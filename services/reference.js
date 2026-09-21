// ============================================================================
// services/reference.js — Regroupement des annonces par set
// ============================================================================
// Chaque boutique nomme le même produit à sa façon :
//
//   "Boite de 24 Boosters - OP16 : The Time of Battle - One Piece CG - OP-16 - EN"
//   "One Piece Card Game - Display OP16 "The Time of Battle" - Anglais !"
//   "ONE PIECE CARD GAME DISPLAY OP16 ANGLAIS PRE COMMANDE EN ATTENTE"
//
// …soit trois annonces indépendantes en base pour un seul et même carton.
// Ce module en extrait le code de set (OP-16) pour rassembler sous une même
// entrée tout ce qui concerne ce set, toutes boutiques confondues, au lieu
// d'afficher 22 flux à plat. Le format (display, case, blister…) et la langue
// restent affichés sur chaque annonce pour les distinguer.
//
// Volontairement dérivé à la lecture (dashboard) et non persisté : affiner une
// regex ici corrige immédiatement tout l'historique, sans migration du fichier
// products.json.
// ============================================================================
import { detectLang } from './lang.js';
import { isOtherFranchise } from './franchise.js';

// ─────────────────────────────────────────────────────────────────────────────
// Prix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convertit un prix affiché en nombre. Les boutiques écrivent tout et n'importe
 * quoi : "90,00 €", "€144,00", "109,95€", "1 230,00 €" (espace insécable),
 * "84.90 €", "€" (vide). Sert à uniformiser l'affichage et à ordonner les
 * annonces d'un même set.
 *
 * @param {string|number|null|undefined} raw
 * @returns {number|null} montant en euros, ou null si non exploitable
 */
