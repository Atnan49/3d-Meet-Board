import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CameraPreset, CursorState, NoteItem, PeerUser, StringConnection, ToolMode } from '../types';
import { CorkboardManager } from './CorkboardManager';
import { MemberBoard } from './MemberBoard';
import { applyRoomProceduralTextures } from './textures';

interface RemoteCursor {
  group: THREE.Group;
  labelSprite: THREE.Sprite;
  cone: THREE.Mesh;
  targetPos: THREE.Vector3;
  visible: boolean;
  lastName: string;
  lastColor: string;
}

export interface RoomSceneCallbacks {
  onLoaded: () => void;
  onLoadError: (msg: string) => void;
  onCursorMove: (cursor: CursorState) => void;
  onSelectNote: (noteId: string | null) => void;
  onSelectString: (stringId: string | null) => void;
  onPlaceAt: (u: number, v: number) => void;
  onNoteMoved: (note: NoteItem) => void;
  onConnectPair: (fromId: string, toId: string) => void;
}

const CAMERA_PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  room: { pos: [5.0, 5.4, 5.6], target: [-0.2, 1.15, -0.45] },
  corkboard: { pos: [0.05, 1.65, 0.55], target: [0.05, 1.62, -2.42] },
  whiteboard: { pos: [-0.35, 1.65, -1.08], target: [-2.81, 1.62, -1.08] },
};

export class RoomScene {
  private readonly container: HTMLElement;
  private readonly callbacks: RoomSceneCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();

  private corkboardObj: THREE.Object3D | null = null;
  private cursorSurfaceTargets: THREE.Object3D[] = [];
  private memberBoard: MemberBoard | null = null;
  private corkboardMgr: CorkboardManager | null = null;

  private remoteCursors = new Map<string, RemoteCursor>();
  private toolMode: ToolMode = 'select';
  private pendingKind: 'sticky' | 'photo' = 'sticky';
  private selectedNoteId: string | null = null;
  private connectStartId: string | null = null;
  private selectedStringId: string | null = null;

  private draggingNoteId: string | null = null;
  private pointerDownPos: { x: number; y: number } | null = null;
  private movedDuringDrag = false;
  private lastCursorEmit = 0;

  private animCamFrom: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private animCamTo: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private animCamProgress = 1;
  private rafId = 0;
  private disposed = false;

  constructor(container: HTMLElement, callbacks: RoomSceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.scene.background = new THREE.Color(0x1c2128);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(container.clientWidth || 1024, container.clientHeight || 768);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      46,
      (container.clientWidth || 1024) / Math.max(1, container.clientHeight || 768),
      0.1,
      60
    );
    const initPreset = CAMERA_PRESETS.room;
    this.camera.position.set(...initPreset.pos);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...initPreset.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.4;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.update();

