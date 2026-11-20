#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import readline from 'node:readline/promises';
import { bin as cloudflaredBin, install as installCloudflared } from 'cloudflared';
import {
  buildDiscordLinks,
  getConfigPath,
  getDefaultRoomsDir,
  loadConfig,
  maskSecret,
  saveConfig,
} from '../server/config.mjs';
import { startServer } from '../server/index.mjs';

const pkg = JSON.parse(fsSync.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const PORTAL_HOME_URL = 'https://discord.com/developers/applications';
const TRY_CF_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    help: false,
    version: false,
    noTunnel: false,
    noOpen: false,
    noSetup: false,
    port: undefined,
  };
  let command = 'start';

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '-h' || a === '--help' || a === 'help') {
      flags.help = true;
    } else if (a === '-v' || a === '--version' || a === 'version') {
      flags.version = true;
    } else if (a === '--no-tunnel') {
      flags.noTunnel = true;
    } else if (a === '--no-open') {
      flags.noOpen = true;
    } else if (a === '--no-setup') {
      flags.noSetup = true;
    } else if (a === '--port' && i + 1 < args.length) {
      flags.port = Number(args[i + 1]);
      i += 1;
    } else if (a.startsWith('--port=')) {
      flags.port = Number(a.slice('--port='.length));
    } else if (!a.startsWith('-') && command === 'start' && ['start', 'setup', 'status'].includes(a)) {
      command = a;
    }
  }

  return { command, flags };
}

function printHelp() {
  console.log(`
3d-meet-board v${pkg.version}
Ruang Kolaborasi 3D untuk Discord (server lokal + auto-tunnel HTTPS)

Pemakaian:
  3d-meet-board                   Jalankan server lokal & tunnel HTTPS (pandu setup jika pertama kali)
  3d-meet-board setup             Wizard konfigurasi Client ID / Secret / Bot Token Discord
  3d-meet-board start [opsi]      Jalankan server dan tunnel HTTPS
  3d-meet-board status            Tampilkan lokasi konfigurasi, status Discord, & folder simpan papan

Opsi:
  --port <angka>                  Ganti port server lokal (default: 3000)
  --no-tunnel                     Jalankan lokal saja tanpa tunnel Cloudflare
  --no-open                       Jangan buka browser otomatis
  --no-setup                      Lewati tawaran setup otomatis pada run pertama
  -h, --help                      Tampilkan bantuan ini
  -v, --version                   Tampilkan versi paket
`);
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
    } else {
      const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
      child.unref();
    }
  } catch {
    // Non-fatal if OS cannot launch browser
  }
}

async function runSetupWizard(flags) {
  const existing = loadConfig();
  if (!process.stdin.isTTY) {
    console.log(`Mode non-interaktif: tulis konfigurasi manual ke ${getConfigPath()}`);
    return existing;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\n=== Setup Ruang Kolaborasi 3D untuk Discord ===');
    console.log('Catatan: Discord mewajibkan Anda membuat Application di Developer Portal.');
    console.log(`Portal: ${PORTAL_HOME_URL}\n`);

    if (!flags.noOpen) {
      const openChoice = await rl.question('Buka Discord Developer Portal di browser sekarang? (Y/n): ');
      if (openChoice.trim().toLowerCase() !== 'n') {
        openBrowser(PORTAL_HOME_URL);
      }
    }

    console.log('\nDi Discord Developer Portal -> New Application -> OAuth2:');
    const cidHint = existing.clientId ? ` [enter untuk pakai: ${existing.clientId}]` : ' (kosongkan jika mau coba lokal dulu)';
    let clientId = (await rl.question(`Masukkan DISCORD_CLIENT_ID${cidHint}: `)).trim();
    if (!clientId && existing.clientId) clientId = existing.clientId;

    let clientSecret = existing.clientSecret;
    if (clientId) {
      const secHint = existing.clientSecret ? ` [enter untuk pertahankan ${maskSecret(existing.clientSecret)}]` : '';
      const secInput = (await rl.question(`Masukkan DISCORD_CLIENT_SECRET${secHint}: `)).trim();
      if (secInput) clientSecret = secInput;
    } else {
      clientSecret = '';
    }

    const botHint = existing.botToken ? ` [enter untuk pertahankan ${maskSecret(existing.botToken)}]` : ' (opsional, Enter untuk lewati)';
    const botInput = (await rl.question(`Masukkan DISCORD_BOT_TOKEN${botHint}: `)).trim();
    const botToken = botInput || existing.botToken || '';

    const portInput = (await rl.question(`Port server lokal [${existing.port}]: `)).trim();
    const port = portInput ? Number(portInput) : existing.port;

    const savedPath = await saveConfig({ port, clientId, clientSecret, botToken });
    console.log(`\nKonfigurasi tersimpan aman di: ${savedPath}`);

    const links = buildDiscordLinks(clientId, Boolean(botToken));
    if (clientId) {
      console.log(`Portal Aplikasi Discord : ${links.portalUrl}`);
      console.log(`Link Undang ke Server  : ${links.inviteUrl}`);
      console.log('Pastikan di portal Anda menyalakan Activities -> Enable Activities.');
    }

    return loadConfig();
  } finally {
    rl.close();
  }
}

