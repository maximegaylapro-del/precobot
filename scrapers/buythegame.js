// ============================================================================
// scrapers/buythegame.js — Scraper Buy The Game (WooCommerce Store API)
// ============================================================================
// Boutique + bar à jeux, 1112 Bd Fernand Darchicourt, 62110 Hénin-Beaumont.
//
// Le thème ne rend qu'une poignée de produits dans le HTML de catégorie (le
// reste arrive en AJAX), mais la Store API de WooCommerce est ouverte et
// renvoie tout en JSON : plus simple et plus fiable que de parser la grille.
//   GET /wp-json/wc/store/v1/products?category=<id>&per_page=100&page=N
//
// Catégories suivies (ids relevés via .../products/categories) :
//   2134 one-piece      — le rayon One Piece
//    573 pre-commande   — toutes licences, One Piece filtré par mots-clés
//   + une recherche plein texte "one piece" pour les produits mal rangés
//
// ⚠️ La boutique masque les produits en rupture : un article épuisé disparaît
// purement et simplement des listings (seul son accès direct par id marche).
// C'est donc `storage.markAbsentOutOfStock()` qui bascule ces produits en
// rupture, et une préco qui ouvre apparaît comme un `new_preorder`.
//
// Prix : prices.price est en unités mineures (2690 + minor_unit 2 → 26,90 €).
// ============================================================================
import { BaseScraper, httpGet } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

const PER_PAGE = 100;

export default class BuyTheGameScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'buythegame',
      baseUrl: 'https://buy-the-game.fr',
      mode: 'static',
      urls: opts.urls || [
        `https://buy-the-game.fr/wp-json/wc/store/v1/products?category=2134&per_page=${PER_PAGE}`,
        `https://buy-the-game.fr/wp-json/wc/store/v1/products?category=573&per_page=${PER_PAGE}`,
        `https://buy-the-game.fr/wp-json/wc/store/v1/products?search=one+piece&per_page=${PER_PAGE}`,
      ],
      maxPages: 3,
      ...opts,
    });
  }

  pageUrl(url, page) {
    return `${url}&page=${page}`;
  }

  /** Même raison que mrjoshop : garder la réponse en texte pour cheerio. */
  async fetchStatic(url) {
    const { data } = await httpGet(url, {
      timeout: config.scan.requestTimeoutMs,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
      responseType: 'text',
      transformResponse: [(d) => d],
      proxy: false,
    });
    return data;
  }

  async parse({ html }) {
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    let products;
    try {
      products = JSON.parse(html);
    } catch (_) {
      throw new Error('réponse Store API illisible');
    }
    if (!Array.isArray(products)) throw new Error('réponse Store API inattendue');

    this.lastRawCount = products.length;
    // La Store API répond 400 au-delà de la dernière page : on s'arrête avant.
    this.lastHasNextPage = products.length === PER_PAGE;

    return products
      .filter((p) => p.name && matchesAny(p.name, keywords))
      .map((p) => {
        const prices = p.prices || {};
        const minor = Number.isFinite(prices.currency_minor_unit) ? prices.currency_minor_unit : 2;
        const raw = parseInt(prices.price, 10);
        const price = Number.isFinite(raw) && raw > 0
          ? `${(raw / 10 ** minor).toFixed(minor).replace('.', ',')} €`
          : '';

        const cats = (p.categories || []).map((c) => c.slug);
        const isPreorder = p.is_on_backorder === true
          || cats.includes('pre-commande')
          || /pr[ée]commande|pre.?order/i.test(p.short_description || '');

        let status;
        if (!p.is_in_stock && !p.is_on_backorder) {
          status = 'out_of_stock';
        } else if (isPreorder) {
          status = 'preorder';
        } else {
          status = 'in_stock';
        }

        return {
          id: `buythegame_${p.id}`,
          site: 'buythegame',
          title: p.name.replace(/\s+/g, ' ').trim(),
          price,
          url: p.permalink || this.baseUrl,
          image: p.images?.[0]?.src || null,
          status,
          availability: status === 'preorder' ? 'Précommande'
            : status === 'in_stock' ? 'En stock'
            : 'Rupture de stock',
          statusText: p.stock_availability?.text || '',
          description: (p.short_description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200),
        };
      });
  }
}
