# Phase 0 spike results

Findings for spikes S1–S7 (plan §8), run on 2026-10-16 in InDesign 2026 (21.6.0.57) on macOS, in throwaway documents created and closed by the scripts. Spike code: `tools/indesign/spikes/src/` (bundle with `node tools/indesign/build-spikes.mjs [prefix]`, run with `tools/indesign/run.sh tools/indesign/spikes/dist/<name>.idjs`).

| Spike | Question | Result |
|---|---|---|
| S1 | Do per-line wrap teeth reproduce planned breaks? | **Pass.** 867/867 lines without hyphenation, 858/858 with hyphenation after re-planning (≤ 2 rounds). |
| S2 | Can we measure widths accurately in bulk? | **Pass for unhyphenated lines** (exact to 0.001 pt). Hyphenated lines ±0.16 pt (kerning against the hyphen). |
| S3 | Can we get InDesign's hyphenation points? | **Yes, by probing.** No API exists. About 8 ms and 3 compositions per word. |
| S4 | Live loop latency in the panel | **Pass.** 42-line frame: 27–32 ms mean, ≤ 95 ms max from slider value to recomposed text. |
| S5 | Events that detect text edits | No text-edit event exists. Listeners must live in a loaded plugin; see below. |
| S6 | Layout interactions | Works with columns, threading, baseline grid, hidden or non-printing teeth. Breaks with optical margin alignment, "ignore text wrap", and teeth below the text when "wrap only affects text beneath" is on. |
| S7 | Duden availability and style | **Yes.** Duden is the default German vendor; the Duden style is a scriptable paragraph attribute. |

## S1: steering with wrap teeth

Setup: text measured in InDesign (S2 method), breaks planned by `@flatter/core`, one tooth per band line, then lines read back. Fonts Minion Pro 10 and 12 pt, Georgia 9 pt; measures 220–340 pt; leading 1.0×, 1.2× and 1.5× the type size; 3 German and 3 English paragraphs.

- **Variant A, no hyphenation: 867 of 867 lines broke exactly as planned**, at every leading, including leading equal to the type size. Each tooth affects only its own line.
- **Variant B, hyphenation (Safe classes from `@flatter/hyphenation`; InDesign with Duden Preferred Aesthetic / Hunspell): 858 of 858 lines after re-planning.** InDesign refused 3 planned points (Pro-gramm, Zusam-men, Ein-zelne); marking a refused point unavailable and solving again converged in at most 2 rounds (9 re-plans over 126 trials). 90 lines were hyphenated.
- Hyphenation matters for the rhythm: strict alternation in 40 of 42 paragraph/measure settings with hyphenation, 31 of 42 without.
- **Tooth recipe** (`tools/indesign/spikes/src/teeth.ts`): a rectangle 0.1 pt high, centred half an x-height above the baseline, from the steering width to past the frame edge; bounding-box wrap, left side, offset 0; no stroke, no fill. Baselines are predictable with `firstBaselineOffset = LEADING_OFFSET` and fixed leading: baseline i = frame top + (i + 1) × leading.
- **UXP pitfall: `rect.strokeWeight = 0` silently does nothing.** The default 1 pt stroke then moves the wrap edge 0.5 pt to the left (the wrap uses visible bounds) and every line breaks a word early. Set stroke and fill when creating the object, or through `properties = {...}`.
- Steering margin ε = 0.05 pt worked. InDesign squeezes a line in if it is up to ~0.1–0.3 pt too wide (S2), so the solver's slack must exceed ε plus that tolerance; no test line came close.
- Speed in a script: about 60 ms per paragraph trial including creating and removing the frame and its teeth. The live loop only moves teeth, so S4 should be much faster; still to measure.

## S2: measurement

- Set the paragraph once on a 9000 pt wide line and read `characters.everyItem().horizontalOffset` / `endHorizontalOffset`: fragment widths include kerning inside the fragment. Bulk reads took about 25 ms per paragraph.
- **Unhyphenated lines: predicted width = actual width, exactly** (0.000 pt), except where InDesign squeezes (below).
- **Hyphenated lines: ±0.16 pt.** The last letter is kerned against the hyphen instead of the next letter. `line.endHorizontalOffset` excludes the hyphen, so its glyph cannot be measured from the line; Minion Pro 10 pt hyphen advance = 3.56 pt.
- **Fitting tolerance:** InDesign fits a line whose advance width exceeds the available width by up to about 0.1–0.3 pt at 10 pt, compressing it slightly. The amount depends on the last glyph (probably its right side bearing: InDesign checks ink, not advance). Word spacing settings make no difference (tested with 100/100/100 and the default 80/100/133).
- Consequence: ε must stay well below the slack minus ~0.4 pt; a tooth placed at the advance width of the planned line always admits it.

