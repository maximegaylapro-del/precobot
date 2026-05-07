// ============================================================================
// services/lang.js — Détection de langue depuis le titre produit
// ============================================================================
// Retourne 'fr' | 'en' | 'jp' | null
// Priorité : marqueurs explicites entre crochets > mots-clés > abréviations
// ============================================================================

const JP_RE = /\[jap\]|\[jp\]|\[jpn\]|\bjaponais\b|\bjaponaise\b|\bjapanese\b|\bjap\b|\bjpn\b/i;
const EN_RE = /\[ang\]|\[en\]|\[eng\]|\banglais\b|\banglaise\b|\benglish\b|\bang\b|\beng\b/i;
const FR_RE = /\[fr\]|\[vf\]|\bfrançais\b|\bfrancais\b|\bfrench\b|\bvf\b/i;

export function detectLang(title = '') {
  if (JP_RE.test(title)) return 'jp';
  if (EN_RE.test(title)) return 'en';
  if (FR_RE.test(title)) return 'fr';
  return null;
}
