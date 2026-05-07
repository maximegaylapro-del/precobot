// ============================================================================
// scrapers/index.js — Registre des scrapers activés
// ============================================================================
// Pour ajouter un scraper :
//   1. Créer un fichier scrapers/<boutique>.js qui étend BaseScraper
//   2. L'importer ici et l'ajouter au tableau ci-dessous
// ============================================================================
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
// import EbayScraper from './ebay.js';
// import AmazonScraper from './amazon.js';

export function buildScrapers() {
  return [
    new ParkageScraper(),
    new FantasySphereScraper(),
    new LudisphereScraper(),
    new GuizettefamilyScraper(),
    new GamesAvenueScraper(),
    new OupiScraper(),
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
}
