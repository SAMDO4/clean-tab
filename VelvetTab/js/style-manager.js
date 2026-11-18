// 글래스모피즘 스타일 계산·적용
// 우선순위: 개별 설정(element.style) > 전역 설정(globalStyle) > 대체값(STYLE_FALLBACK)
import { STYLE_FALLBACK } from './defaults.js';

export function effectiveStyle(settings, key) {
  const el = settings.elements[key];
  return { ...STYLE_FALLBACK, ...settings.globalStyle, ...(el ? el.style : {}) };
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 스타일 객체 → CSS 사용자 정의 속성 */
export function styleVars(s) {
  const [r, g, b] = hexToRgb(s.bgColor);
  const [br, bg, bb] = hexToRgb(s.borderColor);
  const k = s.shadowStrength / 100;
  const hasBox = s.bgOpacity > 0;
  return {
    '--vt-bg': `rgba(${r}, ${g}, ${b}, ${(s.bgOpacity / 100).toFixed(3)})`,
    '--vt-blur': s.blur > 0 ? `blur(${s.blur}px) saturate(140%)` : 'none',
    '--vt-radius': `${s.radius}px`,
    '--vt-border-color': s.border ? `rgba(${br}, ${bg}, ${bb}, 0.28)` : 'transparent',
    '--vt-shadow': s.shadow && hasBox
      ? `0 ${Math.round(4 + k * 20)}px ${Math.round(12 + k * 48)}px rgba(0, 0, 0, ${(0.06 + k * 0.42).toFixed(3)})`
      : 'none',
    // 배경이 없는 요소(기본 시계/날짜)는 상자 그림자 대신 글자 그림자로 가독성 확보
    '--vt-text-shadow': s.shadow && !hasBox && k > 0
      ? `0 1px ${Math.round(2 + k * 16)}px rgba(0, 0, 0, ${(0.12 + k * 0.55).toFixed(3)})`
      : 'none',
    '--vt-color': s.textColor,
    '--vt-font-size': `${s.fontSize}px`,
    '--vt-weight': String(s.fontWeight),
    '--vt-pad': `${s.padding}px`,
    '--vt-opacity': String(s.opacity / 100)
  };
}

const lastApplied = new WeakMap();

/** 바뀐 변수만 DOM 에 반영 */
export function applyStyle(el, settings, key) {
  const vars = styleVars(effectiveStyle(settings, key));
  const prev = lastApplied.get(el) || {};
  for (const [name, value] of Object.entries(vars)) {
    if (prev[name] !== value) el.style.setProperty(name, value);
  }
  lastApplied.set(el, vars);
}
