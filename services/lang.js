// ============================================================================
// services/lang.js — Détection de langue depuis le titre produit
// ============================================================================
// Retourne 'fr' | 'en' | 'jp' | null
// Priorité : marqueurs explicites entre crochets > mots-clés > abréviations
// ============================================================================

const JP_RE = /\[jap\]|\[jp\]|\[jpn\]|\bjaponais\b|\bjaponaise\b|\bjapanese\b|\bjap\b|\bjpn\b/i;
const EN_RE = /\[ang\]|\[en\]|\[eng\]|\banglais\b|\banglaise\b|\benglish\b|\bang\b|\beng\b/i;
const FR_RE = /\[fr\]|\[vf\]|\bfrançais\b|\bfrancais\b|\bfrench\b|\bvf\b/i;

// Suffixe de fin de titre : "… - One Piece EN", "… - OP19 - FR", "… OP16 (EN)"
// (play-in, mystic-ambre, ludisphere…) — cas non couverts par les regex ci-dessus,
// qui exigent des crochets ou le mot complet.
const SUFFIX_RE = /[-–—([]?\s*(fr|en|eng|ang|jp|jap|jpn)\s*[)\]]?\s*$/i;
const SUFFIX_LANG = { fr: 'fr', en: 'en', eng: 'en', ang: 'en', jp: 'jp', jap: 'jp', jpn: 'jp' };

export function detectLang(title = '') {
  const suffix = title.trim().match(SUFFIX_RE);
  if (suffix) return SUFFIX_LANG[suffix[1].toLowerCase()];
  if (JP_RE.test(title)) return 'jp';
  if (EN_RE.test(title)) return 'en';
  if (FR_RE.test(title)) return 'fr';
  return null;
}
