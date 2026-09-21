// ============================================================================
// scrapers/shopifyJson.js — Base commune aux boutiques Shopify
// ============================================================================
// Toutes les boutiques Shopify exposent /collections/<handle>/products.json,
// qui renvoie le catalogue complet en JSON : titre, prix, disponibilité par
// variante, images et tags. C'est à la fois plus fiable et plus léger que de
// parser la grille HTML.
//
// Une sous-classe se contente de fournir name / baseUrl / urls, et peut
// affiner isPreorder() quand la boutique signale ses précommandes autrement
// (tag dédié, collection séparée, mention dans le titre).
// ============================================================================
import { BaseScraper, httpGet } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

export class ShopifyJsonScraper extends BaseScraper {
  constructor(opts) {
    super({ mode: 'static', maxPages: 5, ...opts });
    // Collections dont TOUT le contenu est en précommande, quel que soit le
    // titre du produit (ex. /collections/precommande).
    this.preorderCollections = opts.preorderCollections || /\/collections\/(pre.?commandes?|pre.?orders?)\//i;
    // Tags que la boutique pose sur ses précommandes (Shopify les renvoie
    // dans products[].tags).
    this.preorderTags = opts.preorderTags || /^(pre.?order|pr[ée]co(mmande)?)$/i;
  }

  /** Shopify pagine avec &page=N (250 produits max par page). */
  pageUrl(url, page) {
    return `${url}${url.includes('?') ? '&' : '?'}page=${page}`;
  }

  /**
   * Axios désérialise le JSON, or _runOne() passe le résultat à cheerio.load()
   * qui attend une chaîne. On force donc une réponse texte, et parse() fait le
   * JSON.parse lui-même.
   */
  async fetchStatic(url) {
    const { data } = await httpGet(url, {
      timeout: config.scan.requestTimeoutMs,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      responseType: 'text',
      transformResponse: [(d) => d],
      proxy: false,
    });
    return data;
  }

  /**
   * Précommande ? Surchargeable. Par défaut : collection dédiée, tag dédié, ou
   * mention explicite dans le titre.
   * @param {object} p produit Shopify
   * @param {string} url URL de la collection d'où il vient
   */
  isPreorder(p, url) {
    if (this.preorderCollections.test(url)) return true;
    if ((p.tags || []).some((t) => this.preorderTags.test(String(t).trim()))) return true;
    return /\bpr[ée]co(mmande)?\b|\bpre.?order\b/i.test(p.title || '');
  }

  async parse({ html, url }) {
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    let products;
    try {
      products = JSON.parse(html)?.products;
    } catch (_) {
      throw new Error('réponse products.json illisible');
    }
    if (!Array.isArray(products)) throw new Error('réponse products.json inattendue');

    this.lastRawCount = products.length;

    return products
      .filter((p) => p.title && matchesAny(p.title, keywords))
      .map((p) => {
        const variants = p.variants || [];
        const available = variants.some((v) => v.available);
        // Prix le plus bas parmi les variantes disponibles, à défaut parmi
        // toutes : afficher le prix d'une variante épuisée induirait en erreur.
        const pool = variants.filter((v) => v.available).length
          ? variants.filter((v) => v.available)
          : variants;
        const amounts = pool.map((v) => parseFloat(v.price)).filter((n) => Number.isFinite(n) && n > 0);
        const price = amounts.length
          ? `${Math.min(...amounts).toFixed(2).replace('.', ',')} €`
          : '';

        let status;
        if (!available) {
          status = 'out_of_stock';
        } else if (this.isPreorder(p, url)) {
          status = 'preorder';
        } else {
          status = 'in_stock';
        }

        return {
          id: `${this.name}_${p.id}`,
          site: this.name,
          title: p.title.replace(/\s+/g, ' ').trim(),
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

export default ShopifyJsonScraper;
