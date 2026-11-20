import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RoomStore, sanitizeRoomId, validateNoteInput } from './store.mjs';

test('sanitizeRoomId removes path traversal and unsafe characters', () => {
  assert.equal(sanitizeRoomId('../../etc/passwd'), 'etc-passwd');
  assert.equal(sanitizeRoomId('   '), 'local-room');
  assert.equal(sanitizeRoomId('Himpunan_2026!@#'), 'Himpunan_2026');
});

test('validateNoteInput clamps board coordinates and rejects invalid photo schemes', () => {
  const note = validateNoteInput({
    kind: 'sticky',
    u: -2,
    v: 9,
    color: 'mint',
    title: '  Rapat Website  ',
    body: 'Cek halaman daftar pengurus',
    author: 'Raka',
  });
  assert.equal(note.u, 0.06);
  assert.equal(note.v, 0.94);
  assert.equal(note.color, 'mint');
  assert.equal(note.title, 'Rapat Website');

  assert.throws(() =>
    validateNoteInput({
      kind: 'photo',
      u: 0.5,
      v: 0.5,
      imageData: 'javascript:alert(1)',
    })
  );

  assert.throws(() =>
    validateNoteInput({
      kind: 'photo',
      u: 0.5,
      v: 0.5,
      imageData: 'data:image/png;base64,' + 'A'.repeat(500_000),
    })
  );
});

test('RoomStore persists notes, prevents duplicate strings, and cascades string deletion', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'room-store-test-'));
  try {
    const store = new RoomStore(tmpDir);
    const n1 = await store.upsertNote('guild-1', {
      id: 'n1',
      kind: 'sticky',
      u: 0.25,
      v: 0.7,
      title: 'Beranda Web',
      body: 'Perbarui banner proker',
    });
    const n2 = await store.upsertNote('guild-1', {
      id: 'n2',
      kind: 'photo',
      u: 0.65,
      v: 0.5,
      title: 'Struktur Pengurus',
      imageData: 'https://example.com/foto.png',
    });

    const conn = await store.addString('guild-1', {
      id: 's1',
      fromId: n1.id,
      toId: n2.id,
      color: 'red',
    });
    assert.equal(conn.fromId, 'n1');

    // Undirected duplicate should be rejected
    await assert.rejects(() =>
      store.addString('guild-1', {
        fromId: n2.id,
        toId: n1.id,
        color: 'gold',
      })
    );

    // Reload from disk in a fresh store instance
    const reloaded = new RoomStore(tmpDir);
    const loadedRoom = await reloaded.getRoom('guild-1');
    assert.equal(loadedRoom.notes.length, 2);
    assert.equal(loadedRoom.strings.length, 1);

    // Deleting n1 cascades string s1
    const delRes = await reloaded.deleteNote('guild-1', 'n1');
    assert.equal(delRes.deleted, true);
    assert.deepEqual(delRes.removedStringIds, ['s1']);

    const afterDelete = await reloaded.getRoom('guild-1');
    assert.equal(afterDelete.notes.length, 1);
    assert.equal(afterDelete.strings.length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
