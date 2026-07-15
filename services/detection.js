// ============================================================================
// services/detection.js — Filtrage des produits et détection d'événements
// ============================================================================
import { config } from '../config.js';
import { child } from './logger.js';
import * as storage from './storage.js';
import { matchesAny } from './matcher.js';
import { detectLang } from './lang.js';

const log = child('detection');

/**
 * Retourne true si le produit est une carte unité ou un booster simple à exclure.
 *
 * Cartes unité  : titre contient un code de carte (OP16-001, EB05-042, etc.)
 * Booster simple: titre contient "booster" sans indicateur de format groupé
 *                 (box, display, coffret, case) → "Booster OP16" exclu,
 *                 "Booster Box OP16" / "Display OP16" conservés.
 */
function isExcludedFormat(title) {
  // Cartes unité : code OP16-001, EB05-042, etc.
  if (/\b(?:op|eb)\d{2}-\d{3}\b/i.test(title)) return true;

  // Normalise : lowercase + suppression accents + suppression séparateurs
  const t = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_\s]/g, '');

  // Booster simple : titre contient "booster" sans indicateur de format groupé
  if (
    t.includes('booster') &&
    !t.includes('display') &&    // "Display OP16"
    !t.includes('coffret') &&    // "Coffret OP16"
    !t.includes('case') &&       // "Case boosters"
    !t.includes('box') &&        // "Booster Box"
    !t.includes('boite') &&      // "Boîte de 24 Boosters" → "boite..."
    !t.includes('carton')        // "Carton de 12 Boîtes" → "carton..."
  ) return true;

  return false;
}

const STATUS = Object.freeze({
  PREORDER: 'preorder',
  IN_STOCK: 'in_stock',
  OUT_OF_STOCK: 'out_of_stock',
  UNKNOWN: 'unknown',
});

/**
 * Est-ce un produit One Piece TCG ?
 * Utilise le matching flexible : "op16" matche "op-16", "OP-16", etc.
 */
export function isOnePieceProduct(product) {
  const fields = [product.title, product.description, product.category]
    .filter(Boolean)
    .join(' ');
  if (!matchesAny(fields, config.filters.onepieceKeywords)) return false;
  if (matchesAny(fields, config.filters.blacklistKeywords)) {
    log.debug({ id: product.id }, 'Blacklisted');
    return false;
  }
  return true;
}

/**
 * Le produit correspond-il aux cibles configurées dans TARGET_KEYWORDS ?
 * Si TARGET_KEYWORDS est vide, tous les produits One Piece passent.
 */
export function isTargetProduct(product) {
  if (!config.filters.targetKeywords.length) return true;
  const fields = [product.title, product.description, product.category]
    .filter(Boolean)
    .join(' ');
  return matchesAny(fields, config.filters.targetKeywords);
}

/**
 * Détecte le statut du produit à partir des champs disponibles.
 */
export function inferStatus(product) {
  if (product.status && Object.values(STATUS).includes(product.status)) {
    return product.status;
  }
  const blob = [product.title, product.availability, product.description, product.statusText]
    .filter(Boolean)
    .join(' ');
  if (matchesAny(blob, config.filters.preorderKeywords)) return STATUS.PREORDER;
  if (/out of stock|rupture|\bindispo|sold out|épuisé|epuise/i.test(blob)) return STATUS.OUT_OF_STOCK;
  if (/in stock|disponible|add to cart|ajouter au panier|en stock/i.test(blob)) return STATUS.IN_STOCK;
  return STATUS.UNKNOWN;
}

/**
 * Traite une liste brute de produits scrapés. Met à jour la base locale et
 * retourne les événements notifiables.
 *
 * @param {object[]} rawProducts
 * @param {{ force?: boolean, site?: string }} opts
 *   force=true : réémet les notifs pour TOUS les produits preorder/in_stock
 *                (utilisé par scan:once pour forcer un re-envoi complet)
 *   site       : nom du scraper — utilisé pour taguer les produits et permettre
 *                la réconciliation des produits disparus (voir scheduler).
 * @returns {Promise<{ events: object[], seenIds: string[] }>}
 *   seenIds : ids des produits toujours présents sur la page ce cycle
 *             (ont passé le filtre), quel que soit leur statut.
 */
export async function processBatch(rawProducts, { force = false, site = null } = {}) {
  const events = [];
  const seenIds = [];

  for (const raw of rawProducts) {
    if (!raw?.id || !raw?.title || !raw?.url) {
      log.warn({ raw }, 'Produit invalide (id/title/url manquant) — ignoré');
      continue;
    }
    // Logique de filtrage :
    //   • TARGET_KEYWORDS renseigné → n'accepte que les produits qui matchent
    //     ces keywords (bypass isOnePieceProduct, mais blacklist toujours vérifiée)
    //   • TARGET_KEYWORDS vide → filtre classique isOnePieceProduct
    const fields = [raw.title, raw.description, raw.category].filter(Boolean).join(' ');
    const isBlacklisted = matchesAny(fields, config.filters.blacklistKeywords);
    if (isBlacklisted) { log.debug({ id: raw.id }, 'Blacklisted'); continue; }

    if (config.filters.excludeSingles && isExcludedFormat(raw.title)) {
      log.debug({ id: raw.id, title: raw.title }, 'Format exclu (carte unité / booster simple)');
      continue;
    }

    if (config.filters.targetKeywords.length > 0) {
      if (!matchesAny(fields, config.filters.targetKeywords)) continue;
    } else {
      if (!isOnePieceProduct(raw)) continue;
    }

    const product = { ...raw, site: raw.site ?? site, status: inferStatus(raw), lang: raw.lang ?? detectLang(raw.title) };

    const result = await storage.upsert(product);
    seenIds.push(product.id);

    // Produits épuisés : stockés pour le dashboard mais pas de notif.
    if (product.status === STATUS.OUT_OF_STOCK) continue;

    if (force) {
      // Mode scan:once — notifie tout ce qui est pertinent, sans tenir compte de l'historique
      if (product.status === STATUS.PREORDER) {
        events.push({ type: 'new_preorder', product: result.product });
      } else if (product.status === STATUS.IN_STOCK) {
        events.push({ type: 'back_in_stock', product: result.product });
      }
    } else {
      // Mode normal — notifie uniquement les nouveautés et changements de statut
      if (result.kind === 'new') {
        if (product.status === STATUS.PREORDER) {
          events.push({ type: 'new_preorder', product: result.product });
        } else if (product.status === STATUS.IN_STOCK) {
          events.push({ type: 'back_in_stock', product: result.product });
        }
      } else if (result.kind === 'status') {
        if (product.status === STATUS.PREORDER && result.previousStatus !== STATUS.PREORDER) {
          events.push({ type: 'became_preorder', product: result.product });
        } else if (product.status === STATUS.IN_STOCK && result.previousStatus !== STATUS.IN_STOCK) {
          events.push({ type: 'back_in_stock', product: result.product });
        }
      } else if (result.kind === 'seen' && !result.product.notifiedAt) {
        // Jamais notifié (ex: Discord avait échoué au cycle précédent) → réémettre
        if (product.status === STATUS.PREORDER) {
          events.push({ type: 'new_preorder', product: result.product });
        } else if (product.status === STATUS.IN_STOCK) {
          events.push({ type: 'back_in_stock', product: result.product });
        }
      }
    }
  }

  if (events.length > 0) {
    log.info({ count: events.length, force }, 'Événements détectés');
  }
  return { events, seenIds };
}

export { STATUS };
