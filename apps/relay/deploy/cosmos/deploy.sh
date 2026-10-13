#!/usr/bin/env bash
# 내 컴퓨터에서 한 줄로: 폰 웹앱을 빌드하고, 서버에 올리고, 릴레이를 띄워요.
#   bash apps/relay/deploy/cosmos/deploy.sh root@1.2.3.4 relay.example.com
# 필요한 것: 서버 SSH 접속(키 로그인), 도메인 A 레코드 → 서버 IP.
set -euo pipefail
target="${1:-}"
domain="${2:-}"
if [ -z "$target" ] || [ -z "$domain" ]; then
  echo "사용법: deploy.sh <사용자@서버> <릴레이 도메인>" >&2
  echo "  예)  deploy.sh root@203.0.113.10 relay.example.com" >&2
  exit 2
fi
relay="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
desktop="$relay/../desktop"
remote_dir="/opt/cosmos-relay"

echo "🧱 1/3 폰 웹앱 빌드"
(cd "$desktop" && npm run build:fast)
(cd "$relay" && npm run stage:web)

echo "📦 2/3 서버로 올리기 → $target:$remote_dir"
ssh "$target" "mkdir -p $remote_dir"
rsync -az --delete \
  --exclude node_modules --exclude data --exclude .web-precompress --exclude '*.test.mjs' \
  "$relay/" "$target:$remote_dir/"

echo "🚀 3/3 서버에서 시작"
ssh "$target" "RELAY_DOMAIN='$domain' bash $remote_dir/deploy/cosmos/install.sh"
