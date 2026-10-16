# Flatter

Strict alternating rag (Flattersatz: long, short, long, short) for Adobe InDesign, as a UXP panel plugin.

Status: design phase. The full architecture and implementation plan is in [docs/plan.md](docs/plan.md).

## Layout (planned)

```
packages/
  core/              solver, pure TypeScript, no InDesign APIs
  hyphenation/       patterns, consensus, classifiers
  indesign-adapter/  all InDesign DOM access
  panel/             UXP UI
  simulator/         opentype.js + SVG dev harness
test/
  fixtures/          .indd/.idml test documents
  hyphenation/       golden corpora
docs/
  plan.md            architecture and implementation plan
  spike-results.md   Phase 0 findings
  decisions.md       architecture decision records
```
