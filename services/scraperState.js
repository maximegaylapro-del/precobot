// ============================================================================
// services/scraperState.js — Persistance de l'état activé/désactivé des scrapers
// ============================================================================
// Stocke les overrides manuels (via dashboard) dans data/scraper-state.json.
// Format : { "<name>": true|false }
//   true  = activé manuellement
//   false = désactivé manuellement
// Un scraper absent du fichier suit la config par défaut (DISABLED_SCRAPERS).
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { child } from './logger.js';

const log = child('scraper-state');
const STATE_FILE = join(config.dataDir, 'scraper-state.json');

let cache = null;

function load() {
  if (cache) return cache;
  cache = {};
  try {
    if (existsSync(STATE_FILE)) {
      cache = JSON.parse(readFileSync(STATE_FILE, 'utf8')) || {};
    }
  } catch (err) {
    log.warn({ err: err.message }, 'Lecture scraper-state.json échouée, réinitialisation');
    cache = {};
  }
  return cache;
}

function save() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    log.error({ err: err.message }, 'Écriture scraper-state.json échouée');
  }
}

/**
 * Retourne l'override manuel pour un scraper, ou undefined s'il n'y en a pas.
 * @param {string} name
 * @returns {boolean|undefined}
 */
export function getOverride(name) {
  const state = load();
  return Object.prototype.hasOwnProperty.call(state, name) ? state[name] : undefined;
}

/**
 * Enregistre l'override manuel activé/désactivé d'un scraper.
 * @param {string} name
 * @param {boolean} enabled
 */
export function setOverride(name, enabled) {
  const state = load();
  state[name] = enabled;
  save();
}
