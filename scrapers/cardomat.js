// ============================================================================
// scrapers/cardomat.js — Scraper Card-Omat (Shopify headless / Hydrogen, HTML)
// ============================================================================
// L'ancienne implémentation tapait /collections/pre-order/products.json : cet
// endpoint renvoie désormais 404 (boutique passée en storefront headless), le
// scraper ne remontait donc plus AUCUN produit en silence. On parse le HTML
// rendu côté serveur de la collection pre-order.
//
// Structure HTML identifiée :
//   Grille       : div[data-test="product-grid"]
//   Carte        : > div (enfant direct)
//   Titre        : h3
//   Lien         : a[href*="/products/"]  (préfixé /en-fr/)
//   Image        : img[src]
//   Prix         : 1er montant "€xx" du texte de la carte
//   Statut       : bouton "Add to Cart" → précommande ouverte
//                  bouton disabled "Sold Out" → épuisé
//   ID stable    : handle produit (dernier segment de l'URL)
//   Note         : la collection tient sur une seule page (?page=2 renvoie la
//                  même grille), pas de pagination à suivre.
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class CardOmatScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'cardomat',
      baseUrl: 'https://www.card-omat.com',
      mode: 'static',
      urls: opts.urls || [
        'https://www.card-omat.com/collections/pre-order',
        'https://www.card-omat.com/collections/one-piece',
      ],
      ...opts,
    });
  }

  async parse({ $, url }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    const cards = $('[data-test="product-grid"] > div');
    this.lastRawCount = cards.length;
    const isPreorderCollection = /pre-order/.test(url);

    cards.each((_, el) => {
      const $el = $(el);

      const title = $el.find('h3').first().text().trim();
      if (!title) return;
      if (!matchesAny(title, keywords)) return;

      const href = $el.find('a[href*="/products/"]').first().attr('href') || '';
      if (!href) return;
      const handle = href.split('?')[0].split('/').filter(Boolean).pop();
      if (!handle) return;

      const image = $el.find('img').first().attr('src') || null;

      // Le texte de la carte concatène titre + prix (+ "SAVE x%" si promo) :
      // le 1er montant est le prix effectif.
      const price = ($el.text().match(/€\s?[\d.,]+/) || [''])[0].replace(/\s/g, '');

      // Épuisé : le bouton d'ajout au panier est désactivé ("Sold Out")
      const soldOut =
        $el.find('button[disabled]').length > 0 ||
        /sold\s*out/i.test($el.find('button').text());

      const status = soldOut ? 'out_of_stock' : isPreorderCollection ? 'preorder' : 'in_stock';

      items.push({
        id: `cardomat_${handle}`,
        site: 'cardomat',
        title,
        price,
        url: this.absoluteUrl(href),
        image,
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
