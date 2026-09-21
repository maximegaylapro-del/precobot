// ============================================================================
// scrapers/hikaru.js — Scraper Hikaru Distribution (Shopify)
// ============================================================================
// HIKARU DISTRIBUTION, SIREN 982 907 735 (actif, NAF 47.65Z — commerce de
// détail de jeux et jouets), Saint-Cloud. Trustpilot 4,9/5 sur ~1 075 avis,
// SIRET publié dans les mentions légales.
//
// Boutique 100 % en ligne, très orientée import japonais : c'est le principal
// intérêt ici, les 26 autres scrapers couvrant surtout le marché FR.
//
// Trois collections, volontairement redondantes (`one-piece-card-game` est
// l'ombrelle, les deux autres découpent par langue) : la déduplication par id
// de BaseScraper.run() absorbe le recouvrement.
//
// Précommandes : la boutique pose un tag Shopify `pre-order`, signal propre
// géré par défaut dans ShopifyJsonScraper.
// ============================================================================
import { ShopifyJsonScraper } from './shopifyJson.js';

export default class HikaruScraper extends ShopifyJsonScraper {
  constructor(opts = {}) {
    super({
      name: 'hikaru',
      baseUrl: 'https://hikarudistribution.com',
      urls: opts.urls || [
        'https://hikarudistribution.com/collections/one-piece-card-game/products.json?limit=250',
        'https://hikarudistribution.com/collections/one-piece-japonais/products.json?limit=250',
        'https://hikarudistribution.com/collections/one-piece-francais/products.json?limit=250',
      ],
      ...opts,
    });
  }
}
