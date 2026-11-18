// 우측 설정 사이드 패널 (처음 열 때 동적 import)
import {
  ELEMENT_LABELS, MOVABLE_KEYS, POSITION_PRESETS, POSITION_LABELS, STYLE_SCHEMA, DATE_FORMATS, STYLE_FALLBACK
} from './defaults.js';
import { OPTION_RULES, normalizeUrl, newId } from './storage-manager.js';
import { effectiveStyle } from './style-manager.js';
import { formatDate } from './date.js';
import { validateImage, saveBackground, clearBackground, loadBackground } from './background-manager.js';
import { buildIcon, imageToIconDataUrl, hostOf } from './favorites-manager.js';
import { createPresetManager, exportPresets, importPresets } from './preset-manager.js';

const TABS = [
  ['elements', '요소'], ['layout', '배치'], ['design', '디자인'],
  ['background', '배경'], ['favorites', '즐겨찾기'], ['presets', '프리셋']
];

let api = null;
let store = null;
let presets = null;
let panel = null;
let body = null;
let tabButtons = {};
let anchor = null;
let isOpenFlag = false;
let current = 'elements';
let designTarget = 'global';
let muted = 0;               // 패널 자신이 일으킨 변경은 다시 그리지 않음 (슬라이더 조작 중 포커스 유지)
let unsubscribe = null;
let ac = null;
let pendingBg = null;         // { file, info } 적용 전 미리보기
let previewUrl = null;
let favEditing = null;        // 편집 중인 즐겨찾기 id 또는 'new'
let favDraft = null;          // 입력 중인 값 (패널이 다시 그려져도 유지)

/* ------------------------------------------------------------------ DOM 도우미 */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

function quiet(fn) { muted++; try { fn(); } finally { muted--; } }
const setS = (path, value) => quiet(() => store.set('settings', path, value));

function row(label, control, extra) {
  return h('div', { class: 'vt-row' + (extra?.cls ? ' ' + extra.cls : '') },
    h('span', { class: 'vt-row-label', title: extra?.title }, label, extra?.mark ? h('i', { class: 'vt-mark', title: '개별 설정됨' }) : null),
    h('div', { class: 'vt-row-ctl' }, control, extra?.after || null));
}

function toggle(value, onChange, label) {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label || '' });
  input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'vt-switch' }, input, h('span', { class: 'vt-switch-ui' }));
}

function range(value, { min, max, step = 1, unit = '' }, onInput, label) {
  const out = h('output', { class: 'vt-range-out' }, `${value}${unit}`);
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label || '' });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = `${v}${unit}`;
    onInput(v);
  });
  return h('div', { class: 'vt-range' }, input, out);
}

function select(value, options, onChange, label) {
  const s = h('select', { class: 'vt-select', 'aria-label': label || '' },
    options.map(([v, l]) => { const o = h('option', { value: v }, l); if (v === value) o.selected = true; return o; }));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function segmented(value, options, onChange, label) {
  const wrap = h('div', { class: 'vt-seg', role: 'radiogroup', 'aria-label': label || '' });
  for (const [v, l] of options) {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'is-on' : '' }, l);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => { x.classList.remove('is-on'); x.setAttribute('aria-checked', 'false'); });
      b.classList.add('is-on');
      b.setAttribute('aria-checked', 'true');
      onChange(v);
    });
    wrap.append(b);
  }
  return wrap;
}

function color(value, onChange, label) {
  const i = h('input', { type: 'color', class: 'vt-color', value, 'aria-label': label || '' });
  i.addEventListener('input', () => onChange(i.value));
  return i;
}

function button(label, onClick, cls = '') {
  return h('button', { type: 'button', class: `vt-btn ${cls}`, onclick: onClick }, label);
}

/** 두 번 눌러야 실행되는 위험 동작 버튼 */
function confirmButton(label, confirmLabel, onConfirm, cls = '') {
  let armed = false;
  let timer = 0;
  const b = button(label, () => {
    if (!armed) {
      armed = true;
      b.textContent = confirmLabel;
      b.classList.add('is-armed');
      timer = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('is-armed'); }, 3000);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  }, `is-danger ${cls}`);
  return b;
}

function section(title, ...children) {
  return h('section', { class: 'vt-card' }, title ? h('h3', { class: 'vt-card-title' }, title) : null, ...children);
}

function note(text) { return h('p', { class: 'vt-note' }, text); }

function rule(key, opt) { return OPTION_RULES[key][opt]; }

