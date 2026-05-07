// ============================================================================
// scrapers/fantasysphere.js — Scraper FantasySphere (HTML statique)
// ============================================================================
// Site server-rendered, pas de JS → mode static (axios + cheerio).
//
// Structure HTML identifiée :
//   Carte        : article.product-item-list
//   Titre (full) : div.product-item-name a[title]
//   Lien         : div.product-item-name a[href]
//   Image        : img.product-image[src]
//   Prix promo   : span.product-item-price.promo  (si présent)
//   Prix normal  : span.product-item-price (sans classe extra)
//   Rupture      : span.product-item-label.outofstock présent → out_of_stock
//                  absent → in_stock
//   ID stable    : numéro en fin d'URL (/product/slug-XXXXXXXX)
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class FantasySphereScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'fantasysphere',
      baseUrl: 'https://www.fantasysphere.net',
      mode: 'static',
      urls: opts.urls || [
        'https://www.fantasysphere.net/jeux-de-cartes-a-collectionner/one-piece-tcg/boite-de-boosters-one-piece/',
      ],
      ...opts,
    });
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('article.product-item-list').each((_, el) => {
      const $el = $(el);

      // Titre complet depuis l'attribut title (le texte est tronqué)
      const $link = $el.find('div.product-item-name a').first();
      const title = $link.attr('title') || $link.text().trim();
      if (!title) return;

      // Filtre cible (TARGET_KEYWORDS ou ONEPIECE_KEYWORDS)
      if (!matchesAny(title, keywords)) return;

      const href = $link.attr('href') || '';
      const link = this.absoluteUrl(href);

      // ID stable : numéro en fin d'URL
      const productNum = href.match(/-(\d{6,})(?:\/)?$/)?.[1];
      const id = productNum ? `fantasysphere_${productNum}` : this.makeId(link);

      // Image
      const image = $el.find('img.product-image').first().attr('src');

      // Prix : promo si disponible, sinon prix unique
      const promoPrice = $el.find('span.product-item-price.promo').first().text().trim();
      const basePrice  = $el.find('span.product-item-price:not(.base):not(.promo)').first().text().trim();
      const price = promoPrice || basePrice;

      // Disponibilité : rupture si le badge .outofstock est présent
      const isOutOfStock = $el.find('span.product-item-label.outofstock').length > 0;
      const status = isOutOfStock ? 'out_of_stock' : 'in_stock';
      const availability = isOutOfStock ? 'Rupture de stock' : 'En stock';

      items.push({
        id,
        site: 'fantasysphere',
        title,
        price,
        url: link,
        image: image ? this.absoluteUrl(image) : null,
        status,
        availability,
        statusText: isOutOfStock ? 'rupture' : '',
        description: availability,
      });
    });

    return items;
  }
}
