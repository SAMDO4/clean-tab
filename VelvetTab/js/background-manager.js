// 배경화면: IndexedDB 저장(이미지 Blob + 메타데이터) 및 화면 표시
// - 원본 파일 경로가 아닌 바이트 사본을 저장
// - 단일 키에 put → 교체 시 중복 데이터 없음, 이미지와 메타를 한 트랜잭션으로 갱신(원자적)

const DB_NAME = 'VelvetTab';
const DB_VERSION = 1;
const IMG = 'images';
const META = 'meta';
const KEY = 'background';

export const ACCEPTED_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_BYTES = 40 * 1024 * 1024;
export const MAX_PIXELS = 100_000_000; // 1억 화소 초과 이미지는 메모리 보호를 위해 거부

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // 버전별 마이그레이션: 새 버전 추가 시 case 를 이어서 작성
      switch (e.oldVersion) {
        case 0:
          db.createObjectStore(IMG);
          db.createObjectStore(META);
        // falls through
        default:
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error('IndexedDB blocked')); };
  });
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const results = {};
    fn(t, results);
    t.oncomplete = () => resolve(results);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}

/** 매직 바이트로 실제 형식 판별 */
export async function sniffType(blob) {
  const h = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
  if (h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 && h[4] === 0x0d && h[5] === 0x0a && h[6] === 0x1a && h[7] === 0x0a) return 'image/png';
  if (h.length >= 12 && h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50) return 'image/webp';
  return '';
}

/**
 * 크기·형식·디코딩 가능 여부 검증
 * @returns {Promise<{ok:true,type:string,width:number,height:number}|{ok:false,reason:string}>}
 */
export async function validateImage(file, maxBytes = MAX_BYTES) {
  if (!file) return { ok: false, reason: '파일이 선택되지 않았습니다.' };
  if (file.size === 0) return { ok: false, reason: '비어 있는 파일입니다.' };
  if (file.size > maxBytes) return { ok: false, reason: `파일이 너무 큽니다 (최대 ${Math.round(maxBytes / 1024 / 1024)}MB).` };
  const type = await sniffType(file);
  if (!ACCEPTED_TYPES.includes(type)) return { ok: false, reason: 'JPG, PNG, WebP 이미지만 사용할 수 있습니다.' };
  try {
    const bmp = await createImageBitmap(file);
    const { width, height } = bmp;
    bmp.close();
    if (!width || !height) throw new Error('empty');
    if (width * height > MAX_PIXELS) return { ok: false, reason: '이미지 해상도가 너무 큽니다.' };
    return { ok: true, type, width, height };
  } catch {
    return { ok: false, reason: '이미지를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.' };
  }
}

export async function saveBackground(file, info) {
  const blob = new Blob([await file.arrayBuffer()], { type: info.type });
  const meta = {
    name: String(file.name || '').slice(0, 200),
    type: info.type, size: blob.size, width: info.width, height: info.height, updatedAt: Date.now()
  };
  await run([IMG, META], 'readwrite', (t) => {
    t.objectStore(IMG).put(blob, KEY);
    t.objectStore(META).put(meta, KEY);
  });
  return meta;
}

/** @returns {Promise<null|{blob:Blob, meta:object}>} */
export async function loadBackground() {
  const r = await run([IMG, META], 'readonly', (t, res) => {
    const a = t.objectStore(IMG).get(KEY);
    a.onsuccess = () => { res.blob = a.result; };
    const b = t.objectStore(META).get(KEY);
    b.onsuccess = () => { res.meta = b.result; };
  });
  if (!(r.blob instanceof Blob) || r.blob.size === 0) return null;
  return { blob: r.blob, meta: r.meta && typeof r.meta === 'object' ? r.meta : { name: '', type: r.blob.type, size: r.blob.size } };
}

export async function clearBackground() {
  await run([IMG, META], 'readwrite', (t) => {
    t.objectStore(IMG).delete(KEY);
    t.objectStore(META).delete(KEY);
  });
}

/* ------------------------------------------------------------------ 화면 표시 */
export function createBackgroundView(layer, dimLayer) {
  let url = null;
  let seq = 0;

  const revoke = () => { if (url) { URL.revokeObjectURL(url); url = null; } };

  return {
    /** 디코딩 완료 후 교체 → 깜빡임 방지. 실패 시 false */
    async show(blob) {
      const my = ++seq;
      const next = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = next;
        await img.decode();
      } catch {
        URL.revokeObjectURL(next);
        return false;
      }
      if (my !== seq) { URL.revokeObjectURL(next); return true; }
      layer.style.backgroundImage = `url("${next}")`;
      revoke();
      url = next;
      layer.classList.add('has-image');
      return true;
    },
    clear() {
      ++seq;
      layer.style.backgroundImage = '';
      layer.classList.remove('has-image');
      revoke();
    },
    applyFit(bg) {
      const size = { cover: 'cover', contain: 'contain', original: 'auto', custom: 'cover' }[bg.fit] || 'cover';
      layer.style.backgroundSize = size;
      layer.style.backgroundPosition = bg.fit === 'custom' ? `${bg.posX}% ${bg.posY}%` : 'center center';
      dimLayer.style.opacity = String(bg.dim / 100);
    },
    destroy() { revoke(); }
  };
}
