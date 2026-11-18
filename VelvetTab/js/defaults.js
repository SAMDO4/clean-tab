// 기본값·스키마 정의 (순수 데이터 — Node 단위 테스트에서도 import 가능)

export const SCHEMA_VERSION = 1;

export const ELEMENT_KEYS = Object.freeze(['clock', 'date', 'favorites', 'bookmarkBar']);
/** 자유 배치 가능한 요소 (북마크바는 Chrome 처럼 최상단 고정) */
export const MOVABLE_KEYS = Object.freeze(['clock', 'date', 'favorites']);
export const ELEMENT_LABELS = Object.freeze({
  clock: '시계', date: '날짜', favorites: '즐겨찾기', bookmarkBar: '북마크바'
});

export const POSITION_PRESETS = Object.freeze([
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right'
]);
export const POSITION_LABELS = Object.freeze({
  'top-left': '상단 좌측', 'top-center': '상단 중앙', 'top-right': '상단 우측',
  'middle-left': '중앙 좌측', center: '중앙', 'middle-right': '중앙 우측',
  'bottom-left': '하단 좌측', 'bottom-center': '하단 중앙', 'bottom-right': '하단 우측'
});

/** 글래스 스타일 속성 정의: 타입·범위 (검증 및 UI 생성에 공통 사용) */
export const STYLE_SCHEMA = Object.freeze({
  bgColor:        { type: 'color', label: '배경 색상' },
  bgOpacity:      { type: 'range', min: 0, max: 100, unit: '%', label: '배경 투명도' },
  blur:           { type: 'range', min: 0, max: 30, unit: 'px', label: '블러 강도' },
  radius:         { type: 'range', min: 0, max: 32, unit: 'px', label: '모서리 둥글기' },
  border:         { type: 'bool', label: '테두리 표시' },
  borderColor:    { type: 'color', label: '테두리 색상' },
  shadow:         { type: 'bool', label: '그림자 표시' },
  shadowStrength: { type: 'range', min: 0, max: 100, unit: '%', label: '그림자 강도' },
  textColor:      { type: 'color', label: '글자 색상' },
  fontSize:       { type: 'range', min: 8, max: 220, unit: 'px', label: '글자 크기', elementOnly: true },
  fontWeight:     { type: 'range', min: 100, max: 900, step: 100, unit: '', label: '글자 굵기' },
  padding:        { type: 'range', min: 0, max: 48, unit: 'px', label: '내부 여백' },
  opacity:        { type: 'range', min: 10, max: 100, unit: '%', label: '요소 투명도' }
});

/** 모든 속성의 최종 대체값 (전역/개별 둘 다 없을 때) */
export const STYLE_FALLBACK = Object.freeze({
  bgColor: '#ffffff', bgOpacity: 16, blur: 16, radius: 18, border: true, borderColor: '#ffffff',
  shadow: true, shadowStrength: 30, textColor: '#ffffff', fontSize: 14, fontWeight: 500, padding: 12, opacity: 100
});

export const DEFAULT_GLOBAL_STYLE = Object.freeze({
  bgColor: '#ffffff', bgOpacity: 16, blur: 16, radius: 18, border: true, borderColor: '#ffffff',
  shadow: true, shadowStrength: 30, textColor: '#ffffff', fontWeight: 500, padding: 12, opacity: 100
});

export const DATE_FORMATS = Object.freeze({
  'ko-long': '2026년 11월 18일 수요일',
  'ko-dots': '2026.11.18 (수)',
  'en-short': 'Wed, Nov 18, 2026',
  'en-long': 'Wednesday, November 18, 2026'
});

export const ALIGNS = Object.freeze(['left', 'center', 'right']);

