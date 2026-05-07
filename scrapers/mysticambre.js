// ============================================================================
// scrapers/mysticambre.js — Scraper Mystic Ambre (CMS custom, HTML statique)
// ============================================================================
// Structure HTML identifiée :
//   Container    : ul.media-list
//   Carte        : li.media[data-gtag-item-id]
//   ID stable    : data-gtag-item-id (hex) → "mysticambre_69956156cf2a7533124ea351"
//   Titre        : h2.media-heading a (texte)
//   Lien         : a[href] (absolu)
//   Image        : img.image-main[src]
//   Prix         : span.final-price (ex: "110,00€ TTC")
//   Statut       : data-stock > 0 → précommande ouverte
//                  data-stock == 0 → précommande complète (épuisé)
//                  data-stock < 0 → épuisé / cas particulier
//   Note         : toutes les URLs ciblées sont des pages de précommande
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class MysticAmbreScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'mysticambre',
      baseUrl: 'https://www.mystic-ambre.fr',
      mode: 'static',
      urls: opts.urls || [
        'https://www.mystic-ambre.fr/boutique/pre-commande/one-piece-pre-co/',
      ],
      ...opts,
    });
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('li.media[data-gtag-item-id]').each((_, el) => {
      const $el = $(el);

      // Titre
      const title = $el.find('h2.media-heading a').first().text().trim();
      if (!title) return;

      if (!matchesAny(title, keywords)) return;

      // ID stable
      const itemId = $el.attr('data-gtag-item-id');
      if (!itemId) return;
      const id = `mysticambre_${itemId}`;

      // Lien
      const href = $el.find('h2.media-heading a').first().attr('href')
        || $el.find('a').first().attr('href') || '';

      // Image
      const image = $el.find('img.image-main').first().attr('src') || null;

      // Prix (supprime " TTC" et espaces insécables)
      const priceRaw = $el.find('span.final-price').first().text().trim();
      const price = priceRaw.replace(/\s*TTC\s*/i, '').replace(/\s/g, ' ').trim();

      // Statut via data-stock
      const stock = parseInt($el.attr('data-stock') || '-1', 10);

      let status;
      if (stock > 0) {
        status = 'preorder';
      } else {
        // stock === 0 : précommande complète, ou négatif : indisponible
        status = 'out_of_stock';
      }

      items.push({
        id,
        site: 'mysticambre',
        title,
        price,
        url: href || `${this.baseUrl}/boutique/pre-commande/one-piece-pre-co/`,
        image,
        status,
        availability: status === 'preorder' ? 'Précommande' : 'Épuisé',
        statusText: status === 'preorder' ? 'Précommande' : 'Épuisé',
        description: '',
      });
    });

    return items;
  }
}
