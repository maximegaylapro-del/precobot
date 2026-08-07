// ============================================================================
// scrapers/benandgames.js — Scraper Ben & Games (Wix Stores, HTML statique)
// ============================================================================
// Boutique Wix : contrairement à play-in, la grille produits est rendue côté
// serveur (les 24 cartes sont dans le HTML servi) → mode static, pas de
// Puppeteer.
//
// Structure HTML identifiée :
//   Carte        : [data-hook="product-list-grid-item"]
//   Titre        : [data-hook="product-item-name"]
//   Lien         : a[href*="/product-page/"]
//   ID stable    : slug de fin d'URL → "benandgames_booster-one-piece-op-16-fr"
//   Image        : img[src]
//   Prix         : [data-hook="product-item-price-to-pay"] (préfixé "Prix")
//   Statut       : libellé du bouton [data-hook="product-item-add-to-cart-button"]
//                  "Rupture de stock" → out_of_stock
//                  "Précommander"     → preorder
//                  "Ajouter au panier"→ in_stock
//   Pagination   : ?page=N (42 articles sur 2 pages pour /category/arrivage)
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

const CARD = '[data-hook="product-list-grid-item"]';

export default class BenAndGamesScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'benandgames',
      baseUrl: 'https://www.ben-and-games.com',
      mode: 'static',
      urls: opts.urls || [
        // Arrivages : c'est là que les displays apparaissent en premier.
        'https://www.ben-and-games.com/category/arrivage',
        // Catégorie One Piece dédiée, absente des arrivages une fois le stock installé.
        'https://www.ben-and-games.com/category/one-piece',
      ],
      maxPages: 5,
      ...opts,
    });
  }

  /** Wix Stores : ...category/arrivage?page=2 */
  pageUrl(url, page) {
    return `${url}${url.includes('?') ? '&' : '?'}page=${page}`;
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    const cards = $(CARD);
    this.lastRawCount = cards.length;

    cards.each((_, el) => {
      const $el = $(el);

      const title = $el.find('[data-hook="product-item-name"]').first().text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      if (!matchesAny(title, keywords)) return;

      const href = $el.find('a[href*="/product-page/"]').first().attr('href') || '';
      const slug = href.split('?')[0].split('/').filter(Boolean).pop();
      if (!slug) return;

      const image = $el.find('img').first().attr('src') || null;

      // "Prix6,00 €" ou "Prix original130,00 €Prix promotionnel117,00 €" :
      // on prend le dernier montant, soit le prix effectivement payé.
      const priceRaw = $el.find('[data-hook="product-item-price-to-pay"]').first().text();
      const amounts = priceRaw.match(/[\d\s.,]+€/g) || [];
      const price = (amounts[amounts.length - 1] || '').replace(/\s+/g, ' ').trim();

      // Le libellé du bouton porte le statut.
      const button = $el.find('[data-hook="product-item-add-to-cart-button"]').first().text().trim();

      let status;
      if (/rupture|épuis|epuis|sold\s*out/i.test(button)) {
        status = 'out_of_stock';
      } else if (/pr[eé]command|preorder/i.test(button)) {
        status = 'preorder';
      } else if (/panier|cart|acheter/i.test(button)) {
        status = 'in_stock';
      } else {
        // Libellé inconnu (bouton absent, variante à choisir…) : on ne devine pas.
        status = 'unknown';
      }

      items.push({
        id: `benandgames_${decodeURIComponent(slug).toLowerCase()}`,
        site: 'benandgames',
        title,
        price,
        url: this.absoluteUrl(href),
        image,
        status,
        availability: status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : status === 'out_of_stock' ? 'Épuisé'
          : '',
        statusText: button,
        description: '',
      });
    });

    return items;
  }
}
