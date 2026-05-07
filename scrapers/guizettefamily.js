// ============================================================================
// scrapers/guizettefamily.js — Scraper Guizette Family (WooCommerce + Beaver Builder)
// ============================================================================
// Structure HTML identifiée :
//   Carte        : div.fl-post-grid-post
//   ID stable    : classe "post-30603" → "guizettefamily_30603"
//   Titre        : h2 a[title] (attribut title = titre complet non tronqué)
//   Lien         : même <a href>
//   Image        : div.fl-post-image img[src]
//   Prix promo   : span.woocommerce-Price-amount.promo-price
//   Prix normal  : span.woocommerce-Price-amount.normal-price
//   Statut       : classes "instock"/"outofstock" sur la carte
//                  + badge p.gf_precommande (précommande dispo)
//                  + badge p.horsstock (épuisé, sortie future)
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class GuizettefamilyScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'guizettefamily',
      baseUrl: 'https://www.guizettefamily.com',
      mode: 'static',
      urls: opts.urls || [
        'https://www.guizettefamily.com/precommandes-one-piece/',
      ],
      ...opts,
    });
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('div.fl-post-grid-post').each((_, el) => {
      const $el = $(el);

      // Titre depuis l'attribut title (texte complet, non tronqué)
      const $titleLink = $el.find('h2 a').first();
      const title = $titleLink.attr('title') || $titleLink.text().trim();
      if (!title) return;

      // Filtre cible
      if (!matchesAny(title, keywords)) return;

      const href = $titleLink.attr('href') || '';
      const link = this.absoluteUrl(href);

      // ID stable depuis la classe "post-XXXXX"
      const cls = $el.attr('class') || '';
      const postId = cls.match(/\bpost-(\d+)\b/)?.[1] || this.makeId(link);
      const id = `guizettefamily_${postId}`;

      // Image
      const image = $el.find('div.fl-post-image img').first().attr('src');

      // Prix : promo en priorité, sinon normal
      const price =
        $el.find('span.woocommerce-Price-amount.promo-price').first().text().trim() ||
        $el.find('span.woocommerce-Price-amount.normal-price').first().text().trim();

      // Statut
      const isInStock = /\binstock\b/.test(cls);
      const isOutOfStock = /\boutofstock\b/.test(cls);
      const isPreorderBadge = $el.find('p.gf_precommande').length > 0;

      let status;
      if (isInStock && isPreorderBadge) {
        status = 'preorder';
      } else if (isOutOfStock) {
        status = 'out_of_stock';
      } else if (isInStock) {
        status = 'in_stock';
      } else {
        status = 'unknown';
      }

      const badgeText = $el.find('p.gf_precommande, p.horsstock').first().text().trim();

      items.push({
        id,
        site: 'guizettefamily',
        title,
        price,
        url: link,
        image: image ? this.absoluteUrl(image) : null,
        status,
        availability: status === 'out_of_stock' ? 'Épuisé'
          : status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : '',
        statusText: badgeText,
        description: badgeText,
      });
    });

    return items;
  }
}
