// 설정 저장소 (chrome.storage.local)
// - 키를 영역별로 분리: vt.meta / vt.settings / vt.presets / vt.favorites
// - 스키마 버전 + 마이그레이션 + 검증(sanitize)으로 손상·구버전 데이터에 대응
// - 변경은 디바운스 후 저장하고, 탭 종료 직전(pagehide/hidden)에 즉시 flush
import {
  SCHEMA_VERSION, ELEMENT_KEYS, POSITION_PRESETS, STYLE_SCHEMA, DEFAULT_GLOBAL_STYLE, DATE_FORMATS, ALIGNS,
  defaultSettings, defaultFavorites, defaultPresets
} from './defaults.js';

export const KEYS = Object.freeze({
  meta: 'vt.meta', settings: 'vt.settings', presets: 'vt.presets', favorites: 'vt.favorites', backup: 'vt.backup'
});
const SECTIONS = ['settings', 'presets', 'favorites'];

/* ------------------------------------------------------------------ 검증 유틸 */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isColor = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
function num(v, min, max, fallback, step) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  let n = clamp(v, min, max);
  if (step) n = Math.round(n / step) * step;
  return n;
}

/** 옵션 검증 규칙: enum 배열 또는 [min,max] */
export const OPTION_RULES = Object.freeze({
  clock: { hour12: 'bool', showSeconds: 'bool', align: ALIGNS },
  date: { format: Object.keys(DATE_FORMATS), showWeekday: 'bool', showYear: 'bool', align: ALIGNS },
  favorites: { mode: ['icon-text', 'icon'], iconSize: [24, 96], gap: [0, 48], itemRadius: [0, 48], hover: 'bool', openInNewTab: 'bool' },
  bookmarkBar: { height: [24, 56], iconSize: [12, 24], gap: [0, 16], mode: ['icon-text', 'icon', 'text'], hover: 'bool', hoverStrength: [0, 40], showOther: 'bool' }
});

export function sanitizeStyle(raw, allowElementOnly) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [key, val] of Object.entries(raw)) {
    const s = STYLE_SCHEMA[key];
    if (!s || (s.elementOnly && !allowElementOnly)) continue;
    if (s.type === 'color' && isColor(val)) out[key] = val.toLowerCase();
    else if (s.type === 'bool' && typeof val === 'boolean') out[key] = val;
    else if (s.type === 'range') {
      const n = num(val, s.min, s.max, undefined, s.step);
      if (n !== undefined) out[key] = n;
    }
  }
  return out;
}

function sanitizeOptions(key, raw, defaults) {
  const rules = OPTION_RULES[key] || {};
  const out = { ...defaults };
  if (!isObj(raw)) return out;
  for (const [k, rule] of Object.entries(rules)) {
    const v = raw[k];
    if (rule === 'bool') { if (typeof v === 'boolean') out[k] = v; }
    else if (Array.isArray(rule) && typeof rule[0] === 'number') { out[k] = num(v, rule[0], rule[1], defaults[k]); }
    else if (Array.isArray(rule)) { if (rule.includes(v)) out[k] = v; }
  }
  return out;
}

function sanitizePosition(raw, def) {
  if (!isObj(raw)) return { ...def };
  return {
    mode: raw.mode === 'free' ? 'free' : 'preset',
    preset: POSITION_PRESETS.includes(raw.preset) ? raw.preset : def.preset,
    x: num(raw.x, 0, 1, def.x),
    y: num(raw.y, 0, 1, def.y)
  };
}

/** elements + globalStyle 부분 검증 (설정과 프리셋이 공유) */
function sanitizeLayoutPart(raw, d) {
  const elements = {};
  for (const key of ELEMENT_KEYS) {
    const de = d.elements[key];
    const re = isObj(raw?.elements) ? raw.elements[key] : undefined;
    if (!isObj(re)) { elements[key] = de; continue; }
    const el = {
      visible: typeof re.visible === 'boolean' ? re.visible : de.visible,
      style: isObj(re.style) ? sanitizeStyle(re.style, true) : de.style,
      options: sanitizeOptions(key, re.options, de.options)
    };
    if (de.position) el.position = sanitizePosition(re.position, de.position);
    elements[key] = el;
  }
  const globalStyle = { ...DEFAULT_GLOBAL_STYLE, ...sanitizeStyle(raw?.globalStyle, false) };
  return { elements, globalStyle };
}

export function sanitizeSettings(raw) {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const { elements, globalStyle } = sanitizeLayoutPart(raw, d);
  const rb = isObj(raw.background) ? raw.background : {};
  const rg = isObj(raw.general) ? raw.general : {};
  return {
    elements,
    globalStyle,
    background: {
      fit: ['cover', 'contain', 'original', 'custom'].includes(rb.fit) ? rb.fit : d.background.fit,
      posX: num(rb.posX, 0, 100, d.background.posX),
      posY: num(rb.posY, 0, 100, d.background.posY),
      dim: num(rb.dim, 0, 80, d.background.dim)
    },
    general: {
      closePanelOnOutsideClick: typeof rg.closePanelOnOutsideClick === 'boolean' ? rg.closePanelOnOutsideClick : d.general.closePanelOnOutsideClick,
      settingsButtonAutoHide: typeof rg.settingsButtonAutoHide === 'boolean' ? rg.settingsButtonAutoHide : d.general.settingsButtonAutoHide
    }
  };
}

