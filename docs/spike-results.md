# Phase 0 spike results

Findings for spikes S1 to S7 (see plan §8). Each entry records the question, the setup, the result against the pass criterion, and any plan amendments.

_No spikes run yet._

## S7 (partial, 2026-10-16): dictionary vendor

- InDesign 2026 (21.6.0.57). Duden ships with InDesign and is already the default hyphenation vendor for German: 1996 Reform, German: 2006 Reform, German: Swiss, German: Swiss 2006 Reform and German: Austria 2006 Reform. Available vendors: Duden, Hunspell, Proximity, User Dictionary Only.
- English (USA, UK, Canadian) uses Hunspell; Proximity is the alternative.
- Readable via `app.languagesWithVendors[i].hyphenationVendor` and `.hyphenationVendorList`; the vendor is settable there too (not yet tried). The Duden hyphenation *style* (Aesthetic / Preferred Aesthetic, plan §5.2) is not among the scriptable properties of `LanguageWithVendors`: still to find, possibly UI-only.
- Scripting route: both ExtendScript and UXP scripts run from the terminal (`tools/indesign/run.sh`), so spikes S1–S3 and S5–S7 can run without the UXP Developer Tool.

## Notes to take into the spikes (from simulator work, 2026-10-16)

- **S2 measurement**: the solver measures lines by advance width (the right edge of the last glyph's advance, including the hyphen). Visible ink ends about half a point earlier because of right side bearings. Decide during S2 whether InDesign's end offsets are advance-based, and whether bands should use ink or advance edges.
- **S1 steering**: the plan now reports `slack` per line, the extra width the composer needs to take one more fragment. Lines with slack under 2ε are flagged "tight-steering". Check how small a slack the teeth can reliably steer.
- **Phase flips**: 5–21 % of paragraphs in the reference texts cannot start long. Worth confirming with real InDesign text that this rate holds.
