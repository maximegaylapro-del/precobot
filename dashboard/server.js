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
import { config } from '../config.js';
import { child } from '../services/logger.js';
import * as storage from '../services/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = child('dashboard');

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
