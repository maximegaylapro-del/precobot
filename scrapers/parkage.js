// ============================================================================
// scrapers/parkage.js — Scraper Parkage (React/MUI, Puppeteer)
// ============================================================================
// Parkage est une SPA React avec Axeptio (gestion cookies).
// Les produits ne se chargent qu'après acceptation des cookies.
//
// Stratégie :
//   1. Pré-injecter le consentement Axeptio via localStorage (bypass rapide)
//   2. Naviguer vers la page (domcontentloaded)
//   3. Accepter les cookies Axeptio si la bannière apparaît quand même
//   4. Si aucun produit trouvé → recharger la page (cookies maintenant présents)
//   5. Attendre que React rende les produits (span.MuiTypography-body1)
//   6. Parser le HTML
//
// Le profil navigateur est persisté dans data/puppeteer-profile/ :
//   les cookies survivent aux redémarrages → bannière vue une seule fois.
// ============================================================================
import { existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { config } from '../config.js';
import { matchesAny } from '../services/matcher.js';
import { BaseScraper } from './base.js';

puppeteer.use(StealthPlugin());

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

let browser = null;

const PROFILE_DIR = resolve('./data/puppeteer-profile');

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  const lockFile = `${PROFILE_DIR}/SingletonLock`;
  if (existsSync(lockFile)) {
    try { unlinkSync(lockFile); } catch (_) {}
  }
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
  ];
  if (config.scan.proxyUrl) args.push(`--proxy-server=${config.scan.proxyUrl}`);
  browser = await puppeteer.launch({
    headless: true,
    args,
    userDataDir: PROFILE_DIR,
  });
  return browser;
}

export async function closeParkageBrowser() {
  if (browser) {
    try { await browser.close(); } catch (_) {}
    browser = null;
  }
}

