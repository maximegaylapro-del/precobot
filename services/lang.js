// ============================================================================
// services/lang.js — Détection de langue depuis le titre produit
// ============================================================================
// Retourne 'fr' | 'en' | 'jp' | 'cn' | null
// Priorité : marqueurs explicites entre crochets > mots-clés > abréviations
// ============================================================================

const JP_RE = /\[jap\]|\[jp\]|\[jpn\]|\bjaponais\b|\bjaponaise\b|\bjapanese\b|\bjap\b|\bjpn\b/i;
const EN_RE = /\[ang\]|\[en\]|\[eng\]|\banglais\b|\banglaise\b|\benglish\b|\bang\b|\beng\b/i;
const FR_RE = /\[fr\]|\[vf\]|\bfrançais\b|\bfrancais\b|\bfrench\b|\bvf\b/i;
const CN_RE = /\[cn\]|\bchinois\b|\bchinoise\b|\bchinese\b|\bcn\b/i;

// Suffixe de fin de titre : "… - One Piece EN", "… - OP19 - FR", "… OP16 (EN)"
// (play-in, mystic-ambre, ludisphere…) — cas non couverts par les regex ci-dessus,
// qui exigent des crochets ou le mot complet.
const SUFFIX_RE = /[-–—([]?\s*(fr|en|eng|ang|jp|jap|jpn|cn)\s*[)\]]?\s*$/i;
const SUFFIX_LANG = {
  fr: 'fr', en: 'en', eng: 'en', ang: 'en',
  jp: 'jp', jap: 'jp', jpn: 'jp', cn: 'cn',
};

// Abréviation nue au milieu du titre : "Boite de 24 Boosters FR - One Piece CG".
// On exige un délimiteur (tiret / parenthèse / crochet) d'un côté au moins, sinon
// le « en » français ferait passer "PRE COMMANDE EN ATTENTE" pour de l'anglais.
const DELIMITED_RE =
  /(?:[[(\-–—]\s*(fr|en|jp|cn)\b)|(?:\b(fr|en|jp|cn)\s*[)\]\-–—])/i;

export function detectLang(title = '') {
  const suffix = title.trim().match(SUFFIX_RE);
  if (suffix) return SUFFIX_LANG[suffix[1].toLowerCase()];
  if (JP_RE.test(title)) return 'jp';
  if (EN_RE.test(title)) return 'en';
  if (FR_RE.test(title)) return 'fr';
  if (CN_RE.test(title)) return 'cn';
  const delimited = title.match(DELIMITED_RE);
  if (delimited) return (delimited[1] || delimited[2]).toLowerCase();
  return null;
}
