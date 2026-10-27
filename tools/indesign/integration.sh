#!/bin/sh
# Runs the adapter integration tests inside the running InDesign (throwaway documents only).
#   tools/indesign/integration.sh
set -eu
cd "$(dirname "$0")/../.."
node tools/indesign/build-spikes.mjs i >/dev/null
status=0
for t in i1-adapter i2-tracking i18-language i19-freeze i20-selfcheck i22-edit-after-apply; do
  out="$(tools/indesign/run.sh "tools/indesign/spikes/dist/$t.idjs")"
  if printf '%s' "$out" | grep -q '"pass": true'; then echo "PASS $t"; else echo "FAIL $t"; printf '%s\n' "$out" | head -40; status=1; fi
done
exit $status
