#!/bin/sh
# Run a UXP script (.idjs) or ExtendScript (.jsx) inside the running InDesign and print its result.
#
#   tools/indesign/run.sh path/to/script.idjs
#
# A UXP script returns its result by writing a string to the application label "flatter-result":
#   const { app } = require("indesign");
#   app.insertLabel("flatter-result", JSON.stringify({ ... }));
# An ExtendScript (.jsx) returns the value of its last expression.
# macOS asks once whether the terminal may control InDesign; the user must click OK.
# FLATTER_TIMEOUT sets how many half-second polls to wait for a UXP result (default 600 = 5 minutes).
set -eu
script="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
case "$script" in
  *.jsx)
    exec osascript -e "tell application id \"com.adobe.InDesign\" to do script (POSIX file \"$script\") language javascript"
    ;;
  *.idjs)
    # InDesign runs a UXP script asynchronously when its text contains "async" followed by a word
    # (even inside a string), and doScript then returns at once. So start the script, then poll the
    # result label until the script has written it.
    runner="$(mktemp -t flatter-run).jsx"
    trap 'rm -f "$runner"' EXIT
    cat > "$runner" <<JSX
app.insertLabel("flatter-result", "");
try { app.doScript(File("$script"), ScriptLanguage.UXPSCRIPT); } catch (e) { app.insertLabel("flatter-result", "error: " + e); }
app.extractLabel("flatter-result");
JSX
    # A synchronous script can run for minutes; the default Apple event timeout is two minutes.
    out="$(osascript -e 'with timeout of 3600 seconds' -e "tell application id \"com.adobe.InDesign\" to do script (POSIX file \"$runner\") language javascript" -e 'end timeout')"
    tries=0
    while [ -z "$out" ] && [ "$tries" -lt "${FLATTER_TIMEOUT:-600}" ]; do
      sleep 0.5
      out="$(osascript -e 'tell application id "com.adobe.InDesign" to do script "app.extractLabel(\"flatter-result\")" language javascript')"
      tries=$((tries + 1))
    done
    osascript -e 'tell application id "com.adobe.InDesign" to do script "app.insertLabel(\"flatter-result\", \"\")" language javascript' >/dev/null
    if [ -z "$out" ]; then echo "timed out waiting for the script result" >&2; exit 1; fi
    printf '%s\n' "$out"
    ;;
  *)
    echo "expected a .idjs or .jsx file" >&2
    exit 2
    ;;
esac
