#!/usr/bin/env bash
# Re-captures every screen and re-renders all 8 videos (3 parallel streams, ~35 minutes).
set -e
cd "$(dirname "$0")/.."
mkdir -p promo/out
node promo/build-assets.cjs > promo/out/assets.log 2>&1 &
node promo/build-assets-howto.cjs > promo/out/assets-howto.log 2>&1 &
wait
r() { node promo/render.cjs "$1" "$2" >> "promo/out/render-$1-$2.log" 2>&1; }
( r provider-howto v; r customer v ) &
( r provider-howto l; r customer-howto l ) &
( r customer-howto v; r provider v; r provider l; r customer l ) &
wait
echo ALLDONE > promo/out/rebuild.done
