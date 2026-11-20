import * as THREE from 'three';

function createCanvas(size = 256): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function makeWoodTexture(baseRgb: [number, number, number], grainRgb: [number, number, number], repeatX: number, repeatY: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(256);
  ctx.fillStyle = `rgb(${baseRgb.join(',')})`;
  ctx.fillRect(0, 0, 256, 256);

  for (let y = 0; y < 256; y += 2) {
    const wave = Math.sin(y * 0.17) * 0.5 + Math.sin(y * 0.43) * 0.3;
    const alpha = Math.max(0.04, Math.min(0.28, 0.14 + wave * 0.11));
    ctx.fillStyle = `rgba(${grainRgb.join(',')}, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, y, 256, 2);
  }
  for (let i = 0; i < 45; i += 1) {
    const x = (i * 53) % 256;
    const y = (i * 97) % 256;
    const w = 40 + (i % 5) * 26;
    ctx.fillStyle = `rgba(${grainRgb.join(',')}, 0.10)`;
    ctx.fillRect(x, y, w, 1.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePlasterTexture(baseRgb: [number, number, number]): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(256);
  ctx.fillStyle = `rgb(${baseRgb.join(',')})`;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i += 1) {
    const x = (i * 73 + (i % 7) * 19) % 256;
    const y = (i * 131 + (i % 5) * 11) % 256;
    const shade = i % 2 === 0 ? '255,255,255' : '60,55,48';
    ctx.fillStyle = `rgba(${shade}, 0.045)`;
    ctx.fillRect(x, y, 3, 3);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCorkTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(256);
  ctx.fillStyle = 'rgb(168, 120, 74)';
  ctx.fillRect(0, 0, 256, 256);
  const specks = [
    '122, 78, 42',
    '194, 146, 98',
    '142, 95, 55',
    '208, 166, 118',
  ];
  for (let i = 0; i < 2400; i += 1) {
    const x = (i * 47 + (i % 13) * 7) % 256;
    const y = (i * 89 + (i % 11) * 5) % 256;
    const size = 2 + (i % 3);
    ctx.fillStyle = `rgba(${specks[i % specks.length]}, 0.42)`;
    ctx.fillRect(x, y, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFabricTexture(baseRgb: [number, number, number], accentRgb: [number, number, number], repeat: number): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(128);
  ctx.fillStyle = `rgb(${baseRgb.join(',')})`;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = `rgba(${accentRgb.join(',')}, 0.16)`;
  for (let i = 0; i < 128; i += 4) {
    ctx.fillRect(i, 0, 1, 128);
    ctx.fillRect(0, i, 128, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function applyRoomProceduralTextures(root: THREE.Object3D): void {
  const cache = new Map<string, THREE.CanvasTexture>();

  const getTex = (key: string, factory: () => THREE.CanvasTexture) => {
    if (!cache.has(key)) {
      cache.set(key, factory());
    }
    return cache.get(key)!;
  };

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      const name = mat.name;
      if (name === 'WoodFloor') {
        mat.map = getTex('WoodFloor', () => makeWoodTexture([142, 98, 56], [84, 50, 24], 2, 2));
        mat.roughness = 0.62;
      } else if (name === 'WoodFloorDark') {
        mat.map = getTex('WoodFloorDark', () => makeWoodTexture([118, 78, 44], [66, 38, 18], 2, 2));
        mat.roughness = 0.65;
      } else if (name === 'WoodBirch') {
        mat.map = getTex('WoodBirch', () => makeWoodTexture([194, 152, 102], [142, 104, 62], 2, 2));
        mat.roughness = 0.55;
      } else if (name === 'WoodWalnut') {
        mat.map = getTex('WoodWalnut', () => makeWoodTexture([74, 44, 24], [42, 22, 10], 2, 2));
        mat.roughness = 0.52;
      } else if (name === 'WallBack') {
        mat.map = getTex('WallBack', () => makePlasterTexture([228, 220, 204]));
        mat.roughness = 0.9;
      } else if (name === 'WallSide') {
        mat.map = getTex('WallSide', () => makePlasterTexture([188, 202, 190]));
        mat.roughness = 0.9;
      } else if (name === 'WallCut') {
        mat.map = getTex('WallCut', () => makePlasterTexture([168, 178, 174]));
        mat.roughness = 0.88;
      } else if (name === 'CorkBoard') {
        mat.map = getTex('CorkBoard', () => makeCorkTexture());
        mat.roughness = 0.92;
      } else if (name === 'MeetingRug') {
        mat.map = getTex('MeetingRug', () => makeFabricTexture([72, 88, 104], [42, 54, 66], 8));
        mat.roughness = 0.95;
      } else if (name === 'ChairTeal') {
        mat.map = getTex('ChairTeal', () => makeFabricTexture([46, 126, 140], [26, 84, 96], 6));
        mat.roughness = 0.78;
      } else if (name === 'ChairOchre') {
        mat.map = getTex('ChairOchre', () => makeFabricTexture([212, 146, 54], [164, 104, 28], 6));
        mat.roughness = 0.78;
      }
      mat.needsUpdate = true;
    }
  });
}
