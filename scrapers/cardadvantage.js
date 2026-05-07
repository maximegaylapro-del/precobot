// ============================================================================
// scrapers/cardadvantage.js — Scraper Card Advantage (Shopify JSON API)
// ============================================================================
// Store Shopify FR. Endpoint JSON natif, pas de parsing HTML.
//
// Plusieurs variants par produit (booster box, case...) :
//   any variant available → précommande ou en stock selon le titre
//   aucun variant available → out_of_stock
// ============================================================================
import axios from 'axios';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';
import { BaseScraper } from './base.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

export default class CardAdvantageScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'cardadvantage',
      baseUrl: 'https://www.cardadvantage.fr',
      mode: 'static',
      urls: opts.urls || [
        'https://www.cardadvantage.fr/en/collections/one-piece/products.json?limit=250',
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
        const variants = p.variants || [];
        const anyAvailable = variants.some((v) => v.available);
        const firstVariant = variants[0] || {};
        const rawPrice = parseFloat(firstVariant.price || '0');
        const price = rawPrice ? `€${rawPrice.toFixed(2).replace('.', ',')}` : '';

        const titleLower = p.title.toLowerCase();
        const isPreorderTitle = /pre.?order|précommande/i.test(titleLower);

        let status;
        if (!anyAvailable) {
          status = 'out_of_stock';
        } else if (isPreorderTitle) {
          status = 'preorder';
        } else {
          status = 'in_stock';
        }

        return {
          id: `cardadvantage_${p.id}`,
          site: 'cardadvantage',
          title: p.title.trim(),
          price,
          url: `${this.baseUrl}/en/products/${p.handle}`,
          image: p.images?.[0]?.src || null,
          status,
          availability: status === 'preorder' ? 'Précommande'
            : status === 'in_stock' ? 'En stock'
            : 'Épuisé',
          statusText: status === 'preorder' ? 'Précommande'
            : status === 'in_stock' ? 'En stock'
            : 'Épuisé',
          description: '',
        };
      });
  }
}
