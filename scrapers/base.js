// ============================================================================
// scrapers/base.js — Classe abstraite pour tous les scrapers
// ============================================================================
// Deux modes supportés :
//   - "static"  : axios + cheerio (rapide, léger, pas de JS)
//   - "dynamic" : puppeteer-extra + stealth (lourd, mais passe les protections)
//
// Implémente parse() dans les sous-classes. Les données retournées doivent
// avoir la forme :
//   { id, title, price, url, image?, status?, availability?, description?, category? }
// ============================================================================
import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { config } from '../config.js';
import { child } from '../services/logger.js';

puppeteer.use(StealthPlugin());

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

let sharedBrowser = null;

async function getBrowser() {
  if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'];
  if (config.scan.proxyUrl) args.push(`--proxy-server=${config.scan.proxyUrl}`);
  sharedBrowser = await puppeteer.launch({
    headless: config.scan.headless ? 'new' : false,
    args,
  });
  return sharedBrowser;
}

export async function closeBrowser() {
  if (sharedBrowser) {
    try { await sharedBrowser.close(); } catch (_) {}
    sharedBrowser = null;
  }
}

export class BaseScraper {
  /**
   * @param {{ name: string, baseUrl: string, urls: string[], mode?: 'static'|'dynamic', enabled?: boolean }} opts
   */
  constructor(opts) {
    this.name = opts.name;
    this.baseUrl = opts.baseUrl;
    this.urls = opts.urls || [];
    this.mode = opts.mode || 'static';
    this.enabled = opts.enabled !== false;
    this.waitSelector = opts.waitSelector || null;
    this.log = child(`scraper:${this.name}`);
  }

  /**
   * À implémenter : extrait les produits depuis du HTML (cheerio) ou via page (puppeteer).
   * @param {{ $: any, html: string, url: string, page?: import('puppeteer').Page }} ctx
   * @returns {Promise<Array<object>>}
   */
  async parse(_ctx) {
    throw new Error(`parse() non implémenté dans ${this.name}`);
  }

  async fetchStatic(url) {
    const { data } = await axios.get(url, {
      timeout: config.scan.requestTimeoutMs,
      headers: {
        'User-Agent': randomUA(),
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      proxy: false, // utilisé via httpsAgent si besoin
    });
    return data;
  }

  async fetchDynamic(url) {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(randomUA());
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9' });
    await page.setViewport({ width: 1366, height: 900 });
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: config.scan.requestTimeoutMs,
      });
      if (this.waitSelector) {
        await page.waitForSelector(this.waitSelector, { timeout: 15000 }).catch(() => {});
      } else {
        await new Promise((r) => setTimeout(r, 1500));
      }
      const html = await page.content();
      return { html, page };
    } catch (err) {
      try { await page.close(); } catch (_) {}
      throw err;
    }
  }

  /**
   * Exécute un scrape sur toutes les URLs configurées, avec retry.
   * @returns {Promise<Array<object>>}
   */
  async run() {
    if (!this.enabled || !this.urls.length) return [];
    const all = [];
    for (const url of this.urls) {
      try {
        const items = await this._runOne(url);
        this.log.info({ url, count: items.length }, 'Scrape OK');
        all.push(...items);
      } catch (err) {
        this.log.error({ url, err: err.message }, 'Scrape échoué');
      }
    }
    // déduplication par id
    const seen = new Set();
    return all.filter((p) => {
      if (!p?.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  async _runOne(url, attempt = 1) {
    const maxAttempts = 3;
    try {
      if (this.mode === 'dynamic') {
        const { html, page } = await this.fetchDynamic(url);
        const $ = cheerio.load(html);
        try {
          return await this.parse({ $, html, url, page });
        } finally {
          try { await page.close(); } catch (_) {}
        }
      } else {
        const html = await this.fetchStatic(url);
        const $ = cheerio.load(html);
        return await this.parse({ $, html, url });
      }
    } catch (err) {
      if (attempt < maxAttempts) {
        const backoff = 1000 * Math.pow(2, attempt); // 2s, 4s
        this.log.warn({ url, attempt, err: err.message }, `Retry dans ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        return this._runOne(url, attempt + 1);
      }
      throw err;
    }
  }

  /** Helpers utilitaires pour les sous-classes */
  absoluteUrl(relative) {
    try {
      return new URL(relative, this.baseUrl).href;
    } catch {
      return relative;
    }
  }

  /** Génère un ID stable (site + hash de l'URL normalisée) */
  makeId(urlOrKey) {
    const clean = String(urlOrKey).split('#')[0].split('?')[0];
    return `${this.name}_${Buffer.from(clean).toString('base64url').slice(0, 32)}`;
  }
}
