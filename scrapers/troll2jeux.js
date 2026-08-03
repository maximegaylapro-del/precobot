// ============================================================================
// scrapers/troll2jeux.js — Scraper Troll2Jeux (PrestaShop custom, HTML statique)
// ============================================================================
// Structure HTML identifiée :
//   Carte        : article.ajax_block_product[data-id-product]
//   ID stable    : attribut data-id-product → "troll2jeux_10061622"
//   Titre        : h3.s_title_block a[title] (attribut title = titre complet)
//   Lien         : même <a href>
//   Image        : img.front-image[src]
//   Prix         : span.price[aria-label="Prix"]
//   Statut       : .ajax_add_to_cart_button.preorder → précommande
//                  .ajax_add_to_cart_button (sans .preorder) → en stock
//                  .view_button uniquement (pas de .ajax_add_to_cart_button) → épuisé
//
// Le site retourne 403 aux UA génériques. On simule un navigateur complet.
// ============================================================================
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';
import { BaseScraper, httpGet } from './base.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

export default class Troll2JeuxScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'troll2jeux',
      baseUrl: 'https://troll2jeux.com',
      mode: 'static',
      urls: opts.urls || [
        'https://troll2jeux.com/10002430-one-piece',
      ],
      ...opts,
    });
  }

  // Surcharge : headers navigateur complets pour éviter le 403
  async _fetchPage(url) {
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const { data } = await httpGet(url, {
      timeout: config.scan.requestTimeoutMs,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
    });
    return data;
  }

  async run() {
    if (!this.enabled || !this.urls.length) return [];
    const all = [];

    for (const url of this.urls) {
      let attempt = 1;
      const maxAttempts = 3;
      while (attempt <= maxAttempts) {
        try {
          const html = await this._fetchPage(url);
          const $ = cheerio.load(html);
          const items = await this.parse({ $, html, url });
          this.log.info({ url, count: items.length }, 'Scrape OK');
          all.push(...items);
          break;
        } catch (err) {
          if (attempt < maxAttempts) {
            const backoff = 1000 * Math.pow(2, attempt);
            this.log.warn({ url, attempt, err: err.message }, `Retry dans ${backoff}ms`);
            await new Promise((r) => setTimeout(r, backoff));
            attempt++;
          } else {
            this.log.error({ url, err: err.message }, 'Scrape échoué');
            break;
          }
        }
      }
    }

    const seen = new Set();
    return all.filter((p) => {
      if (!p?.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('article.ajax_block_product[data-id-product]').each((_, el) => {
      const $el = $(el);

      // Titre complet depuis l'attribut title (le texte affiché est tronqué)
      const $titleLink = $el.find('h3.s_title_block a').first();
      const title = $titleLink.attr('title') || $titleLink.text().trim();
      if (!title) return;

      if (!matchesAny(title, keywords)) return;

      const href = $titleLink.attr('href') || '';
      if (!href) return;

      // ID stable depuis data-id-product
      const productId = $el.attr('data-id-product');
      if (!productId) return;
      const id = `troll2jeux_${productId}`;

      // Image
      const image =
        $el.find('img.front-image').first().attr('src') ||
        $el.find('a.product_img_link img').first().attr('src');

      // Prix
      const price = $el.find('span.price[aria-label="Prix"]').first().text().trim();

      // Statut via le bouton d'action
      const $cartBtn = $el.find('.ajax_add_to_cart_button').first();
      const hasCartBtn = $cartBtn.length > 0;
      const isPreorder = $cartBtn.hasClass('preorder');

      let status;
      if (hasCartBtn && isPreorder) {
        status = 'preorder';
      } else if (hasCartBtn) {
        status = 'in_stock';
      } else {
        status = 'out_of_stock';
      }

      items.push({
        id,
        site: 'troll2jeux',
        title,
        price,
        url: href,
        image: image || null,
        status,
        availability: status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : 'Épuisé',
        statusText: status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : 'Épuisé',
        description: '',
      });
    });

    return items;
  }
}
