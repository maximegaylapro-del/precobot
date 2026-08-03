// ============================================================================
// services/storage.js — Persistance JSON des produits déjà vus
// ============================================================================
// Structure du fichier data/products.json :
// {
//   "version": 1,
//   "updatedAt": "2026-04-21T10:00:00.000Z",
//   "products": {
//     "<productId>": {
//       "id": "ebay_12345",
//       "site": "ebay",
//       "title": "One Piece TCG OP10 Display ...",
//       "price": "89.90 €",
//       "url": "https://...",
//       "status": "preorder" | "in_stock" | "out_of_stock" | "unknown",
//       "firstSeenAt": "...",
//       "lastSeenAt": "...",
//       "notifiedAt": "..."
//     }
//   }
// }
// ============================================================================
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { child } from './logger.js';

const log = child('storage');

let cache = null;          // cache en mémoire
let writeLock = Promise.resolve(); // queue d'écritures pour éviter corruption

function emptyState() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    products: {},
  };
}

export async function init() {
  if (!fsSync.existsSync(config.dataDir)) {
    fsSync.mkdirSync(config.dataDir, { recursive: true });
  }
  if (!fsSync.existsSync(config.dataFile)) {
    await fs.writeFile(config.dataFile, JSON.stringify(emptyState(), null, 2), 'utf8');
    log.info('Base locale créée : %s', config.dataFile);
  }
  await load();
}

export async function load() {
  try {
    const raw = await fs.readFile(config.dataFile, 'utf8');
    cache = JSON.parse(raw);
    if (!cache.products) cache.products = {};
    return cache;
  } catch (err) {
    log.error({ err }, 'Lecture corrompue, restauration d\'un état vide (backup conservé).');
    try {
      const bak = config.dataFile.replace(/\.json$/, `.${Date.now()}.backup.json`);
      await fs.copyFile(config.dataFile, bak);
    } catch (_) {}
    cache = emptyState();
    await persist();
    return cache;
  }
}

async function persist() {
  cache.updatedAt = new Date().toISOString();
  const tmp = config.dataFile + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
  await fs.rename(tmp, config.dataFile); // write atomique
}

/**
 * File d'écriture séquentielle pour éviter les races.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withLock(fn) {
  const next = writeLock.then(fn, fn);
  writeLock = next.catch(() => {});
  return next;
}

export function getAll() {
  if (!cache) throw new Error('storage non initialisé — appelle init() d\'abord.');
  return Object.values(cache.products);
}

export function get(id) {
  return cache?.products?.[id] ?? null;
}

/**
 * Upsert un produit. Retourne :
 *  - { kind: 'new',      product } si jamais vu
 *  - { kind: 'status',   product, previousStatus } si statut change
 *  - { kind: 'seen',     product } sinon
 */
export async function upsert(incoming) {
  return withLock(async () => {
    const now = new Date().toISOString();
    const existing = cache.products[incoming.id];

    if (!existing) {
      const product = {
        ...incoming,
        firstSeenAt: now,
        lastSeenAt: now,
        notifiedAt: null,
      };
      cache.products[incoming.id] = product;
      await persist();
      return { kind: 'new', product };
    }

    const previousStatus = existing.status;
    const product = {
      ...existing,
      ...incoming,
      firstSeenAt: existing.firstSeenAt,
      lastSeenAt: now,
      notifiedAt: existing.notifiedAt,
    };
    cache.products[incoming.id] = product;
    await persist();

    if (previousStatus !== incoming.status) {
      return { kind: 'status', product, previousStatus };
    }
    return { kind: 'seen', product };
  });
}

export async function markNotified(id) {
  return withLock(async () => {
    if (cache.products[id]) {
      cache.products[id].notifiedAt = new Date().toISOString();
      await persist();
    }
  });
}

export async function clearAll() {
  return withLock(async () => {
    cache = emptyState();
    await persist();
    log.info('Tous les produits supprimés');
  });
}

/**
 * Réconciliation : après un scrape réussi d'un site, marque en `out_of_stock`
 * tout produit connu de ce site qui n'est plus présent sur la page
 * (donc absent de `seenIds`). Gère le cas où un produit disparaît de la page
 * au lieu de passer explicitement en rupture — sinon il resterait à jamais
 * dans la section "Disponibles" du dashboard.
 *
 * @param {string} site       nom du scraper (== product.site)
 * @param {Iterable<string>} seenIds  ids vus lors de ce cycle
 * @returns {Promise<number>} nombre de produits basculés en rupture
 */
export async function markAbsentOutOfStock(site, seenIds) {
  return withLock(async () => {
    if (!cache) return 0; // init() pas encore appelé
    const seen = new Set(seenIds);
    let changed = 0;
    for (const [id, p] of Object.entries(cache.products)) {
      if (p.site !== site) continue;
      if (seen.has(id)) continue;
      if (p.status === 'out_of_stock') continue;
      p.status = 'out_of_stock';
      changed++;
    }
    if (changed > 0) {
      await persist();
      log.info({ site, changed }, 'Produits disparus basculés en rupture');
    }
    return changed;
  });
}

export async function purgeStale(maxAgeDays = 30) {
  return withLock(async () => {
    if (!cache) return 0; // init() pas encore appelé
    const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
    let removed = 0;
    for (const [id, p] of Object.entries(cache.products)) {
      const last = new Date(p.lastSeenAt).getTime();
      if (last < cutoff) {
        delete cache.products[id];
        removed++;
      }
    }
    if (removed > 0) {
      await persist();
      log.info({ removed }, 'Produits obsolètes purgés');
    }
    return removed;
  });
}
