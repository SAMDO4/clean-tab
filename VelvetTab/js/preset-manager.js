// 프리셋: 디자인/배치 설정의 JSON 스냅샷 (배경화면·즐겨찾기 목록은 포함하지 않음)
import { presetSnapshot } from './defaults.js';
import { newId, sanitizePresets, stableStringify } from './storage-manager.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const find = (presets, id) => presets.items.find((p) => p.id === id);

/* ---------- 순수 연산 (presets/settings 객체를 직접 변경) ---------- */
export const ops = {
  apply(settings, presets, id) {
    const p = find(presets, id);
    if (!p) return false;
    const data = clone(p.data);
    settings.elements = data.elements;
    settings.globalStyle = data.globalStyle;
    presets.activeId = id;
    return true;
  },
  create(settings, presets, name) {
    const id = newId();
    const now = Date.now();
    presets.items.push({ id, name: cleanName(name), builtin: false, data: presetSnapshot(settings), createdAt: now, updatedAt: now });
    presets.activeId = id;
    return id;
  },
  overwrite(settings, presets, id) {
    const p = find(presets, id);
    if (!p || p.builtin) return false;
    p.data = presetSnapshot(settings);
    p.updatedAt = Date.now();
    presets.activeId = id;
    return true;
  },
  rename(presets, id, name) {
    const p = find(presets, id);
    if (!p || p.builtin) return false;
    p.name = cleanName(name);
    p.updatedAt = Date.now();
    return true;
  },
  duplicate(presets, id) {
    const p = find(presets, id);
    if (!p) return null;
    const nid = newId();
    const now = Date.now();
    presets.items.push({ id: nid, name: cleanName(`${p.name} 사본`), builtin: false, data: clone(p.data), createdAt: now, updatedAt: now });
    return nid;
  },
  remove(presets, id) {
    const i = presets.items.findIndex((p) => p.id === id);
    if (i < 0 || presets.items[i].builtin) return false;
    presets.items.splice(i, 1);
    if (presets.defaultId === id) presets.defaultId = 'builtin-glass';
    if (presets.activeId === id) presets.activeId = null;
    return true;
  },
  setDefault(presets, id) {
    if (!find(presets, id)) return false;
    presets.defaultId = id;
    return true;
  },
  isModified(settings, presets) {
    const p = presets.activeId && find(presets, presets.activeId);
    if (!p) return true;
    return stableStringify(presetSnapshot(settings)) !== stableStringify(p.data);
  }
};

function cleanName(name) {
  const s = String(name || '').trim().slice(0, 40);
  return s || '새 프리셋';
}

/** JSON 내보내기/가져오기 (사용자 프리셋만) */
export function exportPresets(presets) {
  return JSON.stringify({ app: 'VelvetTab', kind: 'presets', items: presets.items.filter((p) => !p.builtin) }, null, 2);
}

export function importPresets(presets, json) {
  const parsed = JSON.parse(json);
  if (!parsed || parsed.app !== 'VelvetTab' || !Array.isArray(parsed.items)) throw new Error('Velvet Tab 프리셋 파일이 아닙니다.');
  const incoming = parsed.items.map((p) => ({ ...p, id: newId(), builtin: false }));
  const merged = sanitizePresets({ ...presets, items: [...presets.items, ...incoming] });
  return { merged, count: merged.items.length - presets.items.length };
}

/* ---------- Store 연동 ---------- */
export function createPresetManager(store) {
  const both = (fn) => {
    let result;
    store.mutate('presets', (presets) => {
      store.mutate('settings', (settings) => { result = fn(settings, presets); }, '*');
    });
    return result;
  };
  return {
    list: () => store.presets.items,
    get: (id) => find(store.presets, id),
    apply: (id) => both((s, p) => ops.apply(s, p, id)),
    create: (name) => { let id; store.mutate('presets', (p) => { id = ops.create(store.settings, p, name); }); return id; },
    overwrite: (id) => { let ok; store.mutate('presets', (p) => { ok = ops.overwrite(store.settings, p, id); }); return ok; },
    rename: (id, name) => store.mutate('presets', (p) => ops.rename(p, id, name)),
    duplicate: (id) => { let nid; store.mutate('presets', (p) => { nid = ops.duplicate(p, id); }); return nid; },
    remove: (id) => store.mutate('presets', (p) => ops.remove(p, id)),
    setDefault: (id) => store.mutate('presets', (p) => ops.setDefault(p, id)),
    isModified: () => ops.isModified(store.settings, store.presets),
    applyDefault: () => both((s, p) => ops.apply(s, p, p.defaultId))
  };
}
