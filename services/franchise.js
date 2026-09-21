// ============================================================================
// services/franchise.js — Reconnaissance de la licence d'un produit
// ============================================================================
// Extrait de detection.js pour être partagé avec reference.js sans créer de
// cycle d'import (detection → reference → detection).
// ============================================================================

/**
 * Franchises concurrentes vendues par les mêmes boutiques. Nécessaire parce que
 * TARGET_KEYWORDS contient des termes génériques ("anniversary", "best selection
 * vol") qui matchent des produits Gundam / Weiss Schwarz / Digimon : sans ce
 * garde-fou, un display Gundam en stock déclenchait une alerte One Piece.
 */
export const OTHER_FRANCHISES =
  /gundam|digimon|dragon ball|dbs\b|weiss schwarz|bang dream|pok[eé]mon|yu.?gi.?oh|magic the gathering|\bmtg\b|lorcana|flesh (?:&|and) blood|union arena|riftbound|palworld|star wars|shadowverse|vanguard|battle spirits|hololive|kamen rider|naruto|sword art|final fantasy|altered|\bfab\b/i;

export const ONEPIECE_SIGNALS =
  /one\s*piece|onepiece|\bopcg\b|op.?tcg|\bop-?\d{2}\b|\beb-?\d{2}\b|\bprb-?\d{2}\b/i;

/**
 * Écarte les produits d'une autre franchise TCG. Un produit qui porte un signal
 * One Piece explicite (nom de la licence ou code de set OP/EB/PRB) est conservé
 * même si un mot d'une autre licence apparaît dans le titre.
 *
 * @param {string} fields — titre + description + catégorie concaténés
 * @returns {boolean}
 */
export function isOtherFranchise(fields) {
  return OTHER_FRANCHISES.test(fields) && !ONEPIECE_SIGNALS.test(fields);
}
