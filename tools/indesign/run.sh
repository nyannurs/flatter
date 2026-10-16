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
set -eu
script="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
case "$script" in
  *.jsx)
    exec osascript -e "tell application id \"com.adobe.InDesign\" to do script (POSIX file \"$script\") language javascript"
    ;;
  *.idjs)
    runner="$(mktemp -t flatter-run).jsx"
    trap 'rm -f "$runner"' EXIT
    cat > "$runner" <<JSX
app.insertLabel("flatter-result", "");
try { app.doScript(File("$script"), ScriptLanguage.UXPSCRIPT); } catch (e) { app.insertLabel("flatter-result", "error: " + e); }
var r = app.extractLabel("flatter-result");
app.insertLabel("flatter-result", "");
r;
JSX
    osascript -e "tell application id \"com.adobe.InDesign\" to do script (POSIX file \"$runner\") language javascript"
    ;;
  *)
    echo "expected a .idjs or .jsx file" >&2
    exit 2
    ;;
esac
