#!/usr/bin/env bash
# 서버에서 실행: Docker가 없으면 설치하고 코스모스 릴레이를 띄워요.
#   RELAY_DOMAIN=relay.example.com bash install.sh
# deploy.sh가 이 폴더째 서버에 올린 뒤 자동으로 불러요.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${RELAY_DOMAIN:?RELAY_DOMAIN 을 정해 주세요 (예: relay.example.com)}"

sudo_cmd=""
if [ "$(id -u)" -ne 0 ]; then sudo_cmd="sudo"; fi

if ! command -v docker >/dev/null 2>&1; then
  echo "🛠️  Docker 설치 중…"
  curl -fsSL https://get.docker.com | $sudo_cmd sh
fi
if ! $sudo_cmd docker compose version >/dev/null 2>&1; then
  echo "⛔ docker compose 플러그인이 필요해요. https://docs.docker.com/compose/install/ 를 참고해 주세요." >&2
  exit 1
fi

cd "$here"
echo "🚀 릴레이 시작: https://${RELAY_DOMAIN}"
RELAY_DOMAIN="$RELAY_DOMAIN" $sudo_cmd docker compose up -d --build --remove-orphans

echo "⏳ 상태 확인 중…"
for _ in $(seq 1 30); do
  if curl -fsS "https://${RELAY_DOMAIN}/healthz" >/dev/null 2>&1; then
    echo "✅ 릴레이가 켜졌어요 → 관제실 → 은하수 → 릴레이 주소에 wss://${RELAY_DOMAIN} 을 넣어 주세요."
    exit 0
  fi
  sleep 4
done
echo "⚠️  아직 https://${RELAY_DOMAIN}/healthz 가 응답하지 않아요."
echo "   도메인의 DNS가 이 서버 IP를 가리키는지, 80·443 포트가 열려 있는지 확인해 주세요."
echo "   로그: docker compose -f $here/compose.yml logs -f"
exit 1
