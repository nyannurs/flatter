# Decisions

Architecture decision records and the designer's answers to the open questions in plan §11. Newest last. Do not reverse a decision without asking the user.

## ADR-001: Steer InDesign's composer with per-line text-wrap teeth

Status: accepted, pending Phase 0 spikes. See plan §3, Option C. Text stays untouched; InDesign keeps hyphenation authority; we only choose among breaks InDesign accepts.

## ADR-002: Designer defaults for plan §11 (2026-10-16)

The user approved these defaults on 2026-10-16. They may be revisited after real-text testing.

| Question (§11) | Decision |
|---|---|
| 1. Composer | Switch affected paragraphs to the Adobe Single-line Composer. |
| 2. Definition of length | Bands are measured to the frame edge (not the optical edge). |
| 3. Phase across paragraphs | Every paragraph starts long. Continuous rhythm stays available as an option. |
| 4. Ausgangszeile | No single word under 4 letters, never a hyphen stub; after a long line it must not reach past the short target (strong penalty). No minimum width by default. |
| 5. Tracking assist | Off by default. Revised 2026-10-16: available as an opt-in rescue, see ADR-010. |
| 6. Line-end word rules | Use the plan's default: on for German, optional for English. |
| 7. Duden style | Preferred Aesthetic. |
| 8. Regularity | Variation 0 (pure alternation). |
| 9. Priority order | As in plan §7.4: hyphenation correctness, alternation, Ausgangszeile, hyphen budget, Sinneinheiten, centring. |
| 10. Hanging hyphens | Hyphens count towards line length. |
| 11. Consecutive hyphens | At most 2. |

## ADR-003: Tooling (2026-10-16)

npm workspaces, TypeScript 7, Vitest 5, fast-check for property tests, esbuild for bundling. Sources use `.ts` import extensions and erasable syntax only, so Node 24 runs them directly. No pnpm because it is not installed on the user's machine.

## ADR-004: Solver design choices (2026-10-16)

- **DP state is a whole line** (start break, end break) plus role, consecutive-hyphen run and capped hyphen count. This makes neighbour rules (contrast, same word at line start or end) exact. Lines per end break are few, so it stays fast.
- **Targets sit at the band edge**: long lines aim for the full measure, short lines for W − Z. Lines may fall short by up to b.
- **Default band**: see ADR-006 (now Z / 2).
- **Band drift** (plan §4.2) is handled by the quadratic centring cost, not a separate variance term. The checker reports the spread of long and short line ends so drift stays visible. Revisit if bellies show up in practice.
- **Variation offsets are seeded by the item index where a line starts**, not the line number, so they stay attached to the text while sliders move.
- **Forced line breaks** inside a paragraph keep the long/short parity but their lines are exempt from bands, like the last line.
- **"Last line reads as long after a long line"** is a strong soft penalty and a warning, not a hard rule, because it ranks below alternation (priority 3).
- **Strict fallback order**: requested phase, then the other phase (reported as info), then soft mode with violations. Soft mode keeps the requested phase.
- **Soft mode uses a beam** of 48 states per break (setting `softBeam`) and skips lines far shorter than any band unless nothing longer fits. Strict mode is exact. Checked on 900 text/measure/zone/band combinations: the beam never gave a worse result than an uncapped search.
- **The consecutive-hyphen limit is relaxed in soft mode** like the bands, as a heavy penalty, and every overrun is reported as an error. Hyphenation correctness (classes X and C) is never relaxed.
- **Hyphenation budget and hyphen costs scale with the measure** (characters per line / 60, clamped 0.6 to 2); class B scales with the square. English costs are double the German ones and its budget is 1 instead of 3.
- **Sinneinheiten word lists are deferred to Phase 2** (`packages/hyphenation`). Core already supports them through break costs on glue and the builder's `breakCost` hook.
- **Existing hyphens** (E-Mail) break only after the hyphen, add no glyph, count towards consecutive hyphens but not towards the budget. Words with a discretionary hyphen use only those points.

## ADR-005: Simulator resources (2026-10-16)

The simulator uses Source Serif 4 (`@fontsource/source-serif-4`, SIL OFL 1.1) for real metrics and the `hyphen` package (ISC; patterns ported from CTAN hyph-utf8) as a stand-in hyphenator. Both are development dependencies of the simulator only and are not shipped in the plugin. Pattern licences must be checked before anything is bundled into the plugin (plan §5.2).

