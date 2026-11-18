// 배치 계산 (순수 함수) + DOM 적용
// 위치는 정규화 좌표(0~1)로 저장 → 해상도가 바뀌어도 상대 배치 유지

export const STACK_GAP = 4;

export function metrics(area) {
  return {
    side: Math.min(40, Math.max(16, area.w * 0.025)),
    top: Math.min(150, Math.max(24, area.h * 0.11)),
    bottom: Math.min(72, Math.max(20, area.h * 0.06))
  };
}

const clamp = (v, min, max) => (max < min ? min : Math.min(max, Math.max(min, v)));

function alignOffset(align, groupW, w) {
  if (align === 'left') return 0;
  if (align === 'right') return groupW - w;
  return (groupW - w) / 2;
}

/** 자유 배치의 기준점: 정렬에 따라 좌측/중앙/우측 끝 */
function anchorShift(align, w) {
  if (align === 'left') return 0;
  if (align === 'right') return w;
  return w / 2;
}

/**
 * @param {{x:number,y:number,w:number,h:number}} area 배치 가능 영역
 * @param {Array<{key:string,w:number,h:number,align?:string,position:{mode:string,preset:string,x:number,y:number}}>} items 표시 순서대로
 * @returns {Record<string,{left:number,top:number}>}
 */
export function computeLayout(area, items) {
  const m = metrics(area);
  const out = {};
  const groups = new Map();
  for (const it of items) {
    if (it.position.mode === 'free') {
      const left = area.x + it.position.x * area.w - anchorShift(it.align, it.w);
      const top = area.y + it.position.y * area.h - it.h / 2;
      out[it.key] = { left, top };
    } else {
      const p = it.position.preset;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(it);
    }
  }
  for (const [preset, list] of groups) {
    const [v, hz] = preset === 'center' ? ['middle', 'center'] : preset.split('-');
    const groupW = Math.max(...list.map((i) => i.w));
    const groupH = list.reduce((s, i) => s + i.h, 0) + STACK_GAP * (list.length - 1);
    let gx;
    if (hz === 'left') gx = area.x + m.side;
    else if (hz === 'right') gx = area.x + area.w - m.side - groupW;
    else gx = area.x + (area.w - groupW) / 2;
    let gy;
    if (v === 'top') gy = area.y + m.top;
    else if (v === 'bottom') gy = area.y + area.h - m.bottom - groupH;
    else gy = area.y + (area.h - groupH) / 2;
    let y = gy;
    for (const it of list) {
      const defAlign = hz === 'left' || hz === 'right' ? hz : 'center';
      out[it.key] = { left: gx + alignOffset(it.align || defAlign, groupW, it.w), top: y };
      y += it.h + STACK_GAP;
    }
  }
  // 화면 밖으로 나가지 않도록 제한
  for (const it of items) {
    const p = out[it.key];
    p.left = Math.round(clamp(p.left, area.x, area.x + area.w - it.w));
    p.top = Math.round(clamp(p.top, area.y, area.y + area.h - it.h));
  }
  return out;
}

/** 화면 좌표 → 정규화 좌표 (computeLayout 의 free 모드와 역함수 관계) */
export function toNormalized(left, top, w, h, area, align) {
  const x = (left + anchorShift(align, w) - area.x) / area.w;
  const y = (top + h / 2 - area.y) / area.h;
  return { x: clamp(round4(x), 0, 1), y: clamp(round4(y), 0, 1) };
}

const round4 = (n) => Math.round(n * 10000) / 10000;

export function clampToArea(left, top, w, h, area) {
  return {
    left: clamp(left, area.x, area.x + area.w - w),
    top: clamp(top, area.y, area.y + area.h - h)
  };
}

export function rectsOverlap(a, b) {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}
