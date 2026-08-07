// ============================================================================
// scrapers/index.js — Registre des scrapers activés
// ============================================================================
// Pour ajouter un scraper :
//   1. Créer un fichier scrapers/<boutique>.js qui étend BaseScraper
//   2. L'importer ici et l'ajouter au tableau ci-dessous
// ============================================================================
import { config } from '../config.js';
import { getOverride } from '../services/scraperState.js';
import ParkageScraper from './parkage.js';
import CardOmatScraper from './cardomat.js';
import CardAdvantageScraper from './cardadvantage.js';
import NevermintScraper from './nevermint.js';
import MastersetScraper from './masterset.js';
import GoupiyaScraper from './goupiya.js';
import Troll2JeuxScraper from './troll2jeux.js';
import BaronCollectionsScraper from './baroncollections.js';
import ComptoirDesEcoliersScraper from './comptoirdesecoliers.js';
import CardakusoScraper from './cardakuso.js';
import MysticAmbreScraper from './mysticambre.js';
import KonobaCardsScraper from './konobacards.js';
import FantasySphereScraper from './fantasysphere.js';
import LudisphereScraper from './ludisphere.js';
import GuizettefamilyScraper from './guizettefamily.js';
import GamesAvenueScraper from './gamesavenue.js';
import OupiScraper from './oupi.js';
import LeCoinDesBaronsScraper from './lecoindesbarons.js';
import LudotrotterScraper from './ludotrotter.js';
import PlayinScraper from './playin.js';
import BenAndGamesScraper from './benandgames.js';
// import EbayScraper from './ebay.js';
// import AmazonScraper from './amazon.js';

const ALL_SCRAPERS = () => [
  new ParkageScraper(),
  new FantasySphereScraper(),
  new LudisphereScraper(),
  new GuizettefamilyScraper(),
  new GamesAvenueScraper(),
  new OupiScraper(),
  new LeCoinDesBaronsScraper(),
  new LudotrotterScraper(),
  new PlayinScraper(),
  new BenAndGamesScraper(),
  new CardOmatScraper(),
  new CardAdvantageScraper(),
  new NevermintScraper(),
  new MastersetScraper(),
  new GoupiyaScraper(),
  new Troll2JeuxScraper(),
  new BaronCollectionsScraper(),
  new ComptoirDesEcoliersScraper(),
  new CardakusoScraper(),
  new MysticAmbreScraper(),
  new KonobaCardsScraper(),
  // new PhilibertScraper(),
];

/**
 * Détermine si un scraper doit être actif : l'override manuel (dashboard)
 * prime sur la config par défaut DISABLED_SCRAPERS.
 * @param {string} name
 */
function isEnabled(name) {
  const override = getOverride(name);
  if (override !== undefined) return override;
  return !config.filters.disabledScrapers.includes(name);
}

/**
 * Retourne TOUS les scrapers (activés et désactivés), avec la propriété
 * `enabled` correctement positionnée. Le scheduler ne lance que ceux activés,
 * mais garde les autres pour permettre un toggle live via le dashboard.
 */
export function buildScrapers() {
  return ALL_SCRAPERS().map((s) => {
    s.enabled = isEnabled(s.name);
    return s;
  });
}

export function getDisabledScrapers() {
  return ALL_SCRAPERS()
    .filter((s) => !isEnabled(s.name))
    .map((s) => ({ name: s.name, baseUrl: s.baseUrl, urls: s.urls }));
}
