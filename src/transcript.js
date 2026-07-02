// ~/.claude/projects/<슬러그>/<sessionId>.jsonl 대화 기록 파일 파싱.
// 파일이 수십 MB 까지 커질 수 있으므로 앞/뒤 일부만 읽는다.

import fs from 'node:fs';

const HEAD_BYTES = 8 * 1024;
const TAIL_BYTES = 256 * 1024;

function readChunk(path, position, length) {
  let fd;
  try {
    fd = fs.openSync(path, 'r');
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, position);
    return buf.toString('utf8', 0, read);
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function parseLines(text, { dropFirst = false } = {}) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift(); // 중간부터 읽었으면 첫 줄은 잘린 조각
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // 잘린 마지막 줄 등은 무시
    }
  }
  return out;
}

// content 가 문자열이거나 블록 배열인 메시지에서 사람이 읽을 텍스트를 뽑는다.
// tool_result 는 노이즈라 버리고, tool_use 는 도구 이름만 모은다.
function extractParts(message) {
  const content = message?.content;
  if (typeof content === 'string') return { text: content, tools: [] };
  if (!Array.isArray(content)) return { text: '', tools: [] };
  const texts = [];
  const tools = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) texts.push(block.text);
    else if (block.type === 'tool_use') tools.push(block.name);
  }
  return { text: texts.join(' '), tools };
}

// 사용자가 직접 입력한 프롬프트가 아닌 내부 메시지 판별
function isInternalUserText(text) {
  return /^<(local-command|command-name|command-message|system-reminder|task-notification)|^Caveat:|^\[Request interrupted/.test(
    text,
  );
}

function toolSummary(tools) {
  const counts = new Map();
  for (const t of tools) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(', ');
}

function oneLine(s, max = 500) {
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

// 캐시: path -> { mtimeMs, size, info }
const infoCache = new Map();

// 세션 파일에서 요약 정보를 뽑는다: cwd, gitBranch, model, 마지막 메시지 등.
export function transcriptInfo(path) {
  let st;
  try {
    st = fs.statSync(path);
  } catch {
    return null;
  }
  const cached = infoCache.get(path);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.info;
  }

  const head = parseLines(readChunk(path, 0, Math.min(HEAD_BYTES, st.size)));
  const tailStart = Math.max(0, st.size - TAIL_BYTES);
  const tail =
    tailStart === 0
      ? head.length
        ? parseLines(readChunk(path, 0, st.size))
        : []
      : parseLines(readChunk(path, tailStart, TAIL_BYTES), { dropFirst: true });
  const records = tailStart === 0 && tail.length === 0 ? head : tail;

  const info = {
    cwd: null,
    gitBranch: null,
    model: null,
    version: null,
    lastTs: st.mtimeMs,
    lastUser: null,
    lastAssistant: null,
    size: st.size,
    mtimeMs: st.mtimeMs,
  };

  for (const r of [...head, ...records]) {
    if (r.cwd && !info.cwd) info.cwd = r.cwd;
    if (r.version) info.version = r.version;
  }
  for (const r of records) {
    if (r.gitBranch) info.gitBranch = r.gitBranch;
    if (r.type === 'assistant' && r.message?.model && r.message.model !== '<synthetic>') {
      info.model = r.message.model;
    }
    if (r.type === 'user' && r.message && !r.isMeta && r.userType === 'external') {
      const { text } = extractParts(r.message);
      const line = oneLine(text, 200);
      if (line && !isInternalUserText(line)) {
        info.lastUser = { text: line, ts: r.timestamp };
      }
    }
    if (r.type === 'assistant' && r.message) {
      const { text } = extractParts(r.message);
      const line = oneLine(text, 200);
      if (line) info.lastAssistant = { text: line, ts: r.timestamp };
    }
    if (r.timestamp) {
      const t = Date.parse(r.timestamp);
      if (!Number.isNaN(t)) info.lastTs = Math.max(info.lastTs, t);
    }
  }

  infoCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, info });
  return info;
}

// detail 뷰용 — 최근 메시지 n개를 {role, ts, text} 로 반환
export function lastMessages(path, n = 20) {
  let st;
  try {
    st = fs.statSync(path);
  } catch {
    return [];
  }
  const tailStart = Math.max(0, st.size - TAIL_BYTES);
  const records = parseLines(
    readChunk(path, tailStart, Math.min(TAIL_BYTES, st.size)),
    { dropFirst: tailStart > 0 },
  );

  const msgs = [];
  for (const r of records) {
    if (r.isSidechain) continue;
    if (r.type === 'user' && r.message && !r.isMeta) {
      const { text } = extractParts(r.message);
      const line = oneLine(text, 400);
      if (!line || isInternalUserText(line)) continue;
      msgs.push({ role: 'user', ts: r.timestamp, text: line });
    } else if (r.type === 'assistant' && r.message) {
      const { text, tools } = extractParts(r.message);
      const line = oneLine(text, 400);
      if (!line && !tools.length) continue;
      const prev = msgs[msgs.length - 1];
      // 연속된 assistant 레코드(스트리밍 조각, 연쇄 도구 호출)는 하나로 합친다
      if (prev && prev.role === 'assistant') {
        if (line) prev.text = oneLine(prev.text ? prev.text + ' ' + line : line, 400);
        prev.tools.push(...tools);
      } else {
        msgs.push({ role: 'assistant', ts: r.timestamp, text: line, tools: [...tools] });
      }
    } else if (r.type === 'system' && r.subtype === 'local_command') {
      const m = /<command-name>([^<]+)<\/command-name>/.exec(r.content ?? '');
      if (m) msgs.push({ role: 'command', ts: r.timestamp, text: m[1].trim() });
    }
  }
  for (const m of msgs) {
    if (m.role === 'assistant' && m.tools?.length) {
      const summary = `[도구: ${toolSummary(m.tools)}]`;
      m.text = m.text ? `${m.text} ${summary}` : summary;
    }
    delete m.tools;
  }
  return msgs.slice(-n);
}
