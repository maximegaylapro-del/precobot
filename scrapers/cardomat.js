// ============================================================================
// scrapers/cardomat.js — Scraper Card-Omat (Shopify JSON API)
// ============================================================================
// Card-Omat est un store Shopify. On utilise l'endpoint JSON natif
// /collections/<slug>/products.json plutôt que du parsing HTML, ce qui est
// plus rapide et robuste aux changements de template.
//
// Statut : tous les produits de la collection "pre-order" sont des précommandes.
//   variants[0].available = true  → précommande ouverte
//   variants[0].available = false → précommande épuisée / pas encore ouverte
// ============================================================================
import axios from 'axios';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';
import { BaseScraper } from './base.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

export default class CardOmatScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'cardomat',
      baseUrl: 'https://www.card-omat.com',
      mode: 'static',
      urls: opts.urls || [
        'https://www.card-omat.com/collections/pre-order/products.json?limit=250',
      ],
      ...opts,
    });
  }

  async run() {
    if (!this.enabled || !this.urls.length) return [];
    const all = [];

    for (const url of this.urls) {
      let attempt = 1;
      const maxAttempts = 3;
      while (attempt <= maxAttempts) {
        try {
          const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
          const { data } = await axios.get(url, {
            timeout: config.scan.requestTimeoutMs,
            headers: {
              'User-Agent': ua,
              Accept: 'application/json',
              'Accept-Language': 'fr-FR,fr;q=0.9',
            },
          });
          const items = this._parseProducts(data?.products || []);
          this.log.info({ url, count: items.length }, 'Scrape OK');
          all.push(...items);
          break;
        } catch (err) {
          if (attempt < maxAttempts) {
            const backoff = 1000 * Math.pow(2, attempt);
            this.log.warn({ url, attempt, err: err.message }, `Retry dans ${backoff}ms`);
            await new Promise((r) => setTimeout(r, backoff));
            attempt++;
          } else {
            this.log.error({ url, err: err.message }, 'Scrape échoué');
            break;
          }
        }
      }
    }

    const seen = new Set();
    return all.filter((p) => {
      if (!p?.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  _parseProducts(products) {
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    return products
      .filter((p) => {
        const title = p.title?.trim();
        return title && matchesAny(title, keywords);
      })
      .map((p) => {
        const variant = p.variants?.[0] || {};
        const available = variant.available === true;
        const rawPrice = parseFloat(variant.price || '0');
        const price = rawPrice ? `€${rawPrice.toFixed(2).replace('.', ',')}` : '';

        return {
          id: `cardomat_${p.id}`,
          site: 'cardomat',
          title: p.title.trim(),
          price,
          url: `${this.baseUrl}/products/${p.handle}`,
          image: p.images?.[0]?.src || null,
          status: available ? 'preorder' : 'out_of_stock',
          availability: available ? 'Précommande' : 'Épuisé',
          statusText: available ? 'Précommande' : 'Épuisé',
          description: '',
        };
      });
  }
}
