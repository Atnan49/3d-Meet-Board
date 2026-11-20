import type { CursorState, NoteItem, PeerUser, StringConnection } from './types';

export type SyncStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface SyncCallbacks {
  onStatus: (status: SyncStatus, detail?: string) => void;
  onInit: (payload: {
    roomId: string;
    selfConnId: string;
    notes: NoteItem[];
    strings: StringConnection[];
    peers: PeerUser[];
  }) => void;
  onPeers: (peers: PeerUser[]) => void;
  onCursor: (connId: string, peer: PeerUser, cursor: CursorState) => void;
  onNoteUpsert: (note: NoteItem) => void;
  onNoteDelete: (noteId: string, removedStringIds: string[]) => void;
  onStringAdd: (conn: StringConnection) => void;
  onStringDelete: (stringId: string) => void;
  onError: (message: string) => void;
}

export class RoomSyncClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private retryDelay = 900;
  private retryTimer: number | null = null;
  private readonly url: string;
  private user: PeerUser;
  private readonly callbacks: SyncCallbacks;

  constructor(url: string, user: PeerUser, callbacks: SyncCallbacks) {
    this.url = url;
    this.user = user;
    this.callbacks = callbacks;
  }

  connect(): void {
    this.closed = false;
    this.openSocket(false);
  }

  retryNow(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.retryDelay = 900;
    this.openSocket(true);
  }

  updateUser(user: PeerUser): void {
    this.user = user;
    this.send({ type: 'hello', user });
  }

  sendCursor(cursor: CursorState): void {
    this.send({ type: 'cursor', cursor });
  }

  upsertNote(note: NoteItem): void {
    this.send({ type: 'note:upsert', note });
  }

  deleteNote(noteId: string): void {
    this.send({ type: 'note:delete', noteId });
  }

  addString(conn: StringConnection): void {
    this.send({ type: 'string:add', string: conn });
  }

  deleteString(stringId: string): void {
    this.send({ type: 'string:delete', stringId });
  }

  destroy(): void {
    this.closed = true;
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(isRetry: boolean): void {
    this.callbacks.onStatus(isRetry ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.retryDelay = 900;
      this.callbacks.onStatus('connected');
      this.send({ type: 'hello', user: this.user });
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'init') {
          this.callbacks.onInit(msg);
        } else if (msg.type === 'peers') {
          this.callbacks.onPeers(msg.peers || []);
        } else if (msg.type === 'cursor') {
          this.callbacks.onCursor(msg.connId, msg.peer, msg.cursor);
        } else if (msg.type === 'note:upsert') {
          this.callbacks.onNoteUpsert(msg.note);
        } else if (msg.type === 'note:delete') {
          this.callbacks.onNoteDelete(msg.noteId, msg.removedStringIds || []);
        } else if (msg.type === 'string:add') {
          this.callbacks.onStringAdd(msg.string);
        } else if (msg.type === 'string:delete') {
          this.callbacks.onStringDelete(msg.stringId);
        } else if (msg.type === 'error' && typeof msg.message === 'string') {
          this.callbacks.onError(msg.message);
        }
      } catch {
        // Ignore malformed server frames
      }
    });

    ws.addEventListener('close', () => {
      if (this.closed) {
        this.callbacks.onStatus('offline');
        return;
      }
      this.callbacks.onStatus('reconnecting', 'Koneksi sinkronisasi terputus, mencoba sambung ulang.');
      const delay = this.retryDelay;
      this.retryDelay = Math.min(8000, Math.round(this.retryDelay * 1.6));
      this.retryTimer = window.setTimeout(() => this.openSocket(true), delay);
    });
  }

  private send(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}
