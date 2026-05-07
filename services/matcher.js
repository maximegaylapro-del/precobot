// ============================================================================
// services/matcher.js — Matching flexible de mots-clés
// ============================================================================
// Normalise les deux côtés avant comparaison :
//   - lowercase
//   - suppression des accents (NFD)
//   - suppression des tirets, underscores, espaces
//
// Ainsi "op16" matche "OP-16", "op-16", "OP16", "Op 16", etc.
// ============================================================================

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_\s]/g, '');
}

/**
 * Vérifie si `text` contient le mot-clé `keyword` (matching flexible).
 */
export function matches(text, keyword) {
  return normalize(text).includes(normalize(keyword));
}

/**
 * Vérifie si `text` contient au moins un des mots-clés (matching flexible).
 */
export function matchesAny(text, keywords) {
  return keywords.some((k) => matches(text, k));
}
