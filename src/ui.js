// 화면 렌더링 — 프레임을 문자열 배열(줄 단위)로 만든다.

import path from 'node:path';
import { c, COLORS, padEnd, padStart, truncate, strWidth, wrap } from './text.js';
import { sourceLabel } from './collect.js';

export function fmtAgo(ms) {
  if (ms == null) return '-';
  const d = Math.max(0, Date.now() - ms);
  const s = Math.floor(d / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function fmtSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

export function shortModel(model) {
  if (!model) return '-';
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}

export function projectName(cwd) {
  if (!cwd) return '?';
  return path.basename(cwd) || cwd;
}

export function statusInfo(s) {
  // 최근 기록 탭 항목 (live 여부만 안다)
  if (s.fromRegistry === undefined) {
    return s.live
      ? { dot: '●', label: '실행중', color: COLORS.green }
      : { dot: '·', label: '종료됨', color: COLORS.gray };
  }
  if (!s.fromRegistry) return { dot: '·', label: '프로세스', color: COLORS.gray };
  switch (s.status) {
    case 'working':
    case 'busy':
    case 'running':
      return { dot: '●', label: '작업중', color: COLORS.green };
    case 'waiting':
    case 'waiting-for-input':
      return { dot: '◐', label: '입력대기', color: COLORS.yellow };
    case 'idle':
      return { dot: '○', label: '유휴', color: COLORS.gray };
    default:
      return { dot: '○', label: s.status ?? '-', color: COLORS.gray };
  }
}

// 컬럼 정의를 받아 실제 폭을 계산. flex 컬럼이 남은 폭을 나눠 갖는다.
function layout(defs, total) {
  const gap = 2;
  const visible = defs.filter((d) => !d.minCols || total >= d.minCols);
  const fixed = visible.reduce((sum, d) => sum + (d.width ?? 0), 0);
  const gaps = gap * (visible.length - 1);
  const flexCols = visible.filter((d) => d.flex);
  let remain = Math.max(0, total - fixed - gaps - 1);
  const flexTotal = flexCols.reduce((s, d) => s + d.flex, 0);
  for (const d of flexCols) {
    d.computed = Math.max(d.min ?? 8, Math.floor((remain * d.flex) / flexTotal));
  }
  for (const d of visible) if (!d.flex) d.computed = d.width;
  return visible;
}

function renderRow(cols, row, { selected = false, width = 100 } = {}) {
  const cells = cols.map((col) => {
    const raw = String(col.get(row) ?? '-');
    const clipped = truncate(raw, col.computed);
    const padded =
      col.align === 'right'
        ? padStart(clipped, col.computed)
        : padEnd(clipped, col.computed);
    if (selected) return padded;
    const color = col.color?.(row);
    return color ? c(color, padded) : padded;
  });
  const line = ' ' + cells.join('  ');
  return selected ? c(COLORS.inverse, padEnd(truncate(line, width), width)) : line;
}

function headerRow(cols) {
  const cells = cols.map((col) =>
    col.align === 'right'
      ? padStart(col.label, col.computed)
      : padEnd(col.label, col.computed),
  );
  return c(COLORS.dim, ' ' + cells.join('  '));
}

const LIVE_COLS = () => [
  {
    label: '상태',
    width: 10,
    get: (s) => `${statusInfo(s).dot} ${statusInfo(s).label}`,
    color: (s) => statusInfo(s).color,
  },
  { label: '소스', width: 8, get: (s) => sourceLabel(s) },
  { label: '프로젝트', flex: 2, min: 12, get: (s) => projectName(s.cwd), color: () => COLORS.bold },
  { label: '브랜치', width: 14, minCols: 110, get: (s) => s.gitBranch ?? '-', color: () => COLORS.cyan },
  { label: '모델', width: 10, minCols: 96, get: (s) => shortModel(s.model), color: () => COLORS.magenta },
  { label: '경과', width: 5, align: 'right', get: (s) => fmtAgo(s.startedAt) },
  {
    label: '활동',
    width: 5,
    align: 'right',
    get: (s) => fmtAgo(s.lastTs ?? s.updatedAt),
    color: (s) => (Date.now() - (s.lastTs ?? s.updatedAt ?? 0) < 60_000 ? COLORS.green : COLORS.gray),
  },
  { label: 'PID', width: 6, align: 'right', get: (s) => s.pid, color: () => COLORS.gray },
];

const RECENT_COLS = () => [
  {
    label: ' ',
    width: 1,
    get: (s) => (s.live ? '●' : ' '),
    color: () => COLORS.green,
  },
  { label: '프로젝트', width: 22, get: (s) => projectName(s.cwd), color: () => COLORS.bold },
  { label: '마지막 프롬프트', flex: 3, min: 16, get: (s) => s.lastUser?.text ?? '-' },
  { label: '브랜치', width: 12, minCols: 120, get: (s) => s.gitBranch ?? '-', color: () => COLORS.cyan },
  { label: '모델', width: 10, minCols: 100, get: (s) => shortModel(s.model), color: () => COLORS.magenta },
  { label: '활동', width: 5, align: 'right', get: (s) => fmtAgo(s.lastTs) },
  { label: '크기', width: 5, align: 'right', get: (s) => fmtSize(s.size), color: () => COLORS.gray },
];

function titleBar(data, cols) {
  const live = data.live;
  const working = live.filter((s) => ['working', 'busy', 'running'].includes(s.status)).length;
  const idle = live.filter((s) => s.fromRegistry && !['working', 'busy', 'running'].includes(s.status)).length;
  const procs = live.filter((s) => !s.fromRegistry).length;
  const ides = [...new Set(data.ideLocks.map((l) => l.ideName))];

  let left = ` ${c(COLORS.bold, 'Claude Sessions')}   `;
  left += c(COLORS.green, `● 작업중 ${working}`) + '  ';
  left += c(COLORS.gray, `○ 유휴 ${idle}`);
  if (procs) left += '  ' + c(COLORS.gray, `· 프로세스 ${procs}`);
  if (ides.length) left += '   ' + c(COLORS.blue, `IDE: ${ides.join(', ')}`);
  const right = c(COLORS.dim, `갱신 ${fmtAgo(data.collectedAt)} 전 `);
  const pad = Math.max(1, cols - strWidth(stripAnsi(left)) - strWidth(stripAnsi(right)));
  return left + ' '.repeat(pad) + right;
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function tabBar(state, data) {
  const t = (key, label, active) =>
    active ? c(COLORS.inverse, ` ${label} `) : c(COLORS.dim, ` ${label} `);
  return (
    ' ' +
    t('live', `1 실행 중 (${data.live.length})`, state.tab === 'live') +
    ' ' +
    t('recent', `2 최근 기록 (${data.recent.length})`, state.tab === 'recent')
  );
}

function listFrame(state, data, cols, rows) {
  const lines = [];
  lines.push(titleBar(data, cols));
  lines.push(tabBar(state, data));

  const items = state.tab === 'live' ? data.live : data.recent;
  const colDefs = layout(state.tab === 'live' ? LIVE_COLS() : RECENT_COLS(), cols);
  lines.push(headerRow(colDefs));

  const visible = Math.max(1, rows - 6);
  if (state.sel >= items.length) state.sel = Math.max(0, items.length - 1);
  if (state.sel < state.scroll) state.scroll = state.sel;
  if (state.sel >= state.scroll + visible) state.scroll = state.sel - visible + 1;
  if (state.scroll > Math.max(0, items.length - visible)) {
    state.scroll = Math.max(0, items.length - visible);
  }

  const slice = items.slice(state.scroll, state.scroll + visible);
  slice.forEach((item, i) => {
    lines.push(
      renderRow(colDefs, item, {
        selected: state.scroll + i === state.sel,
        width: cols,
      }),
    );
  });
  for (let i = slice.length; i < visible; i++) lines.push('');

  // 선택된 세션의 마지막 대화 미리보기
  const sel = items[state.sel];
  let preview = '';
  if (sel) {
    const a = sel.lastAssistant;
    const u = sel.lastUser;
    const last = !u ? a : !a ? u : (a.ts ?? '') >= (u.ts ?? '') ? a : u;
    const who = last === a ? 'Claude' : '나';
    if (last?.text) preview = c(COLORS.dim, ` ${who}: ${truncate(last.text, cols - 12)}`);
  }
  lines.push(preview);
  lines.push(
    c(
      COLORS.dim,
      ' ↑↓ 이동  Enter 상세  1/2/Tab 탭 전환  r 새로고침  q 종료',
    ),
  );
  return lines;
}

function metaLine(label, value, color) {
  const v = value == null || value === '' ? '-' : String(value);
  return `  ${c(COLORS.dim, padEnd(label, 10))} ${color ? c(color, v) : v}`;
}

function detailFrame(state, cols, rows) {
  const { session: s, messages } = state.detail;
  const lines = [];
  const title = ` ${c(COLORS.bold, projectName(s.cwd))}  ${c(COLORS.dim, s.cwd ?? '')}`;
  lines.push(title);
  lines.push('');
  const st = statusInfo(s);
  lines.push(metaLine('상태', `${st.dot} ${st.label}`, st.color));
  lines.push(metaLine('소스', sourceLabel(s)));
  lines.push(metaLine('세션 ID', s.sessionId));
  lines.push(metaLine('PID', s.pid));
  lines.push(metaLine('모델', shortModel(s.model), COLORS.magenta));
  lines.push(metaLine('브랜치', s.gitBranch, COLORS.cyan));
  lines.push(metaLine('버전', s.version));
  if (s.startedAt) lines.push(metaLine('시작', `${new Date(s.startedAt).toLocaleString()} (${fmtAgo(s.startedAt)} 전)`));
  lines.push(metaLine('활동', s.lastTs ? `${fmtAgo(s.lastTs)} 전` : null));
  if (s.transcriptPath) lines.push(metaLine('기록', s.transcriptPath, COLORS.gray));
  lines.push('');
  lines.push(c(COLORS.dim, ` ── 최근 대화 ${'─'.repeat(Math.max(0, cols - 12))}`));

  const msgLines = [];
  for (const m of messages) {
    const who =
      m.role === 'user'
        ? c(COLORS.cyan, '나      ')
        : m.role === 'command'
          ? c(COLORS.magenta, '명령    ')
          : c(COLORS.green, 'Claude  ');
    const wrapped = wrap(m.text, Math.max(20, cols - 12));
    wrapped.forEach((w, i) => {
      msgLines.push(i === 0 ? `  ${who} ${w}` : `          ${w}`);
    });
    msgLines.push('');
  }
  if (!msgLines.length) msgLines.push(c(COLORS.dim, '  (대화 기록 없음)'));

  const bodyRows = Math.max(1, rows - lines.length - 2);
  const maxScroll = Math.max(0, msgLines.length - bodyRows);
  if (state.detailScroll > maxScroll) state.detailScroll = maxScroll;
  const start = Math.max(0, msgLines.length - bodyRows - state.detailScroll);
  lines.push(...msgLines.slice(start, start + bodyRows));
  while (lines.length < rows - 1) lines.push('');
  lines.push(c(COLORS.dim, ' ↑↓ 스크롤  Esc/b 뒤로  q 종료'));
  return lines;
}

export function renderFrame(state, data, cols, rows) {
  const lines = state.detail ? detailFrame(state, cols, rows) : listFrame(state, data, cols, rows);
  return lines.slice(0, rows);
}
