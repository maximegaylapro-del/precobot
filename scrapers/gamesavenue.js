// ============================================================================
// scrapers/gamesavenue.js — Scraper Games Avenue (Shopify, HTML statique)
// ============================================================================
// Structure HTML identifiée :
//   Carte        : product-card[data-product-id]
//   ID stable    : attribut data-product-id → "gamesavenue_10406459801941"
//   Titre        : h3.card-heading a (text)
//   Lien         : figure.card-media a.js-product-link[href]
//   Image        : figure.card-media img.card-media-image[src]
//   Prix promo   : span.price-item-sale.price-item-last
//   Prix normal  : span.price-item.price-item-regular (premier)
//   Statut       : div.badge-stock avec classe :
//                  badge-preorder    → preorder
//                  badge-stock-out   → out_of_stock
//                  badge-stock-warning → in_stock (stock faible)
//                  absent + button non disabled → in_stock
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class GamesAvenueScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'gamesavenue',
      baseUrl: 'https://gamesavenue.fr',
      mode: 'static',
      urls: opts.urls || [
        'https://gamesavenue.fr/collections/display-one-piece',
      ],
      ...opts,
    });
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('product-card[data-product-id]').each((_, el) => {
      const $el = $(el);

      // Titre
      const $titleLink = $el.find('h3.card-heading a').first();
      const title = $titleLink.text().trim();
      if (!title) return;

      // Filtre cible
      if (!matchesAny(title, keywords)) return;

      // ID stable
      const productId = $el.attr('data-product-id');
      const id = `gamesavenue_${productId}`;

      // Lien
      const href = $el.find('figure.card-media a.js-product-link').first().attr('href') || $titleLink.attr('href') || '';
      const link = this.absoluteUrl(href);

      // Image
      const image = $el.find('img.card-media-image').first().attr('src');

      // Prix : promo en priorité, sinon régulier
      const price =
        $el.find('span.price-item-sale.price-item-last').first().text().trim() ||
        $el.find('span.price-item.price-item-regular').first().text().trim();

      // Statut via badge-stock + état du bouton
      // Le bouton est la source de vérité : disabled = impossible d'acheter
      const $badge = $el.find('div.badge-stock').first();
      const badgeClass = $badge.attr('class') || '';
      const badgeText = $badge.text().trim();
      const isButtonDisabled = $el.find('button.button-add-to-cart').first().attr('disabled') !== undefined;

      let status;
      if (isButtonDisabled) {
        // Bouton désactivé = rien à acheter, peu importe le badge affiché
        status = 'out_of_stock';
      } else if (badgeClass.includes('badge-preorder')) {
        // Bouton actif + badge précommande = précommande ouverte
        status = 'preorder';
      } else {
        // Bouton actif sans badge précommande = en stock
        status = 'in_stock';
      }

      items.push({
        id,
        site: 'gamesavenue',
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
