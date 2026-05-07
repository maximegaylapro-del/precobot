// ============================================================================
// scrapers/goupiya.js — Scraper Goupiya (PrestaShop, HTML statique)
// ============================================================================
// Structure HTML identifiée :
//   Carte        : li.ajax_block_product
//   ID stable    : span.cdcgtm_product[data-id-product] → "goupiya_18593"
//   Titre        : a.product-name[title] (attribut title = titre complet non tronqué)
//   Lien         : même <a href>
//   Image        : a.product_img_link img[src]
//   Prix promo   : span.price.product-price.reduc
//   Prix normal  : span.price.product-price (sans .reduc)
//   Statut       : .ajax_add_to_cart_button est un <span class="disabled"> → indispo
//                  .ajax_add_to_cart_button est un <a> actif → en stock
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class GoupiyaScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'goupiya',
      baseUrl: 'https://www.goupiya.com',
      mode: 'static',
      urls: opts.urls || [
        'https://www.goupiya.com/fr/40224-boites-de-boosters?p=1',
        'https://www.goupiya.com/fr/40224-boites-de-boosters?p=2',
      ],
      ...opts,
    });
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('li.ajax_block_product').each((_, el) => {
      const $el = $(el);

      // Titre complet depuis l'attribut title (le texte visible est tronqué)
      const $titleLink = $el.find('a.product-name').first();
      const title = $titleLink.attr('title') || $titleLink.text().trim();
      if (!title) return;

      if (!matchesAny(title, keywords)) return;

      const href = $titleLink.attr('href') || '';
      const link = href || this.absoluteUrl(href);

      // ID stable depuis data-id-product
      const productId =
        $el.find('span.cdcgtm_product[data-id-product]').first().attr('data-id-product') ||
        $el.find('[data-id-product]').first().attr('data-id-product') ||
        href.match(/\/(\d+)-/)?.[1];
      if (!productId) return;
      const id = `goupiya_${productId}`;

      // Image
      const image = $el.find('a.product_img_link img').first().attr('src');

      // Prix : promo en priorité, sinon normal
      const promoPrice = $el.find('span.price.product-price.reduc').first().text().trim();
      const basePrice = $el.find('span.price.product-price').not('.reduc').first().text().trim();
      const price = promoPrice || basePrice;

      // Statut : bouton <span disabled> = indispo, bouton <a> actif = en stock
      const $addBtn = $el.find('.ajax_add_to_cart_button').first();
      const isDisabled = $addBtn.hasClass('disabled') || $addBtn[0]?.tagName === 'span';
      const isPreorderTitle = /pr[eé]commande|pre.?order/i.test(title);

      let status;
      if (!isDisabled && isPreorderTitle) {
        status = 'preorder';
      } else if (!isDisabled) {
        status = 'in_stock';
      } else {
        status = 'out_of_stock';
      }

      items.push({
        id,
        site: 'goupiya',
        title,
        price,
        url: link,
        image: image ? this.absoluteUrl(image) : null,
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