## ADR-006: Default band is half the Flatterzone (2026-10-16)

The plan leaves the default band b open. A sweep over the reference texts at 55–70 characters per line, Z = W/5, Safe hyphenation, Strict mode:

| Band | German strict | US English strict | UK English strict | German hyphens per 100 lines |
|---|---|---|---|---|
| Z × 0.20 | 10 % | 11 % | 15 % | 29 |
| Z × 0.33 | 65 % | 61 % | 59 % | 27 |
| Z × 0.40 | 83 % | 85 % | 84 % | 22 |
| Z × 0.50 | 95 % | 100 % | 100 % | 15 |

Z/2 is the first value that meets the MVP target (at least 95 % of paragraphs in perfect alternation) and it also halves the hyphen rate. The minimum contrast between neighbouring lines is then Z/2, which is 10 % of the measure at the default zone. The band is a slider, so the designer can tighten it. Revisit with the designer's own texts and fonts.

Also observed: 5–21 % of paragraphs cannot start long and flip to start short (reported as info). The designer chose "every paragraph starts long"; ask whether flips are acceptable or whether those paragraphs should break the rhythm instead.

## ADR-007: Playground as a private artifact (2026-10-16)

The user is a designer and should judge the rhythm by eye without running code. The simulator's playground is published as a private claude.ai artifact (https://claude.ai/artifact/SvGpvN2649PeRYDPECqJkp). The build emits two files: `out/playground.html` (full document, local) and `out/playground-artifact.html` (content only; the artifact host adds the document skeleton). Republish the artifact file to keep the same link.

## ADR-008: Hyphenation pattern licences (2026-10-16)

Checked against the hyph-utf8 sources on 2026-10-16:

| Patterns | Licence | Notes |
|---|---|---|
| German de-1996 (also used for de-CH) | MIT | Generated from the wortliste project. Keep the copyright notice. |
| British English en-gb | MIT | Keep the notice. The underlying Oxford word list is not distributed and is not needed. |
| US English en-us | Permissive notice (G. D. C. Kuiken) | Copying and modification allowed; keep the notice. |
| `hyphen` npm wrapper | ISC | |

All may be bundled in the plugin as long as the notices ship with it. `THIRD_PARTY_NOTICES.md` lists them; Phase 7 packaging must include it.

## ADR-009: Hyphenation consensus design (2026-10-16)

- **Authority**: TeX patterns stand in until InDesign can be probed (spike S3). The `authority` option takes any source, so the InDesign/Duden probe slots in without changing the rest.
- **German second opinion**: an implementation of the 2006 rules plus a lexicon-based compound and prefix splitter. Independent of the patterns, so their agreement means something. The splitter also supplies main joints (class A). When the lexicon allows two equally good parses, the differing joints become class C automatically.
- **English second opinion**: the other variety's patterns. US and UK practice differ systematically (knowl-edge / know-ledge), so requiring both is conservative by design. British English additionally keeps short leading parts and short compound parts whole.
- **Exceptions** are per variety (de, en-US, en-GB), override both sources, and match inflected forms (Urinstinkte). They are the place for meaning-distorting divisions that are orthographically allowed (Urin-stinkt, bein-halten, Drucker-zeugnis).
- **Ambiguous words** (two legitimate readings: Wachstube, Staubecken, Musikerleben, English homographs) keep only points every reading shares and that are a joint in none of them.
- **Hard rules** (always class X): fewer than 2 letters before or 3 after, words shorter than 6 letters, ck and ch in German, a single vowel at the start or end of a word or word part, misleading English splits, capitalised English words.
- **Golden corpora are precision tests**, not recall tests: the plugin may hyphenate less than allowed, never wrongly.
- **Sinneinheiten** costs: article 30, preposition 20, one-letter word 30, pronoun 10 (English), abbreviation, initials and dates 120, number + unit 300. For scale, a German class B hyphen costs about 120. On by default for German, off for English (plan §2A.6).

## ADR-010: Tracking (Laufweite) as an opt-in rescue (2026-10-16)

The designer asked whether the solver uses Laufweite, then decided: add tracking as an opt-in rescue for lines that just miss their band, off by default, shown in the report, with a suggested maximum.

