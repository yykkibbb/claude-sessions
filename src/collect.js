// 데이터 수집 — Mac 에서 Claude 가 사용되는 모든 흔적을 모은다.
//
//  1. ~/.claude/sessions/*.json                 실행 중 세션 레지스트리 (PID 기준)
//  2. ps                                        레지스트리에 없는 claude 프로세스 (ACP 등)
//  3. ~/.claude/projects/*/<sessionId>.jsonl    대화 기록 (실행 중 + 과거 세션)
//  4. ~/.claude/ide/*.lock                      IDE 연동 (IntelliJ, Rider, VS Code …)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { transcriptInfo } from './transcript.js';

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const IDE_DIR = path.join(CLAUDE_DIR, 'ide');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function safeReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function listDir(p) {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

// 세션 → 소스 라벨
export function sourceLabel(s) {
  if (s.via === 'acp' || s.entrypoint === 'acp') return 'ACP';
  switch (s.entrypoint) {
    case 'cli':
      return '터미널';
    case 'claude-desktop':
      return 'Desktop';
    case 'sdk':
    case 'sdk-ts':
    case 'sdk-py':
      return 'SDK';
    default:
      return s.entrypoint || '-';
  }
}

// sessionId → 대화 기록 파일 경로 인덱스
export function transcriptIndex() {
  const map = new Map();
  const files = [];
  for (const slug of listDir(PROJECTS_DIR)) {
    const dir = path.join(PROJECTS_DIR, slug);
    for (const name of listDir(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -6);
      if (!UUID_RE.test(id)) continue; // agent-*.jsonl 등 제외
      const p = path.join(dir, name);
      map.set(id, p);
      files.push({ sessionId: id, path: p, slug });
    }
  }
  return { map, files };
}

// ps 스캔 — claude 관련 프로세스 목록
function scanProcesses() {
  let out;
  try {
    out = execFileSync('ps', ['-axo', 'pid=,ppid=,lstart=,command='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  const procs = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, lstart, command] = m;
    procs.push({ pid: +pid, ppid: +ppid, lstart, command });
  }
  return procs;
}

function classifyProcess(command) {
  // 제외 대상: 앱 셸/헬퍼/래퍼 프로세스
  if (/Claude Helper|chrome_crashpad|Helpers\/disclaimer|npm exec /.test(command)) return null;
  if (/\/Applications\/Claude\.app\/Contents\/MacOS\/Claude/.test(command)) return null;
  if (/claude-agent-acp/.test(command)) return 'acp';
  if (/Application Support\/Claude\/claude-code/.test(command)) return 'claude-desktop';
  const exe = command.split(/\s+/)[0] ?? '';
  const base = path.basename(exe);
  if (base === 'claude' || base === 'claude.exe') return 'cli';
  return null;
}

// 레지스트리에 없는 프로세스의 작업 디렉토리를 lsof 로 조회
function cwdsForPids(pids) {
  if (!pids.length) return new Map();
  const map = new Map();
  try {
    const out = execFileSync(
      'lsof',
      ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fn'],
      { encoding: 'utf8', timeout: 3000 },
    );
    let cur = null;
    for (const line of out.split('\n')) {
      if (line.startsWith('p')) cur = +line.slice(1);
      else if (line.startsWith('n') && cur != null) map.set(cur, line.slice(1));
    }
  } catch {
    // lsof 실패는 치명적이지 않음
  }
  return map;
}

export function collectIdeLocks() {
  const locks = [];
  for (const name of listDir(IDE_DIR)) {
    if (!name.endsWith('.lock')) continue;
    const data = safeReadJson(path.join(IDE_DIR, name));
    if (!data) continue;
    locks.push({
      port: +name.replace('.lock', ''),
      ideName: data.ideName,
      pid: data.pid,
      workspaceFolders: data.workspaceFolders ?? [],
      alive: data.pid ? isAlive(data.pid) : false,
    });
  }
  return locks.filter((l) => l.alive);
}

// 실행 중 세션 목록
export function collectLive(index) {
  const sessions = [];
  const byPid = new Map();

  for (const name of listDir(SESSIONS_DIR)) {
    if (!name.endsWith('.json')) continue;
    const reg = safeReadJson(path.join(SESSIONS_DIR, name));
    if (!reg || !reg.pid || !isAlive(reg.pid)) continue;
    const entry = {
      pid: reg.pid,
      sessionId: reg.sessionId,
      cwd: reg.cwd,
      startedAt: reg.startedAt,
      version: reg.version,
      kind: reg.kind,
      entrypoint: reg.entrypoint,
      status: reg.status ?? null,
      updatedAt: reg.updatedAt ?? reg.startedAt,
      transcriptPath: index.map.get(reg.sessionId) ?? null,
      fromRegistry: true,
    };
    sessions.push(entry);
    byPid.set(reg.pid, entry);
  }

  const procs = scanProcesses();
  const procByPid = new Map(procs.map((p) => [p.pid, p]));

  // 레지스트리 세션의 부모 프로세스를 따라가서 어디서 띄운 세션인지 파악.
  // ACP 에이전트(Zed 등)가 띄운 세션이면 via='acp' 로 표시하고,
  // 그 래퍼 프로세스들은 중복이므로 프로세스 목록에서 제외한다.
  const covered = new Set();
  for (const s of sessions) {
    let cur = procByPid.get(s.pid);
    for (let depth = 0; cur && depth < 5; depth++) {
      const parent = procByPid.get(cur.ppid);
      if (!parent) break;
      if (/claude-agent-acp/.test(parent.command)) s.via = 'acp';
      if (classifyProcess(parent.command)) covered.add(parent.pid);
      cur = parent;
    }
  }

  // 레지스트리에 안 잡히는 claude 프로세스 (구버전, ACP 에이전트 등)
  const claudeProcs = [];
  for (const p of procs) {
    const kind = classifyProcess(p.command);
    if (kind && !byPid.has(p.pid) && !covered.has(p.pid)) {
      claudeProcs.push({ ...p, entrypoint: kind });
    }
  }
  const cwds = cwdsForPids(claudeProcs.map((p) => p.pid));
  for (const p of claudeProcs) {
    sessions.push({
      pid: p.pid,
      sessionId: null,
      cwd: cwds.get(p.pid) ?? null,
      startedAt: Date.parse(p.lstart) || null,
      version: null,
      kind: 'process',
      entrypoint: p.entrypoint,
      status: null,
      updatedAt: null,
      transcriptPath: null,
      fromRegistry: false,
    });
  }

  // 대화 기록에서 부가 정보 채우기
  for (const s of sessions) {
    if (!s.transcriptPath) continue;
    const info = transcriptInfo(s.transcriptPath);
    if (!info) continue;
    s.model = info.model;
    s.gitBranch = info.gitBranch;
    s.lastTs = info.lastTs;
    s.lastUser = info.lastUser;
    s.lastAssistant = info.lastAssistant;
    if (!s.cwd) s.cwd = info.cwd;
  }

  sessions.sort((a, b) => {
    const aw = a.status === 'working' || a.status === 'busy' ? 0 : 1;
    const bw = b.status === 'working' || b.status === 'busy' ? 0 : 1;
    if (aw !== bw) return aw - bw;
    return (b.lastTs ?? b.updatedAt ?? 0) - (a.lastTs ?? a.updatedAt ?? 0);
  });
  return sessions;
}

// 최근 세션 목록 (종료된 세션 포함) — 대화 기록 mtime 기준
export function collectRecent(index, liveSessionIds, limit = 100) {
  const entries = [];
  for (const f of index.files) {
    let st;
    try {
      st = fs.statSync(f.path);
    } catch {
      continue;
    }
    entries.push({ ...f, mtimeMs: st.mtimeMs, size: st.size });
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const top = entries.slice(0, limit);

  return top.map((e) => {
    const info = transcriptInfo(e.path) ?? {};
    return {
      sessionId: e.sessionId,
      transcriptPath: e.path,
      cwd: info.cwd ?? null,
      gitBranch: info.gitBranch ?? null,
      model: info.model ?? null,
      lastTs: info.lastTs ?? e.mtimeMs,
      lastUser: info.lastUser ?? null,
      lastAssistant: info.lastAssistant ?? null,
      size: e.size,
      live: liveSessionIds.has(e.sessionId),
    };
  });
}

export function collect({ recentLimit = 100 } = {}) {
  const index = transcriptIndex();
  const live = collectLive(index);
  const liveIds = new Set(live.map((s) => s.sessionId).filter(Boolean));
  const recent = collectRecent(index, liveIds, recentLimit);
  const ideLocks = collectIdeLocks();
  return { live, recent, ideLocks, collectedAt: Date.now() };
}
