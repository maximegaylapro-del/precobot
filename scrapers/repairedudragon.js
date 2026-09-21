// ============================================================================
// scrapers/repairedudragon.js — Scraper Le Repaire du Dragon (PrestaShop 1.6)
// ============================================================================
// LE REPAIRE DU DRAGON, SIREN 479 206 005 (actif depuis 2004, NAF 47.65Z),
// boutique physique 43 bis avenue Simon Bolivar, 75019 Paris.
//
// Vieux thème PrestaShop 1.6, très différent du 1.7 de lesgentlemendujeu :
//   Carte       : ul.product_list li.ajax_block_product
//                 (on cadre sur ul.product_list : d'autres blocs de la page
//                  réutilisent la classe ajax_block_product pour des
//                  suggestions hors catégorie)
//   Titre       : a.product-name[title] — le texte affiché est tronqué
//                 ("Booster Les Guerriers les..."), seul l'attribut title
//                 porte le nom complet, indispensable pour extraire le set
//   Lien / ID   : le href du même <a>, de la forme /<cat>/<id>-<slug>.html.
//                 On tire l'id de l'URL plutôt que du data-id-product, qui
//                 n'existe que sur le bouton « Ajouter au panier » — donc
//                 absent justement sur les produits en rupture.
//   Prix        : span.price.product-price ("12.00€")
//   Statut      : bloc [itemprop="offers"] → <link itemprop="availability">
//                 vers schema.org/InStock ou /OutOfStock, suivi d'un texte
//                 libre : "Disponible", "Actuellement Indisponible", ou
//                 "Disponible à partir du 31/07/26".
//
// Cette dernière forme est la précommande : le schema.org reste InStock, seul
// le texte la distingue. Sans ce cas particulier, toutes les précos seraient
// annoncées comme du stock immédiat.
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class RepaireDuDragonScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'repairedudragon',
      baseUrl: 'https://www.lerepairedudragon.fr',
      mode: 'static',
      urls: opts.urls || [
        'https://www.lerepairedudragon.fr/2093-one-piece-card-game',
      ],
      maxPages: 3,
      ...opts,
    });
  }

  /** PrestaShop 1.6 : /2093-one-piece-card-game?p=2 */
  pageUrl(url, page) {
    return `${url}${url.includes('?') ? '&' : '?'}p=${page}`;
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    const cards = $('ul.product_list li.ajax_block_product');
    this.lastRawCount = cards.length;
    this.lastHasNextPage = $('.pagination a[href*="p="]').length > 0;

    cards.each((_, el) => {
      const $el = $(el);

      const $link = $el.find('a.product-name').first();
      // Le title porte le nom complet, le texte du lien est tronqué par le thème.
      const title = ($link.attr('title') || $link.text()).replace(/\s+/g, ' ').trim();
      if (!title) return;
      if (!matchesAny(title, keywords)) return;

      const href = $link.attr('href') || '';
      const idMatch = href.match(/\/(\d+)-[^/]*\.html/);
      if (!idMatch) return;

      const image = $el.find('a.product_img_link img').first().attr('src') || null;
      const rawPrice = $el.find('span.price.product-price').first().text().replace(/\s+/g, ' ').trim();
      // Le thème écrit "12.00€" ; les autres boutiques donnent "12,00 €".
      // parsePrice() gère les deux, mais le dashboard affiche la chaîne brute.
      const price = rawPrice.replace(/(\d)\.(\d{2})\s*€/, '$1,$2 €');

      const $offer = $el.find('[itemprop="offers"]').first();
      const schemaAvail = $offer.find('link[itemprop="availability"]').attr('href') || '';
      // Texte du bloc offre, privé du prix → "Disponible à partir du 31/07/26"
      const availText = $offer.text().replace(price, '').replace(/\s+/g, ' ').trim();

      let status;
      if (/à partir du|a partir du/i.test(availText)) {
        status = 'preorder';
      } else if (/OutOfStock/i.test(schemaAvail) || /indisponible|rupture|épuis/i.test(availText)) {
        status = 'out_of_stock';
      } else if (/InStock/i.test(schemaAvail) || /disponible/i.test(availText)) {
        status = 'in_stock';
      } else {
        status = 'unknown';
      }

      items.push({
        id: `repairedudragon_${idMatch[1]}`,
        site: 'repairedudragon',
        title,
        price,
        url: this.absoluteUrl(href),
        image: image ? this.absoluteUrl(image) : null,
        status,
        availability: status === 'preorder' ? 'Précommande'
          : status === 'in_stock' ? 'En stock'
          : status === 'out_of_stock' ? 'Actuellement indisponible'
          : '',
        statusText: availText.slice(0, 80),
        description: $el.find('p.product-desc').first().text().replace(/\s+/g, ' ').trim().slice(0, 200),
      });
    });

    return items;
  }
}
