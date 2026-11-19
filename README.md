# Flatter

An Adobe InDesign plugin for left-aligned ragged text (Flattersatz). It sets a strict long, short, long, short rhythm (**Aesthetic**) or a free rag tuned for reading (**Functional**, after we.type's [How to Flattersatz](https://wetype.xyz/share/how-to-flattersatz)).

**Status: version 0.6.9, in testing.** Tested on InDesign 2027 for Mac; installs through Creative Cloud. Not signed and not on the Adobe Marketplace.

## Features

- **Planned line breaks.** A solver plans every paragraph so line ends land in their bands, avoiding holes and staircases. Flatter then steers InDesign's own composer with invisible text-wrap shapes, reads the lines back and corrects them. Your text is never edited by hand.
- **Exact line ends (optional).** Per-line letter tracking and word-space adjustment pull each line onto its edge, within limits you set.
- **Careful hyphenation.** German (2006 rules) and English, checked against a second source and against InDesign's own dictionary. Only safe points are used by default. **Sinneinheiten** keep units of meaning together (article and noun, number and unit, names). The **Shape ↔ Sense** slider sets how much that may cost the rag.
- **Long stories.** Select a few paragraphs to try settings on them live. Then **Set whole story** sets the entire story in one go, as fixed line breaks.
- **Freeze** fixes the line breaks in the text for hand-off. **Unfreeze** and **Remove** undo it exactly, also after saving, reopening or editing the document.
- **Real layouts.** Threaded frames of different widths, multi-column frames, text wrap around images, overset text, any document unit. Centred and right-aligned paragraphs are left alone. Every action is one undo step.
- **Self-check.** After an InDesign or Flatter update, the panel checks that InDesign still behaves as Flatter expects, and shows a clear alarm if not.

## Install

Requires InDesign 2023 (18.5) or newer and the Creative Cloud app.

1. Download `Flatter-<version>.ccx` from [Releases](../../releases).
2. Quit InDesign, then double-click the file and confirm in Creative Cloud.
3. Open InDesign: **Plugins → Flatter**.

To update, install a newer `.ccx` the same way. To uninstall: Creative Cloud → **Stock & Marketplace → Plugins → Manage plugins → Flatter → ⋯ → Uninstall**. Documents keep their rag without the plugin.

## Use

1. Put the cursor in a story (or select its frame) and press **Apply**. Flatter switches on the settings it needs and sets the rag.
2. Move the sliders; the text updates live. Check the language buttons under Hyphenation, since language decides hyphenation.
3. **Long stories:** select a few paragraphs and press **Apply** to preview on them (the preview stays when you deselect). When you're happy, press **Set whole story**.
4. **Freeze** before handing the InDesign file on; **Remove** restores the original settings.

Each story keeps its own settings.

## Develop

Node 24 and npm.

```bash
npm install
npm test                # unit, property and snapshot tests
npm run typecheck
npm run playground      # browser playground with the same solver
npm run test:indesign   # integration tests in a running InDesign (throwaway documents)
npm run panel           # dev build "Flatter (dev)", runs beside the installed release
npm run package         # release build → dist/Flatter-<version>.ccx
```

| Folder | Contents |
|---|---|
| `packages/core` | line-break solver (pure TypeScript) |
| `packages/hyphenation` | patterns, German analyser, Sinneinheiten |
| `packages/indesign-adapter` | plan, steer, read back; InDesign DOM |
| `packages/panel` | the UXP panel |
| `packages/simulator` | SVG simulator and playground |
| `tools/indesign` | scripts and tests that run inside InDesign |

More: [plan](docs/plan.md), [progress log](docs/progress.md), [decisions](docs/decisions.md), [InDesign findings](docs/spike-results.md), working notes in `CLAUDE.md`, licences in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