/* ------------------------------------------------------------------ 탭: 화면 요소 */
function tabElements() {
  const s = store.settings;
  const E = s.elements;
  const st = (key, prop) => effectiveStyle(s, key)[prop];
  const now = new Date();

  const visibleRow = (key) => row('표시', toggle(E[key].visible, (v) => setS(`elements.${key}.visible`, v), `${ELEMENT_LABELS[key]} 표시`));
  const styleRange = (key, prop, label, min, max, step) => row(label,
    range(st(key, prop), { min: min ?? STYLE_SCHEMA[prop].min, max: max ?? STYLE_SCHEMA[prop].max, step: step ?? STYLE_SCHEMA[prop].step ?? 1, unit: STYLE_SCHEMA[prop].unit },
      (v) => setS(`elements.${key}.style.${prop}`, v), label));
  const optRange = (key, opt, label, unit = 'px') => row(label,
    range(E[key].options[opt], { min: rule(key, opt)[0], max: rule(key, opt)[1], unit }, (v) => setS(`elements.${key}.options.${opt}`, v), label));
  const optToggle = (key, opt, label) => row(label, toggle(E[key].options[opt], (v) => setS(`elements.${key}.options.${opt}`, v), label));
  const alignRow = (key) => row('정렬', segmented(E[key].options.align, [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']], (v) => setS(`elements.${key}.options.align`, v), '정렬'));
  const colorRow = (key) => row('글자 색상', color(st(key, 'textColor'), (v) => setS(`elements.${key}.style.textColor`, v), '글자 색상'));

  return [
    section('시계',
      visibleRow('clock'),
      row('형식', segmented(E.clock.options.hour12 ? '12' : '24', [['24', '24시간'], ['12', '12시간']], (v) => setS('elements.clock.options.hour12', v === '12'), '시간 형식')),
      optToggle('clock', 'showSeconds', '초 표시'),
      styleRange('clock', 'fontSize', '글자 크기', 24, 220),
      styleRange('clock', 'fontWeight', '글자 굵기'),
      colorRow('clock'),
      styleRange('clock', 'opacity', '투명도'),
      alignRow('clock')),
    section('날짜',
      visibleRow('date'),
      row('형식', select(E.date.options.format, Object.keys(DATE_FORMATS).map((f) => [f, formatDate(now, { format: f, showWeekday: true, showYear: true })]),
        (v) => setS('elements.date.options.format', v), '날짜 형식')),
      optToggle('date', 'showWeekday', '요일 표시'),
      optToggle('date', 'showYear', '연도 표시'),
      styleRange('date', 'fontSize', '글자 크기', 10, 72),
      styleRange('date', 'fontWeight', '글자 굵기'),
      colorRow('date'),
      alignRow('date')),
    section('즐겨찾기',
      visibleRow('favorites'),
      row('표시 방식', segmented(E.favorites.options.mode, [['icon-text', '아이콘+이름'], ['icon', '아이콘만']], (v) => setS('elements.favorites.options.mode', v), '표시 방식')),
      optRange('favorites', 'iconSize', '아이콘 크기'),
      optRange('favorites', 'gap', '간격'),
      optRange('favorites', 'itemRadius', '아이콘 모서리'),
      styleRange('favorites', 'fontSize', '글자 크기', 9, 24),
      optToggle('favorites', 'hover', '마우스 오버 효과'),
      optToggle('favorites', 'openInNewTab', '새 탭에서 열기'),
      h('div', { class: 'vt-actions' }, button('즐겨찾기 관리', () => switchTab('favorites')))),
    section('북마크바',
      note('Chrome 북마크를 읽기 전용으로 보여 주는 확장 프로그램 내부 UI입니다. Chrome의 실제 북마크바(툴바)와 동일하게 동작하지는 않습니다.'),
      visibleRow('bookmarkBar'),
      row('표시 방식', segmented(E.bookmarkBar.options.mode, [['icon-text', '아이콘+이름'], ['icon', '아이콘만'], ['text', '이름만']], (v) => setS('elements.bookmarkBar.options.mode', v), '표시 방식')),
      optRange('bookmarkBar', 'height', '높이'),
      optRange('bookmarkBar', 'iconSize', '아이콘 크기'),
      styleRange('bookmarkBar', 'fontSize', '글자 크기', 10, 18),
      optRange('bookmarkBar', 'gap', '항목 간격'),
      styleRange('bookmarkBar', 'bgOpacity', '배경 투명도'),
      styleRange('bookmarkBar', 'blur', '블러 강도'),
      styleRange('bookmarkBar', 'radius', '모서리 둥글기'),
      optToggle('bookmarkBar', 'hover', '마우스 오버 효과'),
      optRange('bookmarkBar', 'hoverStrength', '오버 효과 강도', '%'),
      optToggle('bookmarkBar', 'showOther', "'모든 북마크' 폴더 표시")),
    section('일반',
      row('설정 버튼 자동 숨김', toggle(s.general.settingsButtonAutoHide, (v) => setS('general.settingsButtonAutoHide', v))),
      row('패널 바깥 클릭 시 닫기', toggle(s.general.closePanelOnOutsideClick, (v) => setS('general.closePanelOnOutsideClick', v))))
  ];
}

/* ------------------------------------------------------------------ 탭: 배치 */
function tabLayout() {
  const E = store.settings.elements;
  const cards = MOVABLE_KEYS.map((key) => {
    const pos = E[key].position;
    const grid = h('div', { class: 'vt-posgrid', role: 'radiogroup', 'aria-label': `${ELEMENT_LABELS[key]} 위치` },
      POSITION_PRESETS.map((p) => {
        const on = pos.mode === 'preset' && pos.preset === p;
        return h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'is-on' : '', title: POSITION_LABELS[p], 'aria-label': POSITION_LABELS[p],
          onclick: () => { store.set('settings', `elements.${key}.position`, { ...pos, mode: 'preset', preset: p }); }
        }, h('span'));
      }));
    const status = pos.mode === 'free'
      ? `자유 배치 · X ${Math.round(pos.x * 100)}% · Y ${Math.round(pos.y * 100)}%`
      : POSITION_LABELS[pos.preset];
    return section(ELEMENT_LABELS[key],
      h('div', { class: 'vt-pos' }, grid, h('div', { class: 'vt-pos-info' },
        h('div', { class: 'vt-pos-status' }, status),
        E[key].visible ? null : h('div', { class: 'vt-note' }, '현재 숨겨진 요소입니다.'))));
  });
  return [
    section('자유 배치',
      note('편집 모드에서 요소를 마우스로 끌어 원하는 곳에 놓으세요. 위치는 화면 비율(%)로 저장되어 해상도가 바뀌어도 유지됩니다. 같은 위치를 고른 요소는 위에서부터 차례로 쌓입니다.'),
      h('div', { class: 'vt-actions' },
        button('편집 모드 시작', () => api.enterEditMode(), 'is-primary'),
        confirmButton('기본 배치 복원', '한 번 더 누르면 복원', () => { api.resetLayout(); render(); }))),
    ...cards
  ];
}

/* ------------------------------------------------------------------ 탭: 디자인 */
function tabDesign() {
  const s = store.settings;
  const isGlobal = designTarget === 'global';
  const targets = [['global', '전역'], ['clock', '시계'], ['date', '날짜'], ['favorites', '즐겨찾기'], ['bookmarkBar', '북마크바']];
  const values = isGlobal ? { ...STYLE_FALLBACK, ...s.globalStyle } : effectiveStyle(s, designTarget);
  const overrides = isGlobal ? {} : s.elements[designTarget].style;
  const base = isGlobal ? 'globalStyle' : `elements.${designTarget}.style`;

  const rows = [];
  for (const [prop, sc] of Object.entries(STYLE_SCHEMA)) {
    if (sc.elementOnly && isGlobal) continue;
    const onChange = (v) => {
      setS(`${base}.${prop}`, v);
      if (!isGlobal) markRow(prop, true);
    };
    let ctl;
    if (sc.type === 'range') ctl = range(values[prop], { min: sc.min, max: sc.max, step: sc.step || 1, unit: sc.unit }, onChange, sc.label);
    else if (sc.type === 'bool') ctl = toggle(values[prop], onChange, sc.label);
    else ctl = color(values[prop], onChange, sc.label);
    const overridden = !isGlobal && prop in overrides && !sc.elementOnly;
    const resetBtn = !isGlobal && !sc.elementOnly
      ? h('button', { type: 'button', class: 'vt-icon-btn vt-row-reset', title: '전역 값 사용', 'aria-label': `${sc.label} 전역 값 사용`, hidden: !overridden,
        onclick: () => { setS(`${base}.${prop}`, undefined); render(); } }, '↺')
      : null;
    const r = row(sc.label, ctl, { mark: overridden, after: resetBtn });
    r.dataset.prop = prop;
    rows.push(r);
  }

  function markRow(prop, on) {
    const r = body.querySelector(`.vt-row[data-prop="${prop}"]`);
    if (!r || STYLE_SCHEMA[prop].elementOnly) return;
    const label = r.querySelector('.vt-row-label');
    if (on && !label.querySelector('.vt-mark')) label.append(h('i', { class: 'vt-mark', title: '개별 설정됨' }));
    const rb = r.querySelector('.vt-row-reset');
    if (rb) rb.hidden = !on;
  }

  return [
    section(null,
      segmented(designTarget, targets, (v) => { designTarget = v; render(); }, '디자인 대상'),
      note(isGlobal
        ? '전역 설정은 모든 요소에 공통으로 적용됩니다. 요소별로 따로 바꾼 값(●)이 있으면 그 값이 우선합니다.'
        : `${ELEMENT_LABELS[designTarget]}에만 적용됩니다. ● 표시는 전역보다 우선하는 개별 설정입니다.`)),
    section(isGlobal ? '전역 디자인' : `${ELEMENT_LABELS[designTarget]} 디자인`, ...rows,
      isGlobal ? null : h('div', { class: 'vt-actions' },
        button('개별 설정 모두 해제 (전역 따르기)', () => {
          const keep = {};
          if ('fontSize' in overrides) keep.fontSize = overrides.fontSize;
          setS(`elements.${designTarget}.style`, keep);
          render();
        })))
  ];
}

/* ------------------------------------------------------------------ 탭: 배경화면 */
function setPreview(blob) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = blob ? URL.createObjectURL(blob) : null;
}

