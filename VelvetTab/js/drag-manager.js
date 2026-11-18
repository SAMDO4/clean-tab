// 편집 모드 자유 드래그
// - 편집 모드일 때만 동작 → 평소에는 실수로 움직이지 않음
// - 드래그 중에는 transform 만 바꾸고 저장하지 않음, 놓을 때 한 번만 저장
// - 화면 밖 이탈 방지, 중앙선 스냅/가이드, 좌표 표시, 겹침 표시
import { clampToArea, toNormalized, rectsOverlap } from './layout-manager.js';

const SNAP = 8;

/**
 * @param {{
 *   stage: HTMLElement,
 *   getArea: () => {x:number,y:number,w:number,h:number},
 *   getItems: () => Array<{key:string, el:HTMLElement, align:string}>,
 *   getPos: (key:string) => {left:number, top:number},
 *   setPos: (key:string, left:number, top:number) => void,
 *   onCommit: (key:string, pos:{x:number,y:number}) => void
 * }} o
 */
export function createDragManager(o) {
  const guideV = document.createElement('div');
  guideV.className = 'vt-guide vt-guide-v';
  const guideH = document.createElement('div');
  guideH.className = 'vt-guide vt-guide-h';
  const badge = document.createElement('div');
  badge.className = 'vt-drag-badge';
  [guideV, guideH, badge].forEach((n) => { n.hidden = true; o.stage.appendChild(n); });

  let enabled = false;
  let drag = null;
  let raf = 0;
  let ac = null;

  function rectOf(item) {
    const p = o.getPos(item.key);
    return { left: p.left, top: p.top, width: item.el.offsetWidth, height: item.el.offsetHeight };
  }

  function markOverlaps() {
    const items = o.getItems().filter((i) => !i.el.hidden);
    const rects = items.map(rectOf);
    items.forEach((it, i) => {
      const hit = rects.some((r, j) => j !== i && rectsOverlap(rects[i], r));
      it.el.classList.toggle('is-overlap', enabled && hit);
    });
  }

  function onDown(e) {
    if (!enabled || e.button !== 0) return;
    const el = e.target.closest('.vt-movable');
    if (!el) return;
    const item = o.getItems().find((i) => i.el === el);
    if (!item) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const p = o.getPos(item.key);
    drag = { item, id: e.pointerId, sx: e.clientX, sy: e.clientY, left: p.left, top: p.top, cur: { ...p }, moved: false };
    el.classList.add('is-dragging');
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.ev = e;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    if (!drag || !drag.ev) return;
    const e = drag.ev;
    const area = o.getArea();
    const w = drag.item.el.offsetWidth;
    const h = drag.item.el.offsetHeight;
    let { left, top } = clampToArea(drag.left + e.clientX - drag.sx, drag.top + e.clientY - drag.sy, w, h, area);
    // 화면 중앙 스냅
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const snapX = Math.abs(left + w / 2 - cx) < SNAP;
    const snapY = Math.abs(top + h / 2 - cy) < SNAP;
    if (snapX) left = cx - w / 2;
    if (snapY) top = cy - h / 2;
    guideV.hidden = !snapX;
    guideH.hidden = !snapY;
    guideV.style.transform = `translateX(${Math.round(cx)}px)`;
    guideH.style.transform = `translateY(${Math.round(cy)}px)`;
    drag.cur = { left: Math.round(left), top: Math.round(top) };
    drag.moved = drag.moved || Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 2;
    o.setPos(drag.item.key, drag.cur.left, drag.cur.top);
    const n = toNormalized(drag.cur.left, drag.cur.top, w, h, area, drag.item.align);
    badge.hidden = false;
    badge.textContent = `X ${Math.round(n.x * 100)}% · Y ${Math.round(n.y * 100)}%`;
    badge.style.transform = `translate(${Math.round(e.clientX + 14)}px, ${Math.round(e.clientY + 16)}px)`;
    markOverlaps();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    cancelAnimationFrame(raf);
    raf = 0;
    if (drag.ev) frame();
    const { item, cur, moved } = drag;
    item.el.classList.remove('is-dragging');
    try { item.el.releasePointerCapture(e.pointerId); } catch { /* 이미 해제됨 */ }
    drag = null;
    guideV.hidden = guideH.hidden = badge.hidden = true;
    if (moved) {
      const area = o.getArea();
      o.onCommit(item.key, toNormalized(cur.left, cur.top, item.el.offsetWidth, item.el.offsetHeight, area, item.align));
    }
  }

  function onClickCapture(e) {
    // 편집 중에는 링크가 열리지 않도록
    if (enabled && e.target.closest('.vt-movable')) { e.preventDefault(); e.stopPropagation(); }
  }

  return {
    get enabled() { return enabled; },
    enable() {
      if (enabled) return;
      enabled = true;
      ac = new AbortController();
      const s = { signal: ac.signal };
      o.stage.addEventListener('pointerdown', onDown, s);
      o.stage.addEventListener('pointermove', onMove, s);
      o.stage.addEventListener('pointerup', onUp, s);
      o.stage.addEventListener('pointercancel', onUp, s);
      o.stage.addEventListener('click', onClickCapture, { capture: true, signal: ac.signal });
      o.stage.addEventListener('dragstart', (e) => e.preventDefault(), s);
      markOverlaps();
    },
    disable() {
      if (!enabled) return;
      enabled = false;
      if (ac) { ac.abort(); ac = null; }
      cancelAnimationFrame(raf);
      raf = 0;
      if (drag) drag.item.el.classList.remove('is-dragging');
      drag = null;
      guideV.hidden = guideH.hidden = badge.hidden = true;
      markOverlaps();
    },
    refresh: markOverlaps
  };
}
