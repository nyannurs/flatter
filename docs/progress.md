# Progress log

Newest entry first. Each entry says what changed, where things stand, and what comes next.

## 2026-10-16 (later): Phase 2 hyphenation module built

**Done**
- `packages/hyphenation`: TeX patterns as stand-in authority, an independent second opinion, consensus classes A/B/C/X, hard rules, curated exceptions per variety (de, en-US, en-GB) that also cover inflected forms, ambiguous words, misleading English splits, a never-hyphenate token check, and Sinneinheiten break costs for German and English. An InDesign probe can later replace the authority through the `authority` option.
- German second opinion: rule syllabifier after the Regelwerk 2006 (ck/ch kept, last consonant to the new line, § 112 options, no single vowel at word or part edges) plus a compound and prefix splitter over a curated stem lexicon with umlaut variants. Ambiguous parses are detected automatically.
- English second opinion: the other variety's patterns, so only breaks both US and UK practice accept are trusted. British English also keeps short word parts whole (inter-, after-, paper-).
- Golden corpora: German 482 words, US English 430, British English 426. All pass: no Safe point outside the acceptable divisions, no wrong class A. Safe mode can use 91 % (de), 73 % (en-US) and 80 % (en-GB) of acceptable breaks.
- Pattern licences checked (ADR-008); notices in `THIRD_PARTY_NOTICES.md`.
- The simulator and playground now use the module, with switches for Sinneinheiten (default on for German, off for English) and Safe/Normal hyphenation. The playground artifact is republished at the same link.
- 89 tests pass.

**Results**
- Reference texts at 60 characters: still 5/5 paragraphs in strict alternation in German and English. German now breaks at joints (ent-stehen, Feier-abend, voll-ständig) where it used to break at syllables.
- MVP target at 55–70 characters: English 98.8 %. German 93.8 % (75 of 80), just under the 95 % target. The five misses are at 55–58 characters: three long lines short of their band by 1.4–4.5 pt, two paragraphs that would need three hyphens in a row. A 10 % wider band, or the optional tracking assist (Laufweite), fixes all five. The test records the German baseline until the designer decides.

**Waiting on the user (new)**
- Tracking assist (Laufweite): the user asked whether the solver uses it. It does not (ADR-002 set it off). Ask whether to add it as an opt-in rescue for near-miss lines, and the maximum (plan §4.3, §11.5).
- Review of the golden corpora. They were written from the rules and dictionary practice, not checked against Duden, Merriam-Webster or Oxford directly. British entries left out because the division is uncertain: particular, serious, violence. Debatable German points currently withheld (class C): In-stinkt / Ins-tinkt, Pro-gramm / Prog-ramm (§ 112).
- Optional improvement: the "Freie Wortlisten und Trennmuster" word list (marks compound joints explicitly) would give far better class A detection than the hand-made stem lexicon. Downloading it needs the user's go-ahead; check its licence first.

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
