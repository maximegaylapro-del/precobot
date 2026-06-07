// ============================================================================
// config.js — Chargement et validation de la configuration
// ============================================================================
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Parse une liste séparée par virgules depuis une variable d'environnement.
 * @param {string|undefined} raw
 * @param {string[]} fallback
 * @returns {string[]}
 */
function parseList(raw, fallback = []) {
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseBool(raw, fallback = false) {
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).toLowerCase());
}

function parseInt10(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseHHMM(s) {
  if (!s) return null;
  const [h, m] = s.trim().split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

// Retourne un tableau de {start, end} en minutes depuis minuit.
// Format accepté : "08:00-22:00" ou "08:00-12:00,14:00-22:00"
// Vide = pas de restriction horaire.
function parseActiveHours(raw) {
  if (!raw?.trim()) return [];
  return raw.split(',').map((range) => {
    const parts = range.trim().split('-');
    const start = parseHHMM(parts[0]);
    const end = parseHHMM(parts[1]);
    return { start, end };
  }).filter((r) => r.start !== null && r.end !== null);
}

export const config = {
  rootDir: __dirname,
  dataDir: path.join(__dirname, 'data'),
  dataFile: path.join(__dirname, 'data', 'products.json'),
  logDir: path.join(__dirname, 'logs'),

  scan: {
    intervalSeconds: parseInt10(process.env.SCAN_INTERVAL_SECONDS, 180),
    maxConcurrent: parseInt10(process.env.MAX_CONCURRENT_SCRAPERS, 2),
    requestTimeoutMs: parseInt10(process.env.REQUEST_TIMEOUT_MS, 30000),
    headless: parseBool(process.env.HEADLESS, true),
    proxyUrl: process.env.PROXY_URL || null,
    activeHours: parseActiveHours(process.env.SCAN_ACTIVE_HOURS),
  },

  filters: {
    preorderKeywords: parseList(process.env.PREORDER_KEYWORDS, [
      'précommande',
      'preorder',
      'pre-order',
      'pré-commande',
      'à paraître',
    ]),
    onepieceKeywords: parseList(process.env.ONEPIECE_KEYWORDS, [
      'one piece card game',
      'one piece tcg',
      'op-',
      'op16',
      'spc-01',
      'super premium collection',
    ]),
    blacklistKeywords: parseList(process.env.BLACKLIST_KEYWORDS, [
      'proxy',
      'custom',
      'fake',
    ]),
    // Produits ciblés : seuls ces mots-clés déclenchent une notification.
    // Le matching est flexible : "op16" matche "OP-16", "op-16", "OP16", etc.
    // Laisser vide (TARGET_KEYWORDS=) pour notifier TOUS les produits One Piece.
    targetKeywords: parseList(process.env.TARGET_KEYWORDS, []),
    disabledScrapers: parseList(process.env.DISABLED_SCRAPERS, []),
    // Exclure cartes unité (code OP16-001) et boosters simples (pas de box/display)
    excludeSingles: parseBool(process.env.EXCLUDE_SINGLES, true),
  },

  notifications: {
    discord: {
      enabled: !!process.env.DISCORD_WEBHOOK_URL,
      webhookUrl: process.env.DISCORD_WEBHOOK_URL || null,
      healthWebhookUrl: process.env.DISCORD_HEALTH_WEBHOOK_URL || null,
    },
    email: {
      enabled: parseBool(process.env.EMAIL_ENABLED, false),
      host: process.env.EMAIL_SMTP_HOST,
      port: parseInt10(process.env.EMAIL_SMTP_PORT, 587),
      user: process.env.EMAIL_SMTP_USER,
      pass: process.env.EMAIL_SMTP_PASS,
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
    },
  },

  dashboard: {
    enabled: parseBool(process.env.DASHBOARD_ENABLED, true),
    port: parseInt10(process.env.DASHBOARD_PORT, 3000),
  },
};

/**
 * Vérifie la configuration et retourne un rapport d'erreurs.
 * @returns {string[]} — Liste de warnings/erreurs (vide = OK)
 */
export function validateConfig() {
  const warnings = [];
  if (!config.notifications.discord.enabled && !config.notifications.email.enabled) {
    warnings.push(
      'Aucun canal de notification actif : définis DISCORD_WEBHOOK_URL ou EMAIL_ENABLED=true dans .env'
    );
  }
  if (config.scan.intervalSeconds < 15) {
    warnings.push(
      `SCAN_INTERVAL_SECONDS=${config.scan.intervalSeconds}s est agressif. Risque de blocage IP.`
    );
  }
  return warnings;
}
