// ============================================================================
// services/notifier.js — Discord webhook (priorité) + Email (optionnel)
// ============================================================================
import axios from 'axios';
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { child } from './logger.js';
import * as storage from './storage.js';

const log = child('notifier');

const COLORS = {
  new_preorder: 0xffcc00,   // jaune
  became_preorder: 0xffa500, // orange
  back_in_stock: 0x00cc66,  // vert
};

const LABELS = {
  new_preorder: 'Nouvelle précommande détectée',
  became_preorder: 'Produit passé en précommande',
  back_in_stock: 'De retour en stock',
};

let emailTransporter = null;
if (config.notifications.email.enabled) {
  emailTransporter = nodemailer.createTransport({
    host: config.notifications.email.host,
    port: config.notifications.email.port,
    secure: config.notifications.email.port === 465,
    auth: {
      user: config.notifications.email.user,
      pass: config.notifications.email.pass,
    },
  });
  emailTransporter.verify().then(
    () => log.info('Transporteur email OK'),
    (err) => log.error({ err }, 'Email non opérationnel')
  );
}

function isAbsoluteUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function buildDiscordEmbed(event) {
  const { product, type } = event;
  const embed = {
    title: `${LABELS[type]} — ${product.title}`.slice(0, 256),
    color: COLORS[type] ?? 0x5865f2,
    timestamp: new Date().toISOString(),
    fields: [
      { name: 'Prix', value: (product.price || 'N/C').slice(0, 1024), inline: true },
      { name: 'Site', value: product.site.slice(0, 1024), inline: true },
      { name: 'Statut', value: product.status.slice(0, 1024), inline: true },
    ],
    footer: { text: `ID ${product.id}`.slice(0, 2048) },
  };
  // url et thumbnail doivent être des URLs absolues, sinon Discord rejette avec 400
  if (isAbsoluteUrl(product.url)) embed.url = product.url;
  if (isAbsoluteUrl(product.image)) embed.thumbnail = { url: product.image };
  return embed;
}

async function sendDiscord(events) {
  if (!config.notifications.discord.enabled) return;
  // Discord accepte jusqu'à 10 embeds par message
  const chunks = [];
  for (let i = 0; i < events.length; i += 10) {
    chunks.push(events.slice(i, i + 10));
  }
  for (const chunk of chunks) {
    const payload = {
      username: 'OP-TCG Preorder Bot',
      content: chunk.length === 1 ? '@everyone 🎴 Nouvelle alerte précommande !' : `@everyone 🎴 ${chunk.length} alertes !`,
      embeds: chunk.map(buildDiscordEmbed),
    };
    try {
      await axios.post(config.notifications.discord.webhookUrl, payload, {
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
      });
      log.info({ count: chunk.length }, 'Discord : notifications envoyées');
    } catch (err) {
      log.error(
        { status: err.response?.status, body: err.response?.data, msg: err.message },
        'Discord webhook a échoué'
      );
      throw err;
    }
  }
}

async function sendEmail(events) {
  if (!emailTransporter) return;
  const subject = events.length === 1
    ? `[OP-TCG] ${LABELS[events[0].type]}`
    : `[OP-TCG] ${events.length} nouvelles alertes`;

  const html = `
    <h2>🎴 Alertes One Piece TCG</h2>
    <ul>
      ${events.map((e) => `
        <li>
          <strong>${LABELS[e.type]}</strong> —
          <a href="${e.product.url}">${e.product.title}</a>
          <br>${e.product.price || ''} • ${e.product.site} • ${e.product.status}
        </li>`).join('')}
    </ul>
  `;

  try {
    await emailTransporter.sendMail({
      from: config.notifications.email.from,
      to: config.notifications.email.to,
      subject,
      html,
    });
    log.info({ count: events.length }, 'Email envoyé');
  } catch (err) {
    log.error({ err }, 'Envoi email échoué');
  }
}

/**
 * Envoie les notifications pour une liste d'événements.
 * Marque les produits comme notifiés après succès Discord.
 * @param {import('./detection.js').Event[]} events
 */
export async function notify(events) {
  if (!events?.length) return;

  // Discord en premier (priorité)
  try {
    await sendDiscord(events);
    // Ne marquer notifié qu'en cas de succès Discord
    for (const e of events) await storage.markNotified(e.product.id);
  } catch (err) {
    log.warn('Discord a échoué — on tente l\'email en secours');
  }

  await sendEmail(events);
}

/**
 * Message de démarrage (utile pour vérifier que le webhook fonctionne).
 */
export async function sendStartupPing() {
  if (!config.notifications.discord.enabled) return;
  try {
    await axios.post(config.notifications.discord.webhookUrl, {
      username: 'OP-TCG Preorder Bot',
      content: '✅ Bot démarré — surveillance des précommandes active.',
    }, { timeout: 10000 });
  } catch (err) {
    log.warn({ msg: err.message }, 'Ping de démarrage Discord échoué');
  }
}
