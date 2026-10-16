// S7: look for a scriptable Duden hyphenation style in app preferences and paragraph attributes (read-only).
var hits = [];
function props(o) { var r = []; try { var p = o.reflect.properties; for (var i = 0; i < p.length; i++) r.push(p[i].name); } catch (e) {} return r; }
var top = props(app);
for (var i = 0; i < top.length; i++) {
  var n = top[i];
  if (/hyph|duden|dictionar|vendor|aesthetic|composition/i.test(n)) hits.push("app." + n);
  if (/Preferences$/.test(n)) {
    var sub = [];
    try { sub = props(app[n]); } catch (e) {}
    for (var k = 0; k < sub.length; k++) if (/hyph|duden|vendor|aesthetic|style/i.test(sub[k])) hits.push("app." + n + "." + sub[k]);
  }
}
var ps = props(app.paragraphStyles[0]);
for (var j = 0; j < ps.length; j++) if (/hyph|compos|ragged|balance/i.test(ps[j])) hits.push("ParagraphStyle." + ps[j]);
hits.join("\n");
