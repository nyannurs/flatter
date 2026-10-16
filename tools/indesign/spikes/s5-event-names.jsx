// S5: event type constants available in InDesign's DOM (read-only).
var out = [];
var classes = ["Event", "DocumentEvent", "MutationEvent", "IdleEvent"];
for (var c = 0; c < classes.length; c++) {
  var cls = eval(classes[c]);
  var names = [];
  try { var p = cls.reflect.properties; for (var i = 0; i < p.length; i++) if (/^[A-Z_]+$/.test(p[i].name)) names.push(p[i].name + "=" + cls[p[i].name]); } catch (e) { names.push("err " + e); }
  out.push(classes[c] + ": " + names.join(", "));
}
out.join("\n");
