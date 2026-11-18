// 새 탭 내부 북마크바 (확장 프로그램 UI — Chrome 실제 툴바가 아님)
// - chrome.bookmarks 를 '읽기 전용'으로 사용: create/update/remove/move 를 호출하지 않는다.
// - 북마크 변경 이벤트를 받아 디바운스 후 다시 그린다(중복 렌더링 방지).
import { faviconUrl } from './favorites-manager.js';

const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  folder: 'M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z',
  globe: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17Zm-8.5 8.5h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5S9.6 5.8 12 3.5Z',
  chevron: 'M7 6l5 6-5 6M13 6l5 6-5 6',
  arrow: 'M9 6l6 6-6 6'
};

function svg(name, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', cls);
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[name]);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.6');
  p.setAttribute('stroke-linejoin', 'round');
  p.setAttribute('stroke-linecap', 'round');
  s.appendChild(p);
  return s;
}

/** URL 분류: 일반 링크 / 브라우저 내부 / 북마크릿 / 잘못된 URL */
export function classifyUrl(url) {
  if (typeof url !== 'string' || !url) return 'invalid';
  let u;
  try { u = new URL(url); } catch { return 'invalid'; }
  if (u.protocol === 'http:' || u.protocol === 'https:') return 'web';
  if (u.protocol === 'javascript:') return 'bookmarklet';
  if (['chrome:', 'chrome-extension:', 'file:', 'about:', 'view-source:', 'edge:', 'ftp:'].includes(u.protocol)) return 'internal';
  if (u.protocol === 'data:') return 'invalid';
  return 'internal';
}

export function findRoots(tree) {
  const root = Array.isArray(tree) ? tree[0] : tree;
  const kids = (root && root.children) || [];
  const bar = kids.find((n) => n.folderType === 'bookmarks-bar') || kids.find((n) => n.id === '1') || kids[0] || null;
  const other = kids.find((n) => n.folderType === 'other') || kids.find((n) => n.id === '2') || null;
  return { bar, other };
}

function iconImg(url, size) {
  const img = document.createElement('img');
  img.className = 'vt-bm-icon';
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  img.width = img.height = size;
  img.src = faviconUrl(url, size > 16 ? 32 : 16);
  img.addEventListener('error', () => img.replaceWith(svg('globe', 'vt-bm-icon is-fallback')), { once: true });
  return img;
}

/**
 * @param {HTMLElement} root
 * @param {{onLayout?: () => void}} hooks
 */
