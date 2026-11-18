# Flatter

A UXP panel plugin for Adobe InDesign that sets left-aligned ragged text (Flattersatz) in one of two styles: **Aesthetic**, a strict long, short, long, short rhythm, or **Functional**, a free rag set for reading. It can also adjust each line with letter tracking and word spaces.

**Status: version 0.6.4, in testing.** The plugin works end to end in InDesign 2026 and installs as a regular plugin through Creative Cloud. It is being tested on real documents. It is not signed or published on Adobe Exchange.

## What it does

- **Strict alternating rag.** A dynamic-programming solver plans every line break of a paragraph so long and short lines alternate. Each line must end inside its band: long lines near the full measure, short lines a Flatterzone shorter. Neighbouring lines keep a minimum contrast, and the report flags holes and staircases. When the strict rhythm is impossible, it falls back to the arrangement with the fewest and smallest misses.
- **Functional style.** One switch changes the algorithm: lines end anywhere inside the Flatterzone, in no fixed order. Breaks prefer Sinneinheiten and reading pauses (after punctuation), neighbouring lines differ by at least the band so the edge flutters, and staircases are avoided. Laufweite only rescues lines that would end outside the zone. Based on the we.type guide [How to Flattersatz](https://wetype.xyz/share/how-to-flattersatz).
- **InDesign sets exactly what was planned.** Flatter steers InDesign's Single-line Composer with invisible text-wrap "teeth" on a non-printing layer. It then reads the composed lines back, corrects any that differ and checks again. The text itself is never edited or broken by hand.
- **Exact line ends (optional).** Per-line letter tracking and word-space adjustment move each line end onto its edge, within limits you set. Lines are measured the way InDesign sets tracked text, with ligatures broken up.
- **Careful hyphenation.** German (2006 reform) and English, from TeX patterns plus a second opinion: a German syllable and word-joint analyser, and US and UK English patterns that must agree. Every point gets a class, and only safe points are used by default. Each point is also checked against InDesign's own hyphenation, including typed hyphens in compounds. A Sinneinheiten option keeps an article or preposition with its word, a number with its unit, dates, initials, titles and names together, and a **Shape ↔ Sense** slider sets how much they may cost the shape, up to Sense first, where a unit of meaning is never broken.
- **Live panel.** Sliders for Flatterzone and band, as a percentage of the measure, plus hyphens in a row and the tracking and word-space limits. Results update while you drag. An optional band view shows where long lines (blue) and short lines (orange) should end, on a non-printing layer. The report lists one entry per visible line, and clicking an entry selects that line in the document.
- **Freeze for hand-off.** Freeze fixes the current line breaks in the text: forced line breaks, plus real hyphens where InDesign hyphenated, all tagged with the condition "Flatter frozen". The file then keeps its rag on any computer, whatever its hyphenation dictionary. Unfreeze removes exactly those characters and brings the live rag back. You don't need Freeze for PDF output.
- **Compatibility alarm.** After every InDesign or Flatter update, the panel checks once, in a hidden test document, that InDesign still behaves the way Flatter relies on. If a check fails, or something happens that should never happen (an unexpected error, InDesign ignoring the steering, no hyphenation points), a hot-magenta box appears at the top of the panel with the details to copy. **Run self-check** at the bottom of the panel runs it any time.
- **Real layouts.** Long stories threaded through frames of different widths and column counts, lines beside images with text wrap, overset text, documents in any measurement unit, and German or English language buttons for bilingual work. Centred and right-aligned paragraphs, such as headings, keep their alignment and are left alone. Apply, slider moves and Remove are each one undo step. Remove restores every setting Flatter changed.

## Install

**You need:** Adobe InDesign 2023 (18.5) or newer, and the Creative Cloud desktop app, signed in. Flatter has been tested on InDesign 2026 for Mac. Windows and older versions should work but are untested.

1. Download `Flatter-<version>.ccx` from the [Releases](../../releases) page, or get the file from whoever shared it with you.
2. Quit InDesign.
3. Double-click the `.ccx` file. Creative Cloud opens the plugin installer; it may warn that the plugin does not come from the Adobe Marketplace. Confirm the installation.
4. Open InDesign. The panel is under **Plugins → Flatter**.

**Update:** install a newer `.ccx` the same way; it replaces the old version.

**Uninstall:** Creative Cloud desktop app → **Stock & Marketplace** → **Plugins** → **Manage plugins** → Flatter → **⋯** → **Uninstall**.

Documents keep their rag without the plugin: it is ordinary InDesign composition. Without Flatter you only cannot change it.

## Use

1. Put the text cursor in a story, or select its frame.
2. Press **German** or **English** if the language tag is wrong. The language decides hyphenation.
3. Press **Apply**. Flatter fixes the settings it needs, for example the Single-line Composer and fixed leading, then measures, plans and steers.
4. Choose **Aesthetic** or **Functional**. Adjust **Flatterzone** and **Band** (in Functional: **Flutter**, how much neighbouring lines differ). Turn on **Align line ends exactly** for geometric line ends (in Functional: **Rescue lines with Laufweite**).
5. Read the report. Each entry names a line; click it to jump there.
6. Optional, before handing the InDesign file to someone else: **Freeze**. Press **Unfreeze** to change the rag again.
7. **Remove** takes Flatter off the story and restores the original settings, including a frozen one.

Each story keeps its own Flatter settings. Selecting a story loads them into the panel.

## Status

| Phase (see [docs/plan.md](docs/plan.md)) | State |
|---|---|
| 0 InDesign spikes | done |
| 1 Core solver | done |
| 2 Hyphenation | done (German, US and UK English) |
| 3 InDesign adapter | done |
| 4 Panel | done |
| 5 Review and QA tooling | partly: clickable report, band view; review list not built |
| 6 Robustness | partly: overset text, frames of different widths, any document unit |
| 7 Packaging | partly: installable `.ccx` with licence texts, GitHub releases; not on the Adobe Marketplace |

Not built yet: a review list across a whole document, tabs and anchored objects inside planned paragraphs, and automatic updates while you edit (press Recompute after edits).

The day-by-day log is in [docs/progress.md](docs/progress.md), and decisions with their reasons are in [docs/decisions.md](docs/decisions.md). InDesign behaviour found by testing is in [docs/spike-results.md](docs/spike-results.md).

## Develop

Requires Node 24 and npm.

```bash
npm install
npm test                # unit, property and snapshot tests (Vitest)
npm run typecheck
npm run sim -- --help   # simulator: text in, SVG and report out, no InDesign needed
npm run playground      # browser playground with the same solver
npm run test:indesign   # integration tests inside a running InDesign (throwaway documents)
npm run panel           # dev build as "Flatter (dev)" (own plugin id, runs beside an installed release)
npm run package         # release build → dist/Flatter-<version>.ccx
```

`CLAUDE.md` has the working notes: InDesign scripting pitfalls, how to load the dev panel without clicks, and conventions.

```
packages/
  core/              solver: item model, metrics, DP, checker (pure TypeScript, no InDesign APIs)
  hyphenation/       patterns, German analyser and lexicon, classes A/B/C/X, Sinneinheiten
  indesign-adapter/  plan → steer → read back → correct, against a Port interface; DOM implementation
  panel/             UXP panel (plain HTML and Spectrum widgets)
  simulator/         dev harness: Source Serif 4 metrics, SVG output, playground
test/                reference texts and golden hyphenation corpora
tools/indesign/      scripts and spikes that run inside InDesign, integration tests, packaging
docs/                plan, progress log, decisions, spike results
```

Third-party components and licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
