#!/usr/bin/env bash
# Renders every video (2 at a time). Usage: bash promo/render-all.sh   (about 30-40 minutes)
set -e
cd "$(dirname "$0")/.."
mkdir -p promo/out
run() { node promo/render.cjs "$1" "$2" >> "promo/out/render-$1-$2.log" 2>&1; }
( run provider v; run provider l; run provider-howto l ) &
( run customer v; run customer l; run customer-howto l ) &
( run provider-howto v; run customer-howto v ) &
wait
echo ALLDONE