/** 사용자 입력 URL 정규화: http(s) 만 허용. 실패 시 null */
export function normalizeUrl(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s.length > 2048) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || /\s/.test(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

const ICON_TYPES = ['auto', 'letter', 'emoji', 'image'];
const MAX_ICON_DATAURL = 200 * 1024;

export function sanitizeFavorites(raw) {
  const out = defaultFavorites();
  if (!isObj(raw) || !Array.isArray(raw.items)) return out;
  const seen = new Set();
  for (const it of raw.items) {
    if (!isObj(it)) continue;
    const url = normalizeUrl(it.url);
    if (!url) continue;
    let id = typeof it.id === 'string' && it.id ? it.id.slice(0, 64) : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const ri = isObj(it.icon) ? it.icon : {};
    const type = ICON_TYPES.includes(ri.type) ? ri.type : 'auto';
    let value = typeof ri.value === 'string' ? ri.value : '';
    if (type === 'image' && !(/^data:image\/(png|jpeg|webp);base64,/.test(value) && value.length <= MAX_ICON_DATAURL)) value = '';
    if (type === 'emoji' || type === 'letter') value = [...value].slice(0, 2).join('');
    out.items.push({
      id,
      title: typeof it.title === 'string' ? it.title.slice(0, 100) : '',
      url,
      hidden: it.hidden === true,
      icon: { type: type === 'image' && !value ? 'auto' : type, value, color: isColor(ri.color) ? ri.color : '#5b6b8c' }
    });
    if (out.items.length >= 200) break;
  }
  return out;
}

export function sanitizePresets(raw) {
  const def = defaultPresets();
  const builtins = def.items.filter((p) => p.builtin);
  if (!isObj(raw) || !Array.isArray(raw.items)) return def;
  const d = defaultSettings();
  const items = [...builtins]; // 기본 제공 프리셋은 항상 최신 코드 정의를 사용
  const ids = new Set(items.map((p) => p.id));
  for (const p of raw.items) {
    if (!isObj(p) || p.builtin || typeof p.id !== 'string' || ids.has(p.id)) continue;
    ids.add(p.id);
    items.push({
      id: p.id.slice(0, 64),
      name: (typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '이름 없는 프리셋').slice(0, 40),
      builtin: false,
      data: sanitizeLayoutPart(p.data, d),
      createdAt: num(p.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
      updatedAt: num(p.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0)
    });
    if (items.length >= 60) break;
  }
  const has = (id) => items.some((p) => p.id === id);
  return {
    items,
    defaultId: has(raw.defaultId) ? raw.defaultId : def.defaultId,
    activeId: raw.activeId === null || has(raw.activeId) ? raw.activeId : def.activeId
  };
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ------------------------------------------------------------------ 마이그레이션 */
// MIGRATIONS[n] : 버전 n-1 → n 으로 변환. 새 버전을 만들 때 여기에 함수를 추가한다.
export const MIGRATIONS = {
  1: (data) => data // 최초 버전
};

/**
 * 저장된 원본을 현재 스키마로 변환한다.
 * @returns {{data:object, from:number, to:number, newer:boolean}}
 */
export function migrate(raw) {
  const from = isObj(raw.meta) && Number.isInteger(raw.meta.schemaVersion) ? raw.meta.schemaVersion : 0;
  if (from > SCHEMA_VERSION) return { data: raw, from, to: from, newer: true };
  let data = raw;
  for (let v = Math.max(from, 0) + 1; v <= SCHEMA_VERSION; v++) {
    if (MIGRATIONS[v]) data = MIGRATIONS[v](data);
  }
  return { data, from, to: SCHEMA_VERSION, newer: false };
}

/** 키 순서와 무관한 JSON (chrome.storage 는 객체 키를 정렬해서 돌려준다) */
export function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

/* ------------------------------------------------------------------ 경로 유틸 */
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!isObj(o[keys[i]])) o[keys[i]] = {};
    o = o[keys[i]];
  }
  if (value === undefined) delete o[keys[keys.length - 1]];
  else o[keys[keys.length - 1]] = value;
}

/* ------------------------------------------------------------------ Store */
const hasChrome = () => typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
const SANITIZERS = { settings: sanitizeSettings, presets: sanitizePresets, favorites: sanitizeFavorites };

export class Store {
  constructor() {
    this.data = { settings: defaultSettings(), presets: defaultPresets(), favorites: defaultFavorites() };
    this.listeners = new Set();
    this.timers = {};
    this.dirty = new Set();
    this.lastWritten = {};
    this.echo = {};          // 이 탭이 쓴 값들 (onChanged 로 늦게 돌아오는 자기 변경을 무시하기 위함)
    this.readOnly = false;
    this.onExternal = this.onExternal.bind(this);
  }

