// ============================================================================
// index.js — Point d'entrée principal
// ============================================================================
// Usage :
//   node index.js         # lance le polling en continu
//   node index.js --once  # un seul scan puis quitte (utile pour cron/CI)
// ============================================================================
import { config, validateConfig } from './config.js';
import { logger } from './services/logger.js';
import * as storage from './services/storage.js';
import * as notifier from './services/notifier.js';
import { Scheduler } from './services/scheduler.js';
import { buildScrapers } from './scrapers/index.js';
import { closeBrowser } from './scrapers/base.js';
import { closeParkageBrowser } from './scrapers/parkage.js';
import { startDashboard } from './dashboard/server.js';

async function main() {
  const args = process.argv.slice(2);
  const runOnce = args.includes('--once');
  const runReset = args.includes('--reset');

  logger.info('=============================================');
  logger.info('🎴 OP-TCG Preorder Monitor — démarrage');
  logger.info('=============================================');

  validateConfig().forEach((w) => logger.warn('⚠️  %s', w));

  await storage.init();

  const scrapers = buildScrapers();
  logger.info({ scrapers: scrapers.map((s) => s.name) }, 'Scrapers chargés');

  const scheduler = new Scheduler(scrapers);

  // Dashboard Express
  let dashboardServer = null;
  if (config.dashboard.enabled && !runOnce) {
    dashboardServer = await startDashboard(scheduler);
  }

  // Ping Discord au démarrage
  if (!runOnce) {
    await notifier.sendStartupPing();
  }

  if (runReset) {
    logger.info('🗑️  Reset : vidage de la base produits...');
    await storage.clearAll();
  }

  if (runOnce) {
    await scheduler.runCycle({ force: true });
    await shutdown(0);
    return;
  }

  scheduler.start();

  // Gestion d'arrêt propre
  const signals = ['SIGINT', 'SIGTERM'];
  signals.forEach((sig) =>
    process.on(sig, () => {
      logger.info(`Signal ${sig} reçu — arrêt en cours...`);
      scheduler.stop();
      dashboardServer?.close?.();
      shutdown(0);
    })
  );

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException');
  });
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'unhandledRejection');
  });
}

async function shutdown(code = 0) {
  try { await closeBrowser(); } catch (_) {}
  try { await closeParkageBrowser(); } catch (_) {}
  setTimeout(() => process.exit(code), 200);
}

main().catch((err) => {
  logger.error({ err }, '💥 Erreur fatale au démarrage');
  shutdown(1);
});
