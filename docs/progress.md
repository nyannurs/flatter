# Progress log

Newest entry first. Each entry says what changed, where things stand, and what comes next.

## 2026-10-17 — Fixes after the user's precise-tracking test

The user switched on "Align line ends exactly" (precise Laufweite, max 30, zone 17 %, band 90 %, one hyphen in a row) on TestFile and got "0/106 lines set as planned", "¶1, line 1: InDesign did not break where planned", 1.5 s slider ticks, a report they could not scroll, and an outdated "Consider some Variation" note. Reproduced on a copy of their story with `tools/indesign/spikes/src/i3-user-copy.ts` (10/38 lines as planned before, 38/38 after). Details in `docs/spike-results.md`, decision in ADR-014.

Done:
- **Cause found: ligatures.** InDesign breaks ligatures (Th, fl, ft…) in tracked text, so some tracked lines were up to 1.5 pt wider than planned and lost their last word. Paragraphs are now measured twice (ligatures on and off, +0.6 s on 12,000 characters); boxes carry `trackedExtra`, which the solver adds to tracked lines.
- **Robust steering for tracked lines:** the tooth sits halfway into the room before the next word (up to a quarter em) instead of 0.15 pt past the line; precise tracking keeps lines at least 0.1 em from the measure (`TrackingRules.safety`).
- **Tracking writes:** only changed runs are written, read from the document's style ranges (Undo-safe); overset lines get no tracking. Slider ticks went from ~1.5 s to 50–170 ms on the user's text.
- Each line's last letter is left untracked; the tracking width model is chars − 1 with no hyphen step.
- Base tracking for a paragraph without a record comes from an even paragraph or its paragraph style, no longer from its first letter.
- Panel: the content scrolls; report entries about a line are clickable and select that line in the document; the mismatch message now quotes where InDesign ended the line and where it was planned. The "mechanical pattern / Consider some Variation" warning is gone (even edges are the goal now).

Status: 131 unit tests and both InDesign integration tests pass; the panel is rebuilt and reloaded but not yet tried by the user after these changes.

Next:
- User to try the panel again on TestFile (Recompute first so it measures with ligatures off).
- First Apply on a long story spends most of its time probing InDesign's hyphenation points (72 words ≈ 17–30 s in a fresh document; cached in the document afterwards). Worth speeding up.
- On the user's copy about half the band lines end within 0.5 pt of their edge; the rest are held back by the tracking limit (short lines up to ~24 pt short at ±30). **Open question to the user:** add per-line word-space adjustment so those lines can reach their edges too.

## 2026-10-16 (later): precise Laufweite; Variation removed (ADR-013)

- The designer wants tracking for geometric precision, not as a rescue. New precise mode: every line end pulled onto its edge within ±max, fractional tracking, edges prioritised above hyphen budget and Sinneinheiten. Panel and playground use it, with an edge-precision readout. Variation slider removed.
- Fixed the tracking width model (n − 1 steps per line, measured in InDesign).
- The source-hygiene test had never run (its own regex contained the character it guards against); fixed, and it found and fixed two more literal characters in an old test.
- InDesign: precise Laufweite steers every line as planned (integration test cases added).
- **Open question for the designer:** tracking alone moves a 60-character line by about ±0.6 pt per unit, while word steps are 20–40 pt, so real text stays 10–20 pt off its edges even at ±10–15. Options: larger tracking, per-line word-space adjustment, or both.

## 2026-10-16 (late): fixes after the user's first panel test

The user moved a slider on their TestFile and saw short freezes, an error ("paragraph does not fit on one measuring line") and black panel text on the dark theme. Fixed (details in `docs/spike-results.md`):
- Overset stories: lines read per frame; visible lines steered, overset lines reported.
- Long paragraphs measured over several wide lines; measurements cached while the plugin is loaded.
- Failed Apply undoes its own partial changes; the panel shows "Preparing…", does not retry on every tick, ignores ticks while busy.
- Panel text uses theme-aware Spectrum elements.
- The user's document had partial changes from the failed attempts; they were reverted by undoing only Flatter's undo steps.
- Note for the user: their test story is German text tagged "English: USA", so it gets English hyphenation and no Duden.

## 2026-10-16 (night, cont.): Phase 4 panel built and loaded in InDesign

**Done**
- `packages/panel` (ADR-012): Flatterzone, band and variation sliders; phase, mode and hyphenation pickers; Sinneinheiten, continuous rhythm and tracking rescue; Apply, Recompute, Remove; Live mode; status line and report list. Loaded in the user's InDesign 2026 through the UXP Developer Tool service.
- The adapter's loop is now a session (prepare / plan / steer / verify) so slider ticks re-plan in about 1 ms and only move teeth.
- Spike S4 passed: 42-line frame, 27–32 ms mean and ≤ 95 ms max per tick from slider to recomposed text; every line verified as planned afterwards.
- Teeth are cached, only changed bounds are written, surplus teeth are parked instead of deleted.
- 122 Node tests, both InDesign integration tests pass.