export function createBookmarkBar(root, hooks = {}) {
  const itemsEl = document.createElement('div');
  itemsEl.className = 'vt-bm-items';
  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = 'vt-bm-item vt-bm-chevron';
  chevron.title = '더보기';
  chevron.setAttribute('aria-label', '숨겨진 북마크 더보기');
  chevron.appendChild(svg('chevron', 'vt-bm-icon'));
  chevron.hidden = true;
  const otherBtn = document.createElement('button');
  otherBtn.type = 'button';
  otherBtn.className = 'vt-bm-item vt-bm-folder vt-bm-other';
  otherBtn.hidden = true;
  root.textContent = '';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', '북마크바');
  root.append(itemsEl, chevron, otherBtn);

  let nodes = { bar: null, other: null };
  const byId = new Map();
  let opts = { mode: 'icon-text', iconSize: 16, showOther: true };
  let overflowFrom = -1;
  let menus = []; // 열린 메뉴 스택 [{el, ownerId}]
  let hoverTimer = 0;
  let reloadTimer = 0;
  let importing = false;
  let loaded = false;
  const ac = new AbortController();
  const sig = { signal: ac.signal };

  /* ---------------- 데이터 */
  async function load() {
    if (typeof chrome === 'undefined' || !chrome.bookmarks) {
      renderEmpty('북마크 권한을 사용할 수 없습니다.');
      return;
    }
    try {
      const tree = await chrome.bookmarks.getTree();
      nodes = findRoots(tree);
      byId.clear();
      const index = (n) => { byId.set(n.id, n); (n.children || []).forEach(index); };
      if (nodes.bar) index(nodes.bar);
      if (nodes.other) index(nodes.other);
      loaded = true;
      render();
    } catch (err) {
      console.warn('[VelvetTab] 북마크를 읽지 못했습니다.', err);
      renderEmpty('북마크를 불러오지 못했습니다.');
    }
  }

  function scheduleReload() {
    if (importing) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 120);
  }

  /* ---------------- 렌더링 */
  function entry(node, inMenu) {
    const isFolder = !node.url;
    const name = node.title || '';
    if (isFolder) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vt-bm-item vt-bm-folder';
      b.dataset.id = node.id;
      b.title = name || '(이름 없는 폴더)';
      b.setAttribute('aria-haspopup', 'menu');
      if (inMenu || opts.mode !== 'text') b.appendChild(svg('folder', 'vt-bm-icon'));
      if (inMenu || opts.mode !== 'icon' || !name) {
        const l = document.createElement('span');
        l.className = 'vt-bm-label';
        l.textContent = name || '(이름 없음)';
        b.appendChild(l);
      }
      if (inMenu) b.appendChild(svg('arrow', 'vt-bm-sub'));
      return b;
    }
    const kind = classifyUrl(node.url);
    const label = name || (inMenu ? node.url : '');
    const el = document.createElement(kind === 'web' || kind === 'internal' ? 'a' : 'span');
    el.className = 'vt-bm-item vt-bm-link';
    el.dataset.id = node.id;
    if (el.tagName === 'A') {
      el.href = node.url;
      el.draggable = false;
      if (kind === 'internal') el.dataset.internal = '1';
      el.title = name ? `${name}\n${node.url}` : node.url;
    } else {
      el.classList.add('is-disabled');
      el.setAttribute('aria-disabled', 'true');
      el.title = kind === 'bookmarklet' ? `${name}\n북마크릿(javascript:)은 새 탭 페이지에서 실행할 수 없습니다.` : `${name}\n잘못된 URL입니다.`;
    }
    if (inMenu || opts.mode !== 'text' || !label) {
      el.appendChild(kind === 'web' || kind === 'internal' ? iconImg(node.url, opts.iconSize) : svg('globe', 'vt-bm-icon is-fallback'));
    }
    if (label && (inMenu || opts.mode !== 'icon')) {
      const l = document.createElement('span');
      l.className = 'vt-bm-label';
      l.textContent = label;
      el.appendChild(l);
    }
    return el;
  }

  function renderEmpty(text) {
    closeMenus();
    itemsEl.textContent = '';
    const s = document.createElement('span');
    s.className = 'vt-bm-empty';
    s.textContent = text;
    itemsEl.appendChild(s);
    chevron.hidden = true;
    otherBtn.hidden = true;
  }

  function render() {
    if (!loaded) return;
    closeMenus();
    root.dataset.mode = opts.mode;
    const kids = (nodes.bar && nodes.bar.children) || [];
    if (!kids.length) {
      renderEmpty('북마크바가 비어 있습니다. Chrome에서 북마크를 추가하면 여기에 표시됩니다.');
    } else {
      itemsEl.textContent = '';
      const frag = document.createDocumentFragment();
      kids.forEach((n) => frag.appendChild(entry(n, false)));
      itemsEl.appendChild(frag);
    }
    const otherKids = (nodes.other && nodes.other.children) || [];
    otherBtn.hidden = !(opts.showOther && otherKids.length);
    if (!otherBtn.hidden) {
      otherBtn.textContent = '';
      otherBtn.dataset.id = nodes.other.id;
      otherBtn.title = '모든 북마크';
      otherBtn.appendChild(svg('folder', 'vt-bm-icon'));
      if (opts.mode !== 'icon') {
        const l = document.createElement('span');
        l.className = 'vt-bm-label';
        l.textContent = '모든 북마크';
        otherBtn.appendChild(l);
      }
    }
    layoutOverflow();
  }

  /** 가로 공간을 넘는 항목은 숨기고 » 메뉴로 이동 */
  function layoutOverflow() {
    const children = [...itemsEl.children].filter((c) => c.classList.contains('vt-bm-item'));
    children.forEach((c) => c.classList.remove('is-overflow'));
    chevron.hidden = true;
    overflowFrom = -1;
    if (!children.length) { hooks.onLayout && hooks.onLayout(); return; }
    const cs = getComputedStyle(root);
    const gap = parseFloat(getComputedStyle(itemsEl).columnGap) || 0;
    const inner = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const otherW = otherBtn.hidden ? 0 : otherBtn.getBoundingClientRect().width + 8;
    const widths = children.map((c) => c.getBoundingClientRect().width);
    const total = widths.reduce((s, w) => s + w, 0) + gap * (widths.length - 1);
    let avail = inner - otherW;
    if (total > avail) {
      chevron.hidden = false;
      avail -= chevron.getBoundingClientRect().width + gap;
      let used = 0;
      for (let i = 0; i < widths.length; i++) {
        used += widths[i] + (i ? gap : 0);
        if (used > avail) { overflowFrom = i; break; }
      }
      if (overflowFrom >= 0) children.slice(overflowFrom).forEach((c) => c.classList.add('is-overflow'));
      else chevron.hidden = true;
    }
    hooks.onLayout && hooks.onLayout();
  }

  /* ---------------- 메뉴 */
  function buildMenu(list, level, ownerId) {
    const m = document.createElement('div');
    m.className = 'vt-menu';
    m.setAttribute('role', 'menu');
    m.dataset.level = String(level);
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'vt-menu-empty';
      e.textContent = '(비어 있음)';
      m.appendChild(e);
    }
    for (const n of list) {
      const it = entry(n, true);
      it.classList.add('vt-menu-item');
      it.setAttribute('role', 'menuitem');
      m.appendChild(it);
    }
    m.addEventListener('mouseover', onMenuHover);
    m.addEventListener('click', onMenuClick);
    m.addEventListener('auxclick', onLinkAux);
    m.addEventListener('keydown', onMenuKey);
    document.body.appendChild(m);
    menus.push({ el: m, ownerId, level });
    return m;
  }

  function place(m, rect, level) {
    const vw = innerWidth;
    const vh = innerHeight;
    const w = m.offsetWidth;
    let left;
    let top;
    if (level === 0) {
      left = Math.min(rect.left, vw - w - 6);
      top = rect.bottom + 2;
    } else {
      left = rect.right - 2;
      if (left + w > vw - 6) left = rect.left - w + 2;
      top = rect.top - 5;
    }
    left = Math.max(6, left);
    const maxH = Math.max(120, vh - top - 8);
    m.style.maxHeight = `${maxH}px`;
    if (top + m.offsetHeight > vh - 6) top = Math.max(6, vh - 6 - m.offsetHeight);
    m.style.left = `${Math.round(left)}px`;
    m.style.top = `${Math.round(top)}px`;
  }

  function closeMenus(fromLevel = 0) {
    clearTimeout(hoverTimer);
    while (menus.length && menus[menus.length - 1].level >= fromLevel) {
      const { el } = menus.pop();
      el.remove();
    }
    root.querySelectorAll('.is-open').forEach((b) => b.classList.remove('is-open'));
    menus.forEach(({ ownerId }) => {
      const b = root.querySelector(`[data-id="${CSS.escape(ownerId)}"]`);
      if (b) b.classList.add('is-open');
    });
    document.querySelectorAll('.vt-menu .is-open').forEach((b) => {
      if (!menus.some((mm) => mm.ownerId === b.dataset.id)) b.classList.remove('is-open');
    });
  }

  function openFolder(button, list, level, ownerId) {
    closeMenus(level);
    button.classList.add('is-open');
    const m = buildMenu(list, level, ownerId);
    place(m, button.getBoundingClientRect(), level);
    return m;
  }

  function overflowNodes() {
    const kids = (nodes.bar && nodes.bar.children) || [];
    return overflowFrom >= 0 ? kids.slice(overflowFrom) : [];
  }

  function isOpenOwner(id) { return menus.some((m) => m.level === 0 && m.ownerId === id); }

  function onBarClick(e) {
    const t = e.target.closest('.vt-bm-item');
    if (!t || !root.contains(t)) return;
    if (t === chevron) {
      if (isOpenOwner('__chevron')) closeMenus();
      else openFolder(chevron, overflowNodes(), 0, '__chevron');
      return;
    }
    if (t.classList.contains('vt-bm-folder')) {
      const n = byId.get(t.dataset.id);
      if (!n) return;
      if (isOpenOwner(n.id)) closeMenus();
      else openFolder(t, n.children || [], 0, n.id);
      return;
    }
    handleLink(e, t);
  }

  function onBarHover(e) {
    // 메뉴가 열려 있으면 다른 폴더에 마우스를 올리는 것만으로 전환 (Chrome 과 같은 방식)
    if (!menus.length) return;
    const t = e.target.closest('.vt-bm-folder, .vt-bm-chevron');
    if (!t || !root.contains(t)) return;
    const id = t === chevron ? '__chevron' : t.dataset.id;
    if (isOpenOwner(id)) return;
    if (t === chevron) openFolder(chevron, overflowNodes(), 0, '__chevron');
    else { const n = byId.get(id); if (n) openFolder(t, n.children || [], 0, id); }
  }

  function levelOf(el) { return Number(el.closest('.vt-menu').dataset.level); }

  function onMenuHover(e) {
    const t = e.target.closest('.vt-menu-item');
    if (!t) return;
    const level = levelOf(t);
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (t.classList.contains('vt-bm-folder')) {
        if (menus.some((m) => m.ownerId === t.dataset.id)) return;
        const n = byId.get(t.dataset.id);
        if (n) openFolder(t, n.children || [], level + 1, n.id);
      } else {
        closeMenus(level + 1);
      }
    }, 220);
  }

  function onMenuClick(e) {
    const t = e.target.closest('.vt-menu-item');
    if (!t) return;
    if (t.classList.contains('vt-bm-folder')) {
      const n = byId.get(t.dataset.id);
      if (n) openFolder(t, n.children || [], levelOf(t) + 1, n.id);
      return;
    }
    if (handleLink(e, t)) closeMenus();
  }

  function onMenuKey(e) {
    const items = [...e.currentTarget.querySelectorAll('.vt-menu-item:not(.is-disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('vt-bm-folder')) {
      e.preventDefault();
      document.activeElement.click();
      menus[menus.length - 1]?.el.querySelector('.vt-menu-item')?.focus();
    } else if (e.key === 'ArrowLeft' && levelOf(e.currentTarget) > 0) {
      e.preventDefault();
      const owner = menus[menus.length - 1].ownerId;
      closeMenus(levelOf(e.currentTarget));
      document.querySelector(`.vt-menu [data-id="${CSS.escape(owner)}"]`)?.focus();
    }
  }

  /** 링크 열기. 처리했으면 true */
  function handleLink(e, el) {
    if (el.classList.contains('is-disabled')) { e.preventDefault(); return false; }
    if (el.tagName !== 'A') return false;
    if (el.dataset.internal) {
      // chrome:// 등 내부 페이지는 링크로 열 수 없어 tabs API 사용 (tabs 권한 불필요)
      e.preventDefault();
      openInternal(el.href, e);
    }
    return true; // 일반 링크는 브라우저 기본 동작(Ctrl/가운데 클릭 = 새 탭 포함)
  }

  function onLinkAux(e) {
    if (e.button !== 1) return;
    const el = e.target.closest('a.vt-bm-link[data-internal]');
    if (el) { e.preventDefault(); openInternal(el.href, { ctrlKey: true }); }
  }

  function openInternal(url, e) {
    try {
      if (e.shiftKey) chrome.windows.create({ url });
      else if (e.ctrlKey || e.metaKey) chrome.tabs.create({ url, active: false });
      else chrome.tabs.update({ url });
    } catch (err) {
      console.warn('[VelvetTab] 페이지를 열 수 없습니다.', err);
    }
  }

  function onDocPointer(e) {
    if (!menus.length) return;
    if (e.target.closest('.vt-menu') || root.contains(e.target)) return;
    closeMenus();
  }
  function onKey(e) {
    if (e.key === 'Escape' && menus.length) { e.stopPropagation(); closeMenus(); }
  }

  root.addEventListener('click', onBarClick, sig);
  root.addEventListener('auxclick', onLinkAux, sig);
  root.addEventListener('mouseover', onBarHover, sig);
  document.addEventListener('pointerdown', onDocPointer, { capture: true, signal: ac.signal });
  document.addEventListener('keydown', onKey, { capture: true, signal: ac.signal });
  window.addEventListener('blur', () => closeMenus(), sig);
  window.addEventListener('resize', () => closeMenus(), sig);

  let rafId = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(layoutOverflow);
  });
  ro.observe(root);

  const ev = typeof chrome !== 'undefined' && chrome.bookmarks ? chrome.bookmarks : null;
  const onImportBegan = () => { importing = true; };
  const onImportEnded = () => { importing = false; scheduleReload(); };
  const evNames = ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered'];
  if (ev) {
    evNames.forEach((n) => ev[n] && ev[n].addListener(scheduleReload));
    ev.onImportBegan && ev.onImportBegan.addListener(onImportBegan);
    ev.onImportEnded && ev.onImportEnded.addListener(onImportEnded);
  }

  return {
    load,
    setOptions(o) {
      const structural = o.mode !== opts.mode || o.iconSize !== opts.iconSize || o.showOther !== opts.showOther;
      opts = { ...o };
      if (structural) render();
      else layoutOverflow();
    },
    relayout: layoutOverflow,
    closeMenus,
    destroy() {
      ac.abort();
      ro.disconnect();
      clearTimeout(reloadTimer);
      closeMenus();
      if (ev) {
        evNames.forEach((n) => ev[n] && ev[n].removeListener(scheduleReload));
        ev.onImportBegan && ev.onImportBegan.removeListener(onImportBegan);
        ev.onImportEnded && ev.onImportEnded.removeListener(onImportEnded);
      }
    }
  };
}
