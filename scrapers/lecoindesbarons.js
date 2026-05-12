// ============================================================================
// scrapers/lecoindesbarons.js — Scraper Le Coin Des Barons (WooCommerce + GTM)
// ============================================================================
// Structure HTML identifiée :
//   Carte        : div.card-game
//   Données      : span.gtm4wp_productdata[data-gtm4wp_product_data] (JSON complet)
//                  → internal_id, item_name, price, stockstatus, stocklevel, productlink
//   Image        : .card-image img[data-lazy-src] ou [src]
//   Statut stock : stockstatus = "instock" | "onbackorder" | "outofstock"
//                  stocklevel > 0 + instock → en stock
//                  onbackorder → précommande
//                  outofstock ou stocklevel = 0 sans backorder → rupture
// ============================================================================
import { BaseScraper } from './base.js';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';

export default class LeCoinDesBaronsScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'lecoindesbarons',
      baseUrl: 'https://lecoindesbarons.com',
      mode: 'dynamic',
      waitSelector: 'div.card-game',
      urls: opts.urls || [
        'https://lecoindesbarons.com/les-tcg/cartes-onepiece/display-one-piece/',
      ],
      ...opts,
    });
  }

  async parse({ $ }) {
    const items = [];
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('span.gtm4wp_productdata').each((_, el) => {
      const $el = $(el);

      let data;
      try {
        data = JSON.parse($el.attr('data-gtm4wp_product_data') || '{}');
      } catch (_) { return; }

      const title = data.item_name || '';
      if (!title) return;
      if (!matchesAny(title, keywords)) return;

      const id = `lecoindesbarons_${data.internal_id}`;
      const url = data.productlink || this.baseUrl;

      // Prix depuis le JSON (numérique) → formaté
      const price = data.price != null
        ? String(data.price).replace('.', ',') + '€'
        : '';

      // Image depuis la carte parente (lazy-load ou src direct)
      const $card = $el.closest('.card-game');
      const $img = $card.find('.card-image img').first();
      const image = $img.attr('data-lazy-src') || $img.attr('src') || null;

      // Statut — source de vérité = le bouton HTML, pas le GTM
      // <button class="add_to_cart_button"> = commandable (stock ou preco ouverte)
      // <a class="in-basket"> avec "Rupture" = non commandable (rupture ou preco fermée)
      const $btn      = $card.find('button.add_to_cart_button');
      const $linkBtn  = $card.find('.buttons a.in-basket');
      const isRupture = !$btn.length
        || /rupture/i.test($linkBtn.find('span').text());

      const hasPreorder = /pr[ée]commande/i.test($card.find('.card-right').text());

      let status;
      if (isRupture) {
        status = 'out_of_stock';
      } else if (hasPreorder) {
        status = 'preorder';
      } else {
        status = 'in_stock';
      }

      items.push({
        id,
        site: 'lecoindesbarons',
        title,
        price,
        url,
        image,
        status,
        availability: status === 'in_stock' ? 'En stock'
          : status === 'preorder' ? 'Précommande'
          : 'Rupture de stock',
        statusText: status === 'in_stock' ? 'En stock'
          : status === 'preorder' ? 'Précommande'
          : 'Rupture de stock',
        description: '',
      });
    });

    return items;
  }
}