  get settings() { return this.data.settings; }
  get presets() { return this.data.presets; }
  get favorites() { return this.data.favorites; }

  async load() {
    if (!hasChrome()) return this;
    let raw = {};
    try {
      const got = await chrome.storage.local.get([KEYS.meta, KEYS.settings, KEYS.presets, KEYS.favorites]);
      raw = { meta: got[KEYS.meta], settings: got[KEYS.settings], presets: got[KEYS.presets], favorites: got[KEYS.favorites] };
    } catch (err) {
      console.warn('[VelvetTab] 설정을 읽지 못해 기본값을 사용합니다.', err);
      this.readOnly = true; // 읽기 실패 시 기존 데이터를 덮어쓰지 않도록
      return this;
    }
    const fresh = raw.meta === undefined && raw.settings === undefined;
    const m = migrate(raw);
    if (m.newer) this.readOnly = true; // 더 새로운 버전의 데이터: 덮어쓰지 않음

    const backups = {};
    for (const s of SECTIONS) {
      const val = m.data[s];
      if (val !== undefined && !isObj(val)) backups[s] = val; // 손상된 값은 백업 후 기본값
      this.data[s] = SANITIZERS[s](val);
    }

    if (!this.readOnly) {
      const write = {};
      if (fresh || m.from !== m.to) write[KEYS.meta] = { schemaVersion: SCHEMA_VERSION, migratedFrom: m.from, at: Date.now() };
      if (Object.keys(backups).length) write[KEYS.backup] = { at: Date.now(), values: backups };
      for (const s of SECTIONS) {
        const json = stableStringify(this.data[s]);
        if (fresh || stableStringify(m.data[s]) !== json) { write[KEYS[s]] = this.data[s]; this.remember(s, json); }
        this.lastWritten[s] = json;
      }
      if (Object.keys(write).length) {
        try { await chrome.storage.local.set(write); } catch (err) { console.warn('[VelvetTab] 초기 저장 실패', err); }
      }
    }
    chrome.storage.onChanged.addListener(this.onExternal);
    return this;
  }

  /** 다른 탭에서의 변경 반영 */
  onExternal(changes, area) {
    if (area !== 'local') return;
    for (const s of SECTIONS) {
      const c = changes[KEYS[s]];
      if (!c || c.newValue === undefined) continue;
      const json = stableStringify(c.newValue);
      // 자기 자신이 쓴 값의 메아리(지연 도착 포함)는 무시 → 빠른 연속 편집이 되돌려지지 않음
      if (this.echo[s] && this.echo[s].delete(json)) continue;
      if (json === stableStringify(this.data[s])) continue;
      // 이 탭에 아직 저장 안 된 변경이 있으면 로컬 변경 우선 (곧 저장되어 다른 탭에도 반영됨)
      if (this.dirty.has(s)) continue;
      this.data[s] = SANITIZERS[s](c.newValue);
      this.lastWritten[s] = json;
      this.emit(s, '*', true);
    }
  }

  remember(section, json) {
    const set = (this.echo[section] ||= new Set());
    if (set.size > 30) set.clear();
    set.add(json);
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(section, path, external = false) { for (const fn of this.listeners) fn(section, path, external); }

  /** 경로 값 변경: store.set('settings', 'elements.clock.visible', false) */
  set(section, path, value) {
    setPath(this.data[section], path, value);
    this.changed(section, path);
  }
  get(section, path) { return getPath(this.data[section], path); }

  /** 영역 전체 교체 */
  replace(section, value) {
    this.data[section] = SANITIZERS[section](value);
    this.changed(section, '*');
  }

  /** 함수형 변경 */
  mutate(section, fn, path = '*') {
    fn(this.data[section]);
    this.changed(section, path);
  }

  changed(section, path) {
    this.emit(section, path);
    this.scheduleSave(section);
  }

  scheduleSave(section, delay = 250) {
    this.dirty.add(section);
    clearTimeout(this.timers[section]);
    this.timers[section] = setTimeout(() => this.save(section), delay);
  }

  async save(section) {
    clearTimeout(this.timers[section]);
    this.dirty.delete(section);
    if (!hasChrome() || this.readOnly) return;
    const json = stableStringify(this.data[section]);
    if (json === this.lastWritten[section]) return;
    this.lastWritten[section] = json;
    this.remember(section, json);
    try {
      await chrome.storage.local.set({ [KEYS[section]]: this.data[section] });
    } catch (err) {
      this.lastWritten[section] = undefined;
      console.error('[VelvetTab] 저장 실패', err);
    }
  }

  /** 대기 중인 저장을 즉시 실행 (탭 종료/숨김 시) */
  flush() {
    for (const s of [...this.dirty]) this.save(s);
  }

  destroy() {
    this.flush();
    if (hasChrome()) chrome.storage.onChanged.removeListener(this.onExternal);
    this.listeners.clear();
  }
}