function fmtSize(b) { return b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`; }

function tabBackground() {
  const bg = store.settings.background;
  const meta = api.bgMeta;
  const status = h('p', { class: 'vt-status', 'aria-live': 'polite' });
  const say = (t, kind = '') => { status.textContent = t; status.dataset.kind = kind; };
  const fileInput = h('input', { type: 'file', accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp', hidden: true });

  const img = h('img', { alt: '배경 미리보기' });
  const preview = h('div', { class: 'vt-bg-preview', tabindex: '0', role: 'button', 'aria-label': '이미지 선택 (클릭 또는 파일 끌어놓기)' },
    img, h('span', { class: 'vt-bg-ph' }, '클릭하거나 이미지를 끌어다 놓으세요', h('small', {}, 'JPG · PNG · WebP · 최대 40MB')));

  const showPreview = () => {
    if (previewUrl) { img.src = previewUrl; preview.classList.add('has-image'); }
    else { img.removeAttribute('src'); preview.classList.remove('has-image'); }
  };

  if (pendingBg) {
    showPreview();
    say(`미리보기: ${pendingBg.file.name} · ${pendingBg.info.width}×${pendingBg.info.height} · ${fmtSize(pendingBg.file.size)} — 적용을 눌러 저장하세요.`, 'info');
  } else {
    loadBackground().then((rec) => {
      if (!isOpenFlag || pendingBg || current !== 'background') return;
      setPreview(rec ? rec.blob : null);
      showPreview();
    }).catch(() => {});
    say(meta ? `현재: ${meta.name || '사용자 이미지'}${meta.width ? ` · ${meta.width}×${meta.height}` : ''} · ${fmtSize(meta.size || 0)}` : '현재 기본 배경을 사용 중입니다.');
  }

  async function pick(file) {
    if (!file) return;
    say('이미지를 확인하는 중…');
    const info = await validateImage(file);
    if (!info.ok) { say(info.reason, 'error'); return; }
    const shown = await api.bgView.show(file); // 새 탭에 즉시 미리 반영 (저장 전)
    if (!shown) { say('이미지를 표시할 수 없습니다.', 'error'); return; }
    pendingBg = { file, info };
    setPreview(file);
    render();
  }

  const open = () => fileInput.click();
  preview.addEventListener('click', open);
  preview.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  preview.addEventListener('dragover', (e) => { e.preventDefault(); preview.classList.add('is-drag'); });
  preview.addEventListener('dragleave', () => preview.classList.remove('is-drag'));
  preview.addEventListener('drop', (e) => { e.preventDefault(); preview.classList.remove('is-drag'); pick(e.dataTransfer?.files?.[0]); });
  fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; pick(f); });

  const apply = async () => {
    if (!pendingBg) return;
    say('저장하는 중…');
    try {
      await saveBackground(pendingBg.file, pendingBg.info);
      pendingBg = null;
      await api.restoreBackground();
      render();
      say('배경화면을 적용했습니다.', 'ok');
    } catch (err) {
      console.error('[VelvetTab] 배경 저장 실패', err);
      say(err?.name === 'QuotaExceededError' ? '저장 공간이 부족합니다. 더 작은 이미지를 사용해 주세요.' : '저장하지 못했습니다. 기존 배경은 그대로 유지됩니다.', 'error');
    }
  };
  const cancel = async () => { pendingBg = null; await api.restoreBackground(); render(); };
  const reset = async () => {
    try {
      pendingBg = null;
      await clearBackground();
      await api.restoreBackground();
      setPreview(null);
      render();
    } catch {
      say('초기화하지 못했습니다.', 'error');
    }
  };

  const fitRows = [
    row('표시 방식', segmented(bg.fit, [['cover', '채우기'], ['contain', '맞추기'], ['original', '원본 크기'], ['custom', '사용자 지정']], (v) => { setS('background.fit', v); render(); }, '배경 표시 방식'))
  ];
  if (bg.fit === 'custom') {
    fitRows.push(row('가로 위치', range(bg.posX, { min: 0, max: 100, unit: '%' }, (v) => setS('background.posX', v), '가로 위치')));
    fitRows.push(row('세로 위치', range(bg.posY, { min: 0, max: 100, unit: '%' }, (v) => setS('background.posY', v), '세로 위치')));
  }
  fitRows.push(row('어둡게', range(bg.dim, { min: 0, max: 80, unit: '%' }, (v) => setS('background.dim', v), '배경 어둡게')));

  return [
    section('배경 이미지', preview, fileInput, status,
      h('div', { class: 'vt-actions' },
        pendingBg ? button('적용', apply, 'is-primary') : button(meta ? '이미지 교체' : '이미지 선택', open, 'is-primary'),
        pendingBg ? button('취소', cancel) : null,
        !pendingBg && meta ? confirmButton('배경 초기화', '한 번 더 누르면 초기화', reset) : null)),
    section('표시 방식', ...fitRows,
      note('배경화면은 프리셋과 별도로 관리되어 프리셋을 바꿔도 바뀌지 않습니다.'))
  ];
}

/* ------------------------------------------------------------------ 탭: 즐겨찾기 */
function tabFavorites() {
  const items = store.favorites.items;
  const mutateFav = (fn) => quiet(() => store.mutate('favorites', fn));

  const list = h('ul', { class: 'vt-fav-list', 'aria-label': '즐겨찾기 목록' });
  let dragId = null;
  items.forEach((it) => {
    const li = h('li', { class: 'vt-fav-row' + (it.hidden ? ' is-hidden' : ''), draggable: 'true', dataset: { id: it.id } },
      h('span', { class: 'vt-handle', title: '끌어서 순서 변경', 'aria-hidden': 'true' }, '⋮⋮'),
      buildIcon(it, 28),
      h('div', { class: 'vt-fav-text' }, h('strong', {}, it.title || hostOf(it.url)), h('small', {}, it.url)),
      h('button', { type: 'button', class: 'vt-icon-btn', title: it.hidden ? '표시' : '숨기기', 'aria-label': `${it.title} ${it.hidden ? '표시' : '숨기기'}`,
        onclick: () => { mutateFav((f) => { f.items.find((x) => x.id === it.id).hidden = !it.hidden; }); render(); } }, it.hidden ? '◌' : '◉'),
      h('button', { type: 'button', class: 'vt-icon-btn', title: '편집', 'aria-label': `${it.title} 편집`, onclick: () => { favEditing = it.id; render(); } }, '✎'),
      confirmButton('삭제', '확인', () => { mutateFav((f) => { f.items = f.items.filter((x) => x.id !== it.id); }); render(); }, 'is-small'));
    li.addEventListener('dragstart', (e) => { dragId = it.id; li.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragend', () => { li.classList.remove('is-dragging'); dragId = null; list.querySelectorAll('.is-target').forEach((x) => x.classList.remove('is-target')); });
    li.addEventListener('dragover', (e) => { if (dragId && dragId !== it.id) { e.preventDefault(); li.classList.add('is-target'); } });
    li.addEventListener('dragleave', () => li.classList.remove('is-target'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || dragId === it.id) return;
      const from = dragId;
      mutateFav((f) => {
        const a = f.items.findIndex((x) => x.id === from);
        const [moved] = f.items.splice(a, 1);
        const b = f.items.findIndex((x) => x.id === it.id);
        f.items.splice(b, 0, moved);
      });
      render();
    });
    list.append(li);
  });

  const children = [];
  if (favEditing) children.push(favoriteForm(favEditing === 'new' ? null : items.find((x) => x.id === favEditing)));
  children.push(section(`즐겨찾기 (${items.length})`,
    note('Chrome 북마크와 별도로 이 확장 프로그램에만 저장됩니다. 항목을 끌어 순서를 바꿀 수 있습니다.'),
    items.length ? list : h('p', { class: 'vt-empty' }, '아직 즐겨찾기가 없습니다.'),
    h('div', { class: 'vt-actions' }, favEditing ? null : button('+ 즐겨찾기 추가', () => { favEditing = 'new'; render(); }, 'is-primary'))));
  return children;
}

function favoriteForm(item) {
  const key = item ? item.id : 'new';
  if (!favDraft || favDraft.key !== key) {
    favDraft = { key, data: item ? JSON.parse(JSON.stringify(item)) : { id: newId(), title: '', url: '', hidden: false, icon: { type: 'auto', value: '', color: '#5b6b8c' } } };
  }
  const draft = favDraft.data;
  const status = h('p', { class: 'vt-status', 'aria-live': 'polite' });
  const title = h('input', { type: 'text', class: 'vt-input', value: draft.title, maxlength: '100', placeholder: '예: 네이버', 'aria-label': '이름' });
  const url = h('input', { type: 'text', class: 'vt-input', value: draft.url, placeholder: '예: naver.com', 'aria-label': 'URL', inputmode: 'url', spellcheck: 'false' });
  const iconValue = h('input', { type: 'text', class: 'vt-input is-short', value: draft.icon.value && draft.icon.type !== 'image' ? draft.icon.value : '', maxlength: '4', 'aria-label': '아이콘 글자' });
  const iconColor = h('input', { type: 'color', class: 'vt-color', value: draft.icon.color || '#5b6b8c', 'aria-label': '아이콘 배경색' });
  const iconFile = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp', hidden: true });
  const previewBox = h('div', { class: 'vt-fav-preview' });
  const extra = h('div', { class: 'vt-row-ctl' });

  const refresh = () => {
    previewBox.textContent = '';
    const u = normalizeUrl(url.value) || 'https://example.com';
    previewBox.append(buildIcon({ ...draft, title: title.value, url: u }, 40));
    extra.textContent = '';
    if (draft.icon.type === 'letter') extra.append(iconValue, iconColor);
    else if (draft.icon.type === 'emoji') extra.append(iconValue);
    else if (draft.icon.type === 'image') extra.append(button(draft.icon.value ? '이미지 바꾸기' : '이미지 선택', () => iconFile.click()));
  };
  const typeSel = select(draft.icon.type, [['auto', '자동 (사이트 아이콘)'], ['letter', '글자'], ['emoji', '이모지'], ['image', '이미지']], (v) => {
    draft.icon.type = v;
    if (v !== 'image' && draft.icon.value?.startsWith('data:')) draft.icon.value = '';
    refresh();
  }, '아이콘 종류');
  iconValue.addEventListener('input', () => { draft.icon.value = iconValue.value; refresh(); });
  iconColor.addEventListener('input', () => { draft.icon.color = iconColor.value; refresh(); });
  url.addEventListener('input', () => { draft.url = url.value; });
  url.addEventListener('change', refresh);
  title.addEventListener('input', () => { draft.title = title.value; refresh(); });
  iconFile.addEventListener('change', async () => {
    const f = iconFile.files[0];
    iconFile.value = '';
    if (!f) return;
    try { draft.icon.value = await imageToIconDataUrl(f); refresh(); status.textContent = ''; }
    catch (err) { status.textContent = err.message; status.dataset.kind = 'error'; }
  });

  const save = () => {
    const u = normalizeUrl(url.value);
    if (!u) { status.textContent = '올바른 웹 주소(http/https)를 입력해 주세요.'; status.dataset.kind = 'error'; url.focus(); return; }
    if (draft.icon.type === 'image' && !draft.icon.value) { status.textContent = '아이콘 이미지를 선택해 주세요.'; status.dataset.kind = 'error'; return; }
    const next = { ...draft, title: title.value.trim().slice(0, 100), url: u };
    quiet(() => store.mutate('favorites', (f) => {
      const i = f.items.findIndex((x) => x.id === next.id);
      if (i >= 0) f.items[i] = next; else f.items.push(next);
    }));
    favEditing = null;
    favDraft = null;
    render();
  };
  [title, url].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); }));
  refresh();
  if (!favDraft.focused) { favDraft.focused = true; setTimeout(() => (item ? title : url).focus(), 0); }

  return section(item ? '즐겨찾기 편집' : '즐겨찾기 추가',
    h('div', { class: 'vt-fav-form' }, previewBox,
      h('div', { class: 'vt-fav-fields' }, row('이름', title), row('URL', url))),
    row('아이콘', typeSel), h('div', { class: 'vt-row' }, h('span', { class: 'vt-row-label' }), extra), iconFile, status,
    h('div', { class: 'vt-actions' }, button('저장', save, 'is-primary'), button('취소', () => { favEditing = null; favDraft = null; render(); })));
}

/* ------------------------------------------------------------------ 탭: 프리셋 */
function tabPresets() {
  const P = store.presets;
  const modified = presets.isModified();
  const status = h('p', { class: 'vt-status', 'aria-live': 'polite' });
  const nameInput = h('input', { type: 'text', class: 'vt-input', placeholder: '새 프리셋 이름', maxlength: '40', 'aria-label': '새 프리셋 이름' });
  const create = () => { quiet(() => presets.create(nameInput.value)); render(); };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });

  const list = h('ul', { class: 'vt-preset-list' }, P.items.map((p) => {
    const active = P.activeId === p.id;
    const isDefault = P.defaultId === p.id;
    const nameEl = h('strong', { class: 'vt-preset-name' }, p.name);
    const rename = () => {
      const input = h('input', { type: 'text', class: 'vt-input', value: p.name, maxlength: '40', 'aria-label': '프리셋 이름' });
      const done = (ok) => { if (ok) quiet(() => presets.rename(p.id, input.value)); render(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
      input.addEventListener('blur', () => done(true), { once: true });
      nameEl.replaceWith(input);
      input.focus();
      input.select();
    };
    return h('li', { class: 'vt-preset' + (active ? ' is-active' : '') },
      h('div', { class: 'vt-preset-head' }, nameEl,
        p.builtin ? h('span', { class: 'vt-badge' }, '기본 제공') : null,
        isDefault ? h('span', { class: 'vt-badge is-accent' }, '기본') : null,
        active ? h('span', { class: 'vt-badge is-ok' }, modified ? '적용 중 · 수정됨' : '적용 중') : null),
      h('div', { class: 'vt-preset-actions' },
        button('적용', () => { presets.apply(p.id); render(); }, 'is-small is-primary'),
        p.builtin ? null : button('덮어쓰기', () => { quiet(() => presets.overwrite(p.id)); render(); }, 'is-small'),
        p.builtin ? null : button('이름 변경', rename, 'is-small'),
        button('복제', () => { quiet(() => presets.duplicate(p.id)); render(); }, 'is-small'),
        isDefault ? null : button('기본으로', () => { quiet(() => presets.setDefault(p.id)); render(); }, 'is-small'),
        p.builtin ? null : confirmButton('삭제', '확인', () => { quiet(() => presets.remove(p.id)); render(); }, 'is-small')));
  }));

  const importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  importInput.addEventListener('change', async () => {
    const f = importInput.files[0];
    importInput.value = '';
    if (!f) return;
    try {
      if (f.size > 1024 * 1024) throw new Error('파일이 너무 큽니다.');
      const { merged, count } = importPresets(store.presets, await f.text());
      quiet(() => store.replace('presets', merged));
      render();
      setTimeout(() => { const st = body.querySelector('.vt-status'); if (st) { st.textContent = `프리셋 ${count}개를 가져왔습니다.`; st.dataset.kind = 'ok'; } });
    } catch (err) {
      status.textContent = `가져오기 실패: ${err.message}`;
      status.dataset.kind = 'error';
    }
  });
  const exportJson = () => {
    const blob = new Blob([exportPresets(store.presets)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'velvet-tab-presets.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return [
    section('현재 설정 저장',
      note('표시 여부·위치·크기·정렬·글래스 디자인·글자 설정이 저장됩니다. 배경화면과 즐겨찾기 목록은 포함되지 않습니다.'),
      h('div', { class: 'vt-inline' }, nameInput, button('저장', create, 'is-primary')), status),
    section('프리셋', list,
      h('div', { class: 'vt-actions' },
        confirmButton('기본 프리셋으로 되돌리기', '한 번 더 누르면 적용', () => { presets.applyDefault(); render(); }),
        button('JSON 내보내기', exportJson), button('JSON 가져오기', () => importInput.click()), importInput))
  ];
}

/* ------------------------------------------------------------------ 패널 골격 */
const RENDERERS = { elements: tabElements, layout: tabLayout, design: tabDesign, background: tabBackground, favorites: tabFavorites, presets: tabPresets };

function render() {
  if (!panel) return;
  const scroll = body.scrollTop;
  const focusedLabel = document.activeElement && body.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
  body.textContent = '';
  body.append(...RENDERERS[current]());
  body.scrollTop = scroll;
  if (focusedLabel) body.querySelector(`[aria-label="${CSS.escape(focusedLabel)}"]`)?.focus({ preventScroll: true });
}

function switchTab(tab) {
  if (!RENDERERS[tab]) return;
  if (current === 'background' && tab !== 'background' && pendingBg) { pendingBg = null; api.restoreBackground(); }
  current = tab;
  for (const [k, b] of Object.entries(tabButtons)) {
    b.setAttribute('aria-selected', String(k === tab));
    b.tabIndex = k === tab ? 0 : -1;
  }
  body.scrollTop = 0;
  render();
}

function build() {
  if (!document.getElementById('vt-settings-css')) {
    document.head.append(h('link', { id: 'vt-settings-css', rel: 'stylesheet', href: 'css/settings.css' }));
  }
  tabButtons = {};
  const tablist = h('div', { class: 'vt-tabs', role: 'tablist', 'aria-label': '설정 분류' }, TABS.map(([k, l]) => {
    const b = h('button', { type: 'button', role: 'tab', class: 'vt-tab', id: `vt-tab-${k}`, 'aria-controls': 'vt-panel-body', onclick: () => switchTab(k) }, l);
    tabButtons[k] = b;
    return b;
  }));
  tablist.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const keys = TABS.map(([k]) => k);
    const i = keys.indexOf(current) + (e.key === 'ArrowRight' ? 1 : -1);
    const next = keys[(i + keys.length) % keys.length];
    switchTab(next);
    tabButtons[next].focus();
  });
  body = h('div', { class: 'vt-panel-body', id: 'vt-panel-body', role: 'tabpanel' });
  panel = h('aside', { class: 'vt-panel', role: 'dialog', 'aria-label': '설정', hidden: true },
    h('header', { class: 'vt-panel-head' },
      h('h2', {}, '설정'),
      h('button', { type: 'button', class: 'vt-icon-btn', 'aria-label': '설정 닫기', title: '닫기 (Esc)', onclick: () => close() }, '✕')),
    tablist, body);
  document.body.append(panel);
}

export function isOpen() { return isOpenFlag; }

export function open(newApi, btn, tab) {
  api = newApi;
  store = api.store;
  presets ??= createPresetManager(store);
  anchor = btn;
  if (!panel) build();
  if (tab) current = tab;
  if (isOpenFlag) { switchTab(current); return; }
  isOpenFlag = true;
  unsubscribe = store.subscribe(() => { if (!muted && isOpenFlag) render(); });
  ac = new AbortController();
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpenFlag && !api.isEditing()) { e.preventDefault(); close(); }
  }, { signal: ac.signal });
  document.addEventListener('pointerdown', (e) => {
    if (!store.settings.general.closePanelOnOutsideClick) return;
    if (panel.contains(e.target) || anchor.contains(e.target) || e.target.closest('.vt-menu, .vt-bookmarks')) return;
    close();
  }, { signal: ac.signal });
  panel.hidden = false;
  document.body.classList.add('vt-panel-open');
  anchor.setAttribute('aria-expanded', 'true');
  switchTab(current);
  requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('is-open')));
  tabButtons[current].focus({ preventScroll: true });
}

export function close({ restoreFocus = true } = {}) {
  if (!isOpenFlag) return;
  isOpenFlag = false;
  if (pendingBg) { pendingBg = null; api.restoreBackground(); }
  favEditing = null;
  favDraft = null;
  setPreview(null);
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (ac) { ac.abort(); ac = null; }
  panel.classList.remove('is-open');
  document.body.classList.remove('vt-panel-open');
  anchor.setAttribute('aria-expanded', 'false');
  const p = panel;
  const done = () => { if (!isOpenFlag) { p.hidden = true; body.textContent = ''; } };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else p.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 400);
  store.flush();
  if (restoreFocus) anchor.focus({ preventScroll: true });
}

export function destroy() {
  if (unsubscribe) unsubscribe();
  if (ac) ac.abort();
  setPreview(null);
  isOpenFlag = false;
}
