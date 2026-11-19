# Progress log

Newest entry first. Each entry says what changed, where things stand, and what comes next.

## 2026-11-19 — Preview on a selection, Set whole story (ADR-032); release 0.6.6

The designer (0.6.5 works, but a long three-column story is still slow) asked to tune settings on a few highlighted paragraphs and then apply them to the whole story in one go, frozen if faster; and that Laufweite must be quick there too.

- **Panel**: selected text → Apply and sliders work on those paragraphs only; the story line shows "Selected: paragraphs 3–7". New button **Set whole story**; hint under the buttons. Unfreeze of a long story without a selection does not set it live again.
- **Adapter**: `DomPort.only`, `openSession(..., { paragraphs })`, `FlatterSession.bakeList()` (spans and break positions per paragraph), `DomPort.bake()` with `BAKE_SCRIPT`, `setWholeStory()`; `unfreezeInPlace` resets tracking and removes frozen characters by GREP (condition), with the old loop as fallback.
- **Tests**: `bake.test.ts` (the break list splits every paragraph into exactly its planned lines; hyphens where planned). `i45-set-whole` (now in `test:indesign`): preview on paragraphs 3–6 (42/42 lines), Set whole story on 8 three-column pages with centred heads every 20 paragraphs (152 paragraphs, 1,574 lines, 0 missed, no teeth left), Unfreeze gives the original text back, set again, Remove gives text and tracking back.
- **Speed** (8 pages): Set whole story 57 s → 22 s and 112 s → 17 s for the second run, by inserting the breaks before the tracking and resetting old tracking first. Laufweite: about 8,000 writes in 6–7 s at full priority. Unfreeze 0.6 s.
- Not measured inside the panel (only as scripts). Measuring (6 s here) still runs in the panel, so it may take longer there.
- Release 0.6.6 packaged, published and installed in place of 0.6.5.

## 2026-11-18 (night) — 0.6.3 and 0.6.4 did not start; release 0.6.5

The designer: "I click on a story, hit apply, and literally nothing happens." InDesign had no Flatter selection listener: the panel's `init()` never ran. The only change to the panel's start-up since 0.6.2 was a `plugin: { destroy }` hook in `entrypoints.setup` (added to remove the selection listener on unload, after the UDT reload dialogs); with it, setup apparently threw before `init()`, and nothing showed in the UXP log. The dev panel had shown the same symptom (loaded, never answered), wrongly put down to the panel not being shown. 0.6.5 removes the hook and calls `init()` whatever `entrypoints.setup` does. Released and installed in place of 0.6.4.

## 2026-11-18 (evening) — Steering writes at full priority (ADR-031); release 0.6.4

The designer asked for the next speed fixes without waiting for them to test.

- **Where the time went** (8 three-column pages, precise Laufweite with word spaces, profile of the DomPort methods): `setTracking` 58 of 61 s, 18,646 writes at about 3 ms each.
- **Tried and dropped**: GREP for a line's word spaces (`i43-track-writes`: 25 % faster in a fresh document, but each `changeGrep` costs about 6 ms, and the settings check after Apply went from 6 s to 140 s); FAST_ENTIRE_SCRIPT (no gain); measuring in a script (slower in a script context).
- **Kept**: story-relative tracking writes (Apply 61 → 49 s) and **batched writes in a script** (`beginWrites`/`endWrites`, `BATCH_SCRIPT`, at least 600 writes): Apply **49 → 24 s** in a script context (steering 35 → 15 s, settings check 6 → 1 s), 1,584/1,584 lines, no fallbacks. Inside the panel the gain should be larger (panel DOM calls 6–10 times slower), but that was not measured: a dev panel loaded through the UXP Developer Tool only starts once its panel is shown, and invoking its menu action (`app.menuActions`, "Flatter (dev)", area "Panel Menus") did not show it.
- `i44-script-start`: starting a script 0.2 s, `require('indesign')` in it 1.3 s; 142 KB of JSON as argument is cheap.
- Slider moves on long stories are still slow (8 pages: draft about 6 s, word spaces about 14 s), most of it the writes themselves (about 1 ms each even at full priority). Next options: write only the lines whose values changed (already done per span; most change when the zone moves), fewer word-space writes, combs (2–3 times faster ticks for the teeth part), chunked work with progress and Cancel.
- Release 0.6.4 packaged, published and installed in place of 0.6.3.

## 2026-11-18 (later) — Long multi-column stories settle in one pass (ADR-030)

The designer chose to fix the rounds first.

- **`flow.ts`** (pure): `predictSlots` pours the planned lines into the read-back columns in story order. Read-back slots now carry `column` (flow order through frames and columns) and `columnBounds` (before text wrap); `ParagraphData` carries `leftIndent`, `spaceBefore`, `spaceAfter`, `hyphenateAcrossColumns`; `Port.narrow` gives a column's width at a baseline after other objects' text wrap. `FlatterSession.steer` uses the prediction (a line that stays put keeps its read-back slot); without column ids it falls back to the old placement.
- **Column-end hyphens**: `avoidColumnEndHyphens` (in `plan` and before each re-steer) takes hyphenation points out of lines the prediction puts at the end of a column or frame when "Hyphenate Across Column" is off. That was the cause of the remaining rounds: one refused hyphen per round, each moving every later line.
- **Diagnostics**: `ApplyResult.roundLog` (per round: paragraphs off plan, re-planned for widths, refused points, set as planned but elsewhere). The benchmark (`packages/panel/src/bench.ts`, `i41-speed`) takes `maxRounds` (0 = only the first steering pass, with planned, steered and read-back positions of the first wrong paragraphs).
- **Fake composer**: columns (`columnLines`, `hideColumns` for comparison, no space before at a column top) and `hyphenateAcrossColumns: false`. Tests `flow.test.ts`: prediction unit tests; 36 paragraphs through 14-line columns settle in ≤ 3 rounds (with and without space before) while the old placement needs more; no hyphen on a column's last line and no refused points.
- Fake composer, before → now: 120 paragraphs 11 → 2 rounds; 300 paragraphs 783/1,500 → 1,500/1,500 lines in 3 rounds.
- **InDesign** (8 facing pages, three columns, 62,000 characters, precise Laufweite with word spaces, script run to completion): 762/1,513 lines in 12 rounds and 129 s → **1,584/1,584 after one steering pass, 62 s**. Slider move: draft 6.8 s, word spaces 16 s, verify 1.2 s (was 22 s).
- What is left of the 62 s: the first steer (about 45 s), nearly all of it tracking writes (one per line plus one per adjusted word space, about 15,000 here). Next: write word-space tracking per line in one call instead of per space, run the work as a script from the panel (6–10 times faster DOM calls), combs instead of teeth, chunks with progress and Cancel.
- Release 0.6.3 packaged, published, and installed in InDesign 2027 in place of 0.6.2 (removed first with `UnifiedPluginInstallerAgent --remove "Flatter"`).

