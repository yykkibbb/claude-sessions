// claude-sessions — Mac 의 모든 Claude Code 세션을 한눈에 보는 대시보드.
//
//   claude-sessions          TUI 대시보드 (기본)
//   claude-sessions --once   현재 세션 목록을 한 번 출력하고 종료
//   claude-sessions --json   수집한 데이터를 JSON 으로 출력

import readline from 'node:readline';
import { collect, sourceLabel } from './collect.js';
import { lastMessages } from './transcript.js';
import {
  renderFrame,
  statusInfo,
  fmtAgo,
  shortModel,
  projectName,
} from './ui.js';
import { c, COLORS, padEnd, truncate } from './text.js';

const REFRESH_MS = 2000;

function printOnce() {
  const data = collect();
  const cols = [
    ['상태', 10],
    ['소스', 8],
    ['프로젝트', 28],
    ['브랜치', 14],
    ['모델', 10],
    ['경과', 5],
    ['활동', 5],
    ['PID', 6],
  ];
  console.log(
    c(COLORS.dim, cols.map(([label, w]) => padEnd(label, w)).join('  ')),
  );
  for (const s of data.live) {
    const st = statusInfo(s);
    const row = [
      c(st.color, padEnd(`${st.dot} ${st.label}`, 10)),
      padEnd(sourceLabel(s), 8),
      c(COLORS.bold, padEnd(truncate(projectName(s.cwd), 28), 28)),
      c(COLORS.cyan, padEnd(truncate(s.gitBranch ?? '-', 14), 14)),
      c(COLORS.magenta, padEnd(shortModel(s.model), 10)),
      padEnd(fmtAgo(s.startedAt), 5),
      padEnd(fmtAgo(s.lastTs ?? s.updatedAt), 5),
      c(COLORS.gray, padEnd(String(s.pid), 6)),
    ];
    console.log(row.join('  '));
  }
  const working = data.live.filter((s) =>
    ['working', 'busy', 'running'].includes(s.status),
  ).length;
  console.log();
  console.log(
    c(
      COLORS.dim,
      `작업중 ${working} · 전체 ${data.live.length} · 최근 기록 ${data.recent.length}개 (자세히: claude-sessions 실행)`,
    ),
  );
}

function runTui() {
  const state = { tab: 'live', sel: 0, scroll: 0, detail: null, detailScroll: 0 };
  let data = collect();

  const out = process.stdout;
  const size = () => ({ cols: out.columns || 100, rows: out.rows || 30 });

  function draw() {
    const { cols, rows } = size();
    const lines = renderFrame(state, data, cols, rows);
    let buf = '\x1b[H';
    for (const line of lines) buf += line + '\x1b[K\r\n';
    buf += '\x1b[J';
    out.write(buf);
  }

  function refresh() {
    try {
      data = collect();
    } catch {
      // 다음 주기에 재시도
    }
    draw();
  }

  function cleanup() {
    clearInterval(timer);
    out.write('\x1b[?25h\x1b[?1049l');
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
  }

  out.write('\x1b[?1049h\x1b[?25l\x1b[2J');
  const timer = setInterval(refresh, REFRESH_MS);

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (!key) return;
    const items = state.tab === 'live' ? data.live : data.recent;

    if (key.name === 'q' || (key.ctrl && key.name === 'c')) return cleanup();

    if (state.detail) {
      if (key.name === 'escape' || key.name === 'b') {
        state.detail = null;
        state.detailScroll = 0;
      } else if (key.name === 'up' || key.name === 'k') state.detailScroll++;
      else if (key.name === 'down' || key.name === 'j') {
        state.detailScroll = Math.max(0, state.detailScroll - 1);
      }
      return draw();
    }

    if (key.name === 'up' || key.name === 'k') state.sel = Math.max(0, state.sel - 1);
    else if (key.name === 'down' || key.name === 'j') {
      state.sel = Math.min(items.length - 1, state.sel + 1);
    } else if (key.name === 'g' && !key.shift) state.sel = 0;
    else if ((key.name === 'g' && key.shift) || str === 'G') state.sel = items.length - 1;
    else if (str === '1' || (key.name === 'tab' && state.tab === 'recent')) {
      state.tab = 'live';
      state.sel = 0;
      state.scroll = 0;
    } else if (str === '2' || (key.name === 'tab' && state.tab === 'live')) {
      state.tab = 'recent';
      state.sel = 0;
      state.scroll = 0;
    } else if (key.name === 'r') return refresh();
    else if (key.name === 'return') {
      const sel = items[state.sel];
      if (sel) {
        state.detail = {
          session: sel,
          messages: sel.transcriptPath ? lastMessages(sel.transcriptPath, 30) : [],
        };
        state.detailScroll = 0;
      }
    }
    draw();
  });

  out.on('resize', draw);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  draw();
}

const args = process.argv.slice(2);
if (args.includes('--json')) {
  console.log(JSON.stringify(collect(), null, 2));
} else if (
  args.includes('--once') ||
  args.includes('-1') ||
  !process.stdout.isTTY ||
  !process.stdin.isTTY
) {
  printOnce();
} else {
  runTui();
}
