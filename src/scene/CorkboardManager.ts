import * as THREE from 'three';
import type { NoteColor, NoteItem, StringColor, StringConnection } from '../types';

const NOTE_PALETTE: Record<NoteColor, { bg: string; header: string; ink: string }> = {
  yellow: { bg: '#FCE68A', header: '#E8C547', ink: '#1E2228' },
  blue: { bg: '#BAE0FA', header: '#7CC0F0', ink: '#1E2228' },
  mint: { bg: '#B7EDD2', header: '#6BD4A2', ink: '#1E2228' },
  coral: { bg: '#FAD0C9', header: '#EA8B7D', ink: '#1E2228' },
  lavender: { bg: '#DCD2FA', header: '#B29CEB', ink: '#1E2228' },
  paper: { bg: '#FAF8F4', header: '#E4DFD6', ink: '#1E2228' },
};

const STRING_COLORS: Record<StringColor, number> = {
  red: 0xd92820,
  gold: 0xde8a18,
};

function hashTilt(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 33 + id.charCodeAt(i)) | 0;
  }
  return (((Math.abs(h) % 15) - 7) * Math.PI) / 180;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number): void {
  const words = text.split(/\s+/);
  let line = '';
  let linesDrawn = 0;
  for (let i = 0; i < words.length; i += 1) {
    const testLine = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y + linesDrawn * lineHeight);
      linesDrawn += 1;
      line = words[i];
      if (linesDrawn >= maxLines) return;
    } else {
      line = testLine;
    }
  }
  if (line && linesDrawn < maxLines) {
    ctx.fillText(line, x, y + linesDrawn * lineHeight);
  }
}

export class CorkboardManager {
  public readonly group = new THREE.Group();
  public readonly bounds: { minX: number; maxX: number; minY: number; maxY: number; frontZ: number };

  private notes = new Map<string, NoteItem>();
  private strings = new Map<string, StringConnection>();
  private noteGroups = new Map<string, THREE.Group>();
  private stringMeshes = new Map<string, THREE.Mesh>();

  private selectedNoteId: string | null = null;
  private connectStartId: string | null = null;
  private selectedStringId: string | null = null;

  private readonly highlightMesh: THREE.Mesh;
  private readonly ghostMesh: THREE.Mesh;