## 2026-11-18 — Why long multi-column stories are so slow: research and measurements

The designer tests long stories on facing pages with three columns each and has had to force-quit InDesign several times. They asked for research first, then allowed measurements in throwaway documents. Findings (details and tables in `docs/spike-results.md`, "Speed of long stories in multi-column spreads"):

1. **The panel's own DOM calls are 6–10 times slower** than a script InDesign runs to completion (Adobe: plugin DOM calls are time-shared). Flatter calls `app.doScript` with a function, which is only partly faster. Running the heavy work as a separate script (`app.doScript` with the script's text) measured 0.8 s against 5.3 s inline.
2. **"async" in the script text** made InDesign run every spike asynchronously (the `hyphen` package's error message); `build-spikes.mjs` rewrites it. Earlier spike timings were measured in that slow mode.
3. **Lines do not converge in multi-column flows**: a full Apply on 8 three-column pages ran all 12 rounds and set only 762 of 1,513 lines as planned (129 s even as a fast script). Each round settles about one column boundary, because teeth are placed at the slots the lines had before the plan changed the line counts.
4. **One comb per column** (one polygon with 1 pt spikes) sets exactly the same lines as one tooth per line, with 72 objects instead of 4,752 on 24 pages: creating 0.2 s instead of 7.6 s, a tick 0.9 s instead of 3.0 s.

Also this session:
- InDesign 2027 (22.0) replaced 2026 on the designer's Mac; Flatter 0.6.2 is installed there. Process name `Adobe InDesign 2027`.
- Reloading the dev panel left selection listeners behind ("Script context is not available anymore" dialogs). Removed by id (17, 18, 19); listener 6 disappeared too during a later unload, possibly the installed Flatter's (a restart restored everything). The panel now removes its listener in `plugin.destroy` (not verified yet).
- `run.sh` allows scripts an hour (Apple event timeout was two minutes); dev build gets `localFileSystem: fullAccess`; dev command `bench`; spikes `i41-speed`, `i42-comb`; shared benchmark `packages/panel/src/bench.ts`.

Proposed next steps (not started; waiting for the designer):
- **Predict where planned lines land** (the same sequence of baselines, filled in story order) instead of reusing each paragraph's old slots, so a long multi-column story settles in two or three rounds instead of running out of rounds.
- **Run Apply, ticks and verify as a script** through `app.doScript` with the script text (built without "async"), loaded once per session.
- **Combs instead of teeth** (needs the same steering semantics: idle teeth, tracked-line margins, per-page pooling, Freeze removes them).
- **Work in chunks with progress and a Cancel button**, so InDesign stays responsive and never needs force-quitting.

## 2026-11-02 (later) — Languages inside a paragraph (ADR-028); scope (ADR-029)

The designer asked where Flatter could misbehave in larger editorial projects. The main risk is architectural: teeth are fixed to the page, so text or layout changed while Flatter is not watching (no Apply, a colleague without the plugin, InCopy, placed text updated) breaks the rhythm. Untested so far: footnotes, tables, text on a path, GREP and nested styles that depend on breaks, span columns, Books, IDML round trips, packaging, other languages. The designer decided Flatter stays a bespoke tool for them and a few colleagues (ADR-029) and asked to look at mixed fonts and languages inside one word first.

- **Spike `i32-mixed-inline`** (now in `test:indesign`): a German paragraph in Source Serif Pro at two widths with English words, an English opening quote, English halves of compounds, [No Language] words, bold/italic/other font/bigger size inside words, and a bold run-in head.
  - Before: fonts, styles and sizes inside words were already fine (all lines as planned, one round). Languages were not: the paragraph opening in English was planned as English (no hyphenation at all at 190 pt); English words were classified as German and probed in German ("reada-" refused); [No Language] words cost 9 to 11 rounds of refusals.
  - After: every case sets all lines as planned, in one round (three for "Corporate-Design-", where InDesign refuses breaks after typed hyphens in a mixed compound). English words break by English rules ("readabil-ity", "commu-nication"); the paragraph opening in English hyphenates German again.
- **Adapter**: `languages.ts` (pure): `paragraphLanguages` (runs clipped to a paragraph, language of most letters), `languageOf`. `readLanguageRuns(story)` in `dom-port.ts` reads the runs from text style ranges (6,400 ranges in a tracked 60-paragraph story: 0.3 s, after InDesign composed it). `ParagraphData.languages`, `Port.probe(words, paragraph, language?)`, `PointSource(word, at)`, `knownHyphenLanguage`. `readSettings` uses the paragraph's main language.
- **Tests**: `languages.test.ts` (main language, runs, English word by English rules and probed in English, no points in [No Language] or mixed words, class C only for other languages). The fake InDesign takes language runs and records its probes.
- Not in the edit signature: changing only the language of some characters (without other edits) is not noticed until Recompute; tracking writes split text style ranges, so the ranges cannot be part of the signature cheaply.

Next, from the editorial review: footnotes, tables and GREP/nested styles that depend on breaks are the untested cases most likely in the designer's and colleagues' projects. Release 0.6.2 with this change packaged, installed and published (2026-11-02).

## 2026-11-02 (evening) — Playground: animation duration

- "Duration" slider next to "Watch Flatter choose" (2 to 60 s, default 8 s, remembered per browser). Moving it while the animation plays keeps the current position and plays the rest at the new speed. Fix: the final frame ("Flatter's choice") is always drawn, also when the last variant was reached before the end. Artifact republished (version 10).
- The preview page leaves fixed room for tracking labels of up to 14 characters (`render.ts`); they were cut off with large word-space changes. Fixed room, not a width per frame: a width that followed the labels made the page change size between animation frames.
- **Before Flatter**: until the animation has played through once (per page load), the preview, status and report show the text as a plain composer sets it (greedy first fit, `plainVariant` in `variants.ts`), with a hint to press ▶. The animation starts from that version and ends on Flatter's; from then on the playground shows Flatter's result. Stopping the animation early returns to the plain version. For showing Flatter to others.
- **Variants drawn without Laufweite**: with Laufweite on, the animation drew each variant with the tracking its scoring gave it, and since random lines miss the bands most were pushed to the largest tracking and word spaces (10,861 of 13,457 lines in the German sample). That stretched lines and pushed some past the edge. Variants are still scored with Laufweite but drawn as a composer sets them; only Flatter's plan shows tracking. Artifact version 12.
- **No one-word lines in the variants**: random walks could break after a single word when the rest of a paragraph was short ("der", "Blick", "vor" on lines of their own). Variant lines other than a paragraph's last are now at least 60 % of the measure (`MIN_LINE_SHARE`; the longest fitting line when nothing qualifies); `variants.test.ts` checks it. Artifact version 13.
- **Before / After switch** next to the play button: Before shows the plain composer's version, After Flatter's (preview, status and report). The page opens on Before; the animation ends on After; the switch sets either at any time, e.g. back to Before after tweaking settings, then play. Artifact version 14.
- The closing "Flatter's choice" message is gone, and the line beside the play button is one line high at most (ellipsis): the message wrapped and pushed the preview down at the end of the designer's screen recordings. The preview now stays in place from start to end. Artifact version 15.

## 2026-11-02 — Playground: colour pickers

- New "Colours" section in the playground sidebar: background (paper), text, long band, short band (in functional style the one zone uses the long band's colour), and one "Band strength" slider for the bands' opacity (default 12 %, as before). The page edge line and the marker labels follow the text colour. The legend swatches follow the band colours. "Reset colours" restores the defaults.
- The choice is remembered per browser (localStorage, wrapped in try/catch). The "Watch Flatter choose" animation uses the same colours.
- Only the preview page changes colour; the sidebar keeps the light/dark theme.
- Published to the same artifact link (version 9).

## 2026-10-30 (night) — Long stories: faster, exact beside images, headings left alone; stress-test file; release 0.6.1

Fixes for what the stress test (`i31-stress.ts`) found, plus a stress-test document for the designer.

- **Measuring in one copy** (`DomPort.measureParagraphs`): all paragraphs that are not cached are copied to the hidden bench document at once (chunks of up to 200,000 characters), with column, frame and page breaks turned into returns and keep options, drop caps and baseline-grid alignment off; leading 2 pt. Was one copy per paragraph at about 0.5 s each in a long threaded story. 80 paragraphs: 38 s → 3.4 s.
- **Discretionary line breaks** (U+200B) are break opportunities without a hyphen; URLs no longer keep a paragraph from settling.
- **Text wrap of other objects** (images, other frames; not Flatter's teeth or band strips): read once per session; a line beside an object is planned at the width InDesign leaves it (object at the column's left edge moves the start, any other ends the line). Jump-object and next-column wraps are left out (InDesign moves those lines).
- **Centred, right-aligned and binding-side paragraphs are left alone** (ADR-026): no plan, no forced settings, alignment part of the edit signature. Justified paragraphs are still set ragged.
- **Read-back rounds**: up to 12 (was 6), stopping after three rounds without progress (fewer paragraphs off plan, or a newly refused hyphenation point). Multi-column stories settle a column boundary at a time.
- **Tracking writes**: a paragraph whose spans are the same as last written is skipped without reading the document; a paragraph whose lines come back wrong is forgotten and read again (`forgetTracking`). Remaining cost is the writes themselves (about 2 ms each; one per line plus one per adjusted word space).
- **Alarm with a tab**: `steeringFailed` counts the paragraphs without unsupported content instead of switching off for the whole story.
- **Property test**: the "tracking only as a rescue" check applies to the aesthetic style only; the functional style may rescue a line outside the zone although an untracked plan exists (ADR-021). Found by a random seed that also fails on older code.
- **Correction**: "OpenType All Small Caps" is `CAP_TO_SMALL_CAP` in scripting; the name used in `i27` did not exist, so that case had run in normal case. It is affected by the ß problem like the others.
- Results, story of 152 paragraphs / 51,600 characters / 22 frames: Apply 181 s → 44 s, lines as planned 622/913 → 875/904, after one slider move 901/904. 80 paragraphs: 57 s → 21 s, 593/593. The few remaining lines oscillate by one line at a column top in a 3-column frame (open).
- **Stress-test document** for the designer: `tools/indesign/spikes/src/i40-stress-file.ts` writes `InDesign Test File/Flatter Stress Test.indd` (since 2026-10-30 in Source Serif Pro: the designer's Mac has only Minion Pro Regular, so Minion Bold and Italic were missing; the generator now refuses fonts that are not installed. The second build is `Flatter Stress Test 2.indd`, because the first was open) (git-ignored; app label `flatter-stress-path` = the path). 24 pages in millimetres, twelve cases each with a note on the locked, non-printing layer "Test notes" (what to do, what to expect), and a contents page.
- Release 0.6.1 packaged, installed and published.

Open: slider moves on very long stories with word spaces are still slow (152 paragraphs: about 3 s for the draft, 6 s for the word spaces, 3 s verify); a further step would be to steer only the pages in view.

## 2026-10-30 (evening) — Stress test with long, mixed stories

The designer asked how Flatter copes with very long threaded stories, varied layouts, paragraph styles in sequence, special characters and every kind of break. `i31-stress.ts` (not in `test:indesign`, it takes minutes) builds such a story; results in `docs/spike-results.md` ("Long stories with mixed layout"). In short: an article of about 40 paragraphs works (19 s Apply, 1–2 s per slider move, 389/399 lines), a 150-paragraph story is too slow (3 min Apply, 3–9 s per slider move) and less exact (622/913 lines).

Next, proposed to the designer: speed for long stories; discretionary line breaks; leave centred and right-aligned paragraphs alone instead of forcing them left; keep the alarm and automatic re-measure working when one paragraph contains a tab; find the cause of the long story's mismatches.

## 2026-10-30 (later) — Shape ↔ Sense slider (ADR-025); release 0.6.0

From the same Instagram post ("here the shape won"): how much Sinneinheiten may cost the shape is a matter of taste, so it is now a slider in the panel and the playground.

- **Core**: `senseBalance` (0 to 1, default 0.5 = unchanged behaviour, snapshots unchanged) scales the Sinneinheiten weight with `senseMultiplier`: ×0 at 0, ×1 at 0.5 (quadratic below), up to ×16 towards 1 (exponential). At 1, Sense first: spaces that carry a Sinneinheiten cost are no longer break candidates (`ResolvedParams.senseFirst`), so the solver lets the rhythm or the zone give way instead (strict may fail and fall back to the other phase or soft).
- Measured on the German sample at 60 characters: plain aesthetic hardly changes with the weight (its bands are hard, few alternatives), precise aesthetic goes from 7 broken units (edges within 14.6 pt) to 1 at ×16 (edges within 26.2 pt), functional from 9 to 0. Sense first: 0 broken units, the playground shows 32/33 lines in rhythm.
- **Playground**: slider under Sinneinheiten ("Shape only", "Balanced", "weight ×n", "Sense first"); artifact republished.
- **Panel**: slider "Shape ↔ Sense" under Sinneinheiten with a hint line; disabled when Sinneinheiten is off; stored per story with the other settings.
- Tests: `sense-balance.test.ts` (multiplier ends, Sense first never breaks a unit in any style, fewer broken units towards Sense); `i30-sense-balance` in `test:indesign` (aesthetic, precise, functional × 0 / 0.5 / 1: all lines as planned, Sense first 0 broken units).
- Release 0.6.0 packaged, installed and published.

## 2026-10-30 — Playground: "Watch Flatter choose"

The designer saw an Instagram post by someone with a private InDesign script built on the same idea (score whole-paragraph variants, keep the best; his video shows the variants sorted worst to best) and wanted a similar animation in the playground.

- **Core**: `scoreBreaks(items, settings, breaks, startRole, tracking)` scores one given set of breaks with the solver's own costs: the dynamic program runs with only those breaks as candidates (`ParagraphMetrics` takes an optional `only` list) and every line ending at the next one (`runDP(..., exact)`), in soft mode so rule breaks are priced. For Flatter's own breaks it returns exactly the plan's cost.
- **Simulator**: `paragraphVariants` (src/variants.ts) builds up to 300 plausible break sets per paragraph (greedy first-fit, as a plain composer would set it, and random rags of varying looseness), scores each, sorts them worst to best (rule breaks first, then cost, as the solver tries strict before soft) and puts Flatter's plan last. `simulate` now returns each paragraph's solve settings. Test `variants.test.ts`: Flatter's breaks score the solver's cost, and no variant beats a strictly solved plan (German and English; plain, precise, functional).
- **Playground**: a "Watch Flatter choose" button above the preview plays all paragraphs' variants from worst to best in 8 s (slowing towards the end; ten still steps with reduced motion), with a counter (variant, rule breaks, cost in compact notation) and a progress bar, ending on Flatter's choice and its solve time. Any control change stops it. Checked in the browser at desktop and phone width. Artifact republished (same link).

Idea from the same post, not built: a Shape ↔ Sense slider (how much Sinneinheiten may cost the shape), since readers notice short words at line ends.

## 2026-10-28 — Crash on paragraphs that start with a forced line break; release 0.5.4

The designer applied 0.5.3 to a long story with several paragraph styles and got the magenta alarm with "TypeError: Cannot read properties of undefined (reading '1') at plannedLastVisible … firstMismatch … FlatterSession.verify". Reproduced offline: a paragraph that starts with a forced line break plans an empty first line (no characters), and the comparison with the read-back looked up the character before item 0. Paragraphs of only spaces, no-break spaces or line breaks crashed in verify too (a planned line missing when InDesign set more lines than planned).

- `plannedLastVisible` takes the planned line: a line without characters counts its first character, as the read-back does (a line of only a forced break reports that break as its last visible character). Tracking spans skip empty lines.
- `prepare` leaves out paragraphs with nothing visible (only spaces or line breaks); they get no plan and no teeth.
- `verify` and `result` no longer assume a planned line exists at the first difference (InDesign may set more lines than planned).
- The fake composer in the adapter tests breaks at U+2028 like at "\n". New tests: nine unusual paragraphs (forced break first, last, twice, only breaks, only spaces, only no-break spaces, only tabs, spaces first, two characters) plus "sets the lines of a paragraph that starts with a forced line break as planned".
- `i29-mixed-paragraphs` in `test:indesign`: three paragraph styles (16/19 Bold, 10/13 Regular, 8/10 Italic), an empty paragraph, one of spaces only, one starting with a forced line break, one with two forced breaks inside; aesthetic, aesthetic precise and functional all set every line as planned. The test can log progress to a file (app label `flatter-progress-file`; UXP's fs has no appendFileSync, so it rewrites the file).
- A first run of i29 got no answer from InDesign for ten minutes; the designer found InDesign misbehaving and quit it. After a restart the same test ran in 4 s. Note: `pgrep -f ".../Adobe InDesign 2026$"` also matches AdobeIPCBroker (its command line ends with InDesign's path); use `pgrep -x "Adobe InDesign 2026"` for InDesign's own process.
- Release 0.5.4 packaged, installed and published.

## 2026-10-27 (evening) — Automatic re-measure, measure cache keyed on all width settings, ß in capitals; release 0.5.3 (ADR-024)

The designer got the alarm again (0.5.2): "only 18 of 53 visible lines were set as planned" on story 1636 in Layout1.indd, after Language → Apply → four slider moves; they pressed Remove afterwards. Nothing reproduced it outside their panel: copies of the story set 53/53 with and without leftover tracking, with the panel's slider sequence (`i25-ticks-copy.ts`), with the document's probe cache and the neighbouring frame, and with the whole history replayed (`i26-history.ts`: Flatter at 14/17 wide, duplicate, 12/15 narrower, language, Apply, ticks). Every earlier case was cured by Recompute, so the remaining suspect is measurements that no longer match the story.

- **Automatic re-measure** (panel): when most lines miss (`steeringFailed`, the same test as the alarm), the panel measures again once, as Recompute does, and raises the alarm only if that does not help. The status then says "Measured again automatically". Tested in the real panel through the dev channel (`{"cmd":"recovery"}`: a capitalization change after Apply, which the live session does not notice; 22/22, then 25/25 after the automatic re-measure, no alarm).
- **Alarm details** now say what led to the result (Apply, slider, language change, automatic re-measure…), the story id, the document units, rounds, the first line that differs (planned and actual end, widths) and the settings, plus the first failure when the automatic re-measure did not help.
- **Measure cache key**: all width-relevant character attributes of every style range (capitalization, OpenType features, position, ligatures, kerning method, tracking, …), not only the first letter's font, size and tracking. Small caps reused the measurements of plain text before (0/22). The probe key includes capitalization; probe cache version v3.
- **ß in All Caps and Small Caps**: InDesign's line breaker needs more room for ß than it draws (one ß: +6.5 pt in Minion Pro 10 pt small caps, +1.9 pt in all caps; four ß: +37 pt / +24 pt; not additive), so those lines break early. Flatter reports it as unsupported content ("ß in All Caps or Small Caps") instead of raising the alarm. Capitals without ß set exactly. (Correction 2026-10-30: "OpenType All Small Caps" in InDesign's menu is `CAP_TO_SMALL_CAP` in scripting and is affected too; the test's `OPENTYPE_ALL_SMALL_CAPS` does not exist, so that case had run in normal case.) (`i27-capitals` in `test:indesign`).
- Spikes: `i25-ticks-copy.ts` (copy plus the panel's slider sequence; app label `flatter-i25-extras` = `probes`, `neighbours`), `i26-history.ts`, `i28-caps-drift.ts` (letter-by-letter comparison of a line).
- Release 0.5.3 packaged, installed and published.

Open: the trigger of the designer's 18/53 is still unknown. If the alarm comes back with 0.5.3, its details now name the action and the first line that differs.

## 2026-10-27 (later) — Duplicated Flatter frames measured without leftover tracking; release 0.5.2 (ADR-023)

The designer got the alarm "only 22 of 46 visible lines were set as planned" (0.5.1, Layout1.indd, a story in Avara Bold 14/16); Recompute fixed it. The undo history showed Duplicate before the Apply, and the document holds a duplicated Flatter story (1636) that carries Flatter's tracking but no Flatter record: InDesign does not copy story labels when a frame is duplicated. Apply on such a copy measured the text with the leftover tracking, then wrote its own tracking over it, so the lines no longer matched the measurements. Recompute worked because the first Apply had recorded the base tracking and Recompute clears the measure cache.

- Fix: when Laufweite is on, Apply resets paragraphs with mixed tracking and no record to their base (`DomPort.resetLeftoverTracking`, base from `baseTrackingOf`) before measuring and records it, so Remove restores it. The measure cache key now includes the tracking of the whole paragraph, not only of its first letter.
- `i24-duplicate` in `test:indesign`: original 29/29, the duplicate 4/29 before the fix, 29/29 after; tracking 0 after Remove.
- Spike helpers: `i21-font-mismatch.ts` copies any story (app labels `flatter-i21-story`, `-settings`, `-layout`) and now resets tracking on the copy (`flatter-i21-keep-tracking` = `yes` keeps it); without the reset its copies failed for the same reason (3/46, 30/46). `i23-tracking-features.ts`: in isolation the width model is exact for Avara and Minion with tracking.
- Release 0.5.2 packaged, installed and published.

## 2026-10-27 — Edits after Apply are measured again; release 0.5.1

The designer got the compatibility alarm "only 0 of 49 visible lines were set as planned" (Flatter 0.5.0, InDesign 21.6, a one-paragraph story in Avara Bold 14/16 in Untitled-1). On a copy the same story set 49/49 with all settings and the same facing-pages layout. Cause: the designer had deleted "Avara Bold 14/16 " from the start of the paragraph after Apply; the live session kept planning with the old measurements, so every line was off from the first one. Reproduced exactly (`i22-edit-after-apply.ts`: 49/49 before, 0/49 and the same alarm after the edit).

- Fix: `storySignature` (text plus size, font, horizontal scale, kerning and language per paragraph; tracking left out because Flatter writes it) is stored with the live session; `liveIsStale` compares it. The panel measures again (a new Apply) before a slider tick or a verify when the story changed. The alarm text now also suggests Recompute after edits.
- `i22-edit-after-apply` is part of `test:indesign`: Flatter's own tracking ticks do not count as an edit; deleting text and changing the type size do; measuring again gives all lines as planned.
- Not an InDesign compatibility problem: the alarm did its job, but for a Flatter bug.
- Release 0.5.1 packaged, installed and published.

## 2026-10-20 — Functional style (ADR-021); release 0.5.0

The designer asked for a second algorithm next to the aesthetic long/short rhythm: a functional Flattersatz after the we.type guide "How to Flattersatz" (https://wetype.xyz/share/how-to-flattersatz), with Flatterzone, band and Laufweite still adjustable.

- **Core**: `style: 'aesthetic' | 'functional'` (default aesthetic, unchanged; snapshots unchanged). Functional: every band line ends inside [0, Z] (hard in strict, scaled per line measure); `flutter` cost when neighbours differ by less than the band; `staircase` cost for three lines in one direction; `pauseless` cost for a break at a space without punctuation before it (reading pauses); Sinneinheiten weight ×4; centring cost pulls lines gently towards the measure; no phase flip; Laufweite rescues lines outside the zone with letters and word spaces (`splitAdjustment`, fractional), from the start. Checker: one "outside the Flatterzone" error per line, no contrast, no last-line role rule. Tests: `functional.test.ts`, functional style in the property tests.
- **Sinneinheiten** (both styles): two capitalised words in a row (first and last name, proper names: "Max Planck", "Nxt Museum") and German titles with a name ("Frau Müller").
- **Adapter**: band view draws one teal zone strip ("Flatter Zone" colour) in the functional style.
- **Panel**: Aesthetic / Functional buttons at the top of the RAG section; in Functional the band slider is "Flutter (% of zone)", phase and "Rhythm across paragraphs" are disabled, the tracking checkbox reads "Rescue lines with Laufweite", the legend shows the zone, the status counts lines inside the zone.
- **Simulator / playground**: Style select (playground artifact republished), `--style` on the CLI. German reference text: aesthetic 33 lines, 7 hyphens; functional 31 lines, all inside the zone, 4 hyphens.
- InDesign integration: four functional cases (German one frame; English narrow into wide; each plain and with rescue), all lines as planned. Not run on the designer's TestFile copy: InDesign was closed (do not relaunch it without the designer; `run.sh` launches InDesign).
- Release 0.5.0 packaged and installed.

Open: the guide's "no hyphen at the end of a column" is left to InDesign's "Hyphenate Across Columns" off (required setting); first and last names in German are detected only as two capitalised words in a row, which also matches a capitalised sentence start before a noun.

## 2026-10-18 (late evening) — Compatibility alarm and self-check; panel text wraps; release 0.4.0 (ADR-020)

- **Self-check** (`selfCheck` in selfcheck.ts): in a hidden document, on a known German text: scripting interface present, all lines set as steered, InDesign gives hyphenation points, exact line ends work, no compatibility alarms, Freeze/Unfreeze round trip, Remove restores the text, units restored. About 2–4 s. The panel runs it once after every InDesign or Flatter version change (remembered in the plugin's localStorage) and on demand (**Run self-check**). Integration test `i20-selfcheck` also makes probing return nothing and checks that the self-check catches it.
- **Compatibility alarm**: a hot-magenta box with a yellow edge at the top of the panel, for things that should never happen: a failed self-check; an error that is not a `FlatterUserError` (expected problems such as a frozen story now throw `FlatterUserError` and stay red); `compatibilityAlarms(result)` after every Apply/verify (fewer than 70 % of at least 10 visible lines as planned without unsupported content, or InDesign returning no points for at least 80 % of at least 10 long lower-case words). The box shows details (Flatter and InDesign version, platform, failing checks) with Copy details (clipboard permission added to the manifest), Run self-check and Dismiss. Seen in the real panel via the dev channel (`alarm-demo`, `panel-state`, `selfcheck` commands).
- **Dev build** now lives in `dist/dev-panel` as "Flatter (dev)" with id com.flatter.panel.dev, so it loads beside the installed release; `uxp-load.mjs` loads that folder. `FLATTER_VERSION` is compiled in (dev builds say `-dev`).
- **Panel text wraps**: checkbox and slider labels are short (UXP checkboxes do not wrap their labels); explanations moved into wrapping hint lines; language row, footer and status lines wrap; the name and version print at the top ("Flatter 0.4.0"). Checked in the real panel at its default floating width.
- Release 0.4.0 packaged, installed and published on GitHub; test checklist gained four setup tests (56 tests).

## 2026-10-18 (late) — Release 0.3.1 for sharing

- The `.ccx` now carries `THIRD-PARTY-LICENSES.txt` (hyphen ISC licence, MIT texts for the de-1996 and en-gb patterns, the en-us notice), from `packages/panel/licenses/`, copied in by `npm run package`.
- README: install, update and uninstall steps for other people; requirements (InDesign 2023 / 18.5 or newer per the manifest; tested only on InDesign 2026 for Mac).
- GitHub release v0.3.1 with `Flatter-0.3.1.ccx` attached (the repository is private: only collaborators can download it). Installed 0.3.1 for the designer.
- Open for the designer: Flatter itself has no licence yet (all rights reserved by default); choose one before making the repository public. Adobe Marketplace listing would remove the "not from the Marketplace" warning.

## 2026-10-18 (night) — Freeze / Unfreeze; release 0.3.0 installed (ADR-019)

- **Freeze** (`freezeFlatter` in dom.ts): every visible line that does not already end a paragraph gets a forced line break; lines InDesign hyphenated, or broke at a discretionary hyphen (which shows no hyphen before a forced break, spike `s10-freeze`), also get a real hyphen. Inserted characters carry the condition "Flatter frozen" and the paragraph's base tracking (no tracking after a line's last glyph). Teeth and band strips are removed; tracking stays; overset lines are left alone. The story label records `frozen`.
- **Unfreeze** removes exactly the conditioned characters; the panel then applies the live rag again. **Remove** unfreezes first. `openSession` refuses a frozen story; the panel blocks sliders, Apply and Recompute with a message.
- Panel: **Freeze** button (second click confirms) that becomes **Unfreeze** on a frozen story.
- Integration test `i19-freeze`: 33/33 lines identical after Freeze (28 breaks, 2 hyphens), no teeth, Apply refused, Undo, Unfreeze gives the original text back (30 characters removed), Apply again, Remove of a frozen story.
- Release 0.3.0 packaged (`dist/Flatter-0.3.0.ccx`) and installed (Creative Cloud lists 0.3.0, enabled). Test checklist artifact updated with a Freeze section (52 tests in 13 sections).

## 2026-10-18 (evening, later) — Test checklist; Freeze explained

- Test checklist for the designer (45 tests in 12 sections, pass/problem/skip with notes and a "Copy results" button): private artifact https://claude.ai/artifact/XWivt51EVhH8awxaPFDm4s. Results will come back as pasted text.
- The designer asked whether the rag is only a preview and wanted a "render" button. Answer given: Apply already sets the rag for real (InDesign composes the lines; it prints, exports and survives without the plugin). Freeze (plan §6.6, not built) would bake the breaks into the text as forced line breaks for final hand-off. Not built unless the designer asks.

## 2026-10-18 (evening) — README and GitHub About updated

README rewritten for version 0.2.0: what Flatter does, install and use for testing, phase status, development commands, layout. GitHub About: description and topics set. Open items listed there: Freeze/Unfreeze, document-wide review list, tabs and anchored objects, signing and bundling the licence texts in the `.ccx`.

## 2026-10-18 (later) — Report cleanup; first installable release (0.2.0)

- **Report**: one entry per line (a band miss and the hole it makes are one sentence), problems on overset lines are not listed (a one-line count instead), and hints (Sinneinheiten, same line ends, refused hyphenations) sit in a collapsible "Notes" section. The status counts visible lines only. `ParagraphResult.visibleLines` tells the panel how many plan lines are visible.
- **Release**: `npm run package` builds the release bundle (no dev command channel) into `dist/ccx-stage` and zips it as `dist/Flatter-0.2.0.ccx`; installed for the designer with Adobe's UnifiedPluginInstallerAgent (listed as enabled, `~/Library/Application Support/Adobe/UXP/Plugins/External/com.flatter.panel_0.2.0`). InDesign needs a restart to load it; it then appears under Plugins → Flatter.
- Not verified in the panel UI: the new report rendering (the UXP Developer Tool was closed). The designer will see it in the installed build.

## 2026-10-18 — Frames of different widths; language buttons (ADR-018)

- **Each frame at its own width.** A story threaded through frames of different widths was planned with the first frame's width for every line (the designer's TestFile: 259 pt into 523 pt). The core takes `lineMeasures` (measure per line; later lines take the last entry); Flatterzone, band and contrast scale with each line's measure, so the panel's percentages mean the same in every frame. With per-line measures the line number is part of the DP state. The adapter derives each line's measure from the column it sits in (`LineSlot.columnLeft`, `ParagraphData.columnWidth`, `lineMeasuresFor`) and plans again when verify finds the widths changed. Band strips scale per line; the staircase check compares gaps, not absolute line ends.
- Tests: core unit tests, property tests with a width change (including the brute-force exactness check), a fake composer with a second frame, InDesign integration cases (narrow frame threaded into a wide one, plain and exact ends: lines planned at 210 and 420 pt, all as planned). On a copy of the TestFile story: lines planned at 259 and 523 pt, 106/106 as planned; problem lines with the designer's settings 35 → 16 (11 with German).
- **German / English buttons** (panel, under the story name): set the language of the selected stories, every linked frame, as one undo step "Flatter: Language" (`setStoryLanguage`, `storyLanguage`, `LANGUAGES` in dom.ts: German: 2006 Reform, English: USA). The current language is shown and its button marked. A story Flatter works on is applied again at once (the language decides hyphenation and the capitalised-words and Duden settings); for other selected Flatter stories the panel says to press Recompute. Integration test `i18-language` (also guards against the probing bug: German text must get hyphens).

Next: the designer tries both. Still open: report cleanup (overset lines, one message per line).

## 2026-10-17 (late night) — Probing never worked in a fixed story; narrow-column analysis

The designer tried a narrow column (259 pt, about 45 characters) with Flatterzone 8 %, band 90 %, tracking off and asked which of the many report entries are real bugs.

- **Bug (fixed): InDesign hyphenation points were never found.** Fix Settings turns "Hyphenate Last Word" off, and the probe frame copied that setting; the probed word is always the last word of the probe text, so InDesign refused every point, probing returned nothing and `mergePoints` (Safe = ours ∩ InDesign) dropped all points. Every plan in InDesign so far was set without hyphenation. The probe frame now always allows hyphenating its last word (`scratchFrame` in dom-port.ts). Probe results stored in documents before this fix are empty, so the cache is versioned (`PROBE_VERSION` = v2) and older entries are dropped on load. Integration tests did not catch it because they only check that lines break as planned.
- **Language:** the story is German text tagged English: USA. Then our classes treat German words with English patterns and capitalised words as class X, and Fix Settings (correctly, for English) turns off hyphenation of capitalised words, so German nouns never break.
- **Analysis on a copy at the exact frame sizes** (`i14-analyse.ts`; every variant set 106/106 visible lines as planned):

  | Variant | Visible lines with rhythm problems (of 106) | Hyphens |
  |---|---|---|
  | as set (English tag, before the fix) | 35 | 0 |
  | German tag + fix | 21 | 61 |
  | German + Normal hyphenation | 19 | 73 |
  | German + Flatterzone 12 % | 7 | 36 |
  | German + Flatterzone 15 % | 0 (strict) | 32 |
  | German + tracking rescue ±3 | 14 | 43 |
  | German + exact ends (letters ±10, spaces ±25 %) | 0 (strict) | 9 |
  | English tag + exact ends | 8 | 2 |

  A 40× wider soft search (beam 2000) finds nothing better, so the remaining problems at Flatterzone 8 % without tracking come from the text and the settings, not from the solver.
- Test harness pitfall: running several Apply variants in one document leaves teeth from earlier copies (labelled by story id) that squeeze later copies; `i14` now calls `removeFlatter` between variants.

Open (not done): the report lists overset lines and gives two entries for one short line ("misses its band" and "hole"); no warning when the text's language looks wrong; threaded frames of different widths are planned with the first frame's width (TestFile frame 2 is 523 pt; proposed as a separate task).

## 2026-10-17 (night) — Regression in millimetre documents fixed; typed hyphens; draft ticks (ADR-017)

The designer reported a regression in TestFile ("results aren't as good anymore", many band errors). Causes and fixes:

- **Units.** Flatter never fixed its measurement units, and TestFile is in millimetres: InDesign reported positions in mm. Before today everything was measured in the same document, so it mostly cancelled out (but tracking was computed in points against mm widths, 2.8× too strong). The new bench document measured in points while the frame width stayed in mm, so every line looked 2.8× too long. Now every Flatter operation runs with `app.scriptPreferences.measurementUnit = POINTS` and restores the user's setting (`inPoints` in dom.ts). Integration tests gained two millimetre cases (they fail without the fix: 0/54 lines).
- **My copies of the user's story were three times too narrow** (frame sizes read in mm, used as points), which is why earlier tests passed. `i3-user-copy.ts` now reads sizes in points; at the real 523 pt width all 106 visible lines are steered.
- **Typed hyphens.** With hyphenation on, InDesign refuses to break after the typed hyphen in some compounds ("master-builder" becomes "mas-ter-builder", also "self-", "twenty-", "pre-"; with hyphenation off it refuses "E-"), but accepts others ("long-term", "Max-Planck"). Compounds are now probed like words (`probeCompound`) and only accepted hyphen breaks are planned (`hardBreaks` in items.ts).
- **Refusals apply to every occurrence of the word** (`sameWordPoints`): the repeated test text needed one round per occurrence and never converged within six rounds, re-planning the whole paragraph each time.
- **Draft ticks.** While a slider moves with word spaces on, the panel plans letter tracking only (`ApplySettings.draft`); word spaces are written once when the slider stops ("Setting word spaces…"). Teeth are moved before tracking is written, and lines steered to the full measure keep an idle tooth just outside the column, so the tooth count per page stays stable and a drag only moves teeth.

Measured on a full-size copy of the user's story (523 pt, 106 visible lines, letters ±30, word spaces ±25 %):

| | before tonight | now |
|---|---|---|
| Lines as planned | 27/106 (did not converge) | 106/106 in 2 rounds |
| Band lines within 0.5 pt of their edge | – | 117/117 |
| Slider tick | 1.5–2.7 s | 0.25–0.75 s, then about 2 s once when the slider stops |
| Apply | 3.5–4.5 s | 3.5 s |

With the designer's current settings (zone 10 %, band 49 %, no tracking) both stories set 106/106 lines as planned; 11–22 lines cannot reach a band that narrow without tracking (reported as band misses), ticks 70–490 ms.

Next: the designer tries again (press Recompute once). Remaining cost: each word space is one write (about 1 ms in a long story); batching them would need Find/Change, which would overwrite the user's Find/Change settings.

## 2026-10-17 (evening) — Performance and band view (ADR-016)

The designer asked for the Flatterzone and band to be visible in the document, as in the playground, and for better performance.

Performance, measured on a copy of the designer's 12,000-character story (`i3-user-copy.ts` now profiles every DomPort method):

| | before | after |
|---|---|---|
| Apply | 31 s | 2.4–2.9 s |
| Slider tick (letters ±30, word spaces ±25 %) | 300–600 ms | 120–380 ms |

- **Cause of the slow Apply:** reading the positions of thousands of characters in a frame of the user's document made every later change to that frame slow (probing 140 ms per word instead of 3 ms; removing the scratch frame 12 s). Paragraphs are now measured in a hidden bench document that is closed afterwards (`i7-scratch.ts`, `i8-measure-aftermath.ts`, `i9-ref-growth.ts`).
- **Teeth** are reused per page: matching them by list position made teeth jump pages and be deleted and recreated whenever an earlier page's line count changed. The per-tick line label writes are gone (only an in-memory label is used). Page bounds for parking are cached.
- **Tracking** remembers what it wrote and only re-reads the document when the paragraph's style-range count changed (Undo, edits); single spaces are addressed as characters, not ranges.
- The panel ignores selection events while it is busy (the bench document opens and closes).

Band view:
- Tinted strips like the playground: blue where long lines end, orange where short lines end, one pair per stretch of visible lines in a column, following indents and threaded frames (`bandsFor` in geometry.ts, `DomPort.setBands`).
- Own layer "Flatter (Ansicht)" under the control layer: not printed, locked, no text wrap, 22 % opacity with Multiply. Colours "Flatter Band lang" / "Flatter Band kurz" are added while bands are shown and removed with the last band.
- Panel: "Show Flatterzone and band in the document" (on by default) with a colour legend. Remove takes the bands, layer and colours away.
- Integration tests now apply with bands on in every case (lines unchanged) and check that Remove cleans up.

Next: the designer tries it. Remaining cost per tick is mostly one tracking write per word space; further speed would need fewer writes (for example coarser word-space steps that change less often).

## 2026-10-17 (later) — Word spaces as a second precision control (ADR-015)

The designer said yes to per-line word-space adjustment. Done:
- Core: `tracking.wordSpaceMax`, `PlannedLine.wordSpace`, `splitAdjustment` (shares each line's distance to its edge between letter tracking and word spaces), `stats.spacedLines`, limits checked by `checkPlan`, `evaluateBreaks` takes word-space values. Tests: split rule, precise-mode gain, property tests with word spaces.
- Adapter: `ApplySettings.wordSpaceShare` (share of the paragraph's space width, converted per paragraph); word spaces inside a line get letter tracking + word-space tracking; `ApplyResult.spacedLines`.
- Panel: slider "Largest word-space change (%)" (0–50, default 25) under "Align line ends exactly"; letter tracking can now go down to 0 (word spaces only).
- Simulator and playground: the same option (`--precise --word-spaces <pct>` on the CLI); the CLI summary now reports how many band lines end within 0.5 pt of their edge.
- InDesign: integration tests gained four word-space cases (German and English), all lines as planned.
- On copies of the designer's TestFile stories (letters ±30, zone 17 %, band 90 %), every visible line set as planned. Band lines within 0.5 pt of their edge:

  | Story | Word spaces off | ±25 % | ±50 % |
  |---|---|---|---|
  | untouched copy | 218/341 | 258/340 | 279/339 |
  | story Flatter worked on | 90/377 | 135/377 | 210/361 |

- Tracking writer: each line is written once and its spaces on top (was: one write per run between spaces). Slider ticks with word spaces 220–360 ms (letter tracking alone 50–170 ms).

Next: the designer tries it in the panel. Open: first Apply on a long story is slow because of hyphenation probing (see below); ticks with word spaces could be faster (one write per space).

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
