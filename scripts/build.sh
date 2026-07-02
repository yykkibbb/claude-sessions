#!/bin/sh
# 배포용 단일 바이너리 빌드 — Node.js 설치 없이 실행 가능한 실행파일을 만든다.
# 결과물: dist/claude-sessions-<버전>-darwin-{arm64,x64}.tar.gz + SHA256SUMS
set -eu
cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)
echo "버전: $VERSION"

rm -rf dist
mkdir -p dist/stage

for target in darwin-arm64 darwin-x64; do
  echo "==> $target 빌드"
  bun build --compile --minify --target="bun-$target" \
    ./bin/claude-sessions.js --outfile "dist/stage/claude-sessions"
  tar -czf "dist/claude-sessions-$VERSION-$target.tar.gz" -C dist/stage claude-sessions
  rm -f dist/stage/claude-sessions
done
rmdir dist/stage

cd dist
shasum -a 256 ./*.tar.gz | tee SHA256SUMS
echo "==> 완료: $(pwd)"
