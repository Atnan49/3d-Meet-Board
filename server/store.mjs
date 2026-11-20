import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const VALID_NOTE_COLORS = new Set(['yellow', 'blue', 'mint', 'coral', 'lavender', 'paper']);
const VALID_STRING_COLORS = new Set(['red', 'gold']);
const MAX_IMAGE_DATA_URL_LEN = 480_000;
const MAX_IMAGE_HTTPS_URL_LEN = 2048;

export function sanitizeRoomId(raw) {
  const str = typeof raw === 'string' ? raw : '';
  const cleaned = str
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || 'local-room';
}

function sanitizeId(raw) {
  if (typeof raw === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(raw)) {
    return raw;
  }
  return crypto.randomUUID();
}

function clampCoord(val, label) {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error(`Koordinat ${label} harus berupa angka yang valid.`);
  }
  return Math.min(0.94, Math.max(0.06, Number(val.toFixed(4))));
}

export function validateImageData(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('Foto wajib menyertakan gambar PNG/JPEG/WebP atau tautan HTTPS.');
  }
  const trimmed = raw.trim();
  const dataUrlMatch = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(trimmed);
  if (dataUrlMatch) {
    if (trimmed.length > MAX_IMAGE_DATA_URL_LEN) {
      throw new Error('Ukuran gambar terlalu besar setelah dikompresi.');
    }
    return trimmed;
  }
  if (trimmed.length <= MAX_IMAGE_HTTPS_URL_LEN) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new Error('Tautan foto tidak valid.');
    }
    if (parsed.protocol === 'https:') {
      return trimmed;
    }
  }
  throw new Error('Format gambar harus berupa data PNG/JPEG/WebP atau URL HTTPS yang valid.');
}

export function validateNoteInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Data catatan tidak valid.');
  }
  const kind = input.kind;
  if (kind !== 'sticky' && kind !== 'photo') {
    throw new Error('Jenis catatan harus sticky atau photo.');
  }

  const u = clampCoord(input.u, 'u');
  const v = clampCoord(input.v, 'v');
  const defaultColor = kind === 'photo' ? 'paper' : 'yellow';
  const color = VALID_NOTE_COLORS.has(input.color) ? input.color : defaultColor;
  const title = String(input.title ?? '').trim().slice(0, 80);
  const body = String(input.body ?? '').trim().slice(0, 500);
  const author = String(input.author ?? 'Anggota').trim().slice(0, 60) || 'Anggota';

  if (kind === 'sticky' && !title && !body) {
    throw new Error('Sticky note tidak boleh kosong seluruhnya.');
  }

  const note = {
    id: sanitizeId(input.id),
    kind,
    u,
    v,
    color,
    title,
    body,
    author,
    updatedAt: Date.now(),
  };

  if (kind === 'photo') {
    note.imageData = validateImageData(input.imageData);
  }

  return note;
}

export function validateStringInput(input, existingNoteIds) {
  if (!input || typeof input !== 'object') {
    throw new Error('Data benang penghubung tidak valid.');
  }
  const fromId = typeof input.fromId === 'string' ? input.fromId : '';
  const toId = typeof input.toId === 'string' ? input.toId : '';

  if (!existingNoteIds.has(fromId) || !existingNoteIds.has(toId)) {
    throw new Error('Kedua catatan tujuan benang harus tersedia di papan.');
  }
  if (fromId === toId) {
    throw new Error('Benang penghubung tidak dapat mengaitkan catatan ke dirinya sendiri.');
  }

  const color = VALID_STRING_COLORS.has(input.color) ? input.color : 'red';
  return {
    id: sanitizeId(input.id),
    fromId,
    toId,
    color,
    createdAt: Date.now(),
  };
}

export class RoomStore {
  constructor(baseDir = path.resolve('data', 'rooms')) {
    this.baseDir = baseDir;
    this.rooms = new Map();
    this.writeQueues = new Map();
  }

  roomFilePath(roomId) {
    const safe = sanitizeRoomId(roomId);
    return path.join(this.baseDir, `${safe}.json`);
  }

  async #loadFromDisk(safeId) {
    const filePath = this.roomFilePath(safeId);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
      const strings = Array.isArray(parsed.strings) ? parsed.strings : [];
      return { notes, strings };
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        return { notes: [], strings: [] };
      }
      throw err;
    }
  }

  async #ensureLoaded(roomId) {
    const safeId = sanitizeRoomId(roomId);
    if (!this.rooms.has(safeId)) {
      const data = await this.#loadFromDisk(safeId);
      this.rooms.set(safeId, data);
    }
    return { safeId, room: this.rooms.get(safeId) };
  }

  async #persist(safeId, room) {
    const prev = this.writeQueues.get(safeId) || Promise.resolve();
    const snapshot = JSON.stringify(room, null, 2);
    const next = prev.then(async () => {
      await fs.mkdir(this.baseDir, { recursive: true });
      const target = this.roomFilePath(safeId);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, target);
    });
    this.writeQueues.set(
      safeId,
      next.catch(() => {})
    );
    await next;
  }

  async getRoom(roomId) {
    const { room } = await this.#ensureLoaded(roomId);
    return {
      notes: room.notes.map((n) => ({ ...n })),
      strings: room.strings.map((s) => ({ ...s })),
    };
  }

  async upsertNote(roomId, rawNote) {
    const { safeId, room } = await this.#ensureLoaded(roomId);
    const note = validateNoteInput(rawNote);
    const idx = room.notes.findIndex((n) => n.id === note.id);
    if (idx >= 0) {
      room.notes[idx] = note;
    } else {
      room.notes.push(note);
    }
    await this.#persist(safeId, room);
    return { ...note };
  }

  async deleteNote(roomId, noteId) {
    const { safeId, room } = await this.#ensureLoaded(roomId);
    const before = room.notes.length;
    room.notes = room.notes.filter((n) => n.id !== noteId);
    const deleted = room.notes.length < before;
    const removedStringIds = [];
    if (deleted) {
      room.strings = room.strings.filter((s) => {
        if (s.fromId === noteId || s.toId === noteId) {
          removedStringIds.push(s.id);
          return false;
        }
        return true;
      });
      await this.#persist(safeId, room);
    }
    return { deleted, removedStringIds };
  }

  async addString(roomId, rawConn) {
    const { safeId, room } = await this.#ensureLoaded(roomId);
    const noteIds = new Set(room.notes.map((n) => n.id));
    const conn = validateStringInput(rawConn, noteIds);

    const dup = room.strings.some(
      (s) =>
        (s.fromId === conn.fromId && s.toId === conn.toId) ||
        (s.fromId === conn.toId && s.toId === conn.fromId)
    );
    if (dup) {
      throw new Error('Benang penghubung di antara dua catatan tersebut sudah ada.');
    }

    room.strings.push(conn);
    await this.#persist(safeId, room);
    return { ...conn };
  }

  async deleteString(roomId, stringId) {
    const { safeId, room } = await this.#ensureLoaded(roomId);
    const before = room.strings.length;
    room.strings = room.strings.filter((s) => s.id !== stringId);
    const deleted = room.strings.length < before;
    if (deleted) {
      await this.#persist(safeId, room);
    }
    return { deleted };
  }
}
