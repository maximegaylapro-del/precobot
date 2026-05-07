// ============================================================================
// services/logger.js — Logger centralisé basé sur Pino
// ============================================================================
import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';

if (!fs.existsSync(config.logDir)) {
  fs.mkdirSync(config.logDir, { recursive: true });
}

const streams = [
  {
    level: 'info',
    stream: pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    }),
  },
  {
    level: 'debug',
    stream: pino.destination({
      dest: path.join(config.logDir, 'monitor.log'),
      sync: false,
      mkdir: true,
    }),
  },
];

export const logger = pino(
  { level: 'debug' },
  pino.multistream(streams)
);

/**
 * Crée un logger enfant avec un contexte (ex: nom du scraper).
 * @param {string} name
 */
export function child(name) {
  return logger.child({ scope: name });
}
