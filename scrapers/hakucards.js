// ============================================================================
// scrapers/hakucards.js — Scraper HakuCards (Shopify JSON API)
// ============================================================================
// NB : au 21/09/2026 la boutique est encore verrouillée par le mot de passe
// Shopify (products.json → 401, /collections/all → /password). Le scraper
// renvoie alors 0 produit avec un warn, sans faire échouer le cycle : il
// commencera à remonter des annonces tout seul le jour de l'ouverture.
// ============================================================================
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';
import { BaseScraper, httpGet } from './base.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

const MAX_PAGES = 10;

export default class HakuCardsScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'hakucards',
      baseUrl: 'https://hakucards.fr',
      mode: 'static',
      urls: opts.urls || [
        'https://hakucards.fr/collections/all/products.json?limit=250',
      ],
      ...opts,
    });
  }

  async run() {
    if (!this.enabled || !this.urls.length) return [];
    const all = [];
    let failedUrls = 0;
    let lastError = null;
    let locked = false;

    for (const url of this.urls) {
      let firstPageRaw = null;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const target = `${url}${url.includes('?') ? '&' : '?'}page=${page}`;
        // Pause entre les pages (anti-429), cf. BaseScraper.run()
        if (page > 1 && config.scan.requestDelayMs > 0) {
          await new Promise((r) => setTimeout(r, config.scan.requestDelayMs));
        }
        let attempt = 1;
        const maxAttempts = 3;
        let products = null;
        while (attempt <= maxAttempts) {
          try {
            const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
            const { data } = await httpGet(target, {
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
            const status = err.response?.status ?? err.httpStatus;
            // Boutique encore fermée (mot de passe Shopify) : inutile d'insister
            if (status === 401) {
              locked = true;
              this.log.warn({ url: target }, 'Boutique verrouillée (mot de passe Shopify) — 0 produit');
              break;
            }
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
        if (locked) break;
        // page vide, incomplète (= dernière) ou en échec → fin de la pagination
        if (!products || products.length === 0) break;
        if (page === 1) firstPageRaw = products.length;
        else if (products.length < firstPageRaw) break;
      }
      if (locked) break;
    }

    if (!locked && failedUrls === this.urls.length && lastError) {
      const err = new Error(`toutes les URLs ont échoué (${lastError.message})`);
      err.httpStatus = lastError.response?.status ?? lastError.httpStatus;
      throw err;
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

        const isPreorderTitle = /pre.?order|pr[ée]commande|\[pre/i.test(p.title);

        let status;
        if (!anyAvailable) {
          status = 'out_of_stock';
        } else if (isPreorderTitle) {
          status = 'preorder';
        } else {
          status = 'in_stock';
        }

        return {
          id: `hakucards_${p.id}`,
          site: 'hakucards',
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
