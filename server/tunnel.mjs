import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getHomeDir } from './config.mjs';

const RELEASE_BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
const TRY_CF_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export function resolveCloudflaredAsset(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') {
    const file = arch === 'ia32' ? 'cloudflared-windows-386.exe' : 'cloudflared-windows-amd64.exe';
    return { url: `${RELEASE_BASE}${file}`, binName: 'cloudflared.exe', isArchive: false };
  }
  if (platform === 'darwin') {
    const file = arch === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz';
    return { url: `${RELEASE_BASE}${file}`, binName: 'cloudflared', isArchive: true };
  }
  if (platform === 'linux') {
    const map = {
      x64: 'cloudflared-linux-amd64',
      arm64: 'cloudflared-linux-arm64',
      arm: 'cloudflared-linux-arm',
      ia32: 'cloudflared-linux-386',
    };
    const file = map[arch];
    if (!file) {
      throw new Error(`Arsitektur Linux tidak didukung untuk cloudflared: ${arch}`);
    }
    return { url: `${RELEASE_BASE}${file}`, binName: 'cloudflared', isArchive: false };
  }
  throw new Error(`Platform tidak didukung untuk cloudflared: ${platform}`);
}

export function getCachedBinaryPath(platform = process.platform) {
  const binName = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  return path.join(getHomeDir(), 'bin', binName);
}

export async function ensureCloudflaredBinary({ onStatus } = {}) {
  const probe = spawnSync('cloudflared', ['--version'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (probe.status === 0) {
    return 'cloudflared';
  }

  const cachedPath = getCachedBinaryPath();
  try {
    const st = fsSync.statSync(cachedPath);
    if (st.isFile() && st.size > 1_000_000) {
      return cachedPath;
    }
  } catch {
    // Not cached yet
  }

  const asset = resolveCloudflaredAsset();
  const binDir = path.dirname(cachedPath);
  await fs.mkdir(binDir, { recursive: true });

  if (onStatus) {
    onStatus('Mengunduh cloudflared resmi untuk tunnel HTTPS otomatis (hanya sekali)...');
  }

  const res = await fetch(asset.url);
  if (!res.ok || !res.body) {
    throw new Error(`Gagal mengunduh cloudflared (${res.status} ${res.statusText}).`);
  }

  if (asset.isArchive) {
    const archivePath = `${cachedPath}.${process.pid}.tgz`;
    const fileStream = fsSync.createWriteStream(archivePath);
    await pipeline(Readable.fromWeb(res.body), fileStream);
    try {
      execFileSync('tar', ['-xzf', archivePath, '-C', binDir], { stdio: 'ignore' });
    } finally {
      await fs.rm(archivePath, { force: true });
    }
  } else {
    const tmpPath = `${cachedPath}.${process.pid}.tmp`;
    const fileStream = fsSync.createWriteStream(tmpPath);
    try {
      await pipeline(Readable.fromWeb(res.body), fileStream);
      await fs.rename(tmpPath, cachedPath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true });
      throw err;
    }
  }

  if (process.platform !== 'win32') {
    await fs.chmod(cachedPath, 0o755);
  }
  return cachedPath;
}

export async function startQuickTunnel(port, { timeoutMs = 25_000, onStatus } = {}) {
  let binPath;
  try {
    binPath = await ensureCloudflaredBinary({ onStatus });
  } catch (err) {
    return {
      url: null,
      process: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return await new Promise((resolve) => {
    const child = spawn(binPath, ['tunnel', '--url', `http://127.0.0.1:${port}`], {
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
      const match = TRY_CF_REGEX.exec(String(chunk));
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
      done({ url: null, process: null, error: 'Waktu tunggu tunnel HTTPS habis.' });
    }, timeoutMs);
  });
}
