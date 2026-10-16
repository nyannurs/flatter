# Flatter — Strict Alternating Rag for Adobe InDesign

**Architecture & Implementation Plan (hand-off document for Claude Code)**
Status: design phase · Languages in scope: German (de-DE 2006 reform, de-CH 2006) and English (en-US, en-GB)

---

## 0. How to use this document (instructions for Claude Code)

1. Read the whole document before writing code.
2. **Do Phase 0 (spikes) first.** Several core assumptions depend on InDesign behaviour that is not documented well enough to trust. Each spike has a pass/fail criterion and a fallback. Record results in `docs/spike-results.md` and adjust the plan before Phase 2.
3. Keep the algorithm (`packages/core`) completely free of InDesign APIs so it can be unit-tested in Node.
4. Never mark a hyphenation as "correct" on the strength of one source alone (see §5).
5. When anything in this document conflicts with observed InDesign behaviour, observed behaviour wins — write it down and update the plan.

---

> **Phase 0 results (2026-10-16):** spikes S1–S3 and S5–S7 are done; see `docs/spike-results.md`, including the plan amendments at its end. Where they differ, the spike results win (§0.5).

## 1. Goal

A UXP panel plugin for InDesign that sets left-aligned ragged text (Flattersatz) in a **strictly alternating rhythm: long, short, long, short …**, with:

- a user-defined **Flatterzone** (the distance between the long-line edge and the short-line edge), controlled by a slider;
- **real-time preview**: moving the slider re-flows the text live so the designer can tune by eye;
- **always-correct hyphenation** for German and English — a wrong word division is a hard failure, not a cosmetic one;
- strictness as the core aesthetic: every line in a paragraph (except the last, see §4.4) must be clearly long or clearly short, in alternation.

### Non-goals (for now)
- Languages other than German and English.
- Justified text, centred text, right-aligned rag (could come later — the solver is alignment-agnostic).
- Vertical/CJK composition, text on a path, tables.

---

## 2. Definitions (the aesthetic, made precise)

All values are measured from the left edge of the line's measure (after indents).

| Symbol | Meaning |
|---|---|
| `W` | Measure: full available line width |
| `Z` | **Flatterzone**: offset of the short-line target from `W` (slider 1) |
| `b` | **Band / tolerance**: how far a line may fall short of its target and still count (slider 2) |
| `c` | **Minimum contrast**: minimum width difference between a long line and its short neighbours (derived or slider 3, default `c = Z − b`) |
| `ε` | Steering margin (see §3), ~0.1–0.25 pt |

- **Long line**: right edge of last visible glyph (incl. hyphen) in `[W − b, W]`
- **Short line**: right edge in `[W − Z − b, W − Z]`
- **Strict alternation**: line parity decides long/short; for every long line `L` and its neighbouring short lines `S`: `L − S ≥ c`
- **Phase**: whether a paragraph starts with long or short (user option: fixed long / fixed short / auto-per-paragraph / continuous across paragraphs)
- **Ausgangszeile** (last line of a paragraph): exempt from the band, but rules in §4.4 apply

Requirement `Z > b` (bands must not overlap); the UI enforces it.

**Default Flatterzone** (initial slider value, derived from the measure): `Z = W/5` for wide columns, `W/7` for narrow columns (ZHdK teaching guideline, §2A.3). Slider range clamps to roughly `W/12 … W/4`; below ~`W/10` the UI labels the result **Rauhsatz** rather than Flattersatz (§2A.2).

---

## 2A. Typographic foundations (why the rules are what they are)

This section records what respected typographers, book and editorial designers, and the official orthography bodies say. The solver's defaults and penalties are derived from it. **Claude Code: do not "simplify away" rules in this section without asking the designer.**

### 2A.1 Source hierarchy
Only these sources inform defaults. Popular blogs, flash-card sites, SEO "typography tips" and generic tutorials were deliberately excluded.

| Tier | Sources | Used for |
|---|---|---|
| **Norms (binding)** | Rat für deutsche Rechtschreibung — Amtliches Regelwerk 2006/2010, Teil F "Worttrennung am Zeilenende"; Duden; *Chicago Manual of Style* §7.36–47 (US); Oxford *New Hart's Rules* (UK) | What is a *correct* word division |
| **Typographic canon (German-language)** | Willberg & Forssman, *Lesetypografie* and *Erste Hilfe in Typografie*; Forssman & de Jong, *Detailtypografie* (chapters "Flattersatz", "Trennungen, Zeilenumbruch", "Bearbeiteter und unbearbeiteter Flattersatz"); Jost Hochuli, *Das Detail in der Typografie*; Zürcher Hochschule der Künste (ZHdK) typography teaching | What is a *good* Flattersatz in German |
| **Typographic canon (English-language)** | Bringhurst, *The Elements of Typographic Style* §2.1, §2.4; Tschichold, *Penguin Composition Rules*; Eric Gill, *An Essay on Typography*; Paul Shaw, "Tiger Rag" (history of rag and hyphenation); Ilene Strizver, *Type Rules*; James Felici, *The Complete Manual of Typography*; Ellen Lupton, *Thinking with Type* | Rag quality, hyphen etiquette, contrasting views |
| **Editorial practice** | Roger Black (editorial designer, "phrase ragging"); Swiss modernists Max Bill, Karl Gerstner, Müller-Brockmann (flush-left/ragged-right as the house style of the International Typographic Style) | Editorial-page conventions |
| **Technical** | Knuth & Plass; Udo Wermuth, "An attempt at ragged-right typesetting" (TUGboat 41:1, 2020) — implements German *Flattersatz* recommendations in TeX; DANTE e.V. hyphenation work; SiSiSi (TU Wien) | Algorithms |

