// ============================================================================
// services/scheduler.js — Orchestration du polling
// ============================================================================
import pLimit from 'p-limit';
import { config } from '../config.js';
import { child } from './logger.js';
import * as detection from './detection.js';
import * as notifier from './notifier.js';

const log = child('scheduler');

export class Scheduler {
  constructor(scrapers) {
    this.scrapers = scrapers;
    this.limit = pLimit(config.scan.maxConcurrent);
    this.running = false;
    this.timer = null;
    this.cycle = 0;
    this.stats = { totalEvents: 0, errors: 0, lastRunAt: null, lastError: null };
    this.scraperHealth = {};
    for (const s of scrapers) {
      this.scraperHealth[s.name] = {
        lastStatus: null, lastOkAt: null, lastErrorAt: null,
        lastError: null, consecutiveFails: 0, totalRuns: 0, totalErrors: 0, lastCount: 0,
      };
    }
  }

  async runCycle({ force = false } = {}) {
    if (this.running) {
      log.debug('Cycle en cours, on passe.');
      return;
    }
    this.running = true;
    this.cycle++;
    const startedAt = Date.now();
    log.info({ cycle: this.cycle, force }, '🔄 Début du cycle de scan');

    let totalEvents = 0;
    try {
      const jobs = this.scrapers
        .filter((s) => s.enabled)
        .map((scraper) =>
          this.limit(async () => {
            const h = this.scraperHealth[scraper.name];
            h.totalRuns++;
            try {
              const rawProducts = await scraper.run();
              h.lastStatus = 'ok';
              h.lastOkAt = new Date().toISOString();
              h.consecutiveFails = 0;
              h.lastCount = rawProducts.length;
              if (!rawProducts.length) return [];
              const events = await detection.processBatch(rawProducts, { force });
              return events;
            } catch (err) {
              h.lastStatus = 'error';
              h.lastErrorAt = new Date().toISOString();
              h.lastError = err.message;
              h.consecutiveFails++;
              h.totalErrors++;
              this.stats.errors++;
              this.stats.lastError = { at: new Date().toISOString(), scraper: scraper.name, msg: err.message };
              log.error({ scraper: scraper.name, err: err.message }, 'Scraper a planté');
              return [];
            }
          })
        );

      const results = await Promise.all(jobs);
      const allEvents = results.flat();
      totalEvents = allEvents.length;
      this.stats.totalEvents += totalEvents;

      if (allEvents.length) {
        await notifier.notify(allEvents);
      }
    } finally {
      this.stats.lastRunAt = new Date().toISOString();
      this.running = false;
      const dur = Date.now() - startedAt;
      log.info({ cycle: this.cycle, durationMs: dur, events: totalEvents }, '✅ Cycle terminé');
    }
  }

  start() {
    if (this.timer) return;
    // Premier run immédiat, puis à intervalle régulier
    const intervalMs = Math.max(5000, config.scan.intervalSeconds * 1000);
    log.info({ intervalSec: config.scan.intervalSeconds }, 'Planificateur démarré');

    this.runCycle().catch((err) => log.error({ err }, 'Erreur initiale'));
    this.timer = setInterval(() => {
      this.runCycle().catch((err) => log.error({ err }, 'Erreur cyclique'));
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStats() {
    return {
      ...this.stats,
      cycle: this.cycle,
      running: this.running,
      scrapers: this.scrapers.map((s) => ({ name: s.name, enabled: s.enabled, urls: s.urls.length })),
    };
  }

  getHealth() {
    return this.scrapers.map((s) => ({
      name: s.name,
      enabled: s.enabled,
      ...this.scraperHealth[s.name],
    }));
  }
}
