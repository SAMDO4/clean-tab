// Velvet Tab 진입점
// 1) 배경 이미지 로딩과 설정 로딩을 병렬로 시작 → 2) 요소 적용 → 3) 배치 → 4) 표시
// 설정 패널은 처음 열 때만 동적으로 불러온다.
import { MOVABLE_KEYS, defaultElements } from './defaults.js';
import { Store } from './storage-manager.js';
import { applyStyle } from './style-manager.js';
import { createClock, startTicker } from './clock.js';
import { createDate } from './date.js';
import { computeLayout } from './layout-manager.js';
import { createDragManager } from './drag-manager.js';
import { createBackgroundView, loadBackground, clearBackground } from './background-manager.js';
import { createFavorites } from './favorites-manager.js';
import { createBookmarkBar } from './bookmark-bar.js';

const $ = (id) => document.getElementById(id);
const dom = {
  bg: $('vt-bg'), dim: $('vt-dim'), stage: $('vt-stage'), bookmarks: $('vt-bookmarks'),
  clock: $('vt-clock'), date: $('vt-date'), favorites: $('vt-favorites'),
  editbar: $('vt-editbar'), settingsBtn: $('vt-settings-btn')
};
const ELS = { clock: dom.clock, date: dom.date, favorites: dom.favorites, bookmarkBar: dom.bookmarks };

const store = new Store();
const bgView = createBackgroundView(dom.bg, dom.dim);
const clock = createClock(dom.clock);
const date = createDate(dom.date);
const favorites = createFavorites(dom.favorites, { onEmpty: () => openPanel('favorites') });
const bookmarkBar = createBookmarkBar(dom.bookmarks, { onLayout: () => scheduleLayout() });
const positions = {};
const cleanups = [];
let panelModule = null;
let layoutRaf = 0;

/* ------------------------------------------------------------------ 배경 */
let bgMeta = null;
async function restoreBackground(preloaded) {
  let rec = null;
  try {
    rec = preloaded !== undefined ? preloaded : await loadBackground();
  } catch (err) {
    console.warn('[VelvetTab] 배경 이미지를 불러오지 못했습니다.', err);
  }
  if (!rec) { bgMeta = null; bgView.clear(); return; }
  const ok = await bgView.show(rec.blob);
  if (ok) { bgMeta = rec.meta; return; }
  // 손상된 이미지 → 제거 후 기본 배경
  console.warn('[VelvetTab] 저장된 배경 이미지가 손상되어 초기화했습니다.');
  bgMeta = null;
  bgView.clear();
  await clearBackground().catch(() => {});
}

/* ------------------------------------------------------------------ 요소 적용 */
function applyElement(key) {
  const conf = store.settings.elements[key];
  const el = ELS[key];
  el.hidden = !conf.visible;
  applyStyle(el, store.settings, key);
  const o = conf.options;
  if (key === 'clock') { el.dataset.align = o.align; clock.setOptions(o); }
  else if (key === 'date') { el.dataset.align = o.align; date.setOptions(o); }
  else if (key === 'favorites') favorites.render(store.favorites, o);
  else if (key === 'bookmarkBar') {
    el.style.setProperty('--vt-bm-height', `${o.height}px`);
    el.style.setProperty('--vt-bm-icon', `${o.iconSize}px`);
    el.style.setProperty('--vt-bm-gap', `${o.gap}px`);
    el.style.setProperty('--vt-bm-hover', String(o.hover ? o.hoverStrength / 100 : 0));
    if (conf.visible) bookmarkBar.setOptions(o);
    else bookmarkBar.closeMenus();
  }
  scheduleLayout();
}

function applyAll() {
  for (const key of Object.keys(ELS)) applyElement(key);
  bgView.applyFit(store.settings.background);
  applyGeneral();
}

function applyGeneral() {
  document.body.classList.toggle('vt-btn-autohide', store.settings.general.settingsButtonAutoHide);
}

/* ------------------------------------------------------------------ 배치 */
function getArea() {
  const top = dom.bookmarks.hidden ? 0 : dom.bookmarks.offsetHeight;
  return { x: 0, y: top, w: window.innerWidth, h: Math.max(1, window.innerHeight - top) };
}

function movableItems() {
  return MOVABLE_KEYS.map((key) => ({ key, el: ELS[key], align: store.settings.elements[key].options.align || 'center' }));
}

function setPos(key, left, top) {
  positions[key] = { left, top };
  ELS[key].style.transform = `translate3d(${left}px, ${top}px, 0)`;
}

function layout() {
  layoutRaf = 0;
  const items = movableItems()
    .filter((i) => !i.el.hidden)
    .map((i) => ({ ...i, w: i.el.offsetWidth, h: i.el.offsetHeight, position: store.settings.elements[i.key].position }));
  const out = computeLayout(getArea(), items);
  for (const [key, p] of Object.entries(out)) setPos(key, p.left, p.top);
  drag.refresh();
}

