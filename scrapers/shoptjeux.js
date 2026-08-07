// ============================================================================
// scrapers/shoptjeux.js — Scraper Shop T Jeux (WooCommerce, thème custom)
// ============================================================================
// WooCommerce mais sans le markup standard (li.product) : thème maison en
// Tailwind, rendu côté serveur → mode static.
//
// Structure HTML identifiée :
//   Carte        : .productItem
//   Lien         : a.linkProduct[href]
//   ID stable    : data-id du bouton wishlist → "shoptjeux_3629"
//   Titre        : p.productTitle
//   Image        : img[src]
//   Prix         : .priceValue (montant sans le €)
//   Stock        : .stock_status → "En stock" | "Épuisé"
//   Précommande  : badge texte "Précommande" en surimpression de l'image
//   Note         : un produit peut être en précommande ET épuisé (préco complète)
//                  → le stock prime, sinon on annoncerait une préco fermée.
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class ShopTJeuxScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'shoptjeux',
      baseUrl: 'https://shoptjeux.com',
      mode: 'static',
      urls: opts.urls || [
        'https://shoptjeux.com/catalogue/one-piece/',
      ],
      maxPages: 5,
      ...opts,
    });
  }

  /** WooCommerce : .../one-piece/page/2/ */
  pageUrl(url, page) {
    return `${url.replace(/\/$/, '')}/page/${page}/`;
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    const cards = $('.productItem');
    this.lastRawCount = cards.length;
    // Le thème n'affiche des liens /page/N que s'il y a plusieurs pages : sans ce
    // signal on irait chercher une page 2 inexistante à chaque cycle.
    this.lastHasNextPage = $('a[href*="/page/"]').length > 0;

    cards.each((_, el) => {
      const $el = $(el);

      const title = $el.find('p.productTitle').first().text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      if (!matchesAny(title, keywords)) return;

      const productId = $el.find('[data-id]').first().attr('data-id');
      if (!productId) return;

      const href = $el.find('a.linkProduct').first().attr('href') || '';
      const image = $el.find('img').first().attr('src') || null;

      const priceValue = $el.find('.priceValue').first().text().replace(/\s+/g, ' ').trim();
      const price = priceValue ? `${priceValue}€` : '';

      const stockText = $el.find('.stock_status').first().text().replace(/\s+/g, ' ').trim();
      // Badge en surimpression de la vignette (div sans enfant dans le lien).
      const badge = $el.find('a.linkProduct > div')
        .filter((_i, d) => $(d).children().length === 0)
        .first().text().replace(/\s+/g, ' ').trim();

      const isPreorder = /pr[eé]commande|preorder/i.test(badge);

      let status;
      if (/épuis|epuis|rupture|sold\s*out/i.test(stockText)) {
        // Précommande complète incluse : rien à acheter, donc pas d'alerte.
        status = 'out_of_stock';
      } else if (/en stock|disponible/i.test(stockText)) {
        status = isPreorder ? 'preorder' : 'in_stock';
      } else {
        status = 'unknown';
      }

      items.push({
        id: `shoptjeux_${productId}`,
        site: 'shoptjeux',
        title,
        price,
        url: href || this.baseUrl,
        image,
        status,
        availability: status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : status === 'out_of_stock' ? 'Épuisé'
          : '',
        statusText: [badge, stockText].filter(Boolean).join(' · '),
        description: '',
      });
    });

    return items;
  }
}
