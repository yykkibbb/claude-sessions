// 터미널 표시 폭 계산 유틸 — 한글/CJK 는 2칸을 차지한다.

function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK Radicals .. Yi
    (cp >= 0xa960 && cp <= 0xa97f) || // Hangul Jamo Extended-A
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK Compatibility Forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // Emoji
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

export function charWidth(cp) {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0; // 제어문자
  if (cp >= 0x300 && cp <= 0x36f) return 0; // combining marks
  if (cp === 0xfe0f || cp === 0x200d) return 0; // VS16, ZWJ
  return isWide(cp) ? 2 : 1;
}

export function strWidth(s) {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0));
  return w;
}

// 표시 폭 기준으로 자르고, 잘렸으면 … 을 붙인다.
export function truncate(s, max) {
  if (max <= 0) return '';
  if (strWidth(s) <= max) return s;
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

export function padEnd(s, width) {
  const w = strWidth(s);
  return w >= width ? s : s + ' '.repeat(width - w);
}

export function padStart(s, width) {
  const w = strWidth(s);
  return w >= width ? s : ' '.repeat(width - w) + s;
}

// 표시 폭 기준 줄바꿈 (detail 뷰용)
export function wrap(s, width) {
  const lines = [];
  for (const raw of s.split('\n')) {
    let cur = '';
    let curW = 0;
    for (const ch of raw) {
      const cw = charWidth(ch.codePointAt(0));
      if (curW + cw > width) {
        lines.push(cur);
        cur = '';
        curW = 0;
      }
      cur += ch;
      curW += cw;
    }
    lines.push(cur);
  }
  return lines;
}

const NO_COLOR = !!process.env.NO_COLOR;

export function c(code, s) {
  if (NO_COLOR) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}

export const COLORS = {
  green: '32',
  gray: '90',
  yellow: '33',
  cyan: '36',
  magenta: '35',
  bold: '1',
  dim: '2',
  inverse: '7',
  red: '31',
  blue: '34',
};
