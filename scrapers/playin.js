// ============================================================================
// scrapers/playin.js — Scraper Play-in (Next.js App Router, rendu client)
// ============================================================================
// Le HTML servi ne contient pas les résultats : ils sont rendus côté client
// depuis le flux RSC → mode dynamic obligatoire (waitUntil networkidle2).
//
// URL ciblée : la recherche "one piece" filtrée sur la famille One Piece (24)
// et les produits scellés — même page que /recherche?q=one+piece, mais sans les
// 330 résultats hors sujet (goodies, puzzles, jeux de société, cartes à l'unité).
//
// Structure HTML identifiée (après rendu) :
//   Grille       : div.grid--template_productCatalog
//                  (indispensable : la page contient aussi un carrousel
//                   "produits du moment" avec des tiles d'autres licences)
//   Carte        : .tile--type_catalogItem
//   Titre + lien : a[href*="/produit/"]
//   ID stable    : id numérique dans l'URL /produit/<id>/<slug> → "playin_663265"
//   Image        : img[src]
//   Prix         : .text--variant_price
//   Statut       : badge en 1er enfant + présence du bouton panier
//                  "Rupture temporaire" / "Temporary rupture"  → out_of_stock
//                  "À venir" / "Upcoming" (pas de bouton panier) → out_of_stock
//                  bouton panier + "Sortie prévue" / "Précommande" → preorder
//                  bouton panier seul                            → in_stock
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

const RESULTS_GRID = '.grid--template_productCatalog';
const CARD = `${RESULTS_GRID} .tile--type_catalogItem`;

export default class PlayinScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'playin',
      baseUrl: 'https://www.play-in.com',
      mode: 'dynamic',
      waitUntil: 'networkidle2',
      waitSelector: CARD,
      urls: opts.urls || [
        'https://www.play-in.com/fr/recherche?q=one+piece&searchType=SEALED_PRODUCTS&family=24',
      ],
      maxPages: 5,
      ...opts,
    });
  }

  /** Play-in : ...&page=2 */
  pageUrl(url, page) {
    return `${url}${url.includes('?') ? '&' : '?'}page=${page}`;
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    const cards = $(CARD);
    this.lastRawCount = cards.length;
    // Play-in n'affiche un lien "?page=N" que s'il reste des résultats : sans ce
    // signal, run() irait chercher une page 2 inexistante (la grille est alors
    // absente → 3 tentatives dans le vide).
    this.lastHasNextPage = $('a[href*="page="]').length > 0;

    cards.each((_, el) => {
      const $el = $(el);

      const $link = $el.find('a[href*="/produit/"]').first();
      const title = $link.text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      if (!matchesAny(title, keywords)) return;

      const href = $link.attr('href') || '';
      const productId = href.match(/\/produit\/(\d+)/)?.[1];
      if (!productId) return;

      const image = $el.find('img').first().attr('src') || null;
      const price = $el.find('.text--variant_price').first().text().replace(/\s+/g, ' ').trim();

      // Le badge (Précommande, À venir, Rupture temporaire, Top vente, -8%…) est
      // le 1er enfant de la carte ; "Sortie prévue le JJ/MM" est dans un <p>.
      const badge = $el.children('div').first().text().replace(/\s+/g, ' ').trim();
      const blob = $el.text().replace(/\s+/g, ' ');
      const hasCartButton = $el.find('button[title]').filter((_i, b) => {
        const label = $(b).attr('title') || '';
        return /panier|cart/i.test(label);
      }).length > 0;

      let status;
      if (/rupture|épuis|epuis|sold\s*out/i.test(badge)) {
        status = 'out_of_stock';
      } else if (!hasCartButton) {
        // "À venir / Bientôt disponible" : annoncé mais pas encore commandable.
        // Le jour où la précommande ouvre, le bouton apparaît → became_preorder.
        status = 'out_of_stock';
      } else if (/pr[eé]commande|preorder|sortie pr[eé]vue|scheduled for release/i.test(blob)) {
        status = 'preorder';
      } else {
        status = 'in_stock';
      }

      // Date de sortie : utile dans la notif Discord et pour l'inférence de statut.
      const releaseLine = ($el.find('p').filter((_i, p) =>
        /sortie pr[eé]vue|scheduled for release/i.test($(p).text())).first().text() || '').replace(/\s+/g, ' ').trim();

      items.push({
        id: `playin_${productId}`,
        site: 'playin',
        title,
        price,
        url: this.absoluteUrl(href),
        image,
        status,
        availability: status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : 'Épuisé',
        statusText: badge || (status === 'in_stock' ? 'En stock' : 'Épuisé'),
        description: releaseLine,
      });
    });

    return items;
  }
}