- **Setting**: `tracking: { enabled, max, emSize }`. Units are 1/1000 em, as in InDesign's Tracking field; `emSize` is the font size in points. Whole units only.
- **When it applies**: only to band lines (never the last line or a forced line), and only when the paragraph cannot be set strictly without it. Fallback order: strict; strict with tracking; strict in the other phase; the other phase with tracking; soft (with tracking if enabled). Tracking comes before a phase flip because the designer chose "start long".
- **Which value**: the smallest whole value that brings the line into its band, tighter or looser. Tightening also lets a line that is slightly too wide fit the measure.
- **Cost**: 400 plus 600 × (t / max)², above hyphens and Sinneinheiten, far below a band violation.
- **Reporting**: each tracked line is an info entry ("Tracking −1/1000 em (Laufweite) brings this line into its band."), a margin mark in the simulator and a count in the summary. Tracking outside the limit is an error.
- **Suggested maximum: ±3/1000 em.** At 10 pt that is 0.03 pt per character. Sweep over the reference texts, 55–70 characters, Safe hyphenation:

| Max | German strict | US/UK English strict | Tracked lines per 100 (40–90 chars) |
|---|---|---|---|
| 0 | 93.8 % | 98.8 % | 0 |
| 1 | 97.5 % | 98.8 % | 1 |
| 3 | 97.5 % | 100 % | 2–2.5 |
| 4 | 100 % | 100 % | 3 |
| 5 | 100 % | 100 % | 3.3 |
| 10 | 100 % | 100 % | 5–6 |

±3 meets the 95 % target in all languages with very few tracked lines. ±4 or ±5 fixes the last near misses. Larger values help narrow columns (below 55 characters) but start to change the grey value of a line. Bringhurst warns against letterspacing lowercase, which is why the rescue stays opt-in and small.
- **InDesign (Phase 3)**: the adapter applies tracking as a character attribute on that line's text, records it in the story label, and Remove resets it. Steering widths already include the tracked width.

## ADR-011: InDesign adapter design (2026-10-16)

