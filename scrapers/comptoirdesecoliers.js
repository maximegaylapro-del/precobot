// ============================================================================
// scrapers/comptoirdesecoliers.js — Scraper Comptoir des Écoliers (WooCommerce)
// ============================================================================
// Structure HTML identifiée :
//   Carte        : li.product[data-product_id via bouton]
//   ID stable    : data-product_id sur le bouton → "comptoirdesecoliers_131143"
//   Titre        : h2.woocommerce-loop-product__title (texte complet)
//   Lien         : a.woocommerce-LoopProduct-link[href]
//   Image        : a.woocommerce-LoopProduct-link img[src]
//   Prix         : span.woocommerce-Price-amount.amount bdi
//   Statut       : classe "instock"/"outofstock" sur le <li> = source de vérité
//                  outofstock + preorder keywords dans titre → preorder
//                  outofstock sans keywords → out_of_stock
//                  instock + a.add_to_cart_button → in_stock
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class ComptoirDesEcoliersScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'comptoirdesecoliers',
      baseUrl: 'https://comptoirdesecoliers.com',
      mode: 'static',
      urls: opts.urls || [
        'https://comptoirdesecoliers.com/index.php/product-category/cartes-a-collectionner-2/carte-one-piece/',
        'https://comptoirdesecoliers.com/index.php/product-category/cartes-a-collectionner-2/carte-one-piece/page/2/',
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

      // Titre
      const title = $el.find('h2.woocommerce-loop-product__title').first().text().trim();
      if (!title) return;

      if (!matchesAny(title, keywords)) return;

      // Lien
      const href = $el.find('a.woocommerce-LoopProduct-link').first().attr('href') || '';
      if (!href) return;

      // ID stable depuis data-product_id sur le bouton
      const productId = $el.find('[data-product_id]').first().attr('data-product_id');
      if (!productId) return;
      const id = `comptoirdesecoliers_${productId}`;

      // Image (lazy-loaded : src et data-src ont la même valeur)
      const image = $el.find('a.woocommerce-LoopProduct-link img').first().attr('src') || null;

      // Prix : contenu du bdi sans le symbole €
      const priceRaw = $el.find('span.woocommerce-Price-amount.amount bdi').first().text().trim();
      const price = priceRaw ? priceRaw.replace(/\s/g, ' ') : '';

      // Statut via classes du <li>
      const liClass = $el.attr('class') || '';
      const isOutOfStock = liClass.includes('outofstock');
      const hasCartBtn = $el.find('a.add_to_cart_button').length > 0;
      const isPreorderTitle = /pr[eé].?commande|en attente|pre.?order/i.test(title);

      let status;
      if (isOutOfStock) {
        status = 'out_of_stock';
      } else if (hasCartBtn && isPreorderTitle) {
        status = 'preorder';
      } else if (hasCartBtn) {
        status = 'in_stock';
      } else {
        status = 'unknown';
      }

      // Ignorer les faux produits (prix 0€ = page info)
      if (priceRaw === '0,00€' || priceRaw === '0,00 €') return;

      items.push({
        id,
        site: 'comptoirdesecoliers',
        title,
        price,
        url: href,
        image,
        status,
        availability: status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : status === 'out_of_stock' ? 'Épuisé'
          : '',
        statusText: status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : status === 'out_of_stock' ? 'Épuisé'
          : '',
        description: '',
      });
    });

    return items;
  }
}
