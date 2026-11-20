import './styles.css';
import { initIdentity, saveLocalDisplayName, wsUrl, type IdentityContext } from './discord';
import { RoomScene } from './scene/RoomScene';
import { RoomSyncClient, type SyncStatus } from './sync';
import type { CameraPreset, NoteColor, NoteItem, PendingNoteDraft, PeerUser, StringColor, StringConnection, ToolMode } from './types';

const STICKY_COLORS: Array<{ id: NoteColor; label: string; hex: string }> = [
  { id: 'yellow', label: 'Kuning', hex: '#FCE68A' },
  { id: 'blue', label: 'Biru', hex: '#BAE0FA' },
  { id: 'mint', label: 'Mint', hex: '#B7EDD2' },
  { id: 'coral', label: 'Koral', hex: '#FAD0C9' },
];

function createElem<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca berkas gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak dikenali.'));
      img.onload = () => {
        const maxDim = 480;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Kanvas gambar tidak tersedia.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;

  // Build static HUD shell via DOM APIs (safe textContent, no untrusted innerHTML)
  const shell = createElem('div', 'viewport-shell');
  const canvasHost = createElem('div', 'canvas-host');
  shell.appendChild(canvasHost);

  const loadingOverlay = createElem('div', 'loading-overlay');
  loadingOverlay.appendChild(createElem('strong', '', 'Menyiapkan Ruang Kolaborasi 3D...'));
  loadingOverlay.appendChild(createElem('span', '', 'Memuat ruangan Blender dan menyambungkan ke server lokal.'));
  shell.appendChild(loadingOverlay);

  // Top HUD
  const hudTop = createElem('header', 'hud-top');
  const leftGroup = createElem('div', 'hud-group');
  const titleEl = createElem('h1', 'brand-title', 'Ruang Kolaborasi 3D');
  const statusPill = createElem('span', 'status-pill');
  const statusDot = createElem('span', 'status-dot');
  const statusText = createElem('span', '', 'Menghubungkan...');
  statusPill.append(statusDot, statusText);

  const peerPill = createElem('span', 'status-pill', '1 Aktif');
  const nameBtn = createElem('button', 'btn btn-ghost hidden', 'Ubah Nama');
  nameBtn.type = 'button';

  leftGroup.append(titleEl, statusPill, peerPill, nameBtn);

  const camGroup = createElem('div', 'hud-group');
  const camButtons: Record<CameraPreset, HTMLButtonElement> = {
    room: createElem('button', 'btn btn-primary', 'Ruangan'),
    corkboard: createElem('button', 'btn', 'Papan Kanan'),
    whiteboard: createElem('button', 'btn', 'Papan Kiri'),
  };
  (Object.keys(camButtons) as CameraPreset[]).forEach((preset) => {
    camButtons[preset].type = 'button';
    camGroup.appendChild(camButtons[preset]);
  });

  hudTop.append(leftGroup, camGroup);
  shell.appendChild(hudTop);

  // Banner (errors / warnings / instructions)
  const banner = createElem('div', 'hud-banner hidden');
  banner.setAttribute('role', 'status');
  const bannerMsg = createElem('span', '', '');
  const bannerActions = createElem('div');
  bannerActions.style.display = 'flex';
  bannerActions.style.gap = '6px';
  const retryBtn = createElem('button', 'btn btn-primary hidden', 'Coba Sambung Ulang');
  retryBtn.type = 'button';
  const dismissBannerBtn = createElem('button', 'btn', 'Tutup');
  dismissBannerBtn.type = 'button';
  bannerActions.append(retryBtn, dismissBannerBtn);
  banner.append(bannerMsg, bannerActions);
  shell.appendChild(banner);

  // Bottom HUD
  const hudBottom = createElem('div', 'hud-bottom');
  const emptyHint = createElem(
    'div',
    'empty-hint hidden',
    'Papan kanan masih kosong. Klik + Sticky Note atau + Foto untuk menempel catatan pertama.'
  );

  const selectionBar = createElem('div', 'selection-bar hidden');
  const selLabel = createElem('span', '', '');
  const editNoteBtn = createElem('button', 'btn hidden', 'Edit Catatan');
  editNoteBtn.type = 'button';
  const delSelectedBtn = createElem('button', 'btn btn-danger', 'Hapus');
  delSelectedBtn.type = 'button';
  const clearSelBtn = createElem('button', 'btn', 'Batal Pilih');
  clearSelBtn.type = 'button';
  selectionBar.append(selLabel, editNoteBtn, delSelectedBtn, clearSelBtn);

  const toolDock = createElem('nav', 'tool-dock');
  toolDock.setAttribute('aria-label', 'Alat Papan Kolaborasi');

  const selectBtn = createElem('button', 'btn btn-primary', 'Pilih & Geser');
  const addStickyBtn = createElem('button', 'btn', '+ Sticky Note');
  const addPhotoBtn = createElem('button', 'btn', '+ Foto');
  const connectBtn = createElem('button', 'btn', '+ Benang');
  const stringColorSelect = createElem('select', 'btn hidden');
  stringColorSelect.setAttribute('aria-label', 'Warna Benang');
  const optRed = createElem('option', '', 'Benang Merah');
  optRed.value = 'red';
  const optGold = createElem('option', '', 'Benang Emas');
  optGold.value = 'gold';
  stringColorSelect.append(optRed, optGold);

  [selectBtn, addStickyBtn, addPhotoBtn, connectBtn].forEach((b) => {
    b.type = 'button';
  });
  toolDock.append(selectBtn, addStickyBtn, addPhotoBtn, connectBtn, stringColorSelect);

  hudBottom.append(emptyHint, selectionBar, toolDock);
  shell.appendChild(hudBottom);

  // Modal Dialog for Sticky Note / Photo / Local Name
  const modalBackdrop = createElem('div', 'modal-backdrop hidden');
  const modalCard = createElem('div', 'modal-card');
  modalCard.setAttribute('role', 'dialog');
  modalCard.setAttribute('aria-modal', 'true');
  modalCard.setAttribute('aria-labelledby', 'modal-title');
  modalBackdrop.appendChild(modalCard);
  shell.appendChild(modalBackdrop);

  root.appendChild(shell);

  // State
  let identity: IdentityContext;
  let notes = new Map<string, NoteItem>();
  let strings = new Map<string, StringConnection>();
  let peers: PeerUser[] = [];
  let activityParticipants = [] as IdentityContext['activityParticipants'];
  let toolMode: ToolMode = 'select';
  let pendingDraft: PendingNoteDraft | null = null;
  let selectedNoteId: string | null = null;
  let selectedStringId: string | null = null;
  let modelLoaded = false;

  const showBanner = (text: string, isError = false, showRetry = false) => {
    bannerMsg.textContent = text;
    banner.classList.toggle('is-error', isError);
    retryBtn.classList.toggle('hidden', !showRetry);
    banner.classList.remove('hidden');
  };

  const hideBanner = () => {
    banner.classList.add('hidden');
  };
  dismissBannerBtn.addEventListener('click', hideBanner);

  const updateRosterAndEmptyState = () => {
    emptyHint.classList.toggle('hidden', notes.size > 0);
    const activeCount = Math.max(1, peers.length, activityParticipants.length);
    peerPill.textContent = `${activeCount} Aktif`;
    const board = scene.getMemberBoard();
    if (board && identity) {
      board.render(peers, activityParticipants, identity.guildMembers, identity.user.id, false);
    }
  };

  const updateSelectionBar = () => {
    if (selectedNoteId && notes.has(selectedNoteId)) {
      const n = notes.get(selectedNoteId)!;
      selLabel.textContent = n.kind === 'photo' ? `Foto: ${n.title || 'Tanpa judul'}` : `Sticky: ${n.title || 'Catatan'}`;
      editNoteBtn.classList.remove('hidden');
      delSelectedBtn.textContent = 'Hapus Catatan';
      selectionBar.classList.remove('hidden');
    } else if (selectedStringId && strings.has(selectedStringId)) {
      selLabel.textContent = 'Benang penghubung dipilih';
      editNoteBtn.classList.add('hidden');
      delSelectedBtn.textContent = 'Hapus Benang';
      selectionBar.classList.remove('hidden');
    } else {
      selectionBar.classList.add('hidden');
    }
  };

  const setTool = (next: ToolMode) => {
    toolMode = next;
    selectBtn.classList.toggle('btn-primary', next === 'select');
    addStickyBtn.classList.toggle('btn-primary', next === 'place-sticky');
    addPhotoBtn.classList.toggle('btn-primary', next === 'place-photo');
    connectBtn.classList.toggle('btn-primary', next === 'connect');
    stringColorSelect.classList.toggle('hidden', next !== 'connect');
    scene.setToolMode(next, next === 'place-photo' ? 'photo' : 'sticky');

    if (next === 'place-sticky' || next === 'place-photo') {
      showBanner('Klik pada papan gabus di kanan untuk menempelkan catatan Anda. Tekan Esc untuk batal.');
    } else if (next === 'connect') {
      showBanner('Klik catatan pertama lalu catatan kedua untuk menarik benang penghubung. Tekan Esc untuk batal.');
    } else if (bannerMsg.textContent?.includes('Tekan Esc')) {
      hideBanner();
    }
  };

  // Initialize 3D Scene
  let syncClient: RoomSyncClient | null = null;

  const scene = new RoomScene(canvasHost, {
    onLoaded: () => {
      modelLoaded = true;
      loadingOverlay.classList.add('hidden');
      scene.setNotesAndStrings(Array.from(notes.values()), Array.from(strings.values()));
      updateRosterAndEmptyState();
    },
    onLoadError: (msg) => {
      loadingOverlay.classList.add('hidden');
      showBanner(msg, true, false);
    },
    onCursorMove: (cursor) => {
      syncClient?.sendCursor(cursor);
    },
    onSelectNote: (noteId) => {
      selectedNoteId = noteId;
      selectedStringId = null;
      updateSelectionBar();
    },
    onSelectString: (stringId) => {
      selectedStringId = stringId;
      selectedNoteId = null;
      updateSelectionBar();
    },
    onPlaceAt: (u, v) => {
      if (!pendingDraft) return;
      const note: NoteItem = {
        id: pendingDraft.editId || `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: pendingDraft.kind,
        u,
        v,
        color: pendingDraft.color,
        title: pendingDraft.title,
        body: pendingDraft.body,
        author: identity.user.name,
        imageData: pendingDraft.imageData,
      };
      pendingDraft = null;
      setTool('select');
      syncClient?.upsertNote(note);
    },
    onNoteMoved: (note) => {
      syncClient?.upsertNote({ ...note, author: identity.user.name });
    },
    onConnectPair: (fromId, toId) => {
      const color = (stringColorSelect.value === 'gold' ? 'gold' : 'red') as StringColor;
      const conn: StringConnection = {
        id: `str-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fromId,
        toId,
        color,
      };
      syncClient?.addString(conn);
    },
  });

  // Camera switcher
  (Object.keys(camButtons) as CameraPreset[]).forEach((preset) => {
    camButtons[preset].addEventListener('click', () => {
      (Object.keys(camButtons) as CameraPreset[]).forEach((k) => {
        camButtons[k].classList.toggle('btn-primary', k === preset);
      });
      scene.setCameraPreset(preset);
    });
  });

  // Auto-pick open spot on corkboard (for keyboard-friendly instant placement)
  const findOpenSlot = (): { u: number; v: number } => {
    const count = notes.size;
    const cols = 4;
    const col = count % cols;
    const row = Math.floor(count / cols) % 3;
    return {
      u: 0.16 + col * 0.22,
      v: 0.78 - row * 0.27,
    };
  };

  const closeModal = () => {
    modalBackdrop.classList.add('hidden');
    modalCard.replaceChildren();
  };

  const openNoteModal = (kind: 'sticky' | 'photo', existing?: NoteItem) => {
    modalCard.replaceChildren();
    let chosenColor: NoteColor = existing?.color || (kind === 'photo' ? 'paper' : 'yellow');
    let uploadedDataUrl = existing?.imageData || '';

    const header = createElem('div', 'modal-header');
    const h2 = createElem('h2', 'modal-title', existing ? 'Edit Catatan' : kind === 'photo' ? 'Tambah Foto ke Papan' : 'Tambah Sticky Note');
    h2.id = 'modal-title';
    const closeX = createElem('button', 'btn', 'Tutup');
    closeX.type = 'button';
    closeX.addEventListener('click', closeModal);
    header.append(h2, closeX);

    const titleGroup = createElem('div', 'field-group');
    const titleLabel = createElem('label', 'field-label', kind === 'photo' ? 'Keterangan Foto' : 'Judul Singkat');
    titleLabel.htmlFor = 'note-title-input';
    const titleInput = createElem('input', 'text-input');
    titleInput.id = 'note-title-input';
    titleInput.type = 'text';
    titleInput.maxLength = 80;
    titleInput.placeholder = kind === 'photo' ? 'Misal: Bagan Struktur Pengurus' : 'Misal: Perbaiki halaman daftar';
    titleInput.value = existing?.title || '';
    titleGroup.append(titleLabel, titleInput);

    modalCard.append(header, titleGroup);

    const bodyInput = createElem('textarea', 'text-area');
    bodyInput.id = 'note-body-input';
    bodyInput.maxLength = 500;
    bodyInput.placeholder = 'Tulis catatan singkat atau pembagian tugas...';
    bodyInput.value = existing?.body || '';

    const photoUrlInput = createElem('input', 'text-input');
    photoUrlInput.id = 'photo-url-input';
    photoUrlInput.type = 'url';
    photoUrlInput.placeholder = 'https://... (opsional jika memilih file di atas)';
    if (existing?.imageData?.startsWith('https://')) {
      photoUrlInput.value = existing.imageData;
    }

    const previewImg = createElem('img', 'photo-preview hidden');
    previewImg.alt = 'Pratinjau foto yang dipilih';
    if (uploadedDataUrl) {
      previewImg.src = uploadedDataUrl;
      previewImg.classList.remove('hidden');
    }

    const formErr = createElem('div', 'field-help');
    formErr.style.color = '#B33229';

    if (kind === 'sticky') {
      const bodyGroup = createElem('div', 'field-group');
      const bodyLabel = createElem('label', 'field-label', 'Isi Catatan');
      bodyLabel.htmlFor = 'note-body-input';
      bodyGroup.append(bodyLabel, bodyInput);

      const colorGroup = createElem('div', 'field-group');
      colorGroup.appendChild(createElem('span', 'field-label', 'Warna Kertas'));
      const swatches = createElem('div', 'swatch-row');
      STICKY_COLORS.forEach((c) => {
        const sw = createElem('button', `swatch-btn${c.id === chosenColor ? ' is-active' : ''}`, c.label);
        sw.type = 'button';
        sw.style.background = c.hex;
        sw.addEventListener('click', () => {
          chosenColor = c.id;
          swatches.querySelectorAll('.swatch-btn').forEach((el) => el.classList.remove('is-active'));
          sw.classList.add('is-active');
        });
        swatches.appendChild(sw);
      });
      colorGroup.appendChild(swatches);
      modalCard.append(bodyGroup, colorGroup);
    } else {
      const fileGroup = createElem('div', 'field-group');
      const fileLabel = createElem('label', 'field-label', 'Pilih File Foto (PNG/JPG/WebP)');
      fileLabel.htmlFor = 'photo-file-input';
      const fileInput = createElem('input', 'text-input');
      fileInput.id = 'photo-file-input';
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/jpeg,image/webp';
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          uploadedDataUrl = await compressImageToDataUrl(file);
          previewImg.src = uploadedDataUrl;
          previewImg.classList.remove('hidden');
          formErr.textContent = '';
        } catch (err) {
          formErr.textContent = err instanceof Error ? err.message : 'Gagal memproses gambar.';
        }
      });
      fileGroup.append(fileLabel, fileInput, previewImg);

      const urlGroup = createElem('div', 'field-group');
      const urlLabel = createElem('label', 'field-label', 'Atau Tautan Gambar HTTPS');
      urlLabel.htmlFor = 'photo-url-input';
      urlGroup.append(urlLabel, photoUrlInput);
      modalCard.append(fileGroup, urlGroup);
    }

    modalCard.appendChild(formErr);

    const actions = createElem('div', 'modal-actions');
    const buildDraft = (): PendingNoteDraft | null => {
      const title = titleInput.value.trim();
      const body = bodyInput.value.trim();
      if (kind === 'sticky' && !title && !body) {
        formErr.textContent = 'Isi minimal judul atau catatan sticky note.';
        return null;
      }
      let imgSrc = uploadedDataUrl;
      if (kind === 'photo' && !imgSrc) {
        const urlCandidate = photoUrlInput.value.trim();
        if (!urlCandidate.startsWith('https://')) {
          formErr.textContent = 'Pilih file foto atau masukkan tautan gambar HTTPS yang valid.';
          return null;
        }
        imgSrc = urlCandidate;
      }
      return {
        kind,
        color: chosenColor,
        title: title || (kind === 'photo' ? 'Foto Papan' : 'Catatan'),
        body,
        imageData: kind === 'photo' ? imgSrc : undefined,
        editId: existing?.id,
      };
    };

    if (existing) {
      const saveBtn = createElem('button', 'btn btn-primary', 'Simpan Perubahan');
      saveBtn.type = 'button';
      saveBtn.addEventListener('click', () => {
        const draft = buildDraft();
        if (!draft) return;
        syncClient?.upsertNote({
          ...existing,
          color: draft.color,
          title: draft.title,
          body: draft.body,
          imageData: draft.imageData,
          author: identity.user.name,
        });
        closeModal();
      });
      actions.appendChild(saveBtn);
    } else {
      const instantBtn = createElem('button', 'btn', 'Tempel Langsung');
      instantBtn.type = 'button';
      instantBtn.addEventListener('click', () => {
        const draft = buildDraft();
        if (!draft) return;
        const slot = findOpenSlot();
        syncClient?.upsertNote({
          id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: draft.kind,
          u: slot.u,
          v: slot.v,
          color: draft.color,
          title: draft.title,
          body: draft.body,
          author: identity.user.name,
          imageData: draft.imageData,
        });
        closeModal();
        camButtons.corkboard.click();
      });

      const pickSpotBtn = createElem('button', 'btn btn-primary', 'Pilih Posisi di Papan');
      pickSpotBtn.type = 'button';
      pickSpotBtn.addEventListener('click', () => {
        const draft = buildDraft();
        if (!draft) return;
        pendingDraft = draft;
        closeModal();
        camButtons.corkboard.click();
        setTool(kind === 'photo' ? 'place-photo' : 'place-sticky');
      });

      actions.append(instantBtn, pickSpotBtn);
    }

    modalCard.appendChild(actions);
    modalBackdrop.classList.remove('hidden');
    titleInput.focus();
  };

  const openNameModal = () => {
    modalCard.replaceChildren();
    const header = createElem('div', 'modal-header');
    const h2 = createElem('h2', 'modal-title', 'Nama Tampilan Anda');
    h2.id = 'modal-title';
    const closeX = createElem('button', 'btn', 'Tutup');
    closeX.type = 'button';
    closeX.addEventListener('click', closeModal);
    header.append(h2, closeX);

    const group = createElem('div', 'field-group');
    const label = createElem('label', 'field-label', 'Nama ini tampil di kursor 3D dan papan anggota kiri');
    label.htmlFor = 'local-name-input';
    const input = createElem('input', 'text-input');
    input.id = 'local-name-input';
    input.type = 'text';
    input.maxLength = 40;
    input.value = identity.user.name;
    group.append(label, input);

    const actions = createElem('div', 'modal-actions');
    const saveBtn = createElem('button', 'btn btn-primary', 'Simpan Nama');
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', () => {
      identity.user = saveLocalDisplayName(input.value);
      syncClient?.updateUser(identity.user);
      updateRosterAndEmptyState();
      closeModal();
    });
    actions.appendChild(saveBtn);

    modalCard.append(header, group, actions);
    modalBackdrop.classList.remove('hidden');
    input.focus();
  };

  // Tool & selection bindings
  selectBtn.addEventListener('click', () => {
    pendingDraft = null;
    setTool('select');
  });
  addStickyBtn.addEventListener('click', () => openNoteModal('sticky'));
  addPhotoBtn.addEventListener('click', () => openNoteModal('photo'));
  connectBtn.addEventListener('click', () => {
    if (notes.size < 2) {
      showBanner('Tambahkan minimal 2 catatan di papan sebelum menghubungkan dengan benang.');
      return;
    }
    camButtons.corkboard.click();
    setTool(toolMode === 'connect' ? 'select' : 'connect');
  });

  editNoteBtn.addEventListener('click', () => {
    if (!selectedNoteId) return;
    const note = notes.get(selectedNoteId);
    if (note) openNoteModal(note.kind, note);
  });

  delSelectedBtn.addEventListener('click', () => {
    if (selectedNoteId) {
      syncClient?.deleteNote(selectedNoteId);
      selectedNoteId = null;
      scene.setSelectedNote(null);
      updateSelectionBar();
    } else if (selectedStringId) {
      syncClient?.deleteString(selectedStringId);
      selectedStringId = null;
      scene.setSelectedString(null);
      updateSelectionBar();
    }
  });

  clearSelBtn.addEventListener('click', () => {
    selectedNoteId = null;
    selectedStringId = null;
    scene.setSelectedNote(null);
    scene.setSelectedString(null);
    updateSelectionBar();
  });

  nameBtn.addEventListener('click', openNameModal);
  retryBtn.addEventListener('click', () => syncClient?.retryNow());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modalBackdrop.classList.contains('hidden')) {
        closeModal();
      } else if (toolMode !== 'select') {
        pendingDraft = null;
        setTool('select');
      }
    }
  });

  // Initialize Discord or Local Identity & Connect WebSocket Sync
  identity = await initIdentity();
  titleEl.textContent = identity.mode === 'discord' ? identity.roomLabel : 'Ruang Kolaborasi 3D';
  activityParticipants = identity.activityParticipants;
  if (identity.mode === 'local') {
    nameBtn.classList.remove('hidden');
  }
  if (identity.warning) {
    showBanner(identity.warning, false, false);
  }

  if (identity.onActivityParticipants) {
    identity.onActivityParticipants((list) => {
      activityParticipants = list;
      updateRosterAndEmptyState();
    });
  }

  const applyStatus = (status: SyncStatus, detail?: string) => {
    statusDot.className = `status-dot ${status === 'connected' ? 'connected' : status === 'reconnecting' ? 'reconnecting' : status === 'offline' ? 'offline' : ''}`;
    statusText.textContent =
      status === 'connected'
        ? identity.mode === 'discord'
          ? 'Terhubung ke Discord'
          : 'Pratinjau Lokal Aktif'
        : status === 'reconnecting'
          ? 'Menyambung Ulang...'
          : status === 'offline'
            ? 'Terputus'
            : 'Menghubungkan...';
    if (status === 'reconnecting' && detail) {
      showBanner(detail, true, true);
    } else if (status === 'connected' && bannerMsg.textContent?.includes('terputus')) {
      hideBanner();
    }
  };

  syncClient = new RoomSyncClient(wsUrl(identity.roomId), identity.user, {
    onStatus: applyStatus,
    onInit: (payload) => {
      notes = new Map(payload.notes.map((n) => [n.id, n]));
      strings = new Map(payload.strings.map((s) => [s.id, s]));
      peers = payload.peers;
      if (modelLoaded) {
        scene.setNotesAndStrings(payload.notes, payload.strings);
      }
      updateRosterAndEmptyState();
    },
    onPeers: (nextPeers) => {
      peers = nextPeers;
      const activeIds = new Set(nextPeers.map((p) => p.connId).filter((x): x is string => Boolean(x)));
      scene.pruneRemoteCursors(activeIds);
      updateRosterAndEmptyState();
    },
    onCursor: (connId, peer, cursor) => {
      scene.updateRemoteCursor(connId, peer, cursor);
    },
    onNoteUpsert: (note) => {
      notes.set(note.id, note);
      if (modelLoaded) scene.upsertNote(note);
      updateRosterAndEmptyState();
      updateSelectionBar();
    },
    onNoteDelete: (noteId, removedStringIds) => {
      notes.delete(noteId);
      for (const sid of removedStringIds) strings.delete(sid);
      if (selectedNoteId === noteId) selectedNoteId = null;
      if (modelLoaded) scene.deleteNote(noteId, removedStringIds);
      updateRosterAndEmptyState();
      updateSelectionBar();
    },
    onStringAdd: (conn) => {
      strings.set(conn.id, conn);
      if (modelLoaded) scene.addString(conn);
      updateSelectionBar();
    },
    onStringDelete: (stringId) => {
      strings.delete(stringId);
      if (selectedStringId === stringId) selectedStringId = null;
      if (modelLoaded) scene.deleteString(stringId);
      updateSelectionBar();
    },
    onError: (msg) => {
      showBanner(msg, true, false);
    },
  });

  syncClient.connect();
}

bootstrap();