function showStatus() {
  const cfg = loadConfig();
  const links = buildDiscordLinks(cfg.clientId, Boolean(cfg.botToken));
  console.log('\n=== Status 3d-meet-board ===');
  console.log(`Berkas Konfigurasi : ${cfg.configPath} (${cfg.configExists ? 'ada' : 'belum dibuat'})`);
  console.log(`Folder Data Papan  : ${getDefaultRoomsDir()}`);
  console.log(`Port Server        : ${cfg.port}`);
  console.log(`Discord Client ID  : ${cfg.clientId || '(belum diisi, mode pratinjau lokal)'}`);
  console.log(`Discord Secret     : ${maskSecret(cfg.clientSecret) || '(belum diisi)'}`);
  console.log(`Discord Bot Token  : ${maskSecret(cfg.botToken) || '(opsional, belum diisi)'}`);
  if (cfg.clientId) {
    console.log(`Portal Aplikasi    : ${links.portalUrl}`);
    console.log(`Link Undang Server : ${links.inviteUrl}`);
  }
  console.log('');
}

async function startCloudflareTunnel(port) {
  if (!fsSync.existsSync(cloudflaredBin)) {
    console.log('Mengunduh binary cloudflared untuk tunnel HTTPS otomatis...');
    await installCloudflared(cloudflaredBin);
  }

  return await new Promise((resolve) => {
    const child = spawn(cloudflaredBin, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const handleChunk = (chunk) => {
      const text = String(chunk);
      const match = TRY_CF_REGEX.exec(text);
      if (match) {
        done({ url: match[0], process: child });
      }
    };

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleChunk);
    child.on('error', (err) => {
      done({ url: null, process: null, error: err.message });
    });
    child.on('exit', (code) => {
      if (!settled) {
        done({ url: null, process: null, error: `cloudflared keluar dengan kode ${code}` });
      }
    });

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      done({ url: null, process: null, error: 'Waktu tunggu tunnel HTTPS habis (25 detik).' });
    }, 25_000);
  });
}

async function runStart(flags) {
  let cfg = loadConfig();

  if (!cfg.configExists && !flags.noSetup && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answer = '';
    try {
      answer = await rl.question(
        'Belum ada konfigurasi Discord. Jalankan wizard setup sekarang? (y/N, Enter untuk langsung pratinjau lokal): '
      );
    } finally {
      rl.close();
    }
    if (answer.trim().toLowerCase() === 'y') {
      cfg = await runSetupWizard(flags);
    }
  }

  const port = Number.isInteger(flags.port) && flags.port > 0 ? flags.port : cfg.port;
  const serverHandle = await startServer({
    port,
    dataDir: getDefaultRoomsDir(),
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    botToken: cfg.botToken,
    quiet: true,
  });

  let tunnelProc = null;
  let tunnelUrl = null;
  let tunnelError = null;

  if (!flags.noTunnel) {
    console.log('Menyiapkan tunnel HTTPS Cloudflare untuk Discord Activity...');
    const t = await startCloudflareTunnel(serverHandle.port);
    tunnelProc = t.process;
    tunnelUrl = t.url;
    tunnelError = t.error || null;
  }

  const localUrl = `http://localhost:${serverHandle.port}`;
  const links = buildDiscordLinks(cfg.clientId, Boolean(cfg.botToken));
  const discordReady = Boolean(cfg.clientId && cfg.clientSecret);

  console.log('\n==================================================');
  console.log('Ruang Kolaborasi 3D Berjalan');
  console.log('==================================================');
  console.log(`URL Lokal              : ${localUrl}`);
  if (tunnelUrl) {
    console.log(`URL HTTPS Tunnel       : ${tunnelUrl}`);
  } else if (!flags.noTunnel && tunnelError) {
    console.log(`Tunnel HTTPS           : Gagal (${tunnelError}) - tetap berjalan secara lokal`);
  }
  console.log(`Lokasi Simpan Papan    : ${serverHandle.dataDir}`);
  if (discordReady) {
    console.log(`Portal Aplikasi Discord: ${links.portalUrl}`);
    console.log(`Link Undang ke Server : ${links.inviteUrl}`);
    if (tunnelUrl) {
      console.log(`\nLangkah di Discord Developer Portal -> Activities -> URL Mappings:`);
      console.log(`  Tempelkan URL ini ke root "/" : ${tunnelUrl}`);
      console.log('Lalu buka Voice/Text Channel di server Discord Anda dan jalankan Activity.');
    }
  } else {
    console.log('\nMode saat ini: Pratinjau Lokal (buka 2 tab browser ke URL Lokal di atas).');
    console.log('Untuk menyambungkan ke server Discord, jalankan: 3d-meet-board setup');
  }
  console.log('Tekan Ctrl+C untuk menghentikan server dan tunnel.\n');

  if (!flags.noOpen && !discordReady) {
    openBrowser(localUrl);
  }

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    console.log('\nMenghentikan server dan tunnel...');
    if (tunnelProc) {
      try {
        tunnelProc.kill();
      } catch {
        // ignore
      }
    }
    await serverHandle.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main() {
  const { command, flags } = parseArgs(process.argv);
  if (flags.help) {
    printHelp();
    return;
  }
  if (flags.version) {
    console.log(pkg.version);
    return;
  }
  if (command === 'status') {
    showStatus();
    return;
  }
  if (command === 'setup') {
    await runSetupWizard(flags);
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      let startNow = 'y';
      try {
        startNow = await rl.question('\nJalankan server dan tunnel HTTPS sekarang? (Y/n): ');
      } finally {
        rl.close();
      }
      if (startNow.trim().toLowerCase() !== 'n') {
        await runStart({ ...flags, noSetup: true });
      }
    }
    return;
  }

  await runStart(flags);
}

main().catch((err) => {
  console.error('[3d-meet-board] Terjadi kesalahan:', err instanceof Error ? err.message : err);
  process.exit(1);
});
