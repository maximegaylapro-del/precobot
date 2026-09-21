// ============================================================================
// scrapers/mrjoshop.js — Scraper MrJoShop (Shopify, API products.json)
// ============================================================================
// Boutique physique 5 rue Chabot d'Allier, 03100 Montluçon (SIRET
// 523 017 531 00030), listée dans l'annuaire des boutiques partenaires OPECards.
//
// Deux collections suivies :
//   - global-one-piece : tout le catalogue One Piece
//   - precommande      : les précos toutes licences (One Piece filtré ensuite)
//
// Particularité : les précommandes pas encore ouvertes sont publiées avec
// variants[].price = "0.00" et available = false. On les remonte quand même en
// out_of_stock — c'est justement leur passage à available = true qui doit
// déclencher l'alerte.
// ============================================================================
import { BaseScraper, httpGet } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class MrJoShopScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'mrjoshop',
      baseUrl: 'https://www.mrjoshop.com',
      mode: 'static',
      urls: opts.urls || [
        'https://www.mrjoshop.com/collections/global-one-piece/products.json?limit=250',
        'https://www.mrjoshop.com/collections/precommande/products.json?limit=250',
      ],
      maxPages: 5,
      ...opts,
    });
  }

  /** Shopify : &page=2 */
  pageUrl(url, page) {
    return `${url}${url.includes('?') ? '&' : '?'}page=${page}`;
  }

  /**
   * Axios désérialise le JSON, or _runOne passe le résultat à cheerio.load().
   * On force une réponse texte : parse() fait le JSON.parse lui-même.
   */
  async fetchStatic(url) {
    const { data } = await httpGet(url, {
      timeout: config.scan.requestTimeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      responseType: 'text',
      transformResponse: [(d) => d],
      proxy: false,
    });
    return data;
  }

  async parse({ html, url }) {
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    let products;
    try {
      products = JSON.parse(html)?.products || [];
    } catch (_) {
      throw new Error('réponse products.json illisible');
    }
    this.lastRawCount = products.length;

    // Tout ce qui sort de la collection "precommande" est une préco, même si
    // le titre ne le dit pas.
    const fromPreorderCollection = /\/collections\/precommande\//.test(url);

    return products
      .filter((p) => p.title && matchesAny(p.title, keywords))
      .map((p) => {
        const variants = p.variants || [];
        const available = variants.some((v) => v.available);
        const rawPrice = Math.max(0, ...variants.map((v) => parseFloat(v.price) || 0));
        // price = 0 → préco pas encore tarifée, on n'affiche rien plutôt que "0 €"
        const price = rawPrice > 0 ? `${rawPrice.toFixed(2).replace('.', ',')} €` : '';

        const isPreorder = fromPreorderCollection
          || /pr[ée]co(mmande)?\b|pre.?order/i.test(p.title);

        let status;
        if (!available) {
          status = 'out_of_stock';
        } else if (isPreorder) {
          status = 'preorder';
        } else {
          status = 'in_stock';
        }

        return {
          id: `mrjoshop_${p.id}`,
          site: 'mrjoshop',
          title: p.title.replace(/\s+/g, ' ').trim(),
          price,
          url: `${this.baseUrl}/products/${p.handle}`,
          image: p.images?.[0]?.src || null,
          status,
          availability: status === 'preorder' ? 'Précommande'
            : status === 'in_stock' ? 'En stock'
            : 'Épuisé',
          statusText: status === 'preorder' ? 'Précommande'
            : status === 'in_stock' ? 'En stock'
            : 'Épuisé',
          description: '',
        };
      });
  }
}