## S3: InDesign's hyphenation points

- **No DOM API lists them.** Probe instead (`s3-probe.ts`): the text "x <word>" in one frame; narrow the frame step by step; line 1 ending inside the word reveals the last point that fits. The leading "x " guarantees a legal break, so InDesign never emergency-breaks the word (without it, InDesign breaks overlong words at any letter, which looks like a point).
- **Replace text in place** (`story.texts.item(0).contents = ...`): assigning `frame.contents` drops the paragraph settings, including the language.
- **Cost: about 8 ms and 3.1 compositions per word** (German and English). Above the 5 ms target, but each unique word is probed once per document and setting (cache key: word, language, hyphenation settings, Duden style).
- **German, Duden Preferred Aesthetic: 99 points over 91 words; it refused 46 of our 141 Safe points**, mostly syllable breaks inside stems (Ausstel-lungen, Flugblät-ter). **English, Hunspell: refused 1 of our 42** (compos-itor).
- **InDesign uses points we did not list**: Duden takes one reading of ambiguous words (Wach-stube, Stau-becken); Hunspell picks homograph readings (pres-ent, proj-ect). These must be merged into the item list as potential breaks (class C/X) so steering knows the composer could take them.
- Consequence for the adapter: Safe points = our A/B ∩ InDesign's probed points; all probed points are potential breaks for steering.

### Duden styles (`s3b-duden-styles.ts`, 84 German words)