### 2A.2 Flattersatz vs. Rauhsatz — the German distinction matters
- German typography distinguishes **Rauhsatz** (ragged with liberal hyphenation, nearly block-like, narrow rag) from **Flattersatz** (clearly distinguishable line lengths, few hyphens, a deliberate rhythm). Wermuth's TUGboat paper makes exactly this point: TeX's default ragged-right produces Rauhsatz, not the more demanding Flattersatz.
- This plugin produces **Flattersatz**. Small Flatterzones drift towards Rauhsatz; the UI names the mode so the designer knows which tradition the result belongs to.

### 2A.3 The rhythm itself — strict alternation is a deliberate stance
- **For it:** German teaching widely cites the rule "lang – kurz – lang" for linksbündigen Flattersatz, and German reference works describe the ideal Flattersatz as rhythmic, e.g. alternating short/long. Roger Black calls the alternating short-long pattern "feathered" setting. Wermuth's TeX implementation targets a rhythmical pattern of short and long lines.
- **Against too much regularity:** several respected voices warn that a mechanically regular rhythm is itself a fault. Teaching material lists "zu regelmäßiger Rhythmus" among the classic Flattersatz faults; TypeSCHOOL recommends "kurz – lang – mittellang"; experienced practitioners on typografie.info say a plain long–short is not enough for a "rhythmisch akzentuierter Flattersatz". Bringhurst goes further: he mocks the tight, hyphenated rag as a "pie-crust" and prefers an unhyphenated "hard rag".
- **Consequence for the product:** strict alternation remains the core (it is the designer's explicit aesthetic), but it is offered with full awareness of the debate:
  - The **Variation** control (§6.4, default 0) lets the designer add controlled, deterministic micro-variation *inside* each band (long lines are never all identical) without ever breaking the long/short alternation.
  - The overlay can show a "pattern check" warning when the right edge forms a visually mechanical sawtooth (e.g. all long lines within 0.5 pt of each other across many lines).

### 2A.4 Classic rag faults the solver must prevent
From the German canon (Willberg/Forssman, Forssman/de Jong, ZHdK) and English sources (Lupton, Strizver):
- **Treppen** (staircases: three or more lines progressively longer or shorter) — impossible under strict alternation, but checked anyway in Soft mode.
- **Bäuche / Hohlkehlen** (bellies / hollows: convex or concave silhouettes over several lines) — prevented by keeping long lines and short lines each inside a narrow band; band drift across a paragraph is penalised.
- **Löcher** (holes: a very short line, often a single short word) — prevented by the short band's lower bound.
- **Sprachlich unlogische Zeilenbildung** (line breaks that tear apart units of meaning) — see 2A.6.
- **Zu kleiner / zu großer Flatterbereich** — handled by the default Z and slider limits.

### 2A.5 Hyphenation in Flattersatz — fewer, better, at word joints
- German Flattersatz convention: hyphenate as little as possible; the wider the column, the fewer hyphens. When dividing, prefer **word-part joints over syllables** (ZHdK example: "gegen-über" is better than "ge-genüber"). This maps directly onto the solver's quality classes (§5.3): class A (main joint) is strongly preferred, class B (syllable) penalised more heavily in wide measures.
- Hochuli observes that English words are shorter than German ones and that English practice hyphenates less (some magazines not at all). Therefore **language-specific defaults**: English gets a smaller hyphenation budget and higher hyphen penalty than German.
- Historical perspective (Paul Shaw): Gutenberg, Plantin and Aldus routinely set four or more hyphens in a row; the modern obsession with consecutive hyphens comes from justified "ladders". Tschichold's Penguin rules allowed free word breaking to avoid wide spacing. Modern editorial guides are stricter: Bringhurst allows at most three consecutive hyphenated lines, Strizver at most two.
  → Default limit **2** (editorial standard), configurable up to 3.
- Bringhurst's hyphenation etiquette, adopted as defaults/penalties:
  - leave at least 2 characters behind and carry at least 3 forward;
  - no stub-end of a hyphenated word, and no word shorter than 4 letters, as the last line of a paragraph;
  - hyphenate proper names only as a last resort;
  - link short numerical expressions with hard (non-breaking) spaces;
  - avoid more than 2 consecutive lines beginning with the same word;
  - avoid hyphenated breaks where the text is interrupted (e.g. before a dash or parenthesis).
- Everyone agrees on one thing: **meaning-distorting divisions** (e.g. "Urin-stinkt") are unacceptable in any setting.

### 2A.6 Sinneinheiten / phrase ragging
- Willberg & Forssman describe arranging line breaks by sense (Sinnzusammenhang) instead of purely by form in reading texts, while keeping Flattersatz lively but not overactive. Roger Black argues the same from editorial practice: lines that follow natural phrases read better even at the cost of a more ragged edge, and he notes that InDesign's automatic feathering often interrupts phrases.
- German line-break conventions keep together: article + noun, number + unit, dates, and abbreviations with their periods (German convention avoids a line ending on a non-final abbreviation period — CMOS notes this as a German rule that English does not share).
- English (CMOS): no break between initials in a name, between a numeral and an abbreviated unit, after a run-in list enumerator, before "Jr."/"Sr."/"III".
  → Implemented as a **Sinneinheiten** penalty layer (§4.2), on by default for German, optional for English. These are penalties, not absolutes, because strict alternation has priority; violations are reported.

---

## 3. Core architectural decision: how do we make InDesign obey?

Three ways to impose line breaks on InDesign were considered.

### Option A — Insert characters (forced line breaks + hard hyphens)
Compute breaks externally, then insert `Forced Line Break` characters and literal hyphens.
- ✅ Total control over every break.
- ❌ Destructive: text now contains fake hyphens and breaks. Any later edit, font change or reflow leaves wrong hyphens mid-line. Breaks search, spell-check, PDF text extraction/accessibility, EPUB.
- ❌ **We become responsible for hyphenation correctness** — the hardest part of the problem.

### Option B — Custom paragraph composer (C++ InDesign SDK)
Write a composer that natively implements the alternating rule.
- ✅ The "right" place for this logic; fully native, no side objects.
- ❌ C++ SDK, per-version native builds for macOS/Windows, much higher cost, no live UXP UI. Keep as a long-term upgrade path only.

### Option C — **Steer InDesign's own composer with per-line text-wrap "teeth"** ✅ *chosen*
Place one locked, non-printing text-wrap object per text frame (or column). It has a thin horizontal "tooth" intruding from the right edge at the vertical centre of each line. Each tooth limits the maximum width of exactly one line. InDesign still composes and **hyphenates the text itself, using its own dictionary (Duden for German)**.

Prior art: a community script (InDesign 2019–2021 era) already produced rhythmic rag by adding a zero-height graphic line with bounding-box text wrap per line, alternating between full width and width minus a Flatterzone percentage. That script only alternated the *maximum* width, randomly, without planning — so lines often fell well short of their target. We keep the mechanism and add a planner.

**The key idea — "plan, then steer":**
1. Measure the text (glyph advances, spaces, InDesign's valid break points).
2. Run a global optimiser (Knuth–Plass-style dynamic programming, §4) that chooses where each line should end so the alternation is strict.
3. For each line, set its tooth so the max width = `planned line width + ε`, which is less than the width needed to fit the next allowed break. A greedy composer (Adobe Single-line Composer, hyphenation zone 0) then breaks *exactly* where planned.
4. Read back the actual composed lines; if any line differs from the plan (e.g. InDesign refused a predicted hyphenation point), mark that point as unavailable and re-plan. Converges in 1–3 iterations.

Why this wins:
- **Hyphenation correctness stays with InDesign's dictionary** (Duden for German), and we only *ever* select among points InDesign itself accepts. On top of that we can veto points (§5) — but we can never introduce a point InDesign would not use.
- **Non-destructive**: the text is untouched. Remove the wrap object and the text is exactly as before.
- **Real-time**: a slider tick = re-run DP on cached measurements (~ms) + one geometry update (`entirePath`) → InDesign recomposes natively.
- **Graceful degradation**: if the text is edited and the plan goes stale, teeth still alternate the maximum widths, so the rhythm survives roughly until recompute.
- **Renders without the plugin** on any machine — with caveats (§7.7).

Risks of Option C are listed in §7 and covered by spikes in Phase 0. Option A is kept as an optional, explicit **"Freeze"** command (§6.6) for final hand-off when needed.

---

## 4. The solver (`packages/core`)

### 4.1 Input model (Knuth–Plass items)
Per paragraph, a sequence of:
- **Box**: unbreakable fragment (syllable chunk between allowed break points), width in pt, measured from InDesign.
- **Glue**: inter-word space. Left-aligned rag uses the desired word spacing → treat as fixed width (no stretch/shrink).
- **Penalty**: possible break inside a word (hyphenation point). Carries hyphen width, a **quality class** (§5.3) and whether it is allowed.
- **Forbidden**: no-break spans (No Break attribute, non-breaking spaces, GREP-protected sequences like `10 kg`, `z. B.`, `S. 42`, dates, initials).
- **Forced**: existing hard line breaks / paragraph end.

### 4.2 Optimisation
Dynamic programming over break candidates. State = `(breakIndex, lineParity, consecutiveHyphenCount)`. Line count does not need to be in the state; parity is enough.

Line cost:
- Distance from the band target (quadratic inside the band; very steep outside).
- Strict mode: a line outside its band, or a long/short pair with contrast `< c`, is **infeasible** (∞), not merely expensive.
- Hyphenation penalty by quality class (main/compound joint < secondary < discouraged; vetoed = forbidden).
- Consecutive hyphens > limit (from paragraph's Hyphen Limit setting, default 2) = infeasible.
- Hyphen in the penultimate line (before Ausgangszeile): high penalty.
- **Hyphenation budget** (§2A.5): penalty grows with hyphen count per paragraph and with measure width; English default budget lower than German.
- **Band drift** (§2A.4, Bäuche/Hohlkehlen): penalty on the variance of long-line ends and of short-line ends across the paragraph.
- **Sinneinheiten** (§2A.6), language-specific lists, on by default for German:
  - line ending on an article, a one-letter word, a preposition before its noun, or (English) a pronoun;
  - breaking number + unit, dates, initials, abbreviation + following word (German: no line end on a non-final abbreviation period);
  - more than 2 consecutive lines starting with the same word; consecutive lines ending with the same word.
- **Hyphen near interruptions**: hyphenated break directly before a dash, parenthesis or quotation: high penalty.
- **Variation** (§2A.3, slider, default 0): when > 0, adds a deterministic, seeded target offset per line *within* its band so that long lines are not mechanically identical. Never moves a target outside its band.

Complexity: O(n · k) with a sliding window of feasible line starts — a few hundred breakpoints per paragraph solve in well under 1 ms in JS.

### 4.3 Infeasibility
Strict alternation is not always achievable (a long unbreakable word, a URL, a very narrow measure). Behaviour:
1. Try the other phase.
2. Relax to soft constraints with very large penalties; return the best solution **plus a list of violations** with line indices and reasons.
3. The UI shows violations (§6.3); the user decides (adjust slider, rephrase, allow tracking).
Optional assist (off by default, per-paragraph opt-in): allow tracking of ±N units on a single line to rescue it — stored and reversible.

### 4.4 Ausgangszeile (last line) rules
- Exempt from bands, must be ≤ `W`.
- Never the stub-end of a hyphenated word, never a single word shorter than 4 letters (Bringhurst §2.4.2) — hard constraint in Strict mode.
- Configurable: minimum length (avoid a lone short word), maximum length (avoid a last line that reads as "long" and breaks the rhythm visually — e.g. must be ≤ the short target if the previous line was long).

### 4.5 Output
`Plan { lines: [{ startItem, endItem, endsWithHyphen, targetWidth, plannedWidth, parity }], violations: [...], cost }`

### 4.6 Simulator (for development without InDesign)
A Node/browser harness that renders a plan to SVG using `opentype.js` font metrics and a pattern-based hyphenator. Used for fast iteration on the solver and for visual regression snapshots. It is a **development tool only**; production measurements always come from InDesign.

---

## 5. Hyphenation — correctness first

This is the highest-risk area. Design principle: **multiple independent sources, only consensus is trusted, disagreements go to a human.**

### 5.1 Why it is hard
- **German compounds** are unlimited and ambiguous; pattern-based hyphenation (TeX/Liang) gets compound joints wrong. Classic ambiguous cases where the reading changes meaning or both readings exist:
  `Wachstube` (Wach-stube / Wachs-tube), `Staubecken` (Stau-becken / Staub-ecken), `Blumentopferde`, `Spargelder` (Spar-gelder / Spargel-der), `Musikerleben` (Musik-erleben / Musiker-leben), `Erbinformation`, `Lachsalve`.
  Mis-segmentation cases: `Urinstinkt` (Ur-instinkt, never Urin-stinkt), `Druckerzeugnis` (Druck-erzeugnis), `beinhalten` (be-inhalten), `Analphabet`, `Bauchinhalt`, `Spiegelei`, `Häuschen` (Häus-chen), `Mädchen`.
- **German 2006 reform rules** (Amtliches Regelwerk, Teil F): `ck` stays together (Zu-cker); `st` may be divided (Kis-te); triple consonants (Schiff-fahrt). The 2006 revision added one visible change: **single vowels at the start or end of a word are never separated** — not "E-sel", not "Feiera-bend", not "Bi-omüll" (and "Klei-e" was already not allowed). These are hard rules, independent of any dictionary, enforced by our own classifier as a last line of defence. de-CH: no ß. Old orthography (Zuk-ker) is out of scope but must not be produced when language = 2006 reform.
- **Correct ≠ good**: the German canon distinguishes divisions that are orthographically allowed from those that are typographically acceptable. Prefer word-part joints (gegen-über) over syllables (ge-genüber) (§2A.5).
- **Haupt- vs Nebentrennstellen**: German typography prefers dividing at word joints (Haupttrennstellen) over syllable breaks inside a stem (Nebentrennstellen) — the SiSiSi research line formalised this; it maps directly to our penalty classes.
- **German nouns are capitalised**: InDesign's "Hyphenate Capitalized Words" must be ON for German, or almost every noun becomes unbreakable. For English it should usually be OFF (proper nouns). Per-language setting.
- **English authorities**: US practice follows *Chicago Manual of Style* §7.36–47, which bases division on pronunciation as shown in Merriam-Webster and discourages breaking names. British practice (Oxford, *New Hart's Rules*) leans on word origin/morphology first, then sound. So en-US and en-GB need **separate golden corpora**.
- **English**: US (pronunciation-based) and UK (morphology-based) conventions differ (`knowl-edge` vs `know-ledge`, `de-moc-racy` vs `demo-cracy`). Homographs hyphenate differently by meaning (`rec-ord` noun / `re-cord` verb, `pres-ent` / `pre-sent`, `proj-ect` / `pro-ject`). Infamous misleading splits: `the-rapist`, `mans-laughter`, `leg-end`.
- **Never hyphenate** (or only at existing hyphens): words that already contain a hyphen (`E-Mail`, `well-known`), URLs, e-mail addresses, numbers, abbreviations, proper names in English, code, words shorter than the minimum length.

### 5.2 Sources
1. **Authority: InDesign's own dictionary for the text's applied language.** For German, configure **Duden** (Preferences → Dictionary). Duden offers four hyphenation styles; "All" permits technically correct but awkward breaks, "Aesthetic" only aesthetically defined points, "Preferred Aesthetic" aesthetic points plus logical breaks for longer words without defined aesthetic points. **Default: Aesthetic or Preferred Aesthetic; never "All".** For English, InDesign's built-in (Hunspell-based) dictionary for en-US / en-GB.
2. **Second opinion: independent pattern engine** (Liang patterns via a JS hyphenator, e.g. the `hyphen` npm package with hyph-utf8 patterns; for German preferably the `dehyph-exptl` patterns generated from the "Freie Wortlisten und Trennmuster" project's word list). **Licensing must be checked before bundling** (hyph-utf8 / dehyph-exptl use LPPL/MIT-style licences — verify).
3. **Curated lists**: a bundled golden list of hard words (above + growing), plus the document's and user's InDesign hyphenation exceptions (respected automatically by InDesign).
4. **User decisions** made in the review panel (§6.4), saved as InDesign hyphenation exceptions (document or user dictionary) so they also govern composition outside the plugin. InDesign's exception notation weights points by tildes: `~` best, `~~` next best, `~~~` acceptable but poor; a leading `~` prevents hyphenating the word. Map our classes onto this: A → `~`, B → `~~`, discouraged → `~~~`, X → leading `~`. Verify the notation against current InDesign behaviour in Spike S7.

### 5.3 Quality classes used by the solver
| Class | Meaning | Solver treatment |
|---|---|---|
| A | Authority accepts + second opinion agrees + main joint (compound boundary) | lowest penalty |
| B | Authority accepts + second opinion agrees, secondary point | normal penalty |
| C | Authority accepts, second opinion disagrees or word is on the ambiguous list | **forbidden in "Safe" mode (default)**, high penalty in "Normal" mode, always listed for review |
| X | User vetoed / exception says no | forbidden |

In Safe mode we only ever break where **both** engines agree, and only where InDesign actually breaks. That is the "always separate correctly" guarantee: no single source can introduce a break on its own.

### 5.4 Getting InDesign's break points (open question → Spike S3)
The solver needs to know which points InDesign will accept. Candidates, in order of preference:
1. A DOM API that exposes hyphenation points (unknown whether one exists — investigate).
2. **Probe**: in a hidden off-page frame with identical paragraph settings, test candidate points from the pattern engine by setting the frame width to `width(prefix + hyphen) + ε` and checking whether line 1 ends there. Cache results per (word, language, style, dictionary vendor) in the document (`insertLabel`) so this runs once per word.
3. **Predict-and-verify only**: use pattern-engine points as predictions, steer, read back, and re-plan on mismatch. Correctness is still guaranteed (InDesign only uses its own points); only efficiency suffers.

### 5.5 Hyphenation settings the plugin checks/enforces on target paragraphs
Hyphenation on; language explicitly applied (warn on `[No Language]` or mixed languages inside a word — a wrong language also produces wrong ligatures); words with at least 6 letters (5 for narrow columns); after first 2 / before last 3 (Bringhurst: 2 behind, 3 forward) for both languages — user configurable; hyphen limit 2; hyphenate capitalised words ON for German, OFF for English; hyphenate last word OFF; hyphenate across column OFF; Duden style = Aesthetic/Preferred Aesthetic. Show a one-click "Fix settings" with a diff before changing anything.

---

## 6. InDesign integration (`packages/indesign-adapter` + `packages/panel`)

### 6.1 Platform
- **UXP plugin** (InDesign ≥ 18.5 supports UXP plugins; target the current release, confirm minimum in Spike S4). Manifest v5, panel entrypoint, Spectrum Web Components (`sp-slider`, `sp-switch`, `sp-picker`).
- TypeScript, esbuild/webpack bundle, `.ccx` packaging.
- All document mutations run inside `app.doScript(fn, ScriptLanguage.UXPSCRIPT, [], UndoModes.ENTIRE_SCRIPT, "Flatter")` so each user action is one undo step. Note: in UXP, DOM calls are time-shared with InDesign and other plugins, so DOM-heavy loops are slow — **minimise the number of DOM calls**: bulk reads via `everyItem()`, one `entirePath` write per frame per tick.

### 6.2 Pipeline per story
```
extract  →  measure  →  hyphenation candidates  →  solve (core)  →  steer (teeth)  →  read back  →  verify / re-plan
   ↑                                                     ↑
 cache (story label)                               slider changes only re-run from here
```
- **Extract**: paragraphs, applied language per character run, paragraph hyphenation & composer settings, indents, no-break runs, frame geometry, columns, threading.
- **Measure**: bulk-read character `horizontalOffset` / end offsets (Spike S2) of the composed text → advance widths including kerning/tracking/optical kerning; hyphen width per font/size; word-space width.
- **Steer**: build/update one wrap polygon per frame-column: vertical spine just outside the frame's right edge, one zero-height-ish tooth per line at `baseline − xHeight/2`, tooth depth = `W − (plannedWidth + ε)`.
- **Read back**: bulk-read actual line ends; compare to plan; re-plan with refused points marked unavailable.

### 6.3 Live preview loop
- Slider `input` events → debounce ~30–60 ms → solve on cached measurements → write polygon → InDesign recomposes.
- After the user pauses (~250 ms): read back, verify, update status.
- Status strip: `✓ 38/38 lines in rhythm` or `⚠ 2 violations` (click → select line in document).
- **Overlay** (toggle): non-printing layer showing the long band and short band as tinted strips and marking violating lines.

### 6.4 Panel UI
- **Flatterzone** slider (pt / mm / % of measure) — primary control; initial value `W/5` or `W/7` (§2)
- **Band** slider (tolerance)
- **Variation** slider (default 0) — controlled liveliness inside the bands (§2A.3)
- Mode label shown live: **Flattersatz** / **Rauhsatz** (§2A.2)
- Toggles: Sinneinheiten (§2A.6); hyphenation budget low / normal; hang hyphen in margin (optional — historical practice from Gutenberg to Dowding; changes how "line length" is measured, see §11)
- Phase: start long / start short / auto / continuous
- Mode: Strict · Soft; Hyphenation: Safe · Normal
- Max consecutive hyphens; Ausgangszeile min/max
- Scope: selection / paragraph / story; Paragraph-style presets (save settings into a named preset, stored in the document)
- Buttons: Apply, Live on/off, Recompute, Freeze, Remove
- **Hyphenation review list**: every hyphenated line end with word, split, class (A/B/C), source agreement; click to jump; actions: approve (→ exception), forbid (→ exception with no break), prefer another split

### 6.5 Persistence
- Settings per story: JSON in `story.insertLabel("flatter", …)`.
- Wrap objects: dedicated locked layer "Flatter (Steuerung)", objects non-printing, labelled with the story/frame id. Do not rely on hiding the layer — verify how hidden-layer text wrap behaves (layer option "suppress text wrap when layer is hidden").
- Measurement / probe caches in document labels, invalidated by content hash per paragraph.

### 6.6 Freeze (optional, explicit)
For final hand-off to machines without matching dictionaries: convert the current composition to fixed breaks (forced line breaks + hyphens), tagged with a dedicated **Condition** ("Flatter frozen") so that "Unfreeze" can find and remove exactly those characters. Warn about the downsides (search, accessibility, reflow).

### 6.7 Edits and lifecycle
- Listen to available UXP/InDesign events (selection change, document events; check what edit-related events exist — Spike S5). On change in a managed story: mark stale; in Live mode recompute the affected paragraphs only.
- Frame moved/resized → rebuild that frame's teeth.
- "Remove" deletes wrap objects, labels, and (if frozen) conditioned characters; text returns to its original state.

---

## 7. Concerns, challenges and obstacles

### 7.1 Composer behaviour
- Steering relies on a **predictable greedy composer**. The Adobe Paragraph Composer evaluates breaks for the whole paragraph with weighted penalties and may break earlier than our max width. Plan: switch target paragraphs to the **Adobe Single-line Composer** with hyphenation zone 0. Must be verified (S1). If Single-line is unacceptable to the user, steering accuracy will drop.
- "Balance Ragged Lines" must be off; Optical Margin Alignment and hanging punctuation shift visual edges — define whether bands refer to the frame edge or the optical edge (S6).

### 7.2 Text-wrap mechanics
- Which vertical extent of a line does a wrap object affect? Tight leading means ascenders/descenders of neighbouring lines overlap vertically. Teeth must hit exactly one line (S1).
- Composition preference "Text Wrap Only Affects Text Beneath" — wrap object must be above the frame in stacking order, or that preference must be considered.
- Frames with "Ignore Text Wrap" enabled; other wrap objects (images) on the page interacting with the teeth.
- Baselines must be stable: fixed leading is fine; auto leading, inline graphics, paragraph spacing changes, keep options and span/split columns can move baselines when breaks change → iterate to a fixed point, cap iterations, report.

### 7.3 Measurement accuracy
- Kerning between last glyph and hyphen, contextual alternates and ligatures (`fi`, `ff`, `ck`, `st` ligatures dissolve or form when a word is broken), tracking/nested/GREP styles, superscripts. The `ε` margin plus read-back verification absorbs small errors; large ones trigger re-plan.

### 7.4 Strictness vs. reality
- Some paragraphs cannot satisfy strict alternation without bad breaks. The product must be honest: show violations instead of silently cheating. Offer explicit, reversible assists only.
- Very narrow measures (< ~40 characters) make strict alternation with Safe hyphenation often infeasible; communicate this in the UI. The canon puts comfortable reading measures at about 45–75 characters (Bringhurst: 66 ideal) and treats very short measures as Rauhsatz territory.
- Strict alternation competes with Sinneinheiten and with "few hyphens". The priority order must be explicit and visible to the designer: (1) correct hyphenation, (2) alternation, (3) Ausgangszeile rules, (4) hyphen budget, (5) Sinneinheiten, (6) band centring/variation.
- Aesthetic risk: a perfectly regular sawtooth can read as mechanical (§2A.3). The pattern check and Variation control exist for this.

### 7.5 Hyphenation correctness
- Covered in §5. Residual risk: both engines agreeing on a wrong point. Mitigation: golden test corpus, ambiguous-word list, review panel, exceptions feeding back.

### 7.6 Performance
- UXP DOM calls are slow and time-shared; design around few bulk calls. Recomposition of long stories is the bottleneck — scope live preview to selection/visible frames; full-story pass on Apply.

### 7.7 Portability of documents
- The composition depends on the hyphenation vendor. A colleague whose InDesign uses a different German dictionary (Hunspell instead of Duden) or different user dictionary may get different breaks → rhythm degrades. Mitigations: store exceptions in the document; detect vendor mismatch on open and warn; Freeze for final output.
- Fonts must match (as always).

### 7.8 Layout complexity (phase later, warn early)
Threaded frames with different widths, multi-column frames, footnotes, anchored objects, drop caps, first-line indents, tabs, tables, text on path. MVP: single- or multi-column frames of equal width, threaded allowed if widths match; everything else → warn and skip paragraph.

### 7.9 Platform / API uncertainty
- Exact availability of properties (line/character end offsets, path editing, events) under UXP must be confirmed against the current InDesign DOM reference. Do not assume ExtendScript-era behaviour carries over.

---

## 8. Phase 0 — spikes (do these first)

| ID | Question | Pass criterion | Fallback |
|---|---|---|---|
| S1 | Do per-line wrap teeth + Single-line Composer reproduce a planned break exactly? Which vertical extent do teeth affect? | 100 % of lines in a 3-paragraph DE + EN test text break where planned, at 3 leadings (tight/normal/loose) | Separate zero-height wrap lines per line (prior-art method); else Option A for Freeze-only workflow |
| S2 | Can we bulk-read per-character horizontal positions and line end positions in UXP accurately? | Predicted vs actual line widths within 0.05 pt | Measure per-word via hidden probe frame |
| S3 | Can we obtain InDesign/Duden hyphenation points (API or probe)? Cost per word? | API exists, or probe < 5 ms/word with caching | Predict-and-verify (§5.4 option 3) |
| S4 | Live loop latency: slider → DP → `entirePath` → visible recomposition | < 100 ms for a 40-line frame | Update on slider release + throttled preview |
| S5 | Which events can detect text edits in a managed story? | Reliable change signal | Manual Recompute + stale detection via content hash on focus |
| S6 | Interaction with optical margin alignment, baseline grid, paragraph spacing, threaded and multi-column frames, hidden layers, non-printing objects in PDF export | Documented behaviour per case | Restrict MVP scope + warnings |
| S7 | Duden availability & settings via scripting (vendor, hyphenation style) | Can read (ideally set) per paragraph style | Read-only check + instructions to user |

Deliverable: `docs/spike-results.md` with findings, screenshots, and plan amendments.

---

## 9. Implementation phases

1. **Phase 0 — Spikes** (above). Minimal throw-away UXP plugin + test document `test/fixtures/flatter-test.indd` with DE and EN paragraphs at several leadings and widths.
2. **Phase 1 — Core solver** (`packages/core`, TypeScript, Vitest)
   - Item model, DP, strict/soft modes, phases, Ausgangszeile rules, violation reporting.
   - Property tests: every plan line ≤ W; strict solutions satisfy bands and contrast; consecutive hyphens ≤ limit.
   - SVG simulator + snapshot tests.
3. **Phase 2 — Hyphenation module** (`packages/hyphenation`)
   - Pattern engine wrapper (de-1996/dehyph-exptl, en-us, en-gb), normalisation (case, ß/ss, soft hyphens, existing hyphens), never-hyphenate classifiers (URLs, numbers, abbreviations, code).
   - Consensus/classification (A/B/C/X), ambiguous-word list.
   - **Golden corpus** `test/hyphenation/{de,en-US,en-GB}.tsv`: word → allowed points → main joints; ≥ 300 entries per language including every example in §5.1 and the official single-vowel cases (Esel, Feierabend, Biomüll, Kleie, Abend). CI must pass 100 %.
   - Hard-rule classifier independent of dictionaries: single vowel at word start/end, `ck`, minimum left/right characters, existing hyphens, abbreviations, numbers, URLs.
   - Sinneinheiten lists (de, en): articles, prepositions, pronouns, units, abbreviations.
4. **Phase 3 — InDesign adapter** (`packages/indesign-adapter`)
   - Extract, measure, settings check/fix, teeth builder, read back, verify/re-plan loop, caching, single undo step.
5. **Phase 4 — Panel** (`packages/panel`)
   - Sliders, live loop with debounce, status strip, overlay layer, presets.
6. **Phase 5 — Review & QA tooling**
   - Hyphenation review list, exceptions write-back, violation navigator.
7. **Phase 6 — Robustness**
   - Edit tracking, threaded/multi-column frames, frame move/resize, Freeze/Unfreeze, Remove, document-open checks (vendor mismatch, stale plans).
8. **Phase 7 — Packaging**
   - `.ccx`, README (DE/EN), user guide with recommended paragraph-style setup.

### Suggested repository layout
```
flatter/
  packages/
    core/              # solver, pure TS, no InDesign
    hyphenation/       # patterns, consensus, classifiers
    indesign-adapter/  # all InDesign DOM access
    panel/             # UXP UI (manifest.json, index.html, SWC)
    simulator/         # opentype.js + SVG dev harness
  test/
    fixtures/          # .indd/.idml test docs, fonts info
    hyphenation/       # golden corpora de.tsv, en.tsv
  docs/
    spike-results.md
    decisions.md       # ADRs
```

---

## 10. Acceptance criteria (MVP)

- On the reference DE and EN test texts (Safe hyphenation, Strict mode, measure 55–70 characters), ≥ 95 % of paragraphs achieve perfect alternation; the rest are reported with reasons.
- **Zero** hyphenations outside class A/B in Safe mode; zero golden-corpus failures; zero violations of the official single-vowel rule.
- No Treppen, Löcher, or Ausgangszeilen shorter than 4 letters in Strict mode; hyphenated lines never exceed the configured consecutive limit (default 2).
- **Designer review**: a typographer judges the DE and EN reference pages side by side with a hand-set Flattersatz version; the plugin result must be judged at least equivalent on rhythm and division quality. (Automated metrics cannot settle aesthetic quality.)
- Slider-to-visible-reflow ≤ 100 ms on a 40-line frame (or documented fallback from S4).
- Remove restores the original text composition bit-for-bit (no residual characters, styles or labels other than intentionally kept exceptions).
- One undo step per Apply / slider release.

---

## 11. Open decisions for the designer

1. **Composer**: OK to switch affected paragraphs to the Single-line Composer? (Required for precise steering.)
2. **Definition of length**: bands measured to the frame edge, or to the optical edge (with optical margin alignment / hanging hyphens)?
3. **Phase across paragraphs**: restart each paragraph with "long", or continue the rhythm across paragraph breaks?
4. **Ausgangszeile**: rules for the last line (min/max length relative to the bands)?
5. **Assists**: is micro-tracking on individual lines acceptable at all, and if so, the maximum?
6. **Line-end word rules**: should the solver avoid ending lines on articles/prepositions/one-letter words (German "unlogische Zeilenbildung")?
7. **Duden style**: Aesthetic vs. Preferred Aesthetic as default.
8. **Regularity**: pure alternation (Variation 0), or a little life inside the bands? (The canon is divided: §2A.3.)
9. **Priority order** when goals conflict (§7.4): confirm or reorder.
10. **Hanging hyphens**: should a hyphen count towards line length, or hang into the margin?
11. **Consecutive hyphens**: 2 (Strizver, editorial) or 3 (Bringhurst)?

---

## 12. References
- Knuth & Plass, "Breaking Paragraphs into Lines" (1981) — box/glue/penalty model; JS implementations: `bramstein/typeset`, `robertknight/tex-linebreak`.
- Adobe: InDesign text composition (Paragraph vs Single-line Composer); Duden dictionary and Duden hyphenation styles; UXP for InDesign developer docs and changelog.
- Adobe Community: "Scripting Flattersatz" (rhythmic rag via per-line text-wrap lines); "UXP vs CEP" (doScript + UndoModes, DOM call performance).
- DANTE e.V. / TeX: German hyphenation patterns, Hyphenation Exception Log (Lemberg), `dehyph-exptl` and the "Freie Wortlisten und Trennmuster" project; SiSiSi (sichere sinnentsprechende Silbentrennung, TU Wien) — Haupt-/Nebentrennstellen.
- Rat für deutsche Rechtschreibung: Amtliches Regelwerk (2006, 2010), Teil F Worttrennung am Zeilenende; Bericht 2006 (single-vowel rule).
- Willberg & Forssman: *Lesetypografie* (Hermann Schmidt Mainz), *Erste Hilfe in Typografie*. Forssman & de Jong: *Detailtypografie*. Jost Hochuli: *Das Detail in der Typografie* / *Detail in Typography*. ZHdK, CAS Fundamentals of Typography: "Flattersatz HowTo" (Flatterzone 1/5 resp. 1/7; word-part joints).
- Robert Bringhurst: *The Elements of Typographic Style* (§2.1, §2.4). Paul Shaw: "Tiger Rag: Attitudes toward Hyphenation and Rag Settings" (Print). Roger Black: "Ragged Orphans" (Type Network). *Chicago Manual of Style* §7.36–47 and Q&A on word division. Ilene Strizver, *Type Rules*; James Felici, *The Complete Manual of Typography*; Ellen Lupton, *Thinking with Type*.
- Udo Wermuth: "An attempt at ragged-right typesetting", TUGboat 41:1 (2020) — closest technical prior art for German Flattersatz rules in an algorithm; read it before Phase 1.
- Practitioner sources (lower weight, used only for corroboration): TypeSCHOOL "Flattersatz soll flattern"; typografie.info forum threads on Flattersatz/Rauhsatz.
