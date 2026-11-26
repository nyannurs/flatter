# Flatter

**Beautiful ragged text in InDesign.**

Flatter is a plugin for Adobe InDesign that gives ragged text (Flattersatz) an even, deliberate edge. Pick a strict long, short, long, short rhythm (**Aesthetic**) or a calm rag tuned for reading (**Functional**). Flatter chooses every line break for you, hyphenates carefully, and keeps phrases together. Left- and right-aligned text, German and English.

### [⬇ Download Flatter](https://github.com/nyannurs/flatter/releases/latest/download/Flatter.ccx)

Version 0.7.0 · Mac · English InDesign 2026 or newer

## AI Disclaimer

This plugin was built by iterating with Claude Code. I did not write a single line of code.

---

## Install (2 minutes)

You need **InDesign 2026 or newer** and the **Creative Cloud app** (the app you installed InDesign with). Make sure you are signed in to it.

1. **Open InDesign once, then quit it.** (InDesign → Quit InDesign.)
2. **Double-click the file you downloaded** (`Flatter.ccx`, usually in your Downloads folder). The Creative Cloud app opens.
3. Creative Cloud says the plugin is not from the Adobe Marketplace. That is expected. **Click Install.**
4. **Open InDesign.** You find Flatter in the menu bar under **Plug-Ins → Flatter**.

That's it. To update later, download the new version and double-click it the same way.

## Use

Flatter works in two steps: try your settings on a few paragraphs, then set the whole story.

1. **Click into a text frame** (or put the cursor in the text).
2. Press **Preview**. Flatter sets up to five paragraphs (or the paragraphs you selected) and shows them live.
3. **Adjust** the settings from top to bottom. The previewed text changes as you drag.
   - **Hyphenation**: Safe or Normal, how many hyphenated lines in a row, and **Keep phrases together** (no line ending on "the", "a", "der" or a number without its unit). Shape ↔ Sense decides how much the shape may give way to that.
   - **Rag**: Aesthetic or Functional. **Align line ends exactly** nudges letter and word spacing a tiny bit so every line ends exactly where it should.
   - **Rag zone**: how far short lines end from the edge. **Band**: how precisely lines hit their position.
4. Press **Apply to whole story**. Flatter sets every paragraph with these settings and shows a progress bar. You can keep working in InDesign or press **Cancel**.

**Undo:** every action is a single Cmd+Z.

**Language:** Flatter hyphenates each word by the dictionary language you assigned in InDesign (Character or Paragraph panel). Its own rules cover German and English; other languages use InDesign's hyphenation only.

**Remove** takes Flatter off a story and puts every setting back the way it was.

## After Apply to whole story

The whole story is **frozen**: its line breaks are fixed in the text, so it looks the same on every computer, in the PDF and for anyone who edits the file. Flatter never changes your words; the fixed breaks are marked and can always be taken out again.

**To change the text or the rag later:** press **Unfreeze**, edit, then **Preview** and **Apply to whole story** again. Unfreeze and Remove still work after saving, reopening or editing the document.

## Something's not working?

**Nothing happens when I double-click the file.**
Install the Creative Cloud app from [adobe.com](https://www.adobe.com/creativecloud/desktop-app.html), sign in, open InDesign once, and try again.

**Creative Cloud shows a red "installation failed" message.**
Check that you have InDesign 2026 or newer. Otherwise click **Details** on the message, copy the text, and [send it to us](../../issues/new).

**I can't find Flatter in InDesign.**
Quit InDesign completely and open it again. Then look under **Plug-Ins → Flatter**.

**A pink box appears at the top of the panel.**
Flatter found something unusual in your InDesign. Press **Copy details** and [send it to us](../../issues/new).

**Some paragraphs are not changed.**
Centred paragraphs, like headings, are left alone on purpose.

**A paragraph is not set exactly.**
Tabs and right indent tabs are not supported yet. Flatter lists the paragraph under Problems; its rag may be off.

## Uninstall

Open the Creative Cloud app → **Manage Plugins** (in the app's menu or under Stock & Marketplace) → Flatter → **•••** → **Uninstall**.

## Good to know

- Works with left- and right-aligned text, text wrap around images, indents, drop caps, columns, threaded frames and InDesign's special characters.
- Tested on Mac with English InDesign 2026 and 2027. Windows and other InDesign languages should work but are untested.
- Not on the Adobe Marketplace yet, which is why Creative Cloud shows a warning when you install it.
- Found a bug or have an idea? [Open an issue](../../issues/new).

## Licence

Flatter is free. You may use it for any work, including paid client work, and pass it on to others. You may not sell it or use it to build a competing product. The legal text is the [PolyForm Shield License 1.0.0](LICENSE.md).

---

<details>
<summary>For developers</summary>

Requires Node 24 and npm.

```bash
npm install
npm test                # unit, property and snapshot tests
npm run typecheck       # every package and the InDesign test scripts
npm run playground      # browser playground with the same solver
npm run test:indesign   # integration tests in a running InDesign (throwaway documents)
npm run panel           # dev build "Flatter (dev)", runs beside the installed release
npm run package         # release build → dist/Flatter-<version>.ccx and dist/Flatter.ccx
```

| Folder | Contents |
|---|---|
| `packages/core` | line-break solver (pure TypeScript) |
| `packages/hyphenation` | patterns, German analyser, Sinneinheiten |
| `packages/indesign-adapter` | plan, steer, read back; InDesign DOM |
| `packages/panel` | the UXP panel |
| `packages/simulator` | SVG simulator and playground |
| `tools/indesign` | scripts and tests that run inside InDesign |

More: [plan](docs/plan.md), [progress log](docs/progress.md), [decisions](docs/decisions.md), [InDesign findings](docs/spike-results.md), [audit](docs/audit-2026-11.md), working notes in `CLAUDE.md`. Licence: [PolyForm Shield 1.0.0](LICENSE.md); third-party licences: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

</details>