| Style | Points | Words with a point | Examples |
|---|---|---|---|
| All (InDesign's default) | 133 | 82 | Ur-ins-tinkt, be-in-hal-ten, Aus-stel-lun-gen |
| All but unaesthetic | 125 | 81 | Ur-ins-tinkt, be-inhal-ten |
| **Preferred aesthetic** | 89 | 80 | Ur-instinkt, be-inhalten, Aus-stellungen, Feier-abend, Programm-hefte |
| Aesthetic | 55 | 48 | same style, but 36 words lose every point |

"All" allows meaning-distorting divisions (Urins-tinkt, bein-halten). **Preferred Aesthetic confirms ADR-002**: it breaks almost only at word joints and still offers a point in most words.

## S5: edit detection

- Event types in the DOM (read via ExtendScript): `afterSelectionChanged`, `afterSelectionAttributeChanged`, `afterContextChanged`, document open/save/close/revert events, `afterAttributeChanged` (MutationEvent), `onIdle` (IdleEvent, via `app.idleTasks`). **There is no text-content-changed event.**
- **A listener registered by a one-off UXP script fires later but its script context is gone**: InDesign shows "An attached script generated the following error: Script context is not available anymore! Do you want to disable this event handler?" (seen 2026-10-16 during the spike). Listeners must be registered by the loaded plugin (panel), which stays alive.
- Plan: in the panel, use `afterSelectionChanged` to note which managed story holds the insertion point (typing moves it), and an idle task to compare a cheap content hash of those stories; mark them stale and, in Live mode, recompute the affected paragraphs. Manual Recompute stays as the fallback (plan §8 S5).

## S6: layout interactions (`s6-layout.ts`)

One German and one English paragraph, 280 pt measure, no hyphenation, 13 lines in total. Without teeth only 2 of 13 lines match the plan, so a match means the steering works.

| Case | Lines as planned |
|---|---|
| No teeth | 2/13 |
| Teeth (control) | 13/13 |
| Teeth on a hidden layer | 13/13 |
| Teeth on a hidden layer with "suppress text wrap when hidden" | 13/13 (the option had no effect in this test) |
| Non-printing teeth | 13/13 |
| Two columns (teeth per column) | 13/13 |
| Two threaded frames (teeth per frame) | 13/13 |
| Aligned to a baseline grid equal to the leading | 13/13 |
| "Text wrap only affects text beneath" on, teeth on a layer above the text | 13/13 |
| "Text wrap only affects text beneath" on, teeth below the text | 2/13 |
| Frame set to ignore text wrap | 2/13 |
| Optical margin alignment on | 5/13 |

- The preference "Text Wrap Only Affects Text Beneath" is `textPreferences.zOrderTextWrap` in scripting. Other composition preferences that touch wrap: `justifyTextWraps`, `abutTextToTextWrap`, `honourTextIndentsWithTextWrap` (the user's defaults: false, true, true).
- `doc.layers.add()` makes the new layer active, so later frames land on it. Put text and teeth on explicit layers.
- Not tested: PDF export. Teeth have no stroke and no fill, so they print nothing either way; they are also set non-printing.

## S7: Duden

- Duden ships with InDesign and is the default hyphenation vendor for German 1996/2006 Reform, Swiss, Swiss 2006 and Austria 2006. Readable and settable via `app.languagesWithVendors[i].hyphenationVendor`; options: Duden, Hunspell, Proximity, User Dictionary Only. English uses Hunspell.
- **The Duden style is the paragraph attribute `providerHyphenationStyle`** (`HyphenationStyleEnum`: HYPH_ALL, HYPH_ALL_BUT_UNAESTHETIC, HYPH_AESTHETIC, HYPH_PREFERRED_AESTHETIC). The user's [Basic Paragraph] style is HYPH_ALL. The plugin's "Fix settings" should set HYPH_PREFERRED_AESTHETIC on target paragraphs (ADR-002).

## Other runtime findings

- **UXP scripts that contain "async" followed by a word, even inside a string, run asynchronously**: `doScript` returns immediately and the result appears later. The `hyphen` package's error text triggers this. `tools/indesign/run.sh` therefore polls for the result label.
- **The `hyphen` package's per-language entry points cannot be used in UXP** (they build an async hyphenator at load). `@flatter/hyphenation` now uses the synchronous core with the pattern files directly.
- In UXP, `itemByName()` results cannot be assigned to text attributes; assign the name string (`appliedLanguage = 'German: 2006 Reform'`).
- Single-line Composer, left aligned, hyphenation zone 0, `firstBaselineOffset = LEADING_OFFSET` and fixed leading give fully predictable composition for steering.

## S4: live latency (2026-10-16, panel loaded in InDesign 2026)

Run by the dev panel itself (`tools/indesign/panel-command.sh '{"cmd":"s4","ticks":30,"visible":true}'`): a 42-line German frame (Minion Pro 10/13, 300 pt), Flatterzone moved 30 times between 12 % and 25 %, each tick = plan + move teeth + `story.recompose()`.

| Document | Mean | Max | Ticks ≥ 100 ms | Lines as planned after verify |
|---|---|---|---|---|
| Hidden | 27 ms | 70 ms | 0/30 | 42/42 |
| Visible | 32 ms | 95 ms | 0/30 | 42/42 |

- Solving all six paragraphs takes about 1 ms; the rest is InDesign DOM calls (about 1 ms each).
- What made it fast: teeth cached in the port (no label scan per tick), only changed bounds written, surplus teeth parked on the pasteboard instead of deleted and re-created (creating a tooth costs tens of ms), no read-back during the drag (verify 250 ms after the last tick).
- The first DOM call right after a heavy Apply can wait 0.6–0.9 s for InDesign to finish composing and redrawing; in use there is always a pause between Apply and the first drag, so the test pauses 0.5 s too.
- Undo: `UndoModes.AUTO_UNDO` merges a script into the previous undo step (spike S9), so a whole drag is one "Flatter: Adjust" step.

## Integration findings (Phase 3, 2026-10-16)

- **Do not measure in place.** In the composed story, a space at a line end has a shortened advance (0–2.3 pt) and a letter before a break loses its kerning. Plans built from such widths missed by one word (17/21 lines). Measuring a duplicate of the paragraph on one wide line in the probe frame fixed it (all lines as planned) and makes plans independent of the current breaks.
- **`autoLeading` is the auto-leading percentage**, not a switch; auto leading shows as `leading = Leading.AUTO`.
- Moving a rectangle with `r.geometricBounds = …` works (unlike `strokeWeight`).
- Measured in InDesign 2026 with three paragraphs per story: first Apply about 1 s (probing ~80–100 words once, measuring, two composition rounds), re-apply about 0.15 s with the probe cache.

## Findings from the user's first panel test (2026-10-16)

The user's TestFile has one 11,800-character paragraph (about 360 lines) in a frame that shows about 20 of them; the rest is overset.

- **Overset lines have no position.** `story.lines.everyItem().baseline` throws ("property is not applicable") as soon as one line is overset. Read lines per frame (`textContainers[i].lines`); the last visible character is the last container's last character. Paragraphs that start in a frame are planned whole; only their visible lines get teeth, and teeth are never extrapolated below a frame's bottom.
- **Long paragraphs** do not fit one 9000 pt measuring line. Measure on several such lines; a space that ends one of them gets the normal space width. Do not call anything that reuses the probe frame while the paragraph sits in it.
- **A failed Apply must undo itself.** The first version fixed settings, then failed while measuring, leaving the story with changed settings and no record of the originals. Apply now undoes its own partial step on failure. (The user's document was restored by undoing Flatter's own seven undo steps.)
- **No retry storm.** With Live on, every slider tick retried the failed Apply, freezing InDesign each time. The panel now runs Apply once, shows "Preparing…", ignores ticks while busy, and does not retry after a failure until Apply is pressed.
- **Theme.** The UXP host CSS variables used for text colour are not available in InDesign; text rendered black on the dark theme. The panel now uses Spectrum text elements (sp-heading, sp-body, sp-detail, sp-divider), which follow the theme.
- **Speed on the long story:** first Apply about 2.4 s (measuring the paragraph and probing 72 words); re-apply 30–50 ms with measurements cached while the plugin is loaded (Recompute clears the cache); slider ticks about 10 ms.

## Findings from the user's precise-tracking test (2026-10-17)

- **Ligatures break under tracking.** Same text, untracked vs tracked 30 (all but the last letter), Minion Pro 12 pt: the advance between two letters grows by exactly the tracking everywhere except at ligatures, where it grows by an extra 1.00 pt (Th), 0.55 pt (fl), 0.13–0.17 pt (ft). Measuring with `ligatures = false` gives the tracked widths to within ±0.3 pt (`i4-track-kern.ts`, `i3-user-copy.ts`).
- **Measuring cost**: re-reading 12,000 character offsets after turning ligatures off takes about 0.6 s.
- **Tracking write cost**: rewriting a 12,000-character paragraph's tracking each tick recomposed all of it (about 1.5 s per tick in the user's file). Writing only changed runs, read from `textStyleRanges` (index and tracking), and skipping overset lines: 50–170 ms per tick.
- **Probing cost**: the first Apply on the user's English story probed 72 words, 17–30 s in a fresh document (cached in the document label afterwards).
- **The user's file**: the story's language is English: USA although the text is German; tracking 1 on most characters there came from their last slider position (max 1), not from a wrong base (the stored base is 0).

## Word spaces (2026-10-17, `i5-space-tracking.ts`)

- Tracking a space character widens exactly that word gap: +100 units moves every following glyph by 1.2 pt at 12 pt, ligatures untouched.
- Cost: 42 lines written once each plus 227 single spaces took 64 ms in one go. In the live loop (teeth, read-back of style ranges, about 230 writes per tick) a tick takes 220–360 ms on the user's 12,000-character story.

## Performance findings (2026-10-17, `i6-perf.ts` … `i9-ref-growth.ts`)

- In isolation every operation is cheap: 70 probes 0.14–0.22 s, creating 38 teeth 35–40 ms, moving them 3 ms, 38 lines + 230 spaces of tracking 45–85 ms (FAST_ENTIRE_SCRIPT is fastest, AUTO_UNDO in between).
- **Reading many character positions poisons that frame.** After `characters.everyItem().horizontalOffset` on a 12,000-character paragraph, removing its frame took 0.6 s; after a second read 2.7 s; probing in the same frame went from 3 to 140 ms per word. Other objects (a rectangle elsewhere) stay fast. Reading in a hidden document and closing it (about 0.1 s) leaves nothing behind.
- Teeth matched by list position across pages were recreated on many ticks (71 created for 38 lines in 7 ticks); pooled per page, only lines that newly need a tooth on a page create one.
- Writing one space with `characters.item(k)` is cheaper than `itemByRange(k, k)`.

## Units, typed hyphens, write costs (2026-10-17, `i10`–`i13`)

- **Document units leak into scripting**: `geometricBounds`, `horizontalOffset` and friends come back in the document's ruler units (TestFile: millimetres). `app.scriptPreferences.measurementUnit = POINTS` makes scripting use points regardless; it is an application setting, so restore it.
- **Typed hyphens with hyphenation on** (Minion Pro 12 pt, frame just wide enough for "x <part>-", also with 3 pt extra): InDesign breaks after "long-", "well-", "mother-", "state-", "Max-", "Hamburg-", "Ost-", "Schiller-", "E-", but not after "master-" (takes "mas-"), "self-", "twenty-" ("twen-"), "pre-". With hyphenation off it breaks after all of these except "E-". Not predictable: probe.
- **Line width model at full size is exact**: the line that failed in the user's story ("…the master-", letters −12.23, spaces −19.59) measures 522.0876 pt in InDesign, model 522.0876 pt.
- **Write costs**: tracking a whole line costs about 0.36 ms; one space about 0.3 ms in isolation, about 1 ms in a long live story; overwriting a line whose spaces still carry their own values about 2 ms. Undo mode and wrap objects next to the text make little difference. Merging ticks into one undo step (AUTO_UNDO) does not slow down over a drag.

## Probing and "Hyphenate Last Word" (2026-10-17, `i15`, `i16`)

- With "Hyphenate Last Word" off, InDesign never hyphenates "x <word>" (the word is the last word of the paragraph): probing must turn it on in the probe frame. With it on, probing returns InDesign's points again (for example demonstrandum 2, 5, 10; happiness 3, 5).
- With "Hyphenate Capitalized Words" off, capitalised words get no points at all (German nouns in a story tagged English).

## Plan amendments from Phase 0

1. **Teeth**: zero-stroke rectangles set at creation, 0.1 pt high, half an x-height above each baseline; one per band line per frame or column. The control layer "Flatter (Steuerung)" must be the **topmost** layer (so "wrap only affects text beneath" cannot disable it) and its "suppress text wrap when hidden" must be off. The layer may be hidden; steering keeps working.
2. **"Fix settings" (plan §5.5) adds**: Duden style Preferred Aesthetic (`providerHyphenationStyle`), Single-line Composer, left alignment, hyphenation zone 0, fixed leading, `firstBaselineOffset = LEADING_OFFSET`, frames must not ignore text wrap, optical margin alignment off on managed stories (ADR-002 #2 measures to the frame edge; supporting optical margins would need measuring with it on).
3. **Hyphenation points**: probe every unique word once per document and setting (~8 ms per word) and cache in a document label. Safe points = our A/B ∩ InDesign's probed points. Every probed point is a potential break for steering, even when we never use it.
4. **Verify and re-plan** stays: refused points are marked unavailable; at most 2 rounds in all S1 trials.
5. **Steering margin** ε = 0.05 pt. The solver's tight-steering check should compare slack with ε plus InDesign's fitting tolerance (about 0.03 em) rather than 2ε. To do in Phase 3.
6. **Hyphenated line widths** are known to about ±0.16 pt (kerning against the hyphen); the margin and the read-back absorb this.
7. **Edit detection** must live in the panel: `afterSelectionChanged` to note the active story, an idle task comparing content hashes, manual Recompute as fallback.
8. **S4 (live latency)** passed with the panel (see above). If larger stories get slow, the plan's single-polygon teeth (one `entirePath` write per frame) remain the next optimisation.

## Duplicated frames (2026-10-27, `i24`)

- Duplicating a frame whose story Flatter set copies the text with Flatter's tracking but not the story's labels: the copy has no Flatter record. Teeth and band strips are not part of the story and are not duplicated with it.

## Capitals and ß (2026-10-27, `i27`, `i28`)

- In All Caps, Small Caps and Cap To Small Cap, InDesign draws ß as one glyph ("draußen" in Minion Pro 10 pt small caps: 34.91 pt, "draussen" 40.71 pt) but its line breaker needs more room: a line with one ß fits only 6.5 pt (small caps) or 1.9 pt (all caps) wider than drawn, four ß 37 pt / 24 pt. Without ß, capitals fit exactly at their drawn width. Cap To Small Cap is what InDesign's menu calls "OpenType All Small Caps", so that is affected as well (corrected 2026-10-30: an earlier test used a name the scripting interface does not have and ran in normal case).
- Character offsets in synthetic capitals are consistent within a line; the sum of the advances equals the drawn width.

## Long stories with mixed layout (2026-10-30, `i31-stress`)

Throwaway document: four paragraph styles in a fixed order (Head 16/19 Bold centred, Lead 12/15 Italic, Body 10/13 with first-line indent, Small 8/10), threaded frames of different widths, 2- and 3-column frames, an image with bounding-box text wrap inside a column, one 12-times-long paragraph, column, frame and page breaks (one column break inside a paragraph), forced line breaks, no-break and thin spaces, dashes, quotes, soft hyphens, a non-breaking hyphen, a URL with discretionary line breaks (U+200B) and tabs. Precise Laufweite with word spaces, bands shown.

| | 40 paragraphs, 16,700 characters, 15 frames | 152 paragraphs, 51,600 characters, 22 frames |
|---|---|---|
| Apply | 19 s (prepare 11.6 s, steer and verify 7.2 s, 6 rounds) | 181 s (prepare 105 s, steer and verify 74 s, 6 rounds) |
| Lines as planned after Apply | 389/399 | 622/913 |
| Slider tick (draft, then full) | 1.1 s, 2.0 s | 3.1 s, 6.1 s |
| Verify after the tick | 1.2 s, 325/396 | 2.4 s, 682/910 |
| Remove | 0.6 s | 2.9 s |

- **Time grows faster than the text**: prepare 0.29 s per paragraph at 40 paragraphs, 0.69 s at 152. Every DOM call on a long threaded story costs more; the rounds re-read all lines of all frames.
- **Discretionary line breaks (U+200B) are not modelled**: InDesign breaks the URL there, Flatter plans the URL as one word; that paragraph never converges, which also spends all six verify rounds.
- **The short story is otherwise exact** (frames of different widths, columns, the image wrap, column/frame/page breaks, special spaces and hyphens); the long one has 55 mismatching paragraphs, not yet explained.
- **A single tab switches the alarm off for the whole story**: `steeringFailed` ignores stories with any unsupported paragraph, so 622/913 raised no alarm and no automatic re-measure.
- **Centred headings become left-aligned** while Flatter is on (required setting for every paragraph of the story); Remove restores them.

### After the fixes (2026-10-30, night)

| | 80 paragraphs, 29,100 characters | 152 paragraphs, 51,600 characters |
|---|---|---|
| Apply | 21 s (was 57 s), 593/593 lines | 44 s (was 181 s), 875/904 lines |
| Measuring | 3.4 s (was 38 s) | 7.3 s (was 105 s) |
| Slider tick (draft, then word spaces), verify | | 2.6 s, 6.2 s, 2.8 s; 901/904 lines |

- Copying paragraph by paragraph into the bench was the slow part (about 0.5 s per copy from a long threaded story); one copy of the whole range costs about as much as one paragraph did.
- In the copy, column, frame and page breaks must become returns: they read as "\r" in `contents` but as `SpecialCharacters` enumerations per character, and would push the rest out of the single bench frame. Discretionary line break is U+200B, forced line break "\n", indent-to-here U+0007, right indent tab U+0008, end nested style U+0003.
- Text wrap of an image narrows the lines beside it; InDesign reports the shorter line, not the reason. Flatter now reads wrap objects itself (bounding box plus offsets; the line band is baseline − 0.75 × size to baseline + 0.25 × size).
- Tracking writes cost about 2 ms each in a long story; word spaces make up most of them.
- `pgrep -f` on InDesign's path also matches AdobeIPCBroker; use `pgrep -x "Adobe InDesign 2026"`.

## Speed of long stories in multi-column spreads (2026-11-18, InDesign 2027 22.0, `i41-speed`, `i42-comb`)

The designer finds long stories in facing pages with three columns each "agonizing" (InDesign had to be force-quit several times). Research (Adobe forums) and measurements:

- **A panel's DOM calls run time-shared.** Adobe staff (Anoop Valomkot, community.adobe.com "UXP vs CEP", 2023): plugin code that calls the DOM is not executed with priority because plugins share time with InDesign; DOM-heavy work belongs in a separate script without async/await run through `app.doScript` (a file or a string). Reported elsewhere: CEP 14 s vs UXP panel 2 min 45 s; calendar plugin 15 s vs 4 min.
- **Measured** (`micro`, 200 moves of wrap rectangles over three-column text plus 200 tracking writes, document visible):

| Run as | Total | Moves | Tracking |
|---|---|---|---|
| Inline in the panel | 5.3–6.5 s | 0.3–1.3 s | 0.7–0.9 s |
| `app.doScript(function)` from the panel (Flatter today) | 3.1–4.8 s | 0.3–0.9 s | 0.3–0.4 s |
| Script, asynchronous (all earlier spikes) | 2.9–3.2 s | 0.5–0.6 s | 0.2–0.3 s |
| Script run to completion (`run.sh` after the fix) | **0.5 s** | 0.06 s | 0.08 s |
| `app.doScript(script text)` from the panel | **0.8 s** (plus about 6 s to read and start the 1.3 MB script) | 0.08 s | 0.11 s |

- **"async" in the script text**: InDesign runs a UXP script asynchronously when its text contains "async" followed by a word. The bundle's only one is the `hyphen` package's error message "…in async mode"; `build-spikes.mjs` now rewrites it. Every spike timing before 2026-11-18 was measured in the slow asynchronous mode.
- From a panel, `documents.add({ showingWindow: false })` shows the window anyway.
- `doScript` with a path string treats the path as script text (returns at once); reading the file needs `localFileSystem` permission and a `file:` URL (dev manifest only).
- **Comb per column instead of a tooth per line** (`i42-comb`, script, Minion 9/11.5, three columns per page, alternating cuts of 18 pt shifted each tick): one polygon per column with text wrap `CONTOUR`, spine in the gutter, one spike per shortened line. Spikes of 0.1 pt are ignored for a quarter of the lines; from 1 pt (centred 2.95 pt above the baseline) every line is set exactly like with teeth.

| | Teeth | Comb (1 pt spikes) |
|---|---|---|
| 4 pages, 792 lines: objects, create, tick | 792, 1.1 s, 0.34 s | 12, 0.03 s, 0.14 s |
| 12 pages, 2,376 lines | 2,376, 3.6 s, 1.1 s | 36, 0.09 s, 0.44 s |
| 24 pages, 4,752 lines | 4,752, 7.6 s, 3.0 s (remove 3.5 s) | 72, 0.2 s, 0.9 s |

  A tick here is: write the shapes, recompose, read the lines back. The comb's lines were identical to the teeth's on every tick.
- **Full Apply, 8 pages of three columns (62,000 characters), script run to completion**: 129 s (prepare 7 s, steer and verify 109 s, check 11 s), 12 rounds (the maximum), only **762 of 1,513 lines as planned**; slider tick 8 s + 8 s, verify 22 s, 831/1,529. Every round re-reads the whole story (about 9 s), and lines settle about one column boundary per round: when a planned paragraph has a different line count, all later lines move to other slots, so their teeth sit one line off until the next round. With 24 columns the rounds run out halfway.

## Set whole story in chunks (2026-11-26, InDesign 2027 22.0, `i47-chunk-start`, `i48-redo`, `i45-set-whole`)

- **Start cost of a script call** (from a script, three-column story, 300 forced breaks with a condition plus 300 tracking ranges): UXP script text with `require('indesign')` and nothing else 251 ms; ExtendScript text 48 ms the first time, then 0 ms. Writing the same: UXP 689 ms (with start), ExtendScript 331–347 ms.
- ExtendScript reads its job from an app label (`app.insertLabel` from UXP, `app.extractLabel` in ExtendScript; UXP has no `scriptArgs`), parsed with `eval` (ExtendScript has no JSON). Its last expression is `doScript`'s result.
- **Undo and redo of merged steps** (one ENTIRE_SCRIPT step, then steps with AUTO_UNDO): undo takes back all of them (ExtendScript and UXP function steps; a UXP script text step does not merge cleanly: undo left its first part). Redo replays only the first step: "xABC → undo x → redo xA".
- **8 facing pages, three columns, 152 paragraphs, precise Laufweite**: Set whole story as a job 9.7 s in 24 steps (measuring 6.3 s, 22 write chunks of about 140 ms, check 0.3 s); 1,574 lines, none missed; one undo restores the original text; again after Unfreeze 5.5 s. Before (one UXP script): 21 s and 16 s.

## Indents next to text wrap (2026-11-26, `i49-indent-wrap`)

Frame 100–400 pt, paragraph indents left 15, right 20, first line 10, a tooth on the first line; text of tiny words so a line ends within about 5 pt of its limit.

| | Left-aligned, tooth from the right at x 300 | Right-aligned, tooth from the left ending at x 200 |
|---|---|---|
| honourTextIndentsWithTextWrap on (default) | line ends at 298 (right indent not applied at the wrap) | text starts at 229 (≥ 200 + left 15 + first 10) |
| off | line ends at 298 | text starts at 214 (≥ 200 + first 10 only) |

Away from wrap objects both indents apply as usual. The preference is `doc.textPreferences.honourTextIndentsWithTextWrap`.

## Edge-case stress test (2026-11-26, `i50-edge-stress`)

18 cases, each on its own page of a throwaway facing-pages document (page-relative ruler origin, or cases on one spread overlap): left and right-aligned text, plain and with images (bounding-box wrap, 6 pt offset) on either side of the column, indents (left 12, right 18, first 10) with and without images, a hanging indent, a centred head with alternating left and right paragraphs, right-aligned in three columns, towards-spine text across a spread, a 3-line drop cap, a 12 pt frame inset, right-aligned text through two frames of different widths. Per case: Preview on the whole story, Apply to whole story, Unfreeze, Remove.

- Before the fixes: right-aligned text 1–4 of 10–113 lines as planned live (teeth wrapped text on their left side), drop cap 6/24 (cap baseline), spine 14/32, mixed 13/40, two overset stories counted pushed-out lines as misses. Apply to whole story set every case correctly already.
- After (ADR-037): every case every line as planned, live and whole, with and without Laufweite, no alarm, text and alignments restored. A right-aligned line ending 3.4 pt short of the edge is a hyphenated line (the hyphen is not a character).

## InDesign special characters (2026-11-26, `i52-specials`, `i50-edge-stress`)

One story per character, inserted every fifth word, Preview on the whole story (`i52-specials`; app labels `flatter-i52-only` = comma-separated names, `flatter-i52-page` = page index).

- **Fixed-width spaces** (em U+2003, en U+2002, third, quarter, sixth, figure U+2007, punctuation U+2008, thin U+2009, hair U+200A): InDesign never breaks a line at them. A frame ending just after "dieser" with an em space after it moves "dieser" to the next line; without a frame edge the line fits. Measured widths match InDesign exactly (bench vs. story positions). Before the fix 10–12 of 16 lines as planned, after 16/16.
- **No-break space, fixed-width no-break space, flush space, end nested style (U+0003), section marker (U+0019), zero-width non-joiner and joiner, discretionary line break (U+200B)**: 16/16 without changes.
- **Page number markers** (U+0018, current and next page): InDesign sets every digit of the page's number but reports the marker's position as one digit wide, and the bench measures it on page 1. On page 15: 2/16 lines as planned; with the width taken as one digit × the length of the page's name, 16/16.
- **Indent to Here** (U+0007): after it, lines start where its next character stands. Modelled from the read-back: one per paragraph (the usual hanging layout) 32/32; several per paragraph (each line starting further right) still converge poorly (2/9).
- **Right indent tab** (U+0008) and **tab**: not modelled; reported as unsupported, no alarm, text restored.
- **Footnote references, inline graphics, soft hyphens, non-breaking hyphens, dashes, guillemets and quotes**: every line as planned (inline graphics are reported as anchored objects but steer correctly).
- Stress test after all fixes: 27 cases (18 layouts plus 9 with special characters), all pass; tabs and right indent tabs pass as "reported, text restored".

## Names in InDesign's own language (2026-11-27, `i53-local-names`)

- A German InDesign 2026 (21.3, Windows) refused `composer = 'Adobe Single-line Composer'` ("Ungültiger Wert … String erwartet"): composer names are localised.
- Language-independent keys: `app.findKeyStrings('Adobe Single-line Composer')` → `$ID/HL Single`; Paragraph Composer `$ID/HL Composer`; German: 2006 Reform `$ID/de_DE_2006`; English: USA `$ID/English: USA`; English: UK `$ID/English: UK`; [No Language] `$ID/[No Language]`; swatch None `$ID/None`.
- ExtendScript translates them (`app.translateKeyString`) and accepts them as values (`composer = '$ID/HL Single'`, `appliedLanguage = '$ID/de_DE_2006'`, `swatches.itemByName('$ID/None')`). UXP does neither: `translateKeyString` returns the key, and setting `composer` or `appliedLanguage` to a key throws. `app.doScript(text, ScriptLanguage.JAVASCRIPT)` from UXP returns the ExtendScript's last value, so one call resolves all names.
- Locale codes (`icuLocaleName`, readable from UXP): German 1996/2006/Old Rules de_DE, Swiss de_CH, Austria de_AT, English UK en_GB, USA (also Medical, Legal) en_US, Canadian en_CA, [No Language] en_US_POSIX.

