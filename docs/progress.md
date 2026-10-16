# Progress log

Newest entry first. Each entry says what changed, where things stand, and what comes next.

## 2026-10-16: repository set up, Phase 1 core solver and simulator built

**Done**
- Private GitHub repo `nyannurs/rag-indesign-plugin`; `main` holds the plan, README and doc stubs.
- All Phase 1 work is on `main` and pushed to GitHub. The user wants commits directly on `main`, without pull requests.
- npm workspace with TypeScript 7, Vitest 5, fast-check, esbuild.
- `packages/core`: item model, parameters and defaults (§2), line metrics, DP solver with strict and soft modes, phase handling and phase flip, Ausgangszeile rules, Variation, first-line indent, forced breaks, steering widths, independent plan checker with pattern analysis (staircase, hole, mechanical sawtooth), story solving with continuous phase, `evaluateBreaks` for read-back checks, plain-text builder with hyphenation and Sinneinheiten hooks.
- `packages/simulator`: Source Serif 4 metrics, TeX-pattern hyphenation (de-1996, en-US, en-GB), SVG renderer, CLI, live playground.
- Reference texts `test/fixtures/texts/de.txt` and `en.txt`.
- 56 tests: unit, scenario, property tests (about 1,000 random paragraphs per run), a brute-force check that strict mode finds a solution whenever one exists, simulator snapshots of the reference texts, and the MVP alternation target.
- Playground published for the user as a private artifact: https://claude.ai/artifact/SvGpvN2649PeRYDPECqJkp

**Results**
- Reference texts at 60 characters, default settings: German 5/5 paragraphs and 33/33 lines in strict alternation with 7 hyphens; English 5/5 and 30/30 with 4 hyphens.
- Over 55–70 characters (the MVP acceptance range), at least 95 % of paragraphs reach strict alternation in German, US and UK English (asserted in tests).
- Speed: strict solve about 0.04 ms per paragraph; soft fallback about 2 ms; whole reference text 2–6 ms. Plan budget is 100 ms for slider-to-reflow.
- Default band changed from Z/3 to Z/2 after a sweep (ADR-006).
- Bugs found and fixed: soft mode could lose every path when a hyphen pushed the only longer line over the measure (found by property tests); opentype.js path serialization wrote NaN.

**Next**
- Ask the user to try the playground and react to the rhythm, band width and hyphenation. Their answers may change defaults.
- Phase 0 spikes need InDesign (see "Waiting on the user"). Pre-spike notes are in `docs/spike-results.md`.
- Phase 2: `packages/hyphenation` (a separate session was proposed for it; it needs the repository trusted in Claude Desktop before it can start) with consensus classes A/B/C/X, golden corpora (at least 300 words per language), the hard-rule classifier and Sinneinheiten word lists. The simulator currently labels every pattern point class B. Examples it should fix: "Fei-erabend" (prefer "Feier-abend"), a line ending on "ob".

**Waiting on the user**
- Feedback on the playground.
- InDesign version, whether German uses the Duden dictionary, and whether the UXP Developer Tool is installed.
- Their own German and English texts; typical font, size, leading and column width. They created `InDesign Test File/TestFile.indd` (git-ignored).
- Who runs the InDesign spikes: the user, or Claude via computer use.
- Distribution plan (affects which hyphenation pattern licences may be bundled).
- Who acts as the typographer for the final side-by-side review.