  constructor(corkboardObj: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(corkboardObj);
    this.bounds = {
      minX: box.min.x,
      maxX: box.max.x,
      minY: box.min.y,
      maxY: box.max.y,
      frontZ: box.max.z,
    };

    this.highlightMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.58, 0.64),
      new THREE.MeshBasicMaterial({ color: 0x16636b, transparent: true, opacity: 0.45 })
    );
    this.highlightMesh.visible = false;
    this.group.add(this.highlightMesh);

    this.ghostMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.36),
      new THREE.MeshBasicMaterial({ color: 0x16636b, transparent: true, opacity: 0.32 })
    );
    this.ghostMesh.visible = false;
    this.group.add(this.ghostMesh);
  }

  uvToWorld(u: number, v: number): THREE.Vector3 {
    const cu = Math.min(0.94, Math.max(0.06, u));
    const cv = Math.min(0.94, Math.max(0.06, v));
    const x = this.bounds.minX + cu * (this.bounds.maxX - this.bounds.minX);
    const y = this.bounds.minY + cv * (this.bounds.maxY - this.bounds.minY);
    return new THREE.Vector3(x, y, this.bounds.frontZ + 0.016);
  }

  worldToUv(point: THREE.Vector3): { u: number; v: number } {
    const spanX = Math.max(0.1, this.bounds.maxX - this.bounds.minX);
    const spanY = Math.max(0.1, this.bounds.maxY - this.bounds.minY);
    const u = Math.min(0.94, Math.max(0.06, (point.x - this.bounds.minX) / spanX));
    const v = Math.min(0.94, Math.max(0.06, (point.y - this.bounds.minY) / spanY));
    return { u, v };
  }

  setGhostVisible(visible: boolean, kind: 'sticky' | 'photo' = 'sticky', point?: THREE.Vector3): void {
    this.ghostMesh.visible = visible;
    if (!visible || !point) return;
    const { u, v } = this.worldToUv(point);
    const pos = this.uvToWorld(u, v);
    this.ghostMesh.position.set(pos.x, pos.y, this.bounds.frontZ + 0.01);
    if (kind === 'photo') {
      this.ghostMesh.scale.set(1.18, 1.5, 1);
    } else {
      this.ghostMesh.scale.set(1, 1, 1);
    }
  }

  setSelection(noteId: string | null, connectStartId: string | null, stringId: string | null): void {
    this.selectedNoteId = noteId;
    this.connectStartId = connectStartId;
    this.selectedStringId = stringId;
    this.updateHighlight();
    this.rebuildAllStrings();
  }

  getAllNotes(): NoteItem[] {
    return Array.from(this.notes.values());
  }

  getNote(id: string): NoteItem | undefined {
    return this.notes.get(id);
  }

  getString(id: string): StringConnection | undefined {
    return this.strings.get(id);
  }

  setAll(notes: NoteItem[], strings: StringConnection[]): void {
    for (const id of Array.from(this.noteGroups.keys())) {
      this.removeNoteMesh(id);
    }
    this.notes.clear();
    for (const n of notes) {
      this.notes.set(n.id, n);
      this.createOrUpdateNoteMesh(n);
    }

    for (const id of Array.from(this.stringMeshes.keys())) {
      this.removeStringMesh(id);
    }
    this.strings.clear();
    for (const s of strings) {
      this.strings.set(s.id, s);
    }
    this.rebuildAllStrings();
    this.updateHighlight();
  }

  upsertNote(note: NoteItem): void {
    this.notes.set(note.id, note);
    this.createOrUpdateNoteMesh(note);
    this.rebuildStringsForNote(note.id);
    this.updateHighlight();
  }

  moveNoteLocal(noteId: string, u: number, v: number): void {
    const note = this.notes.get(noteId);
    if (!note) return;
    note.u = u;
    note.v = v;
    const g = this.noteGroups.get(noteId);
    if (g) {
      const pos = this.uvToWorld(u, v);
      g.position.set(pos.x, pos.y, pos.z);
    }
    this.rebuildStringsForNote(noteId);
    this.updateHighlight();
  }

  deleteNote(noteId: string, removedStringIds: string[]): void {
    this.notes.delete(noteId);
    this.removeNoteMesh(noteId);
    for (const sid of removedStringIds) {
      this.strings.delete(sid);
      this.removeStringMesh(sid);
    }
    for (const [sid, s] of this.strings.entries()) {
      if (s.fromId === noteId || s.toId === noteId) {
        this.strings.delete(sid);
        this.removeStringMesh(sid);
      }
    }
    if (this.selectedNoteId === noteId) this.selectedNoteId = null;
    if (this.connectStartId === noteId) this.connectStartId = null;
    this.updateHighlight();
  }

  addString(conn: StringConnection): void {
    this.strings.set(conn.id, conn);
    this.createOrUpdateStringMesh(conn);
  }

  deleteString(stringId: string): void {
    this.strings.delete(stringId);
    this.removeStringMesh(stringId);
    if (this.selectedStringId === stringId) this.selectedStringId = null;
  }

  getInteractiveMeshes(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    for (const g of this.noteGroups.values()) {
      const card = g.getObjectByName('NoteCard');
      if (card) list.push(card);
    }
    for (const sm of this.stringMeshes.values()) {
      list.push(sm);
    }
    return list;
  }

  private createOrUpdateNoteMesh(note: NoteItem): void {
    this.removeNoteMesh(note.id);

    const isPhoto = note.kind === 'photo';
    const w = isPhoto ? 0.50 : 0.42;
    const h = isPhoto ? 0.56 : 0.36;
    const d = 0.01;
    const tilt = hashTilt(note.id);

    const container = new THREE.Group();
    const pos = this.uvToWorld(note.u, note.v);
    container.position.set(pos.x, pos.y, pos.z);
    container.rotation.z = tilt;
    container.userData = { noteId: note.id };

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = isPhoto ? 574 : 440;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    if (isPhoto) {
      this.drawPhotoCanvas(canvas, note, tex);
    } else {
      this.drawStickyCanvas(canvas, note);
      tex.needsUpdate = true;
    }

    const sideColor = isPhoto ? 0xf2eee6 : new THREE.Color(NOTE_PALETTE[note.color].header).getHex();
    const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.78 });
    const frontMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72 });

    const card = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      [sideMat, sideMat, sideMat, sideMat, frontMat, sideMat]
    );
    card.name = 'NoteCard';
    card.userData = { noteId: note.id };
    container.add(card);

    // 3D Pushpin at top center
    const pinColor = isPhoto ? 0x1e60d4 : 0xd92424;
    const pin = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 14, 10),
      new THREE.MeshStandardMaterial({ color: pinColor, roughness: 0.3 })
    );
    pin.name = 'NotePin';
    pin.position.set(0, h * 0.42, 0.018);
    pin.userData = { noteId: note.id };
    container.add(pin);

    this.group.add(container);
    this.noteGroups.set(note.id, container);
  }

  private drawStickyCanvas(canvas: HTMLCanvasElement, note: NoteItem): void {
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const pal = NOTE_PALETTE[note.color] || NOTE_PALETTE.yellow;

    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = pal.header;
    ctx.fillRect(0, 0, W, 62);

    ctx.fillStyle = pal.ink;
    ctx.font = 'bold 34px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(note.title || 'Catatan', 28, 108, W - 56);

    ctx.font = '26px system-ui, -apple-system, Segoe UI, sans-serif';
    wrapText(ctx, note.body || '', 28, 160, W - 56, 36, 5);

    ctx.fillStyle = 'rgba(30, 34, 40, 0.68)';
    ctx.font = '600 21px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(note.author || 'Anggota', 28, H - 24, W - 56);
  }

  private drawPhotoCanvas(canvas: HTMLCanvasElement, note: NoteItem, tex: THREE.CanvasTexture): void {
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#FAF8F4';
    ctx.fillRect(0, 0, W, H);

    // Photo frame placeholder
    ctx.fillStyle = '#DCE2E8';
    ctx.fillRect(28, 42, W - 56, 396);
    ctx.fillStyle = '#4A5058';
    ctx.font = '24px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Memuat foto...', W / 2, 240);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#1E2228';
    ctx.font = 'bold 28px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(note.title || 'Foto Referensi', 30, 488, W - 60);

    ctx.fillStyle = 'rgba(30, 34, 40, 0.68)';
    ctx.font = '600 20px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(note.author || 'Anggota', 30, H - 26, W - 60);
    tex.needsUpdate = true;

    if (note.imageData) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const fw = W - 56;
        const fh = 396;
        const scale = Math.max(fw / img.width, fh / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.save();
        ctx.beginPath();
        ctx.rect(28, 42, fw, fh);
        ctx.clip();
        ctx.drawImage(img, 28 + (fw - dw) / 2, 42 + (fh - dh) / 2, dw, dh);
        ctx.restore();
        tex.needsUpdate = true;
      };
      img.onerror = () => {
        ctx.fillStyle = '#E5DFD5';
        ctx.fillRect(28, 42, W - 56, 396);
        ctx.fillStyle = '#4A5058';
        ctx.font = '22px system-ui, -apple-system, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Pratinjau foto tidak tersedia', W / 2, 240);
        ctx.textAlign = 'left';
        tex.needsUpdate = true;
      };
      img.src = note.imageData;
    }
  }

  private getPinWorldPosition(noteId: string): THREE.Vector3 | null {
    const g = this.noteGroups.get(noteId);
    if (!g) return null;
    const pin = g.getObjectByName('NotePin');
    if (!pin) return null;
    g.updateMatrixWorld(true);
    const out = new THREE.Vector3();
    pin.getWorldPosition(out);
    out.z += 0.012;
    return out;
  }

  private createOrUpdateStringMesh(conn: StringConnection): void {
    this.removeStringMesh(conn.id);
    const p1 = this.getPinWorldPosition(conn.fromId);
    const p2 = this.getPinWorldPosition(conn.toId);
    if (!p1 || !p2) return;

    const dist = p1.distanceTo(p2);
    const sag = Math.min(0.18, Math.max(0.035, dist * 0.08));
    const mid = new THREE.Vector3(
      (p1.x + p2.x) * 0.5,
      (p1.y + p2.y) * 0.5 - sag,
      Math.max(p1.z, p2.z) + 0.025
    );

    const curve = new THREE.CatmullRomCurve3([p1, mid, p2]);
    const geo = new THREE.TubeGeometry(curve, 18, 0.0085, 6, false);
    const isSelected = this.selectedStringId === conn.id;
    const colorHex = isSelected ? 0x16636b : STRING_COLORS[conn.color] ?? STRING_COLORS.red;
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: isSelected ? 0.45 : 0.16,
      roughness: 0.5,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `String_${conn.id}`;
    mesh.userData = { stringId: conn.id };
    this.group.add(mesh);
    this.stringMeshes.set(conn.id, mesh);
  }

  private rebuildStringsForNote(noteId: string): void {
    for (const conn of this.strings.values()) {
      if (conn.fromId === noteId || conn.toId === noteId) {
        this.createOrUpdateStringMesh(conn);
      }
    }
  }

  private rebuildAllStrings(): void {
    for (const conn of this.strings.values()) {
      this.createOrUpdateStringMesh(conn);
    }
  }

  private updateHighlight(): void {
    const targetId = this.connectStartId || this.selectedNoteId;
    if (!targetId) {
      this.highlightMesh.visible = false;
      return;
    }
    const g = this.noteGroups.get(targetId);
    const note = this.notes.get(targetId);
    if (!g || !note) {
      this.highlightMesh.visible = false;
      return;
    }
    const mat = this.highlightMesh.material as THREE.MeshBasicMaterial;
    mat.color.setHex(this.connectStartId ? 0xde8a18 : 0x16636b);

    const isPhoto = note.kind === 'photo';
    this.highlightMesh.scale.set(isPhoto ? 0.94 : 0.80, isPhoto ? 0.96 : 0.64, 1);
    this.highlightMesh.position.set(g.position.x, g.position.y, g.position.z - 0.004);
    this.highlightMesh.rotation.z = g.rotation.z;
    this.highlightMesh.visible = true;
  }

  private removeNoteMesh(noteId: string): void {
    const g = this.noteGroups.get(noteId);
    if (!g) return;
    g.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial && m.map) {
            m.map.dispose();
          }
          m.dispose();
        }
      }
    });
    this.group.remove(g);
    this.noteGroups.delete(noteId);
  }

  private removeStringMesh(stringId: string): void {
    const mesh = this.stringMeshes.get(stringId);
    if (!mesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    this.group.remove(mesh);
    this.stringMeshes.delete(stringId);
  }

  dispose(): void {
    for (const id of Array.from(this.noteGroups.keys())) {
      this.removeNoteMesh(id);
    }
    for (const id of Array.from(this.stringMeshes.keys())) {
      this.removeStringMesh(id);
    }
    this.highlightMesh.geometry.dispose();
    (this.highlightMesh.material as THREE.Material).dispose();
    this.ghostMesh.geometry.dispose();
    (this.ghostMesh.material as THREE.Material).dispose();
  }
}