**Next**
- The user tries the panel on their own documents and gives feedback.
- Phase 5: hyphenation review list (approve/forbid points, write InDesign exceptions), violation navigator.
- Phase 6: edit tracking in the panel (afterSelectionChanged + idle hash), Freeze/Unfreeze, document-open checks.
- Phase 7: packaging (.ccx), licences (THIRD_PARTY_NOTICES), user guide.

## 2026-10-16 (later still): Phase 3 InDesign adapter built

**Done**
- `packages/indesign-adapter` (ADR-011): measure, probe and cache InDesign's hyphenation points, merge with our classes, solve, steer with teeth, read back, re-plan, apply tracking for the rescue, check and fix settings, Remove with exact restore, one undo step per Apply and Remove.
- Node tests: 23 for the adapter (fake greedy composer for the loop), plus a source-hygiene test that catches invisible characters. 121 tests in total.
- InDesign integration tests (`npm run test:indesign`, throwaway documents): German and English, two columns, threaded frames, indents and paragraph spacing, tracking rescue: every line as planned; re-apply with the probe cache; Remove restores the original composition exactly; one Undo reverts Apply. Tracking scan over 250–340 pt: 32 of 32 tracked lines set as planned.
- Found and fixed: measuring in place is unreliable (see `docs/spike-results.md`, integration findings).

**Next**
- Phase 4, the panel: needs the UXP Developer Tool (the user is installing it). Then spike S4 (live latency).
- Phase 3 leftovers: edit detection (panel), mixed formatting inside words, tabs, threaded frames of different widths.

## 2026-10-16 (late night): Phase 0 spikes run in InDesign

**Done** (details and numbers in `docs/spike-results.md`)
- S1 steering with wrap teeth: **pass**. 867/867 lines without hyphenation; 858/858 with hyphenation after re-planning (≤ 2 rounds). Fonts Minion Pro and Georgia, 9–12 pt, measures 220–340 pt, leading 1.0–1.5×.
- S2 measurement: unhyphenated lines exact; hyphenated ±0.16 pt; InDesign squeezes lines up to ~0.3 pt too wide.
- S3 hyphenation points: no API; probing works at ~8 ms per word. Duden Preferred Aesthetic refuses many of our syllable points and keeps joints.
- S5 events: no text-edit event; listeners only in the panel. A test listener caused an error dialog for the user; it was removed (by the user's click and by id afterwards).
- S6 layout: works with columns, threading, baseline grid, hidden/non-printing teeth; breaks with optical margin alignment, "ignore text wrap", and teeth below the text when "wrap only affects text beneath" is on.
- S7 Duden: default vendor; style scriptable via `providerHyphenationStyle`; "All" (InDesign's default) allows Urins-tinkt and bein-halten.
- `@flatter/hyphenation` now uses the `hyphen` package's synchronous core (the per-language entry points fail in UXP).
- Plan amendments listed at the end of `docs/spike-results.md`; `docs/plan.md` points to them.

**Next**
- S4 (live latency) needs the panel: the user installs the UXP Developer Tool.
- Phase 3, the InDesign adapter, can start: measure, probe and cache points, solve, steer, read back and re-plan, settings check and fix, single undo step.

## 2026-10-16 (night): InDesign access confirmed

- InDesign 2026 (21.6) is installed; Duden is already the German hyphenation vendor (no setup needed). Details in `docs/spike-results.md` (S7, partial).
- Claude can run ExtendScript and UXP scripts in the running InDesign from the terminal: `tools/indesign/run.sh`. This answers "who runs the spikes": Claude, through scripting.
- The UXP Developer Tool is not installed yet. The user was given install steps; it is only needed for the panel (Phase 4) and spike S4.

**Next**: Phase 0 spikes S1, S2, S3 in InDesign, in a new test document (never the user's TestFile.indd).

## 2026-10-16 (evening): tracking rescue (Laufweite) added

**Done**
- Core: opt-in tracking assist (`tracking: { enabled, max, emSize }`), off by default. Used only when a paragraph cannot be set strictly without it, on band lines only, smallest whole value in 1/1000 em, tighter or looser. Reported per line; `PlannedLine.tracking` carries the value for the InDesign adapter. `evaluateBreaks` accepts read-back tracking per line.
- Suggested maximum ±3/1000 em, chosen from a sweep (ADR-010).
- Simulator, CLI (`--tracking <max>`) and playground (Laufweite switch and slider) support it; tracked lines are drawn with the extra spacing and marked in the margin. The playground artifact is republished at the same link.
- Tests: 98 passing, including tracking scenarios, property checks (whole units, within the limit, band lines only, never used when not needed) and the MVP target with tracking.

**Results**
- With tracking at ±3: German reaches 97.5 % strict alternation at 55–70 characters (93.8 % without), English 100 %. About 2 lines in 100 are tracked.

**Waiting on the user (resolved)**
- Tracking question: answered by ADR-010.

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
- UXP Developer Tool installation (only needed for the panel).
- Their own German and English texts; typical font, size, leading and column width. They created `InDesign Test File/TestFile.indd` (git-ignored).
- Distribution plan (affects which hyphenation pattern licences may be bundled).
- Who acts as the typographer for the final side-by-side review.
