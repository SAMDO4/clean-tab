// 날짜·요일 표시 (기본 한국어)

const KO_DAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * @param {Date} d
 * @param {{format?:string, showWeekday?:boolean, showYear?:boolean}} o
 */
export function formatDate(d, { format = 'ko-long', showWeekday = true, showYear = true } = {}) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = d.getDay();
  switch (format) {
    case 'ko-dots': {
      const base = showYear ? `${y}.${pad2(m)}.${pad2(day)}` : `${pad2(m)}.${pad2(day)}`;
      return showWeekday ? `${base} (${KO_DAYS[w][0]})` : base;
    }
    case 'en-short': {
      let s = `${EN_MONTHS[m - 1].slice(0, 3)} ${day}`;
      if (showYear) s += `, ${y}`;
      return showWeekday ? `${EN_DAYS[w].slice(0, 3)}, ${s}` : s;
    }
    case 'en-long': {
      let s = `${EN_MONTHS[m - 1]} ${day}`;
      if (showYear) s += `, ${y}`;
      return showWeekday ? `${EN_DAYS[w]}, ${s}` : s;
    }
    case 'ko-long':
    default: {
      let s = showYear ? `${y}년 ${m}월 ${day}일` : `${m}월 ${day}일`;
      return showWeekday ? `${s} ${KO_DAYS[w]}` : s;
    }
  }
}

export function createDate(root) {
  let opts = {};
  let last = '';
  return {
    setOptions(o) { opts = { ...o }; last = ''; return this.render(); },
    /** @returns {boolean} 글자가 바뀌었으면 true */
    render(now = new Date()) {
      const text = formatDate(now, opts);
      if (text === last) return false;
      root.textContent = text;
      last = text;
      return true;
    }
  };
}
