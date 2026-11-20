import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { loadConfig } from './config.mjs';
import { RoomStore, sanitizeRoomId } from './store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DIST_DIR = path.resolve(__dirname, '..', 'dist');

const PEER_COLORS = ['#16636B', '#B33229', '#B86A14', '#2D6A9F', '#5E4B9E', '#2A7A4E'];

export async function startServer(options = {}) {
  const cfg = loadConfig();
  const port = options.port !== undefined ? Number(options.port) : cfg.port;
  const clientId = String(options.clientId ?? cfg.clientId ?? '').trim();
  const clientSecret = String(options.clientSecret ?? cfg.clientSecret ?? '').trim();
  const botToken = String(options.botToken ?? cfg.botToken ?? '').trim();
  const dataDir = options.dataDir ? path.resolve(options.dataDir) : path.resolve('data', 'rooms');
  const distDir = options.distDir ? path.resolve(options.distDir) : DEFAULT_DIST_DIR;

  const memberCache = new Map();
  const store = new RoomStore(dataDir);
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const apiRouter = express.Router();

  apiRouter.get('/health', (_req, res) => {
    res.json({
      ok: true,
      discordConfigured: Boolean(clientId && clientSecret),
      botConfigured: Boolean(botToken),
    });
  });

  apiRouter.get('/config', (_req, res) => {
    res.json({
      clientId,
      discordConfigured: Boolean(clientId && clientSecret),
      botConfigured: Boolean(botToken),
    });
  });

  apiRouter.post('/token', async (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code) {
      res.status(400).json({ error: 'Kode otorisasi Discord tidak boleh kosong.' });
      return;
    }
    if (!clientId || !clientSecret) {
      res.status(503).json({
        error: 'DISCORD_CLIENT_ID atau DISCORD_CLIENT_SECRET belum dikonfigurasi pada server.',
      });
      return;
    }

    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code,
        }),
      });

      const data = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !data.access_token) {
        res.status(tokenRes.status >= 400 ? tokenRes.status : 502).json({
          error: data.error_description || data.error || 'Gagal menukar token OAuth Discord.',
        });
        return;
      }

      res.json({ access_token: data.access_token });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Gagal menghubungi server Discord.',
      });
    }
  });

  apiRouter.get('/members/:guildId', async (req, res) => {
    if (!botToken) {
      res.json({ source: 'activity', members: [] });
      return;
    }

    const guildId = req.params.guildId;
    if (!/^\d{15,25}$/.test(guildId)) {
      res.status(400).json({ error: 'ID server Discord tidak valid.' });
      return;
    }

    const cached = memberCache.get(guildId);
    if (cached && Date.now() - cached.fetchedAt < 60_000) {
      res.json({ source: 'guild', members: cached.members });
      return;
    }

    try {
      const resp = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=100`, {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      });
      if (!resp.ok) {
        res.json({
          source: 'activity',
          members: [],
          warning: `Bot belum dapat membaca daftar anggota server (status ${resp.status}).`,
        });
        return;
      }
      const rawMembers = await resp.json();
      const members = Array.isArray(rawMembers)
        ? rawMembers.slice(0, 60).map((m) => {
            const u = m.user || {};
            const name = String(m.nick || u.global_name || u.username || 'Anggota').slice(0, 48);
            const avatarUrl = u.avatar
              ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
              : undefined;
            return {
              id: String(u.id || ''),
              name,
              avatarUrl,
              bot: Boolean(u.bot),
            };
          })
        : [];
      memberCache.set(guildId, { fetchedAt: Date.now(), members });
      res.json({ source: 'guild', members });
    } catch {
      res.json({ source: 'activity', members: [] });
    }
  });

  app.use('/api', apiRouter);
  app.use('/.proxy/api', apiRouter);

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/.proxy/api') ||
        req.path.startsWith('/ws') ||
        req.path.startsWith('/.proxy/ws')
      ) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const activeRooms = new Map();

  function broadcast(roomId, payload, exceptConnId = null) {
    const conns = activeRooms.get(roomId);
    if (!conns) return;
    const serialized = JSON.stringify(payload);
    for (const [cid, entry] of conns.entries()) {
      if (cid === exceptConnId) continue;
      if (entry.ws.readyState === WebSocket.OPEN) {
        entry.ws.send(serialized);
      }
    }
  }

  function getRoomPeers(roomId) {
    const conns = activeRooms.get(roomId);
    if (!conns) return [];
    return Array.from(conns.values()).map((e) => e.peer);
  }

  server.on('upgrade', (req, socket, head) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (reqUrl.pathname !== '/ws' && reqUrl.pathname !== '/.proxy/ws') {
        socket.destroy();
        return;
      }
      const roomId = sanitizeRoomId(reqUrl.searchParams.get('room'));
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, roomId);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, roomId) => {
    const connId = crypto.randomUUID();
    if (!activeRooms.has(roomId)) {
      activeRooms.set(roomId, new Map());
    }
    const conns = activeRooms.get(roomId);
    const defaultColor = PEER_COLORS[conns.size % PEER_COLORS.length];

    const entry = {
      ws,
      peer: {
        connId,
        id: connId,
        name: 'Anggota',
        color: defaultColor,
        avatarUrl: '',
      },
    };
    conns.set(connId, entry);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Format pesan tidak valid.' }));
        return;
      }

      try {
        if (msg.type === 'hello') {
          const u = msg.user && typeof msg.user === 'object' ? msg.user : {};
          entry.peer = {
            connId,
            id: typeof u.id === 'string' && u.id.trim() ? u.id.trim().slice(0, 64) : connId,
            name: typeof u.name === 'string' && u.name.trim() ? u.name.trim().slice(0, 48) : 'Anggota',
            color:
              typeof u.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(u.color)
                ? u.color
                : defaultColor,
            avatarUrl:
              typeof u.avatarUrl === 'string' && u.avatarUrl.startsWith('https://')
                ? u.avatarUrl.slice(0, 512)
                : '',
          };
          const roomState = await store.getRoom(roomId);
          ws.send(
            JSON.stringify({
              type: 'init',
              roomId,
              selfConnId: connId,
              notes: roomState.notes,
              strings: roomState.strings,
              peers: getRoomPeers(roomId),
            })
          );
          broadcast(roomId, { type: 'peers', peers: getRoomPeers(roomId) }, connId);
          return;
        }

        if (msg.type === 'cursor') {
          const c = msg.cursor && typeof msg.cursor === 'object' ? msg.cursor : {};
          if (
            typeof c.x === 'number' &&
            Number.isFinite(c.x) &&
            typeof c.y === 'number' &&
            Number.isFinite(c.y) &&
            typeof c.z === 'number' &&
            Number.isFinite(c.z)
          ) {
            broadcast(
              roomId,
              {
                type: 'cursor',
                connId,
                peer: entry.peer,
                cursor: {
                  x: Number(c.x.toFixed(3)),
                  y: Number(c.y.toFixed(3)),
                  z: Number(c.z.toFixed(3)),
                  visible: Boolean(c.visible),
                },
              },
              connId
            );
          }
          return;
        }

        if (msg.type === 'note:upsert') {
          const note = await store.upsertNote(roomId, msg.note);
          broadcast(roomId, { type: 'note:upsert', note });
          return;
        }

        if (msg.type === 'note:delete') {
          const noteId = typeof msg.noteId === 'string' ? msg.noteId : '';
          const res = await store.deleteNote(roomId, noteId);
          if (res.deleted) {
            broadcast(roomId, {
              type: 'note:delete',
              noteId,
              removedStringIds: res.removedStringIds,
            });
          }
          return;
        }

        if (msg.type === 'string:add') {
          const conn = await store.addString(roomId, msg.string);
          broadcast(roomId, { type: 'string:add', string: conn });
          return;
        }

        if (msg.type === 'string:delete') {
          const stringId = typeof msg.stringId === 'string' ? msg.stringId : '';
          const res = await store.deleteString(roomId, stringId);
          if (res.deleted) {
            broadcast(roomId, { type: 'string:delete', stringId });
          }
          return;
        }
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: err instanceof Error ? err.message : 'Gagal memproses permintaan.',
          })
        );
      }
    });

    ws.on('close', () => {
      conns.delete(connId);
      if (conns.size === 0) {
        activeRooms.delete(roomId);
      } else {
        broadcast(roomId, { type: 'peers', peers: getRoomPeers(roomId) });
      }
    });
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    server.once('error', onError);
    server.listen(port, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  if (!options.quiet) {
    const modeLabel =
      clientId && clientSecret
        ? 'Discord Activity + Pratinjau Lokal siap'
        : 'Pratinjau Lokal siap (isi DISCORD_CLIENT_ID & DISCORD_CLIENT_SECRET untuk Discord Activity)';
    console.log(`[Ruang Kolaborasi 3D] Server berjalan di http://localhost:${actualPort}`);
    console.log(`[Status] ${modeLabel}`);
  }

  return {
    server,
    port: actualPort,
    dataDir,
    close: async () => {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const isMainModule =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  startServer().catch((err) => {
    console.error('[Ruang Kolaborasi 3D] Gagal menjalankan server:', err);
    process.exit(1);
  });
}
