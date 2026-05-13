// ============================================================================
// scrapers/ludotrotter.js — Scraper Ludotrotter (WooCommerce)
// ============================================================================
// Structure HTML identifiée :
//   Carte        : li.product (WooCommerce standard)
//   ID stable    : data-product_id sur a.button[data-product_id]
//   Titre        : h2.woocommerce-loop-product__title
//   Lien         : a.woocommerce-LoopProduct-link[href]
//   Image        : .et_shop_image img[data-src] (lazy) ou [src]
//   Prix         : span.price ins bdi (prix soldé) ou premier bdi (prix normal)
//   Statut       : classes CSS du li.product
//                  outofstock → out_of_stock
//                  instock + product_cat-precommandes-* → preorder
//                  instock sans precommande → in_stock
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class LudotrotterScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'ludotrotter',
      baseUrl: 'https://ludotrotter.fr',
      mode: 'static',
      urls: opts.urls || [
        'https://ludotrotter.fr/categorie-produit/magasin/cartes/one-piece/',
      ],
      ...opts,
    });
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('li.product').each((_, el) => {
      const $el = $(el);

      const title = $el.find('h2.woocommerce-loop-product__title').first().text().trim();
      if (!title) return;
      if (!matchesAny(title, keywords)) return;

      const $btn = $el.find('a.button[data-product_id]').first();
      const productId = $btn.attr('data-product_id')
        || $el.find('[data-tinv-wl-product]').first().attr('data-tinv-wl-product');
      if (!productId) return;
      const id = `ludotrotter_${productId}`;

      const href = $el.find('a.woocommerce-LoopProduct-link').first().attr('href') || '';
      const link = this.absoluteUrl(href);

      const $img = $el.find('.et_shop_image img').first();
      const image = $img.attr('data-src') || $img.attr('src') || null;

      // Prix soldé (ins) en priorité, sinon premier montant
      const $priceEl = $el.find('span.price').first();
      const $ins = $priceEl.find('ins .woocommerce-Price-amount bdi');
      let price = $ins.length
        ? $ins.text().replace(/\s/g, ' ').trim()
        : $priceEl.find('.woocommerce-Price-amount bdi').first().text().replace(/\s/g, ' ').trim();

      if (!price && $btn.attr('data-price')) {
        price = $btn.attr('data-price').replace('.', ',') + ' €';
      }

      // Statut depuis les classes CSS du li
      const liClass = $el.attr('class') || '';
      const isOutOfStock = liClass.includes('outofstock');
      const isPreorderCat = liClass.includes('product_cat-precommandes') || liClass.includes('product_cat-precommande-op');

      let status;
      if (isOutOfStock) {
        status = 'out_of_stock';
      } else if (isPreorderCat) {
        status = 'preorder';
      } else {
        status = 'in_stock';
      }

      items.push({
        id,
        site: 'ludotrotter',
        title,
        price,
        url: link,
        image: image ? this.absoluteUrl(image) : null,
        status,
        availability: status === 'out_of_stock' ? 'Épuisé'
          : status === 'preorder' ? 'Précommande'
          : 'En stock',
        statusText: status === 'out_of_stock' ? 'Produit épuisé'
          : status === 'preorder' ? 'Précommande'
          : 'En stock',
        description: '',
      });
    });

    return items;
  }
}