export function defaultElements() {
  return {
    clock: {
      visible: true,
      position: { mode: 'preset', preset: 'top-center', x: 0.5, y: 0.2 },
      // 처음부터 '개별 설정'으로 들어가 있는 값 (디자인 탭에서 전역으로 되돌릴 수 있음)
      style: { fontSize: 96, fontWeight: 300, bgOpacity: 0, blur: 0, border: false, padding: 4, shadowStrength: 35 },
      options: { hour12: false, showSeconds: false, align: 'center' }
    },
    date: {
      visible: true,
      position: { mode: 'preset', preset: 'top-center', x: 0.5, y: 0.32 },
      style: { fontSize: 20, fontWeight: 500, bgOpacity: 0, blur: 0, border: false, padding: 4, shadowStrength: 35 },
      options: { format: 'ko-long', showWeekday: true, showYear: true, align: 'center' }
    },
    favorites: {
      visible: true,
      position: { mode: 'preset', preset: 'bottom-center', x: 0.5, y: 0.88 },
      style: { fontSize: 12, padding: 12 },
      options: { mode: 'icon-text', iconSize: 44, gap: 16, itemRadius: 14, hover: true, openInNewTab: false }
    },
    bookmarkBar: {
      visible: true,
      style: { bgColor: '#141418', bgOpacity: 30, blur: 18, radius: 0, border: false, shadow: false, fontSize: 12, fontWeight: 400, padding: 6 },
      options: { height: 34, iconSize: 16, gap: 2, mode: 'icon-text', hover: true, hoverStrength: 16, showOther: true }
    }
  };
}

export function defaultSettings() {
  return {
    elements: defaultElements(),
    globalStyle: { ...DEFAULT_GLOBAL_STYLE },
    background: { fit: 'cover', posX: 50, posY: 50, dim: 0 },
    general: { closePanelOnOutsideClick: true, settingsButtonAutoHide: true }
  };
}

export function defaultFavorites() {
  return { items: [] };
}

/** 프리셋에 포함되는 부분만 추출 (배경화면·즐겨찾기 목록·일반 설정 제외) */
export function presetSnapshot(settings) {
  return JSON.parse(JSON.stringify({ elements: settings.elements, globalStyle: settings.globalStyle }));
}

function builtinPresets() {
  const glass = presetSnapshot(defaultSettings());

  const minimal = presetSnapshot(defaultSettings());
  Object.assign(minimal.globalStyle, { bgOpacity: 0, blur: 0, border: false, shadowStrength: 25 });
  minimal.elements.clock.style.fontWeight = 200;
  minimal.elements.favorites.options.mode = 'icon';
  minimal.elements.favorites.style = { fontSize: 12, padding: 6, bgOpacity: 0, blur: 0 };
  minimal.elements.bookmarkBar.style.bgOpacity = 0;
  minimal.elements.bookmarkBar.style.blur = 0;

  const dark = presetSnapshot(defaultSettings());
  Object.assign(dark.globalStyle, { bgColor: '#0b0b0f', bgOpacity: 48, blur: 20, borderColor: '#ffffff', textColor: '#f4f4f5', shadowStrength: 45 });
  dark.elements.clock.style = { ...dark.elements.clock.style, bgOpacity: 40, blur: 20, border: true, padding: 20, radius: 28, fontSize: 88 };
  dark.elements.bookmarkBar.style.bgOpacity = 60;

  const now = 0;
  return [
    { id: 'builtin-minimal', name: 'Minimal', builtin: true, data: minimal, createdAt: now, updatedAt: now },
    { id: 'builtin-glass', name: 'Glass', builtin: true, data: glass, createdAt: now, updatedAt: now },
    { id: 'builtin-dark', name: 'Dark', builtin: true, data: dark, createdAt: now, updatedAt: now },
    { id: 'custom', name: 'Custom', builtin: false, data: presetSnapshot(defaultSettings()), createdAt: now, updatedAt: now }
  ];
}

export function defaultPresets() {
  return { items: builtinPresets(), defaultId: 'builtin-glass', activeId: 'builtin-glass' };
}