function scheduleLayout() {
  if (!layoutRaf) layoutRaf = requestAnimationFrame(layout);
}

const drag = createDragManager({
  stage: dom.stage,
  getArea,
  getItems: movableItems,
  getPos: (key) => positions[key] || { left: 0, top: 0 },
  setPos,
  onCommit: (key, pos) => {
    store.set('settings', `elements.${key}.position`, { ...store.settings.elements[key].position, mode: 'free', x: pos.x, y: pos.y });
  }
});

const ro = new ResizeObserver(scheduleLayout);
[dom.clock, dom.date, dom.favorites, dom.bookmarks].forEach((el) => ro.observe(el));
window.addEventListener('resize', scheduleLayout);

/* ------------------------------------------------------------------ 편집 모드 */
let reopenPanelAfterEdit = false;

function enterEditMode() {
  if (drag.enabled) return;
  reopenPanelAfterEdit = !!(panelModule && panelModule.isOpen());
  if (reopenPanelAfterEdit) panelModule.close({ restoreFocus: false });
  bookmarkBar.closeMenus();
  document.body.classList.add('vt-editing');
  dom.editbar.hidden = false;
  drag.enable();
  dom.editbar.querySelector('[data-act="done"]').focus({ preventScroll: true });
}

function exitEditMode() {
  if (!drag.enabled) return;
  drag.disable();
  document.body.classList.remove('vt-editing');
  dom.editbar.hidden = true;
  if (reopenPanelAfterEdit) openPanel('layout');
}

function resetLayout() {
  const d = defaultElements();
  store.mutate('settings', (s) => {
    for (const key of MOVABLE_KEYS) s.elements[key].position = d[key].position;
  }, 'elements');
}

dom.editbar.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'done') exitEditMode();
  else if (act === 'reset-layout') resetLayout();
});

/* ------------------------------------------------------------------ 설정 패널 */
const api = {
  store,
  get bgMeta() { return bgMeta; },
  restoreBackground,
  bgView,
  enterEditMode,
  exitEditMode,
  resetLayout,
  isEditing: () => drag.enabled
};

async function openPanel(tab) {
  try {
    panelModule ??= await import('./settings-panel.js');
    panelModule.open(api, dom.settingsBtn, tab);
  } catch (err) {
    console.error('[VelvetTab] 설정 패널을 열 수 없습니다.', err);
  }
}

dom.settingsBtn.addEventListener('click', async () => {
  if (drag.enabled) exitEditMode();
  if (panelModule && panelModule.isOpen()) panelModule.close();
  else openPanel();
});

/* 설정 버튼 자동 숨김: 마우스를 움직일 때만 표시 */
let idleTimer = 0;
const onPointerMove = () => {
  document.body.classList.add('vt-pointer');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.remove('vt-pointer'), 2500);
};
document.addEventListener('pointermove', onPointerMove, { passive: true });
document.documentElement.addEventListener('pointerleave', () => document.body.classList.remove('vt-pointer'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drag.enabled) { e.preventDefault(); exitEditMode(); }
});

/* ------------------------------------------------------------------ 저장소 변경 → 해당 요소만 갱신 */
store.subscribe((section, path) => {
  if (section === 'favorites') { applyElement('favorites'); return; }
  if (section !== 'settings') return;
  if (path === '*' || path === 'elements' || path.startsWith('globalStyle')) { applyAll(); return; }
  const m = /^elements\.(\w+)/.exec(path);
  if (m && ELS[m[1]]) { applyElement(m[1]); return; }
  if (path.startsWith('background')) bgView.applyFit(store.settings.background);
  else if (path.startsWith('general')) applyGeneral();
});

/* ------------------------------------------------------------------ 시작 */
async function boot() {
  const bgPromise = loadBackground().catch(() => null); // 설정과 병렬로 이미지 로드
  await store.load();
  applyAll();
  bookmarkBar.load(); // 숨김 상태여도 미리 읽어 두어 표시 전환 시 바로 보이도록
  cleanups.push(startTicker((now) => {
    const a = store.settings.elements.clock.visible && clock.render(now);
    const b = store.settings.elements.date.visible && date.render(now);
    if (a || b) scheduleLayout();
  }));
  layout();
  document.body.classList.add('vt-ready'); // 레이아웃 완료 후 요소 표시 (위치 튐 방지)
  await restoreBackground(await bgPromise);
  document.body.classList.add('vt-bg-ready');
}

boot().catch((err) => {
  console.error('[VelvetTab] 초기화 오류', err);
  document.body.classList.add('vt-ready', 'vt-bg-ready');
});

/* 탭이 숨겨지거나 닫힐 때 즉시 저장 + 정리 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.flush();
});
window.addEventListener('pagehide', (e) => {
  store.flush();
  if (e.persisted) return;
  cleanups.forEach((fn) => fn());
  ro.disconnect();
  drag.disable();
  bookmarkBar.destroy();
  bgView.destroy();
  if (panelModule) panelModule.destroy();
  store.destroy();
  clearTimeout(idleTimer);
});