- **Port boundary**: the apply loop (`packages/indesign-adapter/src/apply.ts`) talks to InDesign only through a small `Port` interface (paragraphs, probe, readLines, setTeeth, setTracking). `DomPort` implements it with the DOM; Node tests use a fake greedy composer, so the loop logic is tested without InDesign.
- **Loop**: measure every paragraph, merge probed InDesign points with our classes (Safe = ours A/B ∩ InDesign; InDesign-only points become C, our vetoes stay X, points InDesign refuses are dropped), solve, place teeth at the slots InDesign currently gives the planned lines, read back. A planned hyphen InDesign did not take while its tooth sat on the right line marks that point refused and re-plans; a tooth on the wrong line (line count or column changed) is moved next round. Typically 2 rounds: place, verify.
- **Measuring**: each paragraph is duplicated into the probe frame and measured on one 9000 pt line with hyphenation off. Measuring in place is unreliable: a space that ends a line has a shortened advance, and a letter before a break loses its kerning, so plans would depend on the current breaks (found in integration testing).
- **Probe frame**: on the pasteboard, on the control layer, ignoring text wrap, with the paragraph's formatting copied; removed after each Apply. Probed points are cached in the document label `flatter-probe`, keyed by font, size, language, hyphenation settings and Duden style.
- **Control layer** "Flatter (Steuerung)": created on demand, kept topmost, not printable, wrap suppression off; removed when the last tooth goes. Teeth are labelled `flatter-tooth` = story id.
- **Fix settings** records every original value in the story label `flatter` (per paragraph attribute, optical margin alignment, frames' ignore-wrap, base tracking) so Remove restores the original composition exactly. Auto leading is fixed to the value it currently produces.
- **Tracking rescue**: planned tracking is applied to the tracked lines' characters relative to the paragraph's base tracking, reset before measuring on re-apply, and restored on Remove.
- **Undo**: Apply and Remove each run inside `app.doScript(…, UndoModes.ENTIRE_SCRIPT)`: one undo step.
- **Not yet handled**: paragraphs with mixed fonts or languages inside a word (the probe uses the paragraph's first character), tabs and anchored objects (reported as unsupported), threaded frames of different widths, live updates on edit (needs the panel).

## ADR-012: Panel and live loop (2026-10-16)

- **UI**: plain HTML with InDesign's built-in Spectrum UXP widgets (sp-slider, sp-picker, sp-checkbox, sp-button); no framework. Colours from the host's CSS variables, so the panel follows InDesign's theme.
- **Sliders in relative units**: Flatterzone in % of each paragraph's measure (8–25 %, default 20 %), band in % of the zone (default 50 %), so paragraphs with different indents share one setting (`zoneShare`, `bandShare` in ApplySettings).
- **Live loop**: input → 30 ms debounce → `liveUpdate` (re-plan + move teeth, no read-back) → 250 ms after the last tick `liveVerify` (read back, re-plan refused points, move misplaced teeth, drop parked teeth). The first tick of a drag opens the undo step "Flatter: Adjust"; later ticks and the verify merge into it (AUTO_UNDO).
- **Target**: the story of the current selection (text frame or text cursor). Stored settings are loaded into the panel when the selection moves to a story Flatter has been applied to.
- **Dev builds** poll the application label `flatter-dev-command` every 300 ms and answer in `flatter-dev-result`, so terminal scripts can drive tests inside the loaded panel. Release builds (`npm run panel:release`) leave this out.
- **Loading for development**: `tools/indesign/uxp-load.mjs` talks to the UXP Developer Tool service directly (Adobe's CLI does not run on Node 24).

## ADR-013: Laufweite for geometric precision; Variation removed (2026-10-16)

The designer clarified (2026-10-16): the tracking slider is meant to make the long–short rhythm **more geometric and exact**, not to rescue near misses. "I want to be able to hone in the perfect ragged text for an aesthetic publication." Also: remove the Variation slider.

- **Precise mode** (`tracking.mode = 'precise'`, used by the panel and playground): every band line gets the tracking that puts its end on its target (long lines on the full measure, short lines on the Flatterzone), within ±max, in steps of 0.01 unit (InDesign accepts fractional tracking; measured 2026-10-16). A line never exceeds the measure. The last line and forced lines are not tracked.
- **Priorities in precise mode**: missing an edge costs 400 × (miss / band)², so edge precision ranks above the hyphen budget and Sinneinheiten, still below correct hyphenation, strict alternation and the last-line rules. Tracking itself costs 20 × (t / max)², so the least tracking that reaches the edge wins.
- **Rescue mode** (ADR-010) stays in the solver API; the panel no longer offers it.
- **Tracking steps**: tracking sits between characters, so a line of n characters gains n − 1 steps at its visible edge (measured in InDesign). The solver's width model was corrected accordingly.
- **Readout**: plans report `edgeMiss` (worst distance of a line end from its target) and the spread of long and short line ends; the panel and playground show them.
- **Variation** is gone from the panel and playground (it barely changed any break: 0 of 38 German lines at 100 %). The core keeps the option for API compatibility.

**Known limit (measured, German reference text, 60 characters per line, 10 pt):** words are large steps (20–40 pt with their space) compared with what tracking can move a line (about ±0.6 pt per 1/1000 em). With ±10 the worst line still sits 14–19 pt off its edge; truly geometric edges need more flexibility. Options put to the designer: allow larger tracking, adjust word spaces per line (track only the spaces, which Bringhurst prefers over letterspacing), or both.

## ADR-014: Tracked lines are measured without ligatures and steered with room to spare (2026-10-17)

Found by reproducing the designer's failed precise-tracking test on a copy of their story (`i3-user-copy.ts`, `i4-track-kern.ts`).

- **Ligatures**: InDesign breaks ligatures in tracked text. A tracked "The" in Minion Pro 12 pt is 1.0 pt wider than its untracked advance plus the tracking; "fl" 0.55 pt, "ft" 0.13–0.17 pt. Each paragraph is therefore measured a second time with ligatures off; a box's `trackedExtra` is the difference, and the solver adds it to every tracked line (DP, line building and the next-fragment width).
- **Last letter untracked**: tracking is applied to every character of a line but the last; the width model counts chars − 1 steps and no step for the generated hyphen.
- **Tooth margin**: an untracked line keeps its tooth ε (0.15 pt) past its ink, since those widths measure exactly. A tracked line puts its tooth halfway into the room before the next fragment, up to 0.25 em, so a small width error cannot push its last word down.
- **Safety distance**: precise tracking never brings a line closer than 0.1 em to the measure (long lines target that distance instead of 0). A line that tracking pulls exactly onto the frame edge has no tolerance at all.
- **Writes**: only tracking that differs from the document is written, and overset lines are not tracked (their tracking dominated slider ticks).
- **No "mechanical" warning**: with exact edges as the goal (ADR-013), the warning about even line ends is removed.

## ADR-015: Word spaces as a second precision control (2026-10-17)

The designer asked for per-line word-space adjustment alongside tracking so line ends get more exact (2026-10-17). Letter tracking alone left real text 10–20 pt off its edges.

- **How**: InDesign has no per-line word spacing, so Flatter tracks the word spaces inside a line: the first character of each word space gets the line's letter tracking plus its word-space value `wordSpace` (1/1000 em). Tracking a space widens exactly that gap and leaves ligatures alone (measured: +100 units = +1.2 pt at 12 pt). Writing one value per space is fast (42 lines, 227 spaces: 64 ms).
- **Limit**: `tracking.wordSpaceMax` in the core (1/1000 em per space, precise mode only). The panel and playground set it as a share of the paragraph's space width ("Largest word-space change", 0–50 %, default 25 %; InDesign's default word-spacing range is 80–133 %).
- **Split**: the distance to the edge is shared by `splitAdjustment`, which minimises (t/max)² + (w/max)² (the precise-mode cost): each control is used, relative to its maximum, in proportion to its reach. When one control reaches its maximum the other takes the rest. Values are cut toward zero, so lines never overshoot. Letter tracking only counts ligature widening (ADR-014) when it is non-zero.
- **Reach, German reference text, 60 characters per line, 10 pt**: letters ±10 alone: 14/33 lines within 0.5 pt, worst 16.7 pt off; with ±50 % word spaces: worst 8.6 pt; letters ±30 with ±50 %: 29/32 within 0.5 pt, worst 3.7 pt.
- Rescue mode (ADR-010) does not use word spaces.

## ADR-016: Measuring bench document, per-page teeth, band view (2026-10-17)

- **Measure whole paragraphs in a hidden document** that is closed after Apply's preparation. Reading the positions of thousands of characters in a frame of the user's document leaves InDesign with work on every later change to that frame (measured: probing 140 ms per word instead of 3 ms, removing the frame 12 s). Probing stays in a small scratch frame in the user's document, so the document's own hyphenation exceptions still apply. Document text settings that change glyph sizes (super/subscript, small caps) are copied to the bench.
- **Teeth are pooled per page.** A tooth cannot move between pages; list-position matching recreated teeth whenever an earlier page's line count changed.
- **Band view** on its own layer "Flatter (Ansicht)", directly under the control layer: non-printing, locked, no text wrap, 22 % opacity, Multiply, so it sits over any background and the text stays readable. It shows the target bands (long: measure − band … measure; short: measure − Z − band … measure − Z), like the playground. On by default in the panel; never printed or exported (non-printing layer).

## ADR-017: Points everywhere, probed compound hyphens, word-wide refusals, draft ticks (2026-10-17)

- **Every DOM operation runs in points** (`inPoints`: `app.scriptPreferences.measurementUnit = POINTS`, restored afterwards). Solver widths, tracking (1/1000 em of the point size), teeth and bands are all in points; documents may use any unit.
- **Typed hyphens are not always breaks.** InDesign decides per compound whether it breaks after a typed hyphen (with hyphenation on it often hyphenates a part instead). Compounds are probed and only accepted hyphen positions become breaks; without probing every hyphen stays a break and refusals correct it.
- **A refused point is refused in every occurrence of the same word** (same word key, same position): InDesign decides by word.
- **Draft ticks**: with word spaces on, slider ticks plan letter tracking only; the full plan (word spaces) is written once after the slider stops, then verified. Keeps a drag responsive in long stories (word spaces are one write each).
- **Idle teeth**: a band line steered to the full measure keeps a tooth just outside its column (none when columns touch), so tooth counts per page stay stable while a slider moves. Teeth are moved before tracking is written.

## ADR-018: Per-line measures for threaded frames; language buttons (2026-10-18)

- **`lineMeasures`** (core): a measure per line; Flatterzone, band and contrast scale with it (they are set relative to the paragraph's measure, and the panel sets them as percentages). The DP keys states by line number only when measures vary, so single-width paragraphs cost nothing extra. The adapter reads each line's column from the frames (line k of a paragraph sits at the k-th line position after the paragraph's start, which does not depend on the paragraph's own breaks) and re-plans when verify sees other widths; lines beyond the visible ones take the last frame's width.
- **Language buttons** set whole stories (all linked frames) to German: 2006 Reform or English: USA and re-apply Flatter to the story it works on, because the language changes hyphenation and required settings. For a bilingual publication each story keeps its own Flatter settings (loaded into the panel when it is selected).
