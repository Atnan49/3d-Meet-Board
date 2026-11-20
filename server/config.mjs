import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function getHomeDir() {
  const custom = (process.env.MEET_BOARD_HOME || '').trim();
  return custom ? path.resolve(custom) : path.join(os.homedir(), '.3d-meet-board');
}

export function getConfigPath() {
  return path.join(getHomeDir(), 'config.env');
}

export function getDefaultRoomsDir() {
  return path.join(getHomeDir(), 'rooms');
}

export function parseEnvContent(text) {
  const out = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

export function formatEnvContent(cfg) {
  const port = Number(cfg.port || cfg.PORT) || 3000;
  const clientId = String(cfg.clientId ?? cfg.DISCORD_CLIENT_ID ?? '').trim();
  const clientSecret = String(cfg.clientSecret ?? cfg.DISCORD_CLIENT_SECRET ?? '').trim();
  const botToken = String(cfg.botToken ?? cfg.DISCORD_BOT_TOKEN ?? '').trim();

  return [
    `PORT=${port}`,
    `DISCORD_CLIENT_ID=${clientId}`,
    `DISCORD_CLIENT_SECRET=${clientSecret}`,
    `DISCORD_BOT_TOKEN=${botToken}`,
    '',
  ].join('\n');
}

function readEnvFileSync(filePath) {
  try {
    if (!filePath || !fsSync.existsSync(filePath)) return null;
    return parseEnvContent(fsSync.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function loadConfig({ cwdEnvPath = path.resolve('.env') } = {}) {
  const globalPath = getConfigPath();
  const globalData = readEnvFileSync(globalPath);
  const localData = cwdEnvPath && path.resolve(cwdEnvPath) !== path.resolve(globalPath)
    ? readEnvFileSync(cwdEnvPath)
    : null;

  const merged = {
    PORT: '3000',
    DISCORD_CLIENT_ID: '',
    DISCORD_CLIENT_SECRET: '',
    DISCORD_BOT_TOKEN: '',
    ...(globalData || {}),
    ...(localData || {}),
  };

  for (const key of ['PORT', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN']) {
    if (typeof process.env[key] === 'string' && process.env[key].trim() !== '') {
      merged[key] = process.env[key].trim();
    }
  }

  const parsedPort = Number(merged.PORT);
  const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 3000;

  return {
    port,
    clientId: String(merged.DISCORD_CLIENT_ID || '').trim(),
    clientSecret: String(merged.DISCORD_CLIENT_SECRET || '').trim(),
    botToken: String(merged.DISCORD_BOT_TOKEN || '').trim(),
    configExists: Boolean(globalData || localData),
    configPath: globalPath,
  };
}

export async function saveConfig(cfg) {
  const clientId = String(cfg.clientId ?? cfg.DISCORD_CLIENT_ID ?? '').trim();
  if (clientId && !/^\d{15,25}$/.test(clientId)) {
    throw new Error('DISCORD_CLIENT_ID harus berupa 15-25 digit angka dari Discord Developer Portal.');
  }

  const parsedPort = Number(cfg.port ?? cfg.PORT ?? 3000);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error('PORT harus berupa angka bulat antara 1 sampai 65535.');
  }

  const target = getConfigPath();
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });

  const content = formatEnvContent({
    port: parsedPort,
    clientId,
    clientSecret: cfg.clientSecret ?? cfg.DISCORD_CLIENT_SECRET ?? '',
    botToken: cfg.botToken ?? cfg.DISCORD_BOT_TOKEN ?? '',
  });

  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(tmp, target);
  try {
    await fs.chmod(target, 0o600);
  } catch {
    // chmod may be a no-op on Windows
  }
  return target;
}

export function maskSecret(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  if (s.length <= 4) return '****';
  return `****${s.slice(-4)}`;
}

export function buildDiscordLinks(clientId, hasBot = false) {
  const cleanId = String(clientId || '').trim();
  if (!cleanId) {
    return {
      portalUrl: 'https://discord.com/developers/applications',
      inviteUrl: '',
    };
  }
  const scope = hasBot ? 'bot%20applications.commands' : 'applications.commands';
  return {
    portalUrl: `https://discord.com/developers/applications/${cleanId}/information`,
    inviteUrl: `https://discord.com/oauth2/authorize?client_id=${cleanId}&scope=${scope}`,
  };
}
