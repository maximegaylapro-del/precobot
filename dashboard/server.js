// ============================================================================
// dashboard/server.js — Dashboard Express
// ============================================================================
// Routes :
//   GET /                  -> HTML (page statique)
//   GET /api/products      -> JSON des produits connus
//   GET /api/stats         -> JSON des stats du scheduler
//   POST /api/scan         -> déclenche un scan manuel
// ============================================================================
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { child } from '../services/logger.js';
import * as storage from '../services/storage.js';
import { getDisabledScrapers } from '../scrapers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = child('dashboard');

const PURCHASES_FILE = path.join(path.dirname(__dirname), 'data', 'purchases.json');

function loadPurchases() {
  try {
    if (!existsSync(PURCHASES_FILE)) return [];
    return JSON.parse(readFileSync(PURCHASES_FILE, 'utf8'));
  } catch (_) { return []; }
}

function savePurchases(list) {
  writeFileSync(PURCHASES_FILE, JSON.stringify(list, null, 2));
}

/**
 * @param {import('../services/scheduler.js').Scheduler} scheduler
 * @returns {Promise<import('http').Server>}
 */
export async function startDashboard(scheduler) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/products', (_req, res) => {
    try {
      const products = storage.getAll().sort((a, b) => {
        const at = new Date(b.lastSeenAt).getTime();
        const bt = new Date(a.lastSeenAt).getTime();
        return at - bt;
      });
      res.json({ count: products.length, products });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/stats', (_req, res) => {
    res.json(scheduler.getStats());
  });

  app.post('/api/scan', async (_req, res) => {
    log.info('Scan manuel déclenché via dashboard');
    scheduler.runCycle().catch((err) => log.error({ err }, 'Scan manuel échoué'));
    res.json({ ok: true, message: 'Scan déclenché' });
  });

  app.get('/api/health', (_req, res) => {
    res.json(scheduler.getHealth());
  });

  app.get('/api/disabled', (_req, res) => {
    res.json(getDisabledScrapers());
  });

  app.get('/api/purchases', (_req, res) => {
    res.json(loadPurchases());
  });

  app.post('/api/purchases', (req, res) => {
    const { name, price, boutique, quantity, note } = req.body;
    if (!name || price == null) return res.status(400).json({ error: 'name et price requis' });
    const list = loadPurchases();
    const entry = {
      id: randomUUID(),
      name,
      boutique: boutique || '',
      quantity: parseInt(quantity) || 1,
      price: parseFloat(price),
      note: note || '',
      date: new Date().toISOString(),
    };
    list.push(entry);
    savePurchases(list);
    res.json(entry);
  });

  app.delete('/api/purchases/:id', (req, res) => {
    const list = loadPurchases().filter(p => p.id !== req.params.id);
    savePurchases(list);
    res.json({ ok: true });
  });

  app.delete('/api/products', async (_req, res) => {
    try {
      await storage.clearAll();
      log.info('Dashboard nettoyé via API');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return new Promise((resolve) => {
    const server = app.listen(config.dashboard.port, () => {
      log.info(`🌐 Dashboard disponible sur http://localhost:${config.dashboard.port}`);
      resolve(server);
    });
  });
}
