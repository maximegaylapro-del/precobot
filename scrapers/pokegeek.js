// ============================================================================
// scrapers/pokegeek.js — Scraper Poke-Geek (Shopify)
// ============================================================================
// Édité par MEDIA DISCOUNT 77 (SASU), SIREN 834 277 857 (actif depuis 2017),
// Brou-sur-Chantereine. Trustpilot 4,4/5 sur 169 avis.
//
// Malgré le nom, le catalogue One Piece est fourni (149 références, dont 22
// displays japonais). La collection `precommande` est multi-licence : le
// filtre mots-clés écarte le Pokémon et le Dragon Ball qui s'y trouvent aussi.
// ============================================================================
import { ShopifyJsonScraper } from './shopifyJson.js';

export default class PokeGeekScraper extends ShopifyJsonScraper {
  constructor(opts = {}) {
    super({
      name: 'pokegeek',
      baseUrl: 'https://www.poke-geek.fr',
      urls: opts.urls || [
        'https://www.poke-geek.fr/collections/one-piece/products.json?limit=250',
        'https://www.poke-geek.fr/collections/precommande/products.json?limit=250',
      ],
      ...opts,
    });
  }
}
