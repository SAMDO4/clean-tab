// 자체 즐겨찾기 (Chrome 북마크와 별개, chrome.storage.local 의 vt.favorites 에 저장)
import { sniffType } from './background-manager.js';

export function faviconUrl(pageUrl, size = 32) {
  const base = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL ? chrome.runtime.getURL('/_favicon/') : '/_favicon/';
  return `${base}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
}

export function letterFor(item) {
  const src = (item.title || '').trim() || hostOf(item.url);
  return ([...src.replace(/^www\./, '')][0] || '?').toUpperCase();
}

export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** 아이콘 요소 생성 (자동 파비콘 → 실패 시 글자 아이콘) */
export function buildIcon(item, size) {
  const box = document.createElement('span');
  box.className = 'vt-fav-icon';
  const icon = item.icon || { type: 'auto' };
  const letter = () => {
    box.textContent = icon.type === 'letter' && icon.value ? icon.value : letterFor(item);
    box.classList.add('is-letter');
    box.style.setProperty('--vt-fav-tint', icon.color || '#5b6b8c');
  };
  if (icon.type === 'emoji' && icon.value) {
    box.textContent = icon.value;
    box.classList.add('is-emoji');
  } else if (icon.type === 'letter') {
    letter();
  } else {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.src = icon.type === 'image' && icon.value ? icon.value : faviconUrl(item.url, size >= 40 ? 64 : 32);
    img.addEventListener('error', () => { img.remove(); letter(); }, { once: true });
    box.appendChild(img);
  }
  return box;
}

export function createFavorites(root, { onEmpty }) {
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="add-favorite"]')) onEmpty();
  });

  return {
    render(favorites, options) {
      root.textContent = '';
      root.dataset.mode = options.mode;
      root.classList.toggle('no-hover', !options.hover);
      root.style.setProperty('--vt-fav-size', `${options.iconSize}px`);
      root.style.setProperty('--vt-fav-gap', `${options.gap}px`);
      root.style.setProperty('--vt-fav-radius', `${options.itemRadius}px`);
      const items = favorites.items.filter((i) => !i.hidden);
      if (!items.length) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vt-fav-empty';
        b.dataset.act = 'add-favorite';
        b.textContent = '+ 즐겨찾기 추가';
        root.appendChild(b);
        return;
      }
      const frag = document.createDocumentFragment();
      for (const item of items) {
        const a = document.createElement('a');
        a.className = 'vt-fav';
        a.href = item.url;
        a.draggable = false;
        a.title = `${item.title || hostOf(item.url)}\n${item.url}`;
        if (options.openInNewTab) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        a.appendChild(buildIcon(item, options.iconSize));
        const label = document.createElement('span');
        label.className = 'vt-fav-label';
        label.textContent = item.title || hostOf(item.url);
        a.appendChild(label);
        frag.appendChild(a);
      }
      root.appendChild(frag);
    }
  };
}

/** 사용자가 고른 아이콘 이미지를 64px PNG data URL 로 축소 (저장 용량 최소화) */
export async function imageToIconDataUrl(file, size = 64) {
  if (!file || file.size > 5 * 1024 * 1024) throw new Error('아이콘 이미지는 5MB 이하만 가능합니다.');
  const type = await sniffType(file);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new Error('JPG, PNG, WebP 이미지만 사용할 수 있습니다.');
  const bmp = await createImageBitmap(file);
  try {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const s = Math.min(bmp.width, bmp.height);
    ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/png');
  } finally {
    bmp.close();
  }
}
