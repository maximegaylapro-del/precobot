// ============================================================================
// scrapers/mrjoshop.js — Scraper MrJoShop (Shopify)
// ============================================================================
// Boutique physique 5 rue Chabot de l'Allier, 03100 Montluçon, listée dans
// l'annuaire des boutiques partenaires OPECards. Les mentions légales du site
// affichent encore l'ancien SIRET (523 017 531, micro-entreprise fermée le
// 01/06/2026) : l'activité se poursuit sous SIREN 104 454 137 « MRJOSHOP »,
// actif, à la même adresse.
//
// Deux collections suivies :
//   - global-one-piece : tout le catalogue One Piece
//   - precommande      : les précos toutes licences (One Piece filtré ensuite)
//
// Particularité : les précommandes pas encore ouvertes sont publiées avec
// variants[].price = "0.00" et available = false. Elles remontent donc en
// out_of_stock sans prix — c'est justement leur passage à available = true qui
// doit déclencher l'alerte.
// ============================================================================
import { ShopifyJsonScraper } from './shopifyJson.js';

export default class MrJoShopScraper extends ShopifyJsonScraper {
  constructor(opts = {}) {
    super({
      name: 'mrjoshop',
      baseUrl: 'https://www.mrjoshop.com',
      urls: opts.urls || [
        'https://www.mrjoshop.com/collections/global-one-piece/products.json?limit=250',
        'https://www.mrjoshop.com/collections/precommande/products.json?limit=250',
      ],
      // La boutique écrit "PRECO" en fin de titre, sans tag Shopify dédié.
      ...opts,
    });
  }

  isPreorder(p, url) {
    return super.isPreorder(p, url) || /\bpreco\b/i.test(p.title || '');
  }
}
