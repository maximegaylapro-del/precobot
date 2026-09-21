// ============================================================================
// scrapers/relictcg.js — Scraper Relic TCG (Shopify)
// ============================================================================
// Édité par RLC FS (enseigne « Relic »), SIREN 804 598 266 (actif depuis 2014,
// NAF 47.65Z), 61 Grande-Rue Saint-Michel à Toulouse — adresse identique à
// celle des mentions légales du site.
//
// La boutique ne pose aucun tag de précommande : le seul signal fiable est
// l'appartenance à la collection `precommandes-one-piece`, d'où le regex
// élargi ci-dessous (le handle porte un suffixe, le motif par défaut de
// ShopifyJsonScraper exige un `/` juste après « precommandes »).
//
// Cette collection est vide aujourd'hui ; on la scrute quand même, c'est
// précisément son remplissage qui doit déclencher une alerte.
// ============================================================================
import { ShopifyJsonScraper } from './shopifyJson.js';

export default class RelicTcgScraper extends ShopifyJsonScraper {
  constructor(opts = {}) {
    super({
      name: 'relictcg',
      baseUrl: 'https://www.relictcg.com',
      urls: opts.urls || [
        'https://www.relictcg.com/collections/one-piece/products.json?limit=250',
        'https://www.relictcg.com/collections/display-boosters-one-piece/products.json?limit=250',
        'https://www.relictcg.com/collections/coffrets-one-piece/products.json?limit=250',
        'https://www.relictcg.com/collections/precommandes-one-piece/products.json?limit=250',
      ],
      preorderCollections: /\/collections\/pre.?commandes?[-a-z0-9]*\//i,
      ...opts,
    });
  }
}
