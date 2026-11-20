import * as THREE from 'three';
import type { PeerUser, ServerMember } from '../types';

export class MemberBoard {
  public readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.MeshStandardMaterial;

  constructor(whiteboardObj: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(whiteboardObj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const width = Math.max(1.2, size.z * 0.96);
    const height = Math.max(0.8, size.y * 0.94);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 600;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: 0.35,
      metalness: 0.0,
    });

    const geo = new THREE.PlaneGeometry(width, height);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'MemberRosterOverlay';
    this.mesh.position.set(box.max.x + 0.008, center.y, center.z);
    this.mesh.rotation.y = Math.PI / 2;

    this.render([], [], [], null, true);
  }

  render(
    peers: PeerUser[],
    activityParticipants: ServerMember[],
    guildMembers: ServerMember[],
    selfId: string | null,
    loading = false
  ): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.fillStyle = '#F8F9FB';
    ctx.fillRect(0, 0, W, H);

    // Subtle grid border
    ctx.strokeStyle = '#D5DCE3';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    // Header strip
    ctx.fillStyle = '#16636B';
    ctx.fillRect(8, 8, W - 16, 92);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 34px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText('ANGGOTA SERVER & RUANGAN', 38, 66);

    // Build unified online list (deduplicate by user id)
    const onlineMap = new Map<string, { id: string; name: string; color: string; isSelf: boolean }>();
    for (const p of peers) {
      onlineMap.set(p.id, {
        id: p.id,
        name: p.name,
        color: p.color || '#16636B',
        isSelf: p.id === selfId,
      });
    }
    for (const a of activityParticipants) {
      if (!onlineMap.has(a.id)) {
        onlineMap.set(a.id, {
          id: a.id,
          name: a.name,
          color: '#2D6A9F',
          isSelf: Boolean(a.isSelf || a.id === selfId),
        });
      }
    }
    const onlineList = Array.from(onlineMap.values());

    // Online count pill in header
    const badgeText = `${onlineList.length} Aktif`;
    ctx.fillStyle = '#E8F3F4';
    ctx.beginPath();
    ctx.roundRect(W - 210, 26, 174, 54, 12);
    ctx.fill();
    ctx.fillStyle = '#16636B';
    ctx.font = 'bold 26px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(badgeText, W - 123, 62);
    ctx.textAlign = 'left';

    if (loading) {
      ctx.fillStyle = '#4A5058';
      ctx.font = '28px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText('Memuat daftar anggota ruangan...', 42, 180);
      this.texture.needsUpdate = true;
      return;
    }

    const hasGuildRoster = guildMembers.length > 0;
    const colWidth = hasGuildRoster ? 460 : W - 76;

    ctx.fillStyle = '#1E2228';
    ctx.font = 'bold 24px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText('Sedang di Ruangan 3D', 38, 146);

    if (onlineList.length === 0) {
      ctx.fillStyle = '#4A5058';
      ctx.font = '24px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText('Belum ada anggota tersambung.', 38, 204);
    } else {
      const maxRows = hasGuildRoster ? 6 : 6;
      const cols = hasGuildRoster ? 1 : 2;
      const itemW = hasGuildRoster ? colWidth : 450;

      onlineList.slice(0, maxRows * cols).forEach((member, idx) => {
        const col = Math.floor(idx / maxRows);
        const row = idx % maxRows;
        const x = 38 + col * (itemW + 30);
        const y = 172 + row * 66;

        ctx.fillStyle = member.isSelf ? '#E6F4F5' : '#FFFFFF';
        ctx.strokeStyle = member.isSelf ? '#16636B' : '#DCE2E8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, itemW, 54, 10);
        ctx.fill();
        ctx.stroke();

        // Avatar circle
        ctx.fillStyle = member.color;
        ctx.beginPath();
        ctx.arc(x + 28, y + 27, 17, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 20px system-ui, -apple-system, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText((member.name[0] || 'A').toUpperCase(), x + 28, y + 34);
        ctx.textAlign = 'left';

        // Online green dot
        ctx.fillStyle = '#1F8A4C';
        ctx.beginPath();
        ctx.arc(x + 41, y + 40, 6, 0, Math.PI * 2);
        ctx.fill();

        // Member name
        ctx.fillStyle = '#1E2228';
        ctx.font = '600 22px system-ui, -apple-system, Segoe UI, sans-serif';
        const label = member.isSelf ? `${member.name} (Anda)` : member.name;
        ctx.fillText(this.truncate(ctx, label, itemW - 74), x + 58, y + 35);
      });
    }

    if (hasGuildRoster) {
      // Divider line
      ctx.strokeStyle = '#D5DCE3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(526, 124);
      ctx.lineTo(526, H - 30);
      ctx.stroke();

      ctx.fillStyle = '#1E2228';
      ctx.font = 'bold 24px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText(`Daftar Server (${guildMembers.length})`, 554, 146);

      const nonBots = guildMembers.filter((m) => !m.bot);
      nonBots.slice(0, 7).forEach((m, idx) => {
        const y = 172 + idx * 56;
        const isOnline = onlineMap.has(m.id);
        ctx.fillStyle = isOnline ? '#1F8A4C' : '#8A939E';
        ctx.beginPath();
        ctx.arc(566, y + 20, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#1E2228';
        ctx.font = '500 22px system-ui, -apple-system, Segoe UI, sans-serif';
        ctx.fillText(this.truncate(ctx, m.name, 410), 586, y + 27);
      });
    } else {
      ctx.fillStyle = '#555E68';
      ctx.font = '19px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText(
        'Tips: isi DISCORD_BOT_TOKEN di .env bila ingin menarik seluruh daftar anggota server.',
        38,
        H - 26
      );
    }

    this.texture.needsUpdate = true;
  }

  private truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}...`).width > maxWidth) {
      t = t.slice(0, -1);
    }
    return `${t}...`;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
