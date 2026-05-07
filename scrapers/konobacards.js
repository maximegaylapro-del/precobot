// ============================================================================
// scrapers/konobacards.js — Scraper Konoba Cards (WooCommerce theme Tylt)
// ============================================================================
// Structure HTML identifiée :
//   Carte        : li.tylt_card_product
//   ID stable    : slug extrait de l'URL produit → "konobacards_<slug>"
//   Titre        : h3.tylt_card_name (texte, entités HTML décodées par cheerio)
//   Lien         : premier <a> enfant direct du li
//   Image        : img.wp-post-image dans .tylt_card_image
//   Prix         : div.price span.woocommerce-Price-amount bdi
//   Statut       : classe "out-of-stock" sur le <li> → épuisé
//                  a.tylt_card_add_to_cart présent → en stock
//                  preorder keywords dans titre → précommande
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class KonobaCardsScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'konobacards',
      baseUrl: 'https://www.konobacards.fr',
      mode: 'static',
      urls: opts.urls || [
        'https://www.konobacards.fr/categorie-produit/one-piece/displays-one-piece/',
      ],
      ...opts,
    });
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('li.tylt_card_product').each((_, el) => {
      const $el = $(el);

      // Titre
      const title = $el.find('h3.tylt_card_name').first().text().trim();
      if (!title) return;

      if (!matchesAny(title, keywords)) return;

      // Lien (premier <a> qui pointe vers /produit/)
      const href = $el.find('a[href*="/produit/"]').first().attr('href') || '';
      if (!href) return;

      // ID stable depuis le slug de l'URL
      const slugMatch = href.match(/\/produit\/([^/]+)\/?$/);
      if (!slugMatch) return;
      const id = `konobacards_${slugMatch[1]}`;

      // Image
      const image = $el.find('.tylt_card_image img').first().attr('src') || null;

      // Prix (ex : "135,00 €")
      const priceRaw = $el.find('div.price span.woocommerce-Price-amount bdi').first().text().trim();
      const price = priceRaw.replace(/\s/g, ' ').trim();

      // Statut
      const liClass = $el.attr('class') || '';
      const isOutOfStock = liClass.includes('out-of-stock');
      const hasCartBtn = $el.find('a.tylt_card_add_to_cart').length > 0;
      const isPreorderTitle = /pr[eé].?commande|pre.?order|\[pr[eé]/i.test(title);

      let status;
      if (isOutOfStock && isPreorderTitle) {
        status = 'preorder';
      } else if (isOutOfStock) {
        status = 'out_of_stock';
      } else if (isPreorderTitle) {
        status = 'preorder';
      } else if (hasCartBtn) {
        status = 'in_stock';
      } else {
        status = 'unknown';
      }

      items.push({
        id,
        site: 'konobacards',
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
