// ============================================================================
// scrapers/lesgentlemendujeu.js — Scraper Les Gentlemen du Jeu (PrestaShop)
// ============================================================================
// SAS Gambetta Jeux, deux boutiques physiques à Paris (75020 / 75009).
// Rendu 100 % côté serveur → mode static, pas de Puppeteer.
//
// Structure HTML identifiée :
//   Carte        : article.js-product-miniature[data-id-product]
//   ID stable    : data-id-product → "lesgentlemendujeu_12557"
//   Titre        : h2.product-title a
//   Lien         : le href de ce même <a> (déjà absolu)
//   Image        : .thumbnail-container img[data-src] (le src est un SVG vide,
//                  la vraie image n'arrive qu'au lazy-load)
//   Prix         : span.product-price[content] (valeur numérique) ou son texte
//   Rupture      : span.product-unavailable ("Rupture de stock"), et absence
//                  du button.add-to-cart
//   Précommande  : aucun flag dédié — la mention est dans le texte du
//                  .product-description-short ("Précommande : Retraits en
//                  magasin et expéditions pour réception à partir de …")
//
// Les trois catégories couvrent l'ensemble du scellé One Piece : la catégorie
// racine 147 ne contient PAS les displays et boosters, rangés dans 150 et 151.
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class LesGentlemenDuJeuScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'lesgentlemendujeu',
      baseUrl: 'https://lesgentlemendujeu.com',
      mode: 'static',
      urls: opts.urls || [
        'https://lesgentlemendujeu.com/147-one-piece',
        'https://lesgentlemendujeu.com/150-display-one-piece',
        'https://lesgentlemendujeu.com/151-boosters-one-piece',
      ],
      maxPages: 4,
      ...opts,
    });
  }

  /** PrestaShop : /147-one-piece?page=2 */
  pageUrl(url, page) {
    return `${url}${url.includes('?') ? '&' : '?'}page=${page}`;
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    const cards = $('article.js-product-miniature[data-id-product]');
    this.lastRawCount = cards.length;
    // PrestaShop rend un <nav class="pagination"> vide quand il n'y a qu'une
    // page : sans ce signal on irait chercher une page 2 qui renvoie 200 avec
    // une grille vide (donc pas de 404 pour nous arrêter).
    this.lastHasNextPage = $('nav.pagination a[href*="page="]').length > 0;

    cards.each((_, el) => {
      const $el = $(el);

      const $link = $el.find('h2.product-title a').first();
      const title = $link.text().replace(/\s+/g, ' ').trim();
      if (!title) return;
      if (!matchesAny(title, keywords)) return;

      const productId = $el.attr('data-id-product');
      if (!productId) return;

      const href = $link.attr('href') || '';
      const $img = $el.find('.thumbnail-container img').first();
      const image = $img.attr('data-src') || $img.attr('data-full-size-image-url') || null;

      const $price = $el.find('span.product-price').first();
      const price = $price.text().replace(/\s+/g, ' ').trim();

      const description = $el.find('.product-description-short').text().replace(/\s+/g, ' ').trim();

      // Le bouton fait foi : PrestaShop ne le rend que si le produit est
      // réellement commandable (stock disponible ou précommande ouverte).
      const canOrder = $el.find('button.add-to-cart').length > 0;
      const unavailable = $el.find('.product-unavailable').length > 0;
      const isPreorder = /pr[ée]commande/i.test(description);

      let status;
      if (unavailable || !canOrder) {
        // Couvre aussi la précommande fermée : plus rien à acheter.
        status = 'out_of_stock';
      } else if (isPreorder) {
        status = 'preorder';
      } else {
        status = 'in_stock';
      }

      items.push({
        id: `lesgentlemendujeu_${productId}`,
        site: 'lesgentlemendujeu',
        title,
        price,
        url: href ? this.absoluteUrl(href) : this.baseUrl,
        image: image ? this.absoluteUrl(image) : null,
        status,
        availability: status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : 'Rupture de stock',
        statusText: status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : 'Rupture de stock',
        description: description.slice(0, 200),
      });
    });

    return items;
  }
}