export function parsePrice(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;

  // Espaces insécables utilisés comme séparateur de milliers
  const cleaned = String(raw).replace(/[  ]/g, ' ');
  const match = cleaned.match(/\d[\d\s.,]*/);
  if (!match) return null;

  let num = match[0].replace(/\s/g, '').replace(/[.,]+$/, '');
  const lastSep = Math.max(num.lastIndexOf(','), num.lastIndexOf('.'));

  if (lastSep !== -1) {
    const decimals = num.length - lastSep - 1;
    const hasBoth = num.includes(',') && num.includes('.');
    if (decimals === 3 && !hasBoth) {
      // "1.234" / "1,234" → séparateur de milliers, pas de décimales
      num = num.replace(/[.,]/g, '');
    } else {
      // Le dernier séparateur est le décimal, les autres sont des milliers
      num = num.slice(0, lastSep).replace(/[.,]/g, '') + '.' + num.slice(lastSep + 1);
    }
  }

  const value = parseFloat(num);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Formate un montant à la française : 103.5 → "103,50 €".
 * @param {number|null} value
 */
export function formatPrice(value) {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(2).replace('.', ',')} €`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Référence canonique
// ─────────────────────────────────────────────────────────────────────────────

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’´`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Code de set : OP16, OP-16, op 16, EB05, ST21, PRB01…
// Le \b initial évite de matcher "1st" (pas de frontière entre "1" et "st").
const SET_CODE_RE = /\b(op|eb|prb|st)\s*-?\s*(\d{1,2})\b/gi;

const FORMAT_RE = {
  // Lots guizettefamily : "1 Display – OP16 – … + 1 Case – 24 Blister – OP10 – …"
  // Prix non comparable à un display seul → jamais regroupé avec lui.
  bundle: /\+\s*\d*\s*(display|case|deck|carton|boite|blister|coffret|booster)/,
  // Un binder "Best Selection Vol.4" à 54,90 € n'est pas la collection à 27 €.
  binder: /\bbinder\b|\bclasseur\b|\bportfolio\b/,
  // Case = carton de N displays (~1 100 €), à ne pas confondre avec la
  // "Case de 24 Boosters sous blisters" (~110 €) qui tombe dans `blister`.
  case: /\bcase\s*(?:scellee|sealed)?\s*(?:de|of)?\s*\d+\s*(?:display|boite|box)|sealed case|\bcase scellee\b|carton de \d+\s*(?:boite|display|box)/,
  blister: /sous\s*blisters?|\bblisters?\b/,
  doublePack: /double\s*packs?/,
  anniversary: /\b(\d{1,2})\s*(?:st|nd|rd|th|e|eme|ere)?\s*anniversary\b|\banniversary set\b/,
  bestSelection: /best\s*selection\s*vol\.?\s*(\d+)/,
  deck: /starter deck|\bdeck\b/,
  display: /\bdisplay\b|boite de \d+ boosters?|boite \d+ boosters?|booster box|\bbox de \d+/,
};

export const FORMAT_LABELS = Object.freeze({
  display: 'Display 24 boosters',
  case: 'Case scellée',
  blister: 'Boosters sous blisters',
  'double-pack': 'Double Pack',
  deck: 'Starter Deck',
  binder: 'Binder',
  collection: 'Premium Card Collection',
  set: 'Coffret anniversaire',
  bundle: 'Lot / bundle',
  other: 'Autre',
});

const ORDINALS = { 1: '1st', 2: '2nd', 3: '3rd' };

function ordinal(n) {
  return ORDINALS[n] ?? `${n}th`;
}

/**
 * Classe un titre en famille de produit. L'ordre des tests compte : `binder`
 * avant `bestSelection`, `case` avant `blister`, `bundle` avant tout le reste.
 *
 * @param {string} t — titre normalisé
 * @returns {{ format: string, setCode: string|null, setLabel: string|null }}
 */
function classifyFormat(t) {
  if (FORMAT_RE.bundle.test(t)) return { format: 'bundle' };
  if (FORMAT_RE.binder.test(t)) return { format: 'binder' };
  if (FORMAT_RE.case.test(t)) return { format: 'case' };
  if (FORMAT_RE.blister.test(t)) return { format: 'blister' };
  if (FORMAT_RE.doublePack.test(t)) return { format: 'double-pack' };

  const anniv = t.match(FORMAT_RE.anniversary);
  if (anniv) {
    const n = anniv[1] ? parseInt(anniv[1], 10) : null;
    return n
      ? { format: 'set', setCode: `ANNIV-${String(n).padStart(2, '0')}`, setLabel: `${ordinal(n)} Anniversary Set` }
      : { format: 'set' };
  }

  const best = t.match(FORMAT_RE.bestSelection);
  if (best) {
    const n = parseInt(best[1], 10);
    return {
      format: 'collection',
      setCode: `BS-${String(n).padStart(2, '0')}`,
      setLabel: `Best Selection Vol. ${n}`,
    };
  }

  if (FORMAT_RE.deck.test(t)) return { format: 'deck' };
  if (FORMAT_RE.display.test(t)) return { format: 'display' };
  return { format: 'other' };
}

/**
 * Extrait la référence canonique d'un produit.
 *
 * @param {{ title: string, description?: string, category?: string, lang?: string|null }} product
 * @returns {{
 *   key: string, setCode: string|null, setLabel: string|null,
 *   format: string, formatLabel: string, lang: string|null,
 *   label: string, comparable: boolean
 * }}
 */
export function extractReference(product) {
  const title = product?.title ?? '';
  const t = normalize(title);
  const fields = [product?.title, product?.description, product?.category].filter(Boolean).join(' ');

  // La langue est redérivée du titre : le champ stocké peut dater d'avant un
  // affinage de lang.js. On retombe sur la valeur en base si le titre est muet.
  const lang = detectLang(title) ?? product?.lang ?? null;

  // Filet pour les fiches d'une autre licence encore en base (elles seraient
  // rejetées par detection.js aujourd'hui) : "BanG Dream! 10th Anniversary"
  // ne doit pas atterrir dans un coffret anniversaire One Piece.
  if (isOtherFranchise(fields)) {
    return unclassified('other', lang);
  }

  const cls = classifyFormat(t);
  const format = cls.format;

  // Code de set explicite (OP-16, EB-05…). Sur un lot, plusieurs codes
  // apparaissent : on prend le premier, mais un lot n'est de toute façon pas
  // comparable à un produit seul.
  let setCode = cls.setCode ?? null;
  let setLabel = cls.setLabel ?? null;
  if (!setCode) {
    SET_CODE_RE.lastIndex = 0;
    const m = SET_CODE_RE.exec(t);
    if (m) {
      setCode = `${m[1].toUpperCase()}-${m[2].padStart(2, '0')}`;
      setLabel = setCode;
    }
  }

  const formatLabel = FORMAT_LABELS[format] ?? FORMAT_LABELS.other;
  // Un lot ("1 Display OP16 + 1 Case OP10") porte deux sets à la fois : le
  // ranger sous OP-16 laisserait croire à une annonce OP-16 simple.
  const grouped = Boolean(setCode) && format !== 'bundle';

  if (!grouped) return unclassified(format, lang, setCode, setLabel);

  return {
    key: setCode,
    setCode,
    setLabel: setLabel ?? setCode,
    format,
    formatLabel,
    lang,
    label: setLabel ?? setCode,
    grouped: true,
  };
}

function unclassified(format, lang, setCode = null, setLabel = null) {
  return {
    key: '__unclassified__',
    setCode,
    setLabel,
    format,
    formatLabel: FORMAT_LABELS[format] ?? FORMAT_LABELS.other,
    lang,
    label: setLabel ?? 'Non classé',
    grouped: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Regroupement
// ─────────────────────────────────────────────────────────────────────────────

const AVAILABLE = new Set(['preorder', 'in_stock']);

// Ordre d'affichage à l'intérieur d'un set : ce qui est achetable d'abord, puis
// par format (les displays avant les cases à 1 200 €), puis par prix croissant.
const FORMAT_ORDER = ['display', 'blister', 'double-pack', 'collection', 'set', 'deck', 'case', 'binder', 'other'];

function compareOffers(a, b) {
  if (a.available !== b.available) return a.available ? -1 : 1;
  const fa = FORMAT_ORDER.indexOf(a.format);
  const fb = FORMAT_ORDER.indexOf(b.format);
  if (fa !== fb) return (fa === -1 ? 99 : fa) - (fb === -1 ? 99 : fb);
  if (a.priceValue === null && b.priceValue === null) return a.site.localeCompare(b.site);
  if (a.priceValue === null) return 1;
  if (b.priceValue === null) return -1;
  return a.priceValue - b.priceValue;
}

function toOffer(product) {
  const ref = extractReference(product);
  return {
    id: product.id,
    site: product.site,
    title: product.title,
    url: product.url,
    image: product.image ?? null,
    price: product.price ?? null,
    priceValue: parsePrice(product.price),
    status: product.status,
    lang: ref.lang,
    format: ref.format,
    formatLabel: ref.formatLabel,
    available: AVAILABLE.has(product.status),
    notifiedAt: product.notifiedAt ?? null,
    firstSeenAt: product.firstSeenAt ?? null,
    lastSeenAt: product.lastSeenAt ?? null,
  };
}

/**
 * Regroupe les annonces de toutes les boutiques par set.
 *
 * Une entrée « OP-16 » rassemble donc les displays, cases et blisters OP-16 de
 * toutes les boutiques, en FR/EN/JP. Le format et la langue restent portés par
 * chaque annonce : le regroupement centralise l'information, il ne fusionne
 * pas des produits différents.
 *
 * @param {object[]} products — produits issus de storage.getAll()
 * @returns {{ references: object[], unclassified: object[] }}
 */
export function buildReferences(products = []) {
  const groups = new Map();
  const loose = [];

  for (const product of products) {
    if (!product?.title) continue;
    const ref = extractReference(product);
    const offer = toOffer(product);

    if (!ref.grouped) {
      loose.push({ ...offer, setLabel: ref.setLabel });
      continue;
    }

    let group = groups.get(ref.key);
    if (!group) {
      group = {
        key: ref.key,
        setCode: ref.setCode,
        setLabel: ref.setLabel,
        label: ref.label,
        offers: [],
      };
      groups.set(ref.key, group);
    }
    group.offers.push(offer);
  }

  const references = [...groups.values()].map(finalizeGroup);

  // Sets avec du stock d'abord, puis les mieux fournis, puis alphabétique.
  references.sort((a, b) => {
    if ((a.availableCount > 0) !== (b.availableCount > 0)) return a.availableCount > 0 ? -1 : 1;
    if (a.availableCount !== b.availableCount) return b.availableCount - a.availableCount;
    return a.label.localeCompare(b.label);
  });

  loose.sort(compareOffers);
  return { references, unclassified: loose };
}

function finalizeGroup(group) {
  group.offers.sort(compareOffers);
  const available = group.offers.filter((o) => o.available);

  return {
    ...group,
    offerCount: group.offers.length,
    availableCount: available.length,
    siteCount: new Set(group.offers.map((o) => o.site)).size,
    langs: [...new Set(group.offers.map((o) => o.lang ?? 'unknown'))],
    formats: [...new Set(group.offers.map((o) => o.formatLabel))],
    lastSeenAt: group.offers.reduce(
      (acc, o) => (o.lastSeenAt && (!acc || o.lastSeenAt > acc) ? o.lastSeenAt : acc),
      null
    ),
  };
}
