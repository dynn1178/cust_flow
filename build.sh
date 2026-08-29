#!/bin/sh
# parts/ 조각을 이어 붙여 배포 산출물 index.html 을 만든다.
# 배포는 Vercel 한 곳으로만 한다 (claude.ai Artifact 배포는 쓰지 않는다).
set -e
cd "$(dirname "$0")"

HEAD="parts/01-head.html parts/02-css.html"
BODY="parts/03-markup.html parts/04-core.js parts/05-flow.js parts/06-stage.js \
parts/07-panels.js parts/09-storage.js parts/10-import.js parts/11-lock.js \
parts/12-boards.js parts/14-extras.js parts/15-sheets.js parts/16-perf.js parts/13-auth.js parts/08-shell.js"

{
  printf '%s\n' '<!doctype html>'
  printf '%s\n' '<html lang="ko">'
  printf '%s\n' '<head>'
  printf '%s\n' '<meta charset="utf-8">'
  printf '%s\n' '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  printf '%s\n' '<meta name="color-scheme" content="light">'
  printf '%s\n' '<meta name="description" content="고객 여정 도식화 · Amplitude/Braze/GA4 태깅 · CRM 캠페인 통합 보드">'
  printf '%s\n' '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%97%BA%EF%B8%8F%3C/text%3E%3C/svg%3E">'
  cat $HEAD
  printf '%s\n' '</head>'
  printf '%s\n' '<body>'
  cat $BODY
  printf '%s\n' '</body>'
  printf '%s\n' '</html>'
} > index.html

echo "built:"
echo "  index.html  $(wc -c < index.html) bytes  (Vercel 배포용)"
