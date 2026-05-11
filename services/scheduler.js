// ============================================================================
// services/scheduler.js — Orchestration du polling
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import axios from 'axios';
import pLimit from 'p-limit';
import { config } from '../config.js';
import { child } from './logger.js';
import * as detection from './detection.js';
import * as notifier from './notifier.js';

const log = child('scheduler');

const HEALTH_FILE = join(config.dataDir, 'scraper-health.json');
// Nombre de cycles consécutifs à 0 avant d'alerter (~30 min à 3 min/cycle)
const ZERO_STREAK_THRESHOLD = 10;
// Délai minimum entre deux alertes Discord pour le même scraper (24h)
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Un scraper est "suspect" seulement s'il avait des produits dans les 7 derniers jours
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
        lastError: null, consecutiveFails: 0, totalRuns: 0, totalErrors: 0,
        lastCount: 0, zeroStreak: 0, lastNonZeroAt: null, alertSentAt: null,
      };
    }
    this._loadHealth();
  }

  _loadHealth() {
    try {
      if (!existsSync(HEALTH_FILE)) return;
      const saved = JSON.parse(readFileSync(HEALTH_FILE, 'utf8'));
      for (const [name, data] of Object.entries(saved)) {
        if (this.scraperHealth[name]) {
          Object.assign(this.scraperHealth[name], data);
        }
      }
    } catch (_) {}
  }

  _saveHealth() {
    try {
      writeFileSync(HEALTH_FILE, JSON.stringify(this.scraperHealth, null, 2));
    } catch (_) {}
  }

  async _checkAlerts() {
    if (!config.notifications.discord.webhookUrl) return;
    const now = Date.now();
    const suspects = [];

    for (const s of this.scrapers) {
      const h = this.scraperHealth[s.name];
      if (!h.lastNonZeroAt) continue;
      const hadProductsRecently = (now - new Date(h.lastNonZeroAt).getTime()) < RECENT_WINDOW_MS;
      const isZeroStreaking = h.lastStatus === 'ok' && h.zeroStreak >= ZERO_STREAK_THRESHOLD;
      const alertCooledDown = !h.alertSentAt || (now - new Date(h.alertSentAt).getTime()) > ALERT_COOLDOWN_MS;

      if (hadProductsRecently && isZeroStreaking && alertCooledDown) {
        suspects.push({ name: s.name, zeroStreak: h.zeroStreak, lastNonZeroAt: h.lastNonZeroAt });
        h.alertSentAt = new Date().toISOString();
      }
    }

    if (!suspects.length) return;

    const lines = suspects.map((s) => {
      const ago = Math.round((now - new Date(s.lastNonZeroAt).getTime()) / 60000);
      return `• **${s.name}** — 0 produit depuis ${s.zeroStreak} cycles (dernier succès il y a ${ago} min)`;
    }).join('\n');

    try {
      await axios.post(config.notifications.discord.webhookUrl, {
        embeds: [{
          title: '⚠️ Alerte maintenance scrapers',
          description: `Les scrapers suivants retournent 0 produit alors qu'ils en avaient récemment :\n\n${lines}\n\nVérifiez la page Santé du dashboard.`,
          color: 0xf5a623,
          timestamp: new Date().toISOString(),
        }],
      });
      log.warn({ suspects: suspects.map((s) => s.name) }, 'Alerte maintenance envoyée sur Discord');
    } catch (err) {
      log.error({ err: err.message }, 'Impossible d\'envoyer l\'alerte maintenance');
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
              if (rawProducts.length > 0) {
                h.zeroStreak = 0;
                h.lastNonZeroAt = new Date().toISOString();
              } else {
                h.zeroStreak++;
              }
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

      await this._checkAlerts();
      this._saveHealth();
    } finally {
      this.stats.lastRunAt = new Date().toISOString();
      this.running = false;
      const dur = Date.now() - startedAt;
      log.info({ cycle: this.cycle, durationMs: dur, events: totalEvents }, '✅ Cycle terminé');
    }
  }

  start() {
    if (this.timer) return;
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
    const now = Date.now();
    return this.scrapers.map((s) => {
      const h = this.scraperHealth[s.name];
      const suspect = h.lastStatus === 'ok'
        && h.zeroStreak >= ZERO_STREAK_THRESHOLD
        && h.lastNonZeroAt
        && (now - new Date(h.lastNonZeroAt).getTime()) < RECENT_WINDOW_MS;
      return {
        name: s.name,
        enabled: s.enabled,
        urls: s.urls,
        suspect,
        ...h,
      };
    });
  }
}