export default class ParkageScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'parkage',
      baseUrl: 'https://www.parkage.com',
      mode: 'static',
      urls: opts.urls || [
        'https://www.parkage.com/fr/recherche?with_quantity=1&range_price=0.1&category_id=9883&preorder=1',
      ],
      ...opts,
    });
  }

  async fetchParkage(url) {
    const b = await getBrowser();
    const page = await b.newPage();

    // Pré-injecter le consentement Axeptio dans localStorage avant tout script de la page
    await page.evaluateOnNewDocument(() => {
      try {
        const consent = JSON.stringify({
          $$token: 'bypass',
          $$date: new Date().toISOString(),
          $$version: 2,
          $$cookiesVersion: { name: 'complete', identifier: '~~' },
          google_analytics: true,
          google_ads: true,
          facebook_pixel: true,
        });
        window.localStorage.setItem('axeptio_cookies', consent);
        // Aussi injecter le cookie via document.cookie au cas où Axeptio le vérifie
        document.cookie = `axeptio_cookies=${encodeURIComponent(consent)}; path=/; domain=.parkage.com`;
      } catch (_) {}
    });

    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    await page.setUserAgent(ua);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
    });
    await page.setViewport({ width: 1366, height: 900 });

    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      // Tenter d'accepter les cookies si la bannière est quand même présente
      const dismissed = await this._acceptCookies(page);
      this.log.debug({ dismissed }, 'Parkage cookies');

      // Attendre que React + AJAX produits se terminent (jusqu'à 25s)
      await page.waitForSelector('span.MuiTypography-body1', { timeout: 25000 })
        .catch(() => {});

      let html = await page.content();
      let $ = cheerio.load(html);
      let body1Count = $('span.MuiTypography-body1').length;

      this.log.debug({ body1Count }, 'Parkage DOM - premier chargement');

      // Si aucun produit, la bannière a peut-être bloqué le chargement →
      // recharger la page (les cookies Axeptio sont maintenant dans le profil)
      if (body1Count === 0) {
        this.log.debug('Pas de produits MUI trouvés — rechargement de la page...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });

        // Deuxième tentative d'acceptation si la bannière revient
        const dismissed2 = await this._acceptCookies(page);
        if (dismissed2) this.log.debug({ dismissed2 }, 'Parkage cookies (reload)');

        await page.waitForSelector('span.MuiTypography-body1', { timeout: 20000 })
          .catch(() => {});

        html = await page.content();
        $ = cheerio.load(html);
        body1Count = $('span.MuiTypography-body1').length;
        this.log.debug({ body1Count }, 'Parkage DOM - après rechargement');
      }

      const bodyPreview = $('body').text().replace(/\s+/g, ' ').slice(0, 200);
      this.log.debug({ body1Count, bodyPreview }, 'Parkage DOM final');

      return html;
    } finally {
      try { await page.close(); } catch (_) {}
    }
  }

  // Accepte les cookies Axeptio — stratégie multi-niveaux
  async _acceptCookies(page) {
    // Attendre spécifiquement qu'un bouton "accepter" soit visible dans la page
    // (plus fiable que d'attendre un nombre arbitraire de boutons)
    await page.waitForFunction(
      () => {
        const btns = [...document.querySelectorAll('button')];
        return btns.some((b) =>
          /tout accepter|accepter tout|accept all|j'accepte|^accepter$|^ok$/i.test(
            b.textContent.trim()
          )
        );
      },
      { timeout: 10000 }
    ).catch(() => {});

    // Stratégie 1 : page.click() via sélecteurs CSS Axeptio (le plus fiable)
    const CSS_SELECTORS = [
      '#axeptio_overlay button',
      '[id*="axeptio"] button',
      '[class*="axeptio"] button',
      '[id*="cookie-banner"] button',
      '[class*="cookie-banner"] button',
      '[class*="CookieBanner"] button',
      '[id*="didomi"] button',
    ];

    for (const sel of CSS_SELECTORS) {
      try {
        const el = await page.$(sel);
        if (!el) continue;
        const text = await page.evaluate((e) => e.textContent.trim(), el);
        if (/accepter|accept|ok/i.test(text)) {
          await el.click();
          this.log.debug({ sel, text }, 'Parkage: bouton accepté via CSS selector');
          await new Promise((r) => setTimeout(r, 3000));
          return `css:${sel}`;
        }
      } catch (_) {}
    }

    // Stratégie 2 : evaluate() — parcourt tous les boutons par texte (liste de priorité)
    const result = await page.evaluate(() => {
      const PRIORITY = [
        'Tout accepter',
        'Accepter tout',
        'Accept all',
        "J'accepte",
        'Accepter',
        'Fermer',
        'OK',
        'Continuer',
      ];
      const btns = [...document.querySelectorAll('button, [role="button"]')];

      for (const label of PRIORITY) {
        const btn = btns.find(
          (b) => b.textContent.trim().toLowerCase() === label.toLowerCase()
        );
        if (btn) {
          btn.click();
          return `text:${label}`;
        }
      }

      // Correspondance partielle : bouton contenant "accepter" / "accept"
      const partial = btns.find((b) => /accepter|accept/i.test(b.textContent.trim()));
      if (partial) {
        partial.click();
        return `partial:${partial.textContent.trim()}`;
      }

      // Fallback container Axeptio/cookie
      const container = document.querySelector(
        '[class*="axeptio"], [id*="axeptio"], [class*="cookie"], [id*="cookie"]'
      );
      const btn = container?.querySelector('button');
      if (btn) {
        btn.click();
        return `fallback:${btn.textContent.trim()}`;
      }

      return null;
    }).catch(() => null);

    if (result) {
      await new Promise((r) => setTimeout(r, 3000));
      return result;
    }

    // Stratégie 3 : vérifier les iframes (certains CMPs utilisent des iframes)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const frameUrl = frame.url();
      if (!frameUrl.includes('axeptio') && !frameUrl.includes('consent') && !frameUrl.includes('cookie')) continue;

      const r = await frame.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          /accepter|accept|ok/i.test(b.textContent)
        );
        if (btn) { btn.click(); return btn.textContent.trim(); }
        return null;
      }).catch(() => null);

      if (r) {
        await new Promise((r2) => setTimeout(r2, 3000));
        return `iframe:${r}`;
      }
    }

    return null;
  }

  async run() {
    if (!this.enabled || !this.urls.length) return [];
    const all = [];
    for (const url of this.urls) {
      let attempt = 1;
      const maxAttempts = 3;
      while (attempt <= maxAttempts) {
        try {
          const html = await this.fetchParkage(url);
          const $ = cheerio.load(html);
          const items = await this.parse({ $, url });
          this.log.info({ url, count: items.length }, 'Scrape OK');
          all.push(...items);
          break;
        } catch (err) {
          if (attempt < maxAttempts) {
            const backoff = 1000 * Math.pow(2, attempt);
            this.log.warn({ url, attempt, err: err.message }, `Retry dans ${backoff}ms`);
            await new Promise((r) => setTimeout(r, backoff));
            attempt++;
          } else {
            this.log.error({ url, err: err.message }, 'Scrape échoué');
            break;
          }
        }
      }
    }
    const seen = new Set();
    return all.filter((p) => {
      if (!p?.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  async parse({ $ }) {
    const items = [];
    const seen = new Set();
    const keywords = config.filters.targetKeywords.length
      ? config.filters.targetKeywords
      : config.filters.onepieceKeywords;

    $('span.MuiTypography-body1').each((_, spanEl) => {
      const $span = $(spanEl);
      const title = $span.text().trim();
      if (!title || !matchesAny(title, keywords)) return;

      const $link = $span.parent('a');
      const href = $link.attr('href') || $span.closest('a').attr('href') || '';
      if (!href) return;
      const link = this.absoluteUrl(href);

      if (seen.has(link)) return;
      seen.add(link);

      const $card = $span.closest('.MuiPaper-elevation1');

      const price = $card.find('p.MuiTypography-h3').first().text().replace(/ /g, ' ').trim();
      const image = $card.find('img.MuiBox-root').first().attr('src') || $card.find('img').first().attr('src');

      const isPreorder = $card.find('.MuiButton-containedSuccess').length > 0;
      const isInStock  = $card.find('.MuiButton-containedPrimary').length > 0;
      const status = isPreorder ? 'preorder' : isInStock ? 'in_stock' : 'unknown';

      const shippingInfo = $card.find('.MuiAlert-colorSuccess[aria-label]').attr('aria-label') || '';

      const productNum = href.match(/\/fr\/(\d+)-/)?.[1];
      const id = productNum ? `parkage_${productNum}` : this.makeId(link + title);

      items.push({
        id,
        site: 'parkage',
        title,
        price,
        url: link,
        image: image || null,
        status,
        availability: shippingInfo || (isPreorder ? 'Précommande' : isInStock ? 'En stock' : ''),
        statusText: shippingInfo,
        description: shippingInfo,
      });
    });

    return items;
  }
}
