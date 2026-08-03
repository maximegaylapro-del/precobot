// ============================================================================
// scrapers/masterset.js — Scraper Masterset (Shopify JSON API)
// ============================================================================
import axios from 'axios';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';
import { BaseScraper } from './base.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

export default class MastersetScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'masterset',
      baseUrl: 'https://masterset.store',
      mode: 'static',
      urls: opts.urls || [
        'https://masterset.store/collections/multi-tcg/products.json?limit=250',
      ],
      ...opts,
    });
  }

  async run() {
    if (!this.enabled || !this.urls.length) return [];
    const all = [];
    let failedUrls = 0;
    let lastError = null;
    const MAX_PAGES = 10; // la collection multi-tcg dépasse 500 produits

    for (const url of this.urls) {
      let firstPageRaw = null;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const target = `${url}${url.includes('?') ? '&' : '?'}page=${page}`;
        let attempt = 1;
        const maxAttempts = 3;
        let products = null;
        while (attempt <= maxAttempts) {
          try {
            const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
            const { data } = await axios.get(target, {
              timeout: config.scan.requestTimeoutMs,
              headers: {
                'User-Agent': ua,
                Accept: 'application/json',
                'Accept-Language': 'fr-FR,fr;q=0.9',
              },
            });
            products = data?.products || [];
            const items = this._parseProducts(products);
            this.log.info({ url: target, count: items.length, raw: products.length }, 'Scrape OK');
            all.push(...items);
            break;
          } catch (err) {
            if (attempt < maxAttempts) {
              const backoff = 1000 * Math.pow(2, attempt);
              this.log.warn({ url: target, attempt, err: err.message }, `Retry dans ${backoff}ms`);
              await new Promise((r) => setTimeout(r, backoff));
              attempt++;
            } else {
              this.log.error({ url: target, err: err.message }, 'Scrape échoué');
              if (page === 1) { failedUrls++; lastError = err; }
              break;
            }
          }
        }
        // page vide, incomplète (= dernière) ou en échec → fin de la pagination
        if (!products || products.length === 0) break;
        if (page === 1) firstPageRaw = products.length;
        else if (products.length < firstPageRaw) break;
      }
    }

    if (failedUrls === this.urls.length && lastError) {
      throw new Error(`toutes les URLs ont échoué (${lastError.message})`);
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

        const isPreorderTitle = /pre.?order|précommande|\[pre/i.test(p.title);

        let status;
        if (!anyAvailable) {
          status = 'out_of_stock';
        } else if (isPreorderTitle) {
          status = 'preorder';
        } else {
          status = 'in_stock';
        }

        return {
          id: `masterset_${p.id}`,
          site: 'masterset',
          title: p.title.trim(),
          price,
          url: `${this.baseUrl}/products/${p.handle}`,
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
