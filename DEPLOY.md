# DEPLOY.md — Infos de déploiement & config

Mémo pour mettre à jour et opérer le bot. À garder à jour.

## Repo

- **Remote GitHub** : `git@github.com:maximegaylapro-del/precobot.git`
- **Branche de prod** : `main`

## VPS (production)

| Élément | Valeur |
|---|---|
| Hébergeur | OVH |
| Connexion SSH | `ssh ubuntu@vps-89f09679-vps-ovh-net` |
| User | `ubuntu` |
| Dossier du projet | `~/precobot` |
| Gestionnaire de process | **pm2** |
| Nom de l'app pm2 | `precobot` |
| Port dashboard | `3000` |

## Mettre à jour la prod

Depuis le VPS, dans `~/precobot` :

```bash
git pull origin main
npm install            # au cas où de nouvelles dépendances
pm2 restart precobot
pm2 logs precobot --lines 30   # vérifier le démarrage (Ctrl+C pour sortir, n'arrête pas le bot)
```

Au démarrage on doit voir `🎴 OP-TCG Preorder Monitor — démarrage` puis le chargement des scrapers, sans erreur.

### Si `git pull` bloque sur des fichiers locaux modifiés

Généralement des fichiers d'état runtime (`data/scraper-health.json`, `data/scraper-state.json`) qui étaient suivis avant d'être ignorés. Ne pas écraser sans vérifier. En cas de doute, sauvegarder puis `git stash` :

```bash
git stash            # met de côté les modifs locales
git pull origin main
git stash pop        # (optionnel) ré-applique si nécessaire
```

## Accéder au dashboard depuis ton navigateur (local)

Le dashboard écoute sur le port 3000 **du VPS**. Tunnel SSH depuis ta machine :

```bash
ssh -L 3000:localhost:3000 ubuntu@vps-89f09679-vps-ovh-net
# puis ouvrir http://localhost:3000  (produits) et http://localhost:3000/health.html (santé + toggles)
```

## Toggles scrapers (activer/désactiver en live)

- Se fait depuis la page **Santé** du dashboard (`/health.html`), un interrupteur par scraper.
- L'état est persisté dans `data/scraper-state.json` (propre à chaque machine, non versionné).
- Priorité : **toggle dashboard** > `DISABLED_SCRAPERS` (`.env`) > activé par défaut.

## Commandes pm2 utiles

```bash
pm2 list                    # état des apps
pm2 restart precobot        # redémarrer
pm2 stop precobot           # arrêter
pm2 logs precobot           # logs en direct
pm2 save                    # sauver la config pm2 (après changement)
```

## Dev local (Mac)

- Node par défaut (`v14`) est **cassé** pour ce projet — utiliser une version récente via nvm :
  ```bash
  nvm use 20        # ou 22 ; v20.20.2 testé OK
  ```
- Commandes : voir `CLAUDE.md` (`npm start`, `npm run scan:once`, `npm run dashboard`, …).

## Fichiers non versionnés (par machine)

Ignorés via `.gitignore`, à ne pas committer : `.env`, `.claude/`, `logs/*.log`,
`data/products.json`, `data/scraper-health.json`, `data/scraper-state.json`,
`data/puppeteer-profile/`.
