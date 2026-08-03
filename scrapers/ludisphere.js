// ============================================================================
// scrapers/ludisphere.js — Scraper Ludisphere (Shopify, HTML statique)
// ============================================================================
// Structure HTML identifiée :
//   Carte        : li.grid__item
//   ID stable    : attribut id du lien principal → "CardLink-...__product-grid-10631342948685"
//   Titre        : div.card__heading.h5 a (outer section, hors overlay)
//   Lien         : même <a href="/products/...">
//   Image        : img.motion-reduce[src]
//   Prix         : span.custom-price-final puis span.price-item--regular
//   Précommande  : span.badge contenant "Précommande"
//   Bouton       : .quick-add__submit  <a> = précommande / <button> = stock
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class LudisphereScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'ludisphere',
      baseUrl: 'https://ludisphere.fr',
      mode: 'static',
      urls: opts.urls || [
        'https://ludisphere.fr/collections/one-piece-card-game-precommande',
      ],
      // Collection paginée : sans ça seule la page 1 était lue.
      maxPages: 10,
      ...opts,
    });
  }

  /** Shopify : ...collection?page=2 */
  pageUrl(url, page) {
    return `${url}${url.includes('?') ? '&' : '?'}page=${page}`;
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    const cards = $('li.grid__item');
    this.lastRawCount = cards.length;

    cards.each((_, el) => {
      const $el = $(el);

      // Titre : div.card__heading.h5 a (section outer, hors overlay)
      const $titleLink = $el.find('div.card__heading.h5 a').first();
      const title = $titleLink.text().trim();
      if (!title) return;

      // Filtre cible
      if (!matchesAny(title, keywords)) return;

      const href = $titleLink.attr('href') || '';
      const link = this.absoluteUrl(href);

      // ID stable depuis l'attribut id du lien : "CardLink-...__product-grid-10631342948685"
      const linkId = $titleLink.attr('id') || '';
      const productNum = linkId.match(/__product-grid-(\d+)/)?.[1] || this.makeId(link);
      const id = `ludisphere_${productNum}`;

      // Image
      const image = $el.find('img.motion-reduce').first().attr('src');

      // Prix
      const price =
        $el.find('span.custom-price-final').first().text().trim() ||
        $el.find('span.price-item--regular').first().text().trim();

      // Statut
      const badgeText = $el.find('div.card__badge span.badge').first().text().trim().toLowerCase();
      const isPreorder = badgeText.includes('précommande') || badgeText.includes('precommande');

      // Chercher le bouton quick-add (classe avec ou sans "2" selon le thème servi)
      const $quickAdd = $el.find('.quick-add__submit2, .quick-add__submit').first();
      const quickAddTag = $quickAdd[0]?.name;
      const quickAddText = $quickAdd.find('span').first().text().trim().toLowerCase();
      const isSoldOutPrice = $el.find('.price--sold-out').length > 0;
      const isDisabled = $quickAdd.attr('disabled') !== undefined;

      let status;
      // Épuisé : prix marqué sold-out OU bouton désactivé
      if (isSoldOutPrice || isDisabled) {
        status = 'out_of_stock';
      } else if (isPreorder) {
        status = 'preorder';
      } else if (quickAddTag === 'button' && quickAddText.includes('épuisé')) {
        status = 'out_of_stock';
      } else if (quickAddTag === 'button' && quickAddText.includes('ajouter')) {
        status = 'in_stock';
      } else if (quickAddTag === 'a' && quickAddText.includes('précommande')) {
        status = 'preorder';
      } else {
        status = 'unknown';
      }

      items.push({
        id,
        site: 'ludisphere',
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
