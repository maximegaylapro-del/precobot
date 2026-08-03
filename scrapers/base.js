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
    this.waitUntil = opts.waitUntil || 'domcontentloaded';
    // Pagination : nombre max de pages suivies par URL de départ (1 = pas de
    // pagination). Une sous-classe qui pagine doit implémenter pageUrl() ET
    // renseigner this.lastRawCount dans parse() (nb de cartes AVANT filtrage),
    // sinon on ne sait pas distinguer « page vide » de « page sans cible ».
    this.maxPages = opts.maxPages || 1;
    this.lastRawCount = null;
    this.log = child(`scraper:${this.name}`);
  }

  /**
   * URL de la page n (n >= 2) pour une URL de départ. Retourner null désactive
   * la pagination pour cette URL.
   * @param {string} _url
   * @param {number} _page
   * @returns {string|null}
   */
  pageUrl(_url, _page) {
    return null;
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
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setUserAgent(randomUA());
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9' });
    await page.setViewport({ width: 1366, height: 900 });
    try {
      await page.goto(url, {
        waitUntil: this.waitUntil,
        timeout: config.scan.requestTimeoutMs,
      });
      if (this.waitSelector) {
        const seen = () => page.waitForSelector(this.waitSelector, { timeout: 15000 })
          .then(() => true).catch(() => false);
        let found = await seen();
        if (!found) {
          // Certaines grilles ne se peuplent qu'au scroll (lazy loading).
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
          found = await seen();
        }
        // Page rendue sans les cartes produit : on échoue explicitement pour
        // déclencher le retry, au lieu de parser du vide et de conclure
        // "0 produit" (ce qui ferait basculer tout le site en rupture).
        if (!found) throw new Error(`sélecteur "${this.waitSelector}" absent après rendu`);
      } else {
        await new Promise((r) => setTimeout(r, 1500));
      }
      const html = await page.content();
      return { html, page, context };
    } catch (err) {
      try { await context.close(); } catch (_) {}
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
    let failedUrls = 0;
    let lastError = null;

    for (const url of this.urls) {
      let firstPageRaw = null;
      for (let page = 1; page <= this.maxPages; page++) {
        const target = page === 1 ? url : this.pageUrl(url, page);
        if (!target) break;
        try {
          this.lastRawCount = null;
          const items = await this._runOne(target);
          this.log.info({ url: target, count: items.length, raw: this.lastRawCount }, 'Scrape OK');
          all.push(...items);
          // Fin de pagination : la page ne contient plus aucune carte produit.
          // Si le scraper ne renseigne pas lastRawCount, on s'arrête après la 1re page.
          if (this.lastRawCount === null || this.lastRawCount === 0) break;
          if (page === 1) firstPageRaw = this.lastRawCount;
          // Page incomplète = dernière page réelle. Au-delà, certains sites
          // renvoient en boucle une page "aucun résultat" au lieu d'un 404.
          else if (this.lastRawCount < firstPageRaw) break;
        } catch (err) {
          this.log.error({ url: target, err: err.message }, 'Scrape échoué');
          if (page === 1) { failedUrls++; lastError = err; }
          break;
        }
      }
    }

    // Toutes les URLs sont tombées → on remonte l'erreur pour que le scraper
    // soit marqué "error" dans le health, au lieu de passer pour un "ok, 0 produit".
    if (failedUrls === this.urls.length && lastError) {
      throw new Error(`toutes les URLs ont échoué (${lastError.message})`);
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
        const { html, page, context } = await this.fetchDynamic(url);
        const $ = cheerio.load(html);
        try {
          return await this.parse({ $, html, url, page });
        } finally {
          try { await context.close(); } catch (_) {}
        }
      } else {
        const html = await this.fetchStatic(url);
        const $ = cheerio.load(html);
        return await this.parse({ $, html, url });
      }
    } catch (err) {
      // 404/410 : page inexistante (fin de pagination le plus souvent) — inutile
      // de retenter, la réponse ne changera pas.
      const httpStatus = err.response?.status;
      if (httpStatus === 404 || httpStatus === 410) throw err;
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