    this.setupLights();
    this.bindEvents();
    this.loadRoomModel();
    this.startLoop();
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xf6f3ea, 0x3b4048, 1.35);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff6e8, 1.55);
    key.position.set(4.5, 6.5, 4.2);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xd9ebff, 0.75);
    fill.position.set(-4.5, 4.0, 2.0);
    this.scene.add(fill);
  }

  private loadRoomModel(): void {
    const loader = new GLTFLoader();
    loader.load(
      './models/room.glb',
      (gltf) => {
        if (this.disposed) return;
        const root = gltf.scene;
        applyRoomProceduralTextures(root);

        // Hide Blender dummy pawns so live cursors/participants represent real users
        root.traverse((obj) => {
          if (obj.name.startsWith('Avatar_Senior') || obj.name.startsWith('Avatar_Maba')) {
            obj.visible = false;
          }
        });

        this.scene.add(root);
        root.updateMatrixWorld(true);

        const wb = root.getObjectByName('Whiteboard_Surface');
        if (wb) {
          this.memberBoard = new MemberBoard(wb);
          this.scene.add(this.memberBoard.mesh);
        }

        const cb = root.getObjectByName('Corkboard_Surface');
        if (cb) {
          this.corkboardObj = cb;
          this.corkboardMgr = new CorkboardManager(cb);
          this.scene.add(this.corkboardMgr.group);
        }

        const table = root.getObjectByName('Table_Top');
        const rug = root.getObjectByName('Meeting_Rug');
        const floor = root.getObjectByName('FloorBase');
        this.cursorSurfaceTargets = [cb, wb, table, rug, floor].filter(
          (x): x is THREE.Object3D => Boolean(x)
        );

        this.callbacks.onLoaded();
      },
      undefined,
      () => {
        if (this.disposed) return;
        this.callbacks.onLoadError('Gagal memuat model ruangan 3D (./models/room.glb).');
      }
    );
  }

  getMemberBoard(): MemberBoard | null {
    return this.memberBoard;
  }

  getCorkboard(): CorkboardManager | null {
    return this.corkboardMgr;
  }

  setCameraPreset(preset: CameraPreset): void {
    const p = CAMERA_PRESETS[preset];
    this.animCamFrom = {
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
    };
    this.animCamTo = {
      pos: new THREE.Vector3(...p.pos),
      target: new THREE.Vector3(...p.target),
    };
    this.animCamProgress = 0;
  }

  setToolMode(mode: ToolMode, pendingKind: 'sticky' | 'photo' = 'sticky'): void {
    this.toolMode = mode;
    this.pendingKind = pendingKind;
    if (mode !== 'connect') {
      this.connectStartId = null;
    }
    if (mode !== 'place-sticky' && mode !== 'place-photo') {
      this.corkboardMgr?.setGhostVisible(false);
    }
    this.syncSelectionVisuals();
  }

  setSelectedNote(noteId: string | null): void {
    this.selectedNoteId = noteId;
    if (noteId) this.selectedStringId = null;
    this.syncSelectionVisuals();
  }

  setSelectedString(stringId: string | null): void {
    this.selectedStringId = stringId;
    if (stringId) this.selectedNoteId = null;
    this.syncSelectionVisuals();
  }

  setNotesAndStrings(notes: NoteItem[], strings: StringConnection[]): void {
    this.corkboardMgr?.setAll(notes, strings);
  }

  upsertNote(note: NoteItem): void {
    this.corkboardMgr?.upsertNote(note);
  }

  deleteNote(noteId: string, removedStringIds: string[]): void {
    if (this.selectedNoteId === noteId) this.selectedNoteId = null;
    if (this.connectStartId === noteId) this.connectStartId = null;
    this.corkboardMgr?.deleteNote(noteId, removedStringIds);
  }

  addString(conn: StringConnection): void {
    this.corkboardMgr?.addString(conn);
  }

  deleteString(stringId: string): void {
    if (this.selectedStringId === stringId) this.selectedStringId = null;
    this.corkboardMgr?.deleteString(stringId);
  }

  updateRemoteCursor(connId: string, peer: PeerUser, cursor: CursorState): void {
    let rc = this.remoteCursors.get(connId);
    if (!rc || rc.lastName !== peer.name || rc.lastColor !== peer.color) {
      if (rc) {
        this.disposeRemoteCursor(connId);
      }
      rc = this.createRemoteCursor(peer);
      this.remoteCursors.set(connId, rc);
    }
    rc.targetPos.set(cursor.x, cursor.y, cursor.z);
    rc.visible = cursor.visible;
    rc.group.visible = cursor.visible;
  }

  pruneRemoteCursors(activeConnIds: Set<string>): void {
    for (const cid of Array.from(this.remoteCursors.keys())) {
      if (!activeConnIds.has(cid)) {
        this.disposeRemoteCursor(cid);
      }
    }
  }

  private createRemoteCursor(peer: PeerUser): RemoteCursor {
    const group = new THREE.Group();
    const colorHex = new THREE.Color(peer.color || '#16636B');

    const coneGeo = new THREE.ConeGeometry(0.055, 0.16, 12);
    coneGeo.translate(0, -0.08, 0);
    const coneMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 0.35,
      roughness: 0.35,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.rotation.set(0.35, 0, -0.45);
    group.add(cone);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = peer.color || '#16636B';
    ctx.beginPath();
    ctx.roundRect(8, 8, 240, 48, 24);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 26px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(peer.name.slice(0, 16), 128, 41);

    const spriteTex = new THREE.CanvasTexture(canvas);
    spriteTex.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({ map: spriteTex, depthTest: false });
    const labelSprite = new THREE.Sprite(spriteMat);
    labelSprite.scale.set(0.56, 0.14, 1);
    labelSprite.position.set(0, 0.16, 0);
    group.add(labelSprite);

    this.scene.add(group);
    return {
      group,
      labelSprite,
      cone,
      targetPos: new THREE.Vector3(),
      visible: true,
      lastName: peer.name,
      lastColor: peer.color,
    };
  }

  private disposeRemoteCursor(connId: string): void {
    const rc = this.remoteCursors.get(connId);
    if (!rc) return;
    rc.cone.geometry.dispose();
    (rc.cone.material as THREE.Material).dispose();
    const sm = rc.labelSprite.material as THREE.SpriteMaterial;
    sm.map?.dispose();
    sm.dispose();
    this.scene.remove(rc.group);
    this.remoteCursors.delete(connId);
  }

  private syncSelectionVisuals(): void {
    this.corkboardMgr?.setSelection(this.selectedNoteId, this.connectStartId, this.selectedStringId);
  }

  private updateRaycasterFromPointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
  }

  private bindEvents(): void {
    const dom = this.renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !this.corkboardMgr) return;
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      this.movedDuringDrag = false;
      this.updateRaycasterFromPointer(e);

      if (this.toolMode === 'select') {
        const hits = this.raycaster.intersectObjects(this.corkboardMgr.getInteractiveMeshes(), false);
        if (hits.length > 0 && typeof hits[0].object.userData.noteId === 'string') {
          this.draggingNoteId = hits[0].object.userData.noteId;
          this.controls.enabled = false;
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      this.updateRaycasterFromPointer(e);

      if (this.pointerDownPos) {
        const dx = e.clientX - this.pointerDownPos.x;
        const dy = e.clientY - this.pointerDownPos.y;
        if (dx * dx + dy * dy > 25) {
          this.movedDuringDrag = true;
        }
      }

      // Dragging an existing note across corkboard
      if (this.draggingNoteId && this.corkboardObj && this.corkboardMgr) {
        const hits = this.raycaster.intersectObject(this.corkboardObj, false);
        if (hits.length > 0) {
          const { u, v } = this.corkboardMgr.worldToUv(hits[0].point);
          this.corkboardMgr.moveNoteLocal(this.draggingNoteId, u, v);
        }
        return;
      }

      // Ghost preview when placing sticky note or photo
      if ((this.toolMode === 'place-sticky' || this.toolMode === 'place-photo') && this.corkboardObj && this.corkboardMgr) {
        const hits = this.raycaster.intersectObject(this.corkboardObj, false);
        if (hits.length > 0) {
          this.corkboardMgr.setGhostVisible(true, this.pendingKind, hits[0].point);
        } else {
          this.corkboardMgr.setGhostVisible(false);
        }
      }

      // Throttled 3D cursor broadcast
      const now = performance.now();
      if (now - this.lastCursorEmit >= 60 && this.cursorSurfaceTargets.length > 0) {
        this.lastCursorEmit = now;
        const hits = this.raycaster.intersectObjects(this.cursorSurfaceTargets, true);
        if (hits.length > 0) {
          const pt = hits[0].point;
          this.callbacks.onCursorMove({ x: pt.x, y: pt.y, z: pt.z, visible: true });
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;

      if (this.draggingNoteId && this.corkboardMgr) {
        const dragged = this.corkboardMgr.getNote(this.draggingNoteId);
        const wasMoved = this.movedDuringDrag;
        const noteId = this.draggingNoteId;
        this.draggingNoteId = null;
        this.controls.enabled = true;

        if (wasMoved && dragged) {
          this.callbacks.onNoteMoved({ ...dragged });
        } else {
          this.selectedNoteId = noteId;
          this.selectedStringId = null;
          this.syncSelectionVisuals();
          this.callbacks.onSelectNote(noteId);
        }
        this.pointerDownPos = null;
        return;
      }

      if (this.movedDuringDrag) {
        this.pointerDownPos = null;
        return;
      }
      this.pointerDownPos = null;

      this.updateRaycasterFromPointer(e);

      // Placing note or photo
      if ((this.toolMode === 'place-sticky' || this.toolMode === 'place-photo') && this.corkboardObj && this.corkboardMgr) {
        const hits = this.raycaster.intersectObject(this.corkboardObj, false);
        if (hits.length > 0) {
          const { u, v } = this.corkboardMgr.worldToUv(hits[0].point);
          this.corkboardMgr.setGhostVisible(false);
          this.callbacks.onPlaceAt(u, v);
        }
        return;
      }

      // Connecting two notes with a string
      if (this.toolMode === 'connect' && this.corkboardMgr) {
        const hits = this.raycaster.intersectObjects(this.corkboardMgr.getInteractiveMeshes(), false);
        const noteId = hits[0]?.object.userData.noteId as string | undefined;
        if (!noteId) return;
        if (!this.connectStartId) {
          this.connectStartId = noteId;
          this.selectedNoteId = null;
          this.selectedStringId = null;
          this.syncSelectionVisuals();
        } else if (this.connectStartId === noteId) {
          this.connectStartId = null;
          this.syncSelectionVisuals();
        } else {
          const fromId = this.connectStartId;
          this.connectStartId = null;
          this.syncSelectionVisuals();
          this.callbacks.onConnectPair(fromId, noteId);
        }
        return;
      }

      // Select string or clear selection
      if (this.toolMode === 'select' && this.corkboardMgr) {
        const hits = this.raycaster.intersectObjects(this.corkboardMgr.getInteractiveMeshes(), false);
        const hitObj = hits[0]?.object;
        if (hitObj && typeof hitObj.userData.stringId === 'string') {
          this.selectedStringId = hitObj.userData.stringId;
          this.selectedNoteId = null;
          this.syncSelectionVisuals();
          this.callbacks.onSelectString(this.selectedStringId);
        } else {
          this.selectedNoteId = null;
          this.selectedStringId = null;
          this.syncSelectionVisuals();
          this.callbacks.onSelectNote(null);
          this.callbacks.onSelectString(null);
        }
      }
    };

    const onPointerLeave = () => {
      this.callbacks.onCursorMove({ x: 0, y: 0, z: 0, visible: false });
    };

    const onResize = () => {
      const w = this.container.clientWidth || 1024;
      const h = Math.max(1, this.container.clientHeight || 768);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };

    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('resize', onResize);

    this.cleanupListeners = () => {
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', onResize);
    };
  }

  private cleanupListeners: () => void = () => {};

  private startLoop(): void {
    let lastTime = performance.now();
    const tick = (now: number) => {
      if (this.disposed) return;
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      if (this.animCamFrom && this.animCamTo && this.animCamProgress < 1) {
        this.animCamProgress = Math.min(1, this.animCamProgress + dt * 2.6);
        const t = 1 - Math.pow(1 - this.animCamProgress, 3);
        this.camera.position.lerpVectors(this.animCamFrom.pos, this.animCamTo.pos, t);
        this.controls.target.lerpVectors(this.animCamFrom.target, this.animCamTo.target, t);
        if (this.animCamProgress >= 1) {
          this.animCamFrom = null;
          this.animCamTo = null;
        }
      }

      const lerpAlpha = Math.min(1, dt * 14);
      for (const rc of this.remoteCursors.values()) {
        if (rc.visible) {
          rc.group.position.lerp(rc.targetPos, lerpAlpha);
        }
      }

      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  dispose(): void {
    this.disposed = true;
    window.cancelAnimationFrame(this.rafId);
    this.cleanupListeners();
    for (const cid of Array.from(this.remoteCursors.keys())) {
      this.disposeRemoteCursor(cid);
    }
    this.memberBoard?.dispose();
    this.corkboardMgr?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
