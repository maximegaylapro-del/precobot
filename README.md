# 🎴 OP-TCG Preorder Monitor

Bot Node.js qui surveille plusieurs boutiques en ligne pour détecter instantanément les **précommandes One Piece Card Game** et notifier sur **Discord** (ou email).

---

## ⚡ Démarrage rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Copier et configurer l'environnement
cp .env.example .env
#   → éditer .env et renseigner DISCORD_WEBHOOK_URL

# 3. Lancer en mode continu
npm start

# 4. (optionnel) un scan unique
npm run scan:once

# 5. Dashboard
# Ouvrir http://localhost:3000
```

---

## 🧱 Architecture

```
.
├── index.js                 # Point d'entrée (orchestrateur)
├── config.js                # Lecture/validation du .env
├── scrapers/
│   ├── base.js              # Classe abstraite (axios+cheerio OU puppeteer+stealth)
│   ├── ebay.js              # Scraper eBay (mode statique)
│   ├── amazon.js            # Scraper Amazon (mode dynamique + stealth)
│   └── index.js             # Registre des scrapers actifs
├── services/
│   ├── detection.js         # Filtres One Piece + précommande + nouveauté
│   ├── notifier.js          # Webhook Discord + email Nodemailer
│   ├── storage.js           # Persistance JSON atomique avec lock
│   ├── scheduler.js         # Polling avec pLimit + retry
│   └── logger.js            # Pino (console + fichier)
├── dashboard/
│   ├── server.js            # Express : /api/products, /api/stats, /api/scan
│   └── public/index.html    # UI temps réel (auto-refresh 5 s)
├── data/
│   └── products.json        # Base locale (auto-créée)
└── logs/
    └── monitor.log          # Logs persistants
```

---

## 🔑 Choix techniques

| Choix | Raison |
|---|---|
| **ES Modules** (`"type":"module"`) | Standard moderne, meilleure tree-shaking. |
| **Puppeteer-extra + stealth** | Amazon bloque les scrapers "bruts" ; stealth efface les empreintes `navigator.webdriver` etc. |
| **cheerio** | Parsing HTML côté serveur en 10× moins de RAM que Puppeteer quand on n'a pas besoin de JS. |
| **Architecture à 2 modes** (`static`/`dynamic`) | Un nouveau scraper choisit le mode selon le site. Pas besoin de lancer Chrome pour eBay. |
| **pLimit** | Limite la concurrence (défaut 2) pour éviter de saturer la RAM et de se faire blacklister. |
| **Pino** | Logger structuré ultra-rapide, log fichier + pretty-print console. |
| **Discord Embeds** | Affichage riche (image, prix, lien) ; batched jusqu'à 10 alertes par webhook. |
| **Stockage JSON atomique** | `writeFile` → `rename` pour éviter les corruptions. Write-lock en mémoire pour sérialiser les `upsert`. |
| **IDs stables** | Basés sur l'ASIN (Amazon) ou l'ItemID (eBay), donc un produit déjà vu reste identifié même si son titre change. |

---

## ➕ Ajouter un nouveau site

1. Créer `scrapers/ma-boutique.js` :

```js
import { BaseScraper } from './base.js';

export default class MaBoutiqueScraper extends BaseScraper {
  constructor(opts = {}) {
    super({
      name: 'ma-boutique',
      baseUrl: 'https://ma-boutique.fr',
      mode: 'static',               // ou 'dynamic' si le site utilise du JS
      urls: [
        'https://ma-boutique.fr/tcg/one-piece?sort=new',
      ],
      ...opts,
    });
  }

  async parse({ $, url }) {
    const items = [];
    $('.product-card').each((_, el) => {
      const $el = $(el);
      const link = this.absoluteUrl($el.find('a.product-link').attr('href'));
      items.push({
        id: this.makeId(link),
        site: 'ma-boutique',
        title: $el.find('.product-title').text().trim(),
        price: $el.find('.product-price').text().trim(),
        url: link,
        image: $el.find('img').attr('src'),
        statusText: $el.find('.product-badge').text().trim(),
        availability: $el.find('.stock-info').text().trim(),
      });
    });
    return items;
  }
}
```

2. L'enregistrer dans `scrapers/index.js` :

```js
import MaBoutiqueScraper from './ma-boutique.js';
export function buildScrapers() {
  return [
    new EbayScraper(),
    new AmazonScraper(),
    new MaBoutiqueScraper(),
  ];
}
```

Voilà — le scheduler, la détection et les notifs fonctionnent déjà.

---

## 🔎 Détection des précommandes

La logique dans `services/detection.js` :

1. Filtre **One Piece** : le titre/description doit contenir un mot-clé (`one piece card game`, `op-01`, etc.).
2. Filtre **blacklist** : exclut `proxy`, `custom`, `fake`, etc.
3. Infère le **statut** (`preorder`, `in_stock`, `out_of_stock`, `unknown`) à partir des champs retournés par le scraper ou via mots-clés.
4. Compare avec la base locale → émet un **événement** (`new_preorder`, `became_preorder`, `back_in_stock`).

Tous les mots-clés sont configurables dans `.env`.

---

## 📢 Notifications Discord

Crée un webhook dans ton serveur :

> *Paramètres du serveur → Intégrations → Webhooks → Nouveau webhook → Copier l'URL*

Colle l'URL dans `.env` :
```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123456/abcdef
```

Au démarrage, le bot envoie un ping de test. Ensuite, chaque précommande déclenche un embed avec titre, prix, statut, lien et miniature.

---

## 🛠️ Dashboard

Accessible sur `http://localhost:3000` quand `DASHBOARD_ENABLED=true`.

- Liste des produits détectés (triés par dernière vue).
- Stats du scheduler en temps réel.
- Bouton **« Lancer un scan »** pour forcer un cycle.

---

## ⚠️ Anti-scraping — notes importantes

| Site | Difficulté | Stratégie |
|---|---|---|
| **eBay** | Faible | axios + cheerio suffit. Rate-limit : max ~1 req/5s par URL. |
| **Amazon** | Élevée | Puppeteer + stealth + User-Agent rotatif. Si CAPTCHA → passer par un **proxy résidentiel** ou l'**API PA-API 5.0** (recommandé en production). |
| Boutiques TCG FR (Cartajouer, Play-in, Philibert…) | Faible à moyenne | Généralement `static` suffit. Certaines pages produit sont côté client → alors `dynamic`. |

Le code intègre :
- rotation de User-Agents,
- retry exponentiel (2s, 4s),
- détection de CAPTCHA Amazon (log + skip),
- support proxy via `PROXY_URL` dans `.env`.

---

## 🧪 Tests manuels rapides

```bash
# Scan unique et voir les événements
npm run scan:once

# Forcer un site uniquement (à coder rapidement) : commenter les autres dans scrapers/index.js

# Vérifier le webhook sans scrape :
node -e "require('dotenv/config'); const a=require('axios'); \
  a.post(process.env.DISCORD_WEBHOOK_URL, {content:'test'}).then(()=>console.log('ok'))"
```

---

## 🔭 Extensions possibles

- Stockage SQLite (meilleure perf si >10k produits).
- Support Telegram (bot token) en plus de Discord.
- Classement multi-set (filtrer par OP-01, OP-02…).
- Détection de variation de prix (alerte si -20 %).
- Système de whitelist de vendeurs (pour eBay).
- Déploiement Docker + cron (pas besoin de Puppeteer si uniquement des sites statiques).

---

## 📜 Licence

MIT — usage personnel. Respecte les CGU des sites scrappés (robots.txt, rate-limit raisonnable).
