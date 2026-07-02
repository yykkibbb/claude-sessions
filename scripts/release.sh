#!/bin/sh
# GitHub 릴리스 + Homebrew tap 갱신을 한 번에 처리한다.
#
#   사용법: scripts/release.sh <github-계정>
#
# 하는 일:
#   1. dist/ 에 양대 아키텍처 바이너리 빌드
#   2. <계정>/claude-sessions 리포에 v<버전> 릴리스 생성, 바이너리 업로드
#   3. <계정>/homebrew-tap 리포의 Formula/claude-sessions.rb 를 새 sha256 으로 갱신
#
# 사전 조건: gh 로그인 (gh auth status), 두 리포가 없으면 자동 생성(public).
set -eu
cd "$(dirname "$0")/.."

GH_USER=${1:?사용법: scripts/release.sh <github-계정>}
VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)
REPO="$GH_USER/claude-sessions"
TAP_REPO="$GH_USER/homebrew-tap"

scripts/build.sh

echo "==> 메인 리포 확인: $REPO"
if ! gh repo view "$REPO" >/dev/null 2>&1; then
  gh repo create "$REPO" --public --source . --push \
    --description "Mac의 모든 Claude Code 세션을 한눈에 보는 TUI 대시보드"
else
  git push "https://github.com/$REPO.git" HEAD:main 2>/dev/null || true
fi

echo "==> 릴리스 v$VERSION 생성"
gh release delete "v$VERSION" --repo "$REPO" --yes 2>/dev/null || true
gh release create "v$VERSION" dist/*.tar.gz \
  --repo "$REPO" --title "v$VERSION" \
  --notes "Node.js 설치 없이 실행되는 단일 바이너리 (Apple Silicon / Intel)"

SHA_ARM=$(shasum -a 256 "dist/claude-sessions-$VERSION-darwin-arm64.tar.gz" | cut -d' ' -f1)
SHA_X64=$(shasum -a 256 "dist/claude-sessions-$VERSION-darwin-x64.tar.gz" | cut -d' ' -f1)

echo "==> Formula 생성"
mkdir -p dist/tap/Formula
sed -e "s/{{USER}}/$GH_USER/g" \
    -e "s/{{VERSION}}/$VERSION/g" \
    -e "s/{{SHA_ARM}}/$SHA_ARM/g" \
    -e "s/{{SHA_X64}}/$SHA_X64/g" \
    packaging/claude-sessions.rb.tmpl > dist/tap/Formula/claude-sessions.rb

echo "==> tap 리포 갱신: $TAP_REPO"
TAP_DIR=$(mktemp -d)
if gh repo view "$TAP_REPO" >/dev/null 2>&1; then
  gh repo clone "$TAP_REPO" "$TAP_DIR" -- --depth 1
else
  git init -b main "$TAP_DIR"
fi
mkdir -p "$TAP_DIR/Formula"
cp dist/tap/Formula/claude-sessions.rb "$TAP_DIR/Formula/"
git -C "$TAP_DIR" add Formula/claude-sessions.rb
git -C "$TAP_DIR" commit -m "claude-sessions $VERSION"
if ! gh repo view "$TAP_REPO" >/dev/null 2>&1; then
  (cd "$TAP_DIR" && gh repo create "$TAP_REPO" --public --source . --push)
else
  git -C "$TAP_DIR" push
fi
rm -rf "$TAP_DIR"

echo ""
echo "완료! 이제 누구나 이렇게 설치할 수 있습니다:"
echo ""
echo "  brew tap $GH_USER/tap"
echo "  brew install claude-sessions"
