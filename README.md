# claude-sessions

Mac에서 Claude Code가 사용되는 **모든 곳**을 한눈에 보는 터미널 대시보드.

터미널에서 띄운 세션, Claude Desktop이 띄운 세션, Zed 같은 에디터가 ACP로 띄운 세션,
SDK로 띄운 세션까지 전부 잡아서 실시간으로 보여준다. 종료된 세션의 대화 기록도 조회할 수 있다.

## 설치

```sh
brew tap yykkibbb/tap
brew trust yykkibbb/tap   # 최신 Homebrew는 서드파티 tap 신뢰 필요
brew install claude-sessions
```

Homebrew 릴리스는 bun으로 컴파일한 단일 바이너리라 **Node.js 설치가 필요 없다.**

소스로 쓰려면 (Node.js 18+):

```sh
git clone https://github.com/yykkibbb/claude-sessions && cd claude-sessions
npm link
```

## 실행

```sh
claude-sessions           # TUI 대시보드 (2초마다 자동 갱신)
claude-sessions --once    # 현재 세션 목록을 한 번 출력하고 종료
claude-sessions --json    # 수집 데이터를 JSON으로 출력 (스크립트 연동용)
```

## 키

| 키 | 동작 |
|---|---|
| `↑` `↓` / `j` `k` | 이동 (상세 화면에서는 스크롤) |
| `Enter` | 세션 상세 (메타 정보 + 최근 대화) |
| `Esc` / `b` | 뒤로 |
| `1` / `2` / `Tab` | 실행 중 ↔ 최근 기록 탭 전환 |
| `g` / `G` | 맨 위 / 맨 아래 |
| `r` | 즉시 새로고침 |
| `q` | 종료 |

## 데이터 소스

모두 로컬 파일/프로세스만 읽는다. 네트워크 접근 없음, 쓰기 없음.

| 소스 | 내용 |
|---|---|
| `~/.claude/sessions/*.json` | 실행 중 세션 레지스트리 — PID, 작업 디렉토리, 상태(작업중/유휴), 진입점(터미널/Desktop/SDK) |
| `ps` + `lsof` | 레지스트리에 없는 claude 프로세스 (구버전 CLI, ACP 에이전트 등) |
| `~/.claude/projects/*/<sessionId>.jsonl` | 대화 기록 — 모델, 브랜치, 마지막 프롬프트/응답 (실행 중 + 종료된 세션) |
| `~/.claude/ide/*.lock` | IDE 연동 (IntelliJ, Rider, VS Code 등) |

세션의 부모 프로세스를 추적해서 Zed 등이 ACP(`claude-agent-acp`)로 띄운 세션은 `ACP`로,
Claude Desktop이 띄운 세션은 `Desktop`으로 구분한다.

## 구조

```
bin/claude-sessions.js   실행 진입점
src/index.js             CLI 파싱, TUI 이벤트 루프
src/collect.js           세션/프로세스/IDE 데이터 수집
src/transcript.js        대화 기록(jsonl) 파싱 — 대용량 파일은 앞/뒤 일부만 읽음
src/ui.js                프레임 렌더링 (테이블, 상세 뷰)
src/text.js              한글/CJK 표시 폭 계산, ANSI 색상
scripts/build.sh         bun 으로 arm64/x64 단일 바이너리 빌드
scripts/release.sh       GitHub 릴리스 생성 + Homebrew tap 갱신
packaging/               Homebrew formula 템플릿
```

## 배포 (메인테이너용)

bun 과 gh 로그인이 필요하다.

```sh
scripts/build.sh                  # dist/ 에 바이너리 + tar.gz + SHA256SUMS 생성
scripts/release.sh <github-계정>  # 릴리스 업로드 + tap formula 갱신까지 한 번에
```

버전을 올릴 때는 `package.json` 의 `version` 만 수정하고 다시 `release.sh` 를 실행하면 된다.
