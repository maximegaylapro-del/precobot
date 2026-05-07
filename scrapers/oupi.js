// ============================================================================
// scrapers/oupi.js — Scraper Oupi.eu (PrestaShop + TvShop)
// ============================================================================
// Structure HTML identifiée :
//   Carte        : article.product-miniature[data-id-product]
//                  (contient plusieurs .tvproduct-wrapper en vues répétées — on prend le premier)
//   ID stable    : attribut data-id-product → "oupi_7397"
//   Titre        : h6[itemprop="name"] (premier dans la carte)
//   Lien         : a.thumbnail.product-thumbnail[href] (premier)
//   Image        : img.tvproduct-defult-img[src] (première image par défaut)
//   Prix         : span.price (premier)
//   Statut       : bouton button.add-to-cart avec classe tvproduct-out-of-stock
//                  + attribut disabled → out_of_stock
//                  bouton actif + description contient "précommande" → preorder
//                  bouton actif sans mention précommande → in_stock
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class OupiScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'oupi',
      baseUrl: 'https://oupi.eu',
      mode: 'dynamic',
      waitSelector: 'article.product-miniature',
      urls: opts.urls || [
        'https://oupi.eu/fr/413-precommande-one-piece',
      ],
      ...opts,
    });
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('article.product-miniature[data-id-product]').each((_, el) => {
      const $el = $(el);

      // Titre (premier h6 avec itemprop dans la carte)
      const title = $el.find('h6[itemprop="name"]').first().text().trim();
      if (!title) return;

      // Filtre cible
      if (!matchesAny(title, keywords)) return;

      // ID stable
      const productId = $el.attr('data-id-product');
      const id = `oupi_${productId}`;

      // Lien
      const href = $el.find('a.thumbnail.product-thumbnail').first().attr('href') || '';
      const link = this.absoluteUrl(href);

      // Image (image par défaut, pas l'image de survol)
      const image = $el.find('img.tvproduct-defult-img').first().attr('src');

      // Prix (premier span.price dans la carte)
      const price = $el.find('span.price').first().text().replace(/\s/g, ' ').trim();

      // Statut
      const $btn = $el.find('button.add-to-cart').first();
      const isButtonDisabled = $btn.attr('disabled') !== undefined;
      const isOutOfStockBtn = ($btn.attr('class') || '').includes('tvproduct-out-of-stock');

      // Description (vue liste) pour détecter la précommande
      const description = $el.find('.tv-product-desc').first().text().toLowerCase();
      const isPreorderDesc = /pr[ée]commande/i.test(description);

      let status;
      if (isButtonDisabled || isOutOfStockBtn) {
        status = 'out_of_stock';
      } else if (isPreorderDesc) {
        status = 'preorder';
      } else {
        status = 'in_stock';
      }

      items.push({
        id,
        site: 'oupi',
        title,
        price,
        url: link,
        image: image ? this.absoluteUrl(image) : null,
        status,
        availability: status === 'out_of_stock' ? 'Épuisé'
          : status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : '',
        statusText: isOutOfStockBtn ? 'Out Of Stock' : isPreorderDesc ? 'Précommande' : '',
        description: description.slice(0, 200),
      });
    });

    return items;
  }
}
