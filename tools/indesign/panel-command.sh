#!/bin/sh
# Send a command to the loaded Flatter panel (dev build) and print its answer.
#   tools/indesign/panel-command.sh '{"cmd":"ping"}'
#   tools/indesign/panel-command.sh '{"cmd":"s4","ticks":20}'
set -eu
cmd="$1"
# Backslashes and double quotes for AppleScript, single quotes for the JavaScript string inside it.
esc=$(printf '%s' "$cmd" | sed "s/\\\\/\\\\\\\\/g; s/\"/\\\\\"/g; s/'/\\\\\\\\'/g")
osascript -e "tell application id \"com.adobe.InDesign\" to do script \"app.insertLabel('flatter-dev-result', ''); app.insertLabel('flatter-dev-command', '$esc')\" language javascript" >/dev/null
tries=0
while [ "$tries" -lt "${FLATTER_TIMEOUT:-240}" ]; do
  sleep 0.5
  out="$(osascript -e 'tell application id "com.adobe.InDesign" to do script "app.extractLabel(\"flatter-dev-result\")" language javascript')"
  if [ -n "$out" ]; then
    osascript -e 'tell application id "com.adobe.InDesign" to do script "app.insertLabel(\"flatter-dev-result\", \"\")" language javascript' >/dev/null
    printf '%s\n' "$out"
    exit 0
  fi
  tries=$((tries + 1))
done
echo "no answer from the panel: is the dev build loaded (UXP Developer Tool → Load)?" >&2
exit 1
