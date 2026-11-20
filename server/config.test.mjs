import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildDiscordLinks,
  getConfigPath,
  loadConfig,
  maskSecret,
  saveConfig,
} from './config.mjs';

test('saveConfig and loadConfig persist and reload inside isolated MEET_BOARD_HOME', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'meet-board-home-'));
  const prevHome = process.env.MEET_BOARD_HOME;
  const prevCid = process.env.DISCORD_CLIENT_ID;
  const prevSec = process.env.DISCORD_CLIENT_SECRET;
  const prevBot = process.env.DISCORD_BOT_TOKEN;
  const prevPort = process.env.PORT;

  try {
    process.env.MEET_BOARD_HOME = tmpHome;
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_SECRET;
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.PORT;

    const initial = loadConfig({ cwdEnvPath: path.join(tmpHome, 'nonexistent.env') });
    assert.equal(initial.configExists, false);
    assert.equal(initial.port, 3000);

    const savedPath = await saveConfig({
      port: 3456,
      clientId: '123456789012345678',
      clientSecret: 'super-secret-value-xyz',
      botToken: 'bot-token-abcd',
    });
    assert.equal(savedPath, getConfigPath());

    const reloaded = loadConfig({ cwdEnvPath: path.join(tmpHome, 'nonexistent.env') });
    assert.equal(reloaded.configExists, true);
    assert.equal(reloaded.port, 3456);
    assert.equal(reloaded.clientId, '123456789012345678');
    assert.equal(reloaded.clientSecret, 'super-secret-value-xyz');
    assert.equal(reloaded.botToken, 'bot-token-abcd');
  } finally {
    if (prevHome === undefined) delete process.env.MEET_BOARD_HOME;
    else process.env.MEET_BOARD_HOME = prevHome;
    if (prevCid === undefined) delete process.env.DISCORD_CLIENT_ID;
    else process.env.DISCORD_CLIENT_ID = prevCid;
    if (prevSec === undefined) delete process.env.DISCORD_CLIENT_SECRET;
    else process.env.DISCORD_CLIENT_SECRET = prevSec;
    if (prevBot === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = prevBot;
    if (prevPort === undefined) delete process.env.PORT;
    else process.env.PORT = prevPort;
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});

test('saveConfig rejects malformed DISCORD_CLIENT_ID and maskSecret hides secrets', async () => {
  const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'meet-board-invalid-'));
  const prevHome = process.env.MEET_BOARD_HOME;
  try {
    process.env.MEET_BOARD_HOME = tmpHome;
    await assert.rejects(() => saveConfig({ clientId: 'not-a-snowflake' }));
    assert.equal(maskSecret(''), '');
    assert.equal(maskSecret('abc'), '****');
    assert.equal(maskSecret('my-secret-1234'), '****1234');

    const links = buildDiscordLinks('123456789012345678', true);
    assert.equal(
      links.portalUrl,
      'https://discord.com/developers/applications/123456789012345678/information'
    );
    assert.ok(links.inviteUrl.includes('scope=bot%20applications.commands'));
  } finally {
    if (prevHome === undefined) delete process.env.MEET_BOARD_HOME;
    else process.env.MEET_BOARD_HOME = prevHome;
    await fs.rm(tmpHome, { recursive: true, force: true });
  }
});
