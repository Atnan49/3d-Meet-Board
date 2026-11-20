import { DiscordSDK, Events } from '@discord/embedded-app-sdk';
import type { PeerUser, ServerMember } from './types';

const LOCAL_COLORS = ['#16636B', '#B33229', '#B86A14', '#2D6A9F', '#5E4B9E', '#2A7A4E'];

export function isDiscordFrame(): boolean {
  return new URLSearchParams(window.location.search).has('frame_id');
}

export function apiBase(): string {
  return isDiscordFrame() ? '/.proxy/api' : '/api';
}

export function wsUrl(roomId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = isDiscordFrame() ? '/.proxy/ws' : '/ws';
  return `${proto}//${window.location.host}${basePath}?room=${encodeURIComponent(roomId)}`;
}

function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return LOCAL_COLORS[Math.abs(h) % LOCAL_COLORS.length];
}

function getOrCreateLocalUser(): PeerUser {
  let id = localStorage.getItem('ruang3d.peerId');
  if (!id) {
    id = `local-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('ruang3d.peerId', id);
  }
  let name = localStorage.getItem('ruang3d.name');
  if (!name) {
    name = `Pengurus ${id.slice(-4).toUpperCase()}`;
    localStorage.setItem('ruang3d.name', name);
  }
  const color = localStorage.getItem('ruang3d.color') || hashColor(id);
  localStorage.setItem('ruang3d.color', color);
  return { id, name, color };
}

export function saveLocalDisplayName(name: string): PeerUser {
  const user = getOrCreateLocalUser();
  const clean = name.trim().slice(0, 40) || user.name;
  localStorage.setItem('ruang3d.name', clean);
  return { ...user, name: clean };
}

export interface IdentityContext {
  mode: 'discord' | 'local';
  roomId: string;
  roomLabel: string;
  user: PeerUser;
  guildMembers: ServerMember[];
  activityParticipants: ServerMember[];
  warning?: string;
  onActivityParticipants?: (cb: (participants: ServerMember[]) => void) => () => void;
}

function mapParticipant(p: {
  id: string;
  username: string;
  global_name?: string | null;
  nickname?: string;
  avatar?: string | null;
  bot?: boolean;
}, selfId: string): ServerMember {
  const name = p.nickname || p.global_name || p.username || 'Anggota';
  const avatarUrl = p.avatar
    ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=64`
    : undefined;
  return {
    id: p.id,
    name,
    avatarUrl,
    bot: Boolean(p.bot),
    online: true,
    isSelf: p.id === selfId,
  };
}

export async function initIdentity(): Promise<IdentityContext> {
  const base = apiBase();
  let clientId = '';
  let botConfigured = false;
  let configWarning: string | undefined;

  try {
    const cfgRes = await fetch(`${base}/config`);
    if (cfgRes.ok) {
      const cfg = (await cfgRes.json()) as {
        clientId?: string;
        discordConfigured?: boolean;
        botConfigured?: boolean;
      };
      clientId = (cfg.clientId || '').trim();
      botConfigured = Boolean(cfg.botConfigured);
      if (isDiscordFrame() && !cfg.discordConfigured) {
        configWarning = 'DISCORD_CLIENT_ID atau DISCORD_CLIENT_SECRET belum diisi pada .env server.';
      }
    }
  } catch {
    configWarning = 'Server backend tidak terjangkau. Jalankan npm start di terminal.';
  }

  if (isDiscordFrame() && clientId) {
    try {
      const discordSdk = new DiscordSDK(clientId);
      await discordSdk.ready();

      const { code } = await discordSdk.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: '',
        scope: ['identify', 'guilds', 'guilds.members.read'],
      });

      const tokenRes = await fetch(`${base}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!tokenRes.ok) {
        const errData = await tokenRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Gagal menukar token Discord OAuth2.');
      }
      const { access_token } = (await tokenRes.json()) as { access_token: string };
      const auth = await discordSdk.commands.authenticate({ access_token });

      const selfId = auth.user.id;
      const selfName = auth.user.global_name || auth.user.username;
      const avatarUrl = auth.user.avatar
        ? `https://cdn.discordapp.com/avatars/${selfId}/${auth.user.avatar}.png?size=64`
        : undefined;

      const user: PeerUser = {
        id: selfId,
        name: selfName,
        color: hashColor(selfId),
        avatarUrl,
      };

      const { participants } = await discordSdk.commands.getActivityInstanceConnectedParticipants();
      const activityParticipants = participants.map((p) => mapParticipant(p, selfId));

      let guildMembers: ServerMember[] = [];
      const guildId = discordSdk.guildId;
      if (botConfigured && guildId) {
        try {
          const mRes = await fetch(`${base}/members/${guildId}`);
          if (mRes.ok) {
            const mData = (await mRes.json()) as { members?: ServerMember[] };
            guildMembers = mData.members || [];
          }
        } catch {
          // Non-fatal; fallback to activity participants
        }
      }

      const roomId = guildId || discordSdk.channelId || 'discord-room';
      const onActivityParticipants = (cb: (list: ServerMember[]) => void) => {
        const handler = (data: { participants: Parameters<typeof mapParticipant>[0][] }) => {
          cb(data.participants.map((p) => mapParticipant(p, selfId)));
        };
        discordSdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
        return () => {
          discordSdk.unsubscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
        };
      };

      return {
        mode: 'discord',
        roomId,
        roomLabel: guildId ? `Server Discord (${guildId.slice(-4)})` : 'Ruang Discord',
        user,
        guildMembers,
        activityParticipants,
        onActivityParticipants,
      };
    } catch (err) {
      configWarning =
        err instanceof Error ? `Login Discord gagal: ${err.message}` : 'Gagal menyambung ke Discord SDK.';
    }
  }

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room') || 'ruang-demo';
  const user = getOrCreateLocalUser();
  return {
    mode: 'local',
    roomId,
    roomLabel: `Pratinjau Lokal (${roomId})`,
    user,
    guildMembers: [],
    activityParticipants: [],
    warning: configWarning,
  };
}
