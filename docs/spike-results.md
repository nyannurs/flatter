# Phase 0 spike results

Findings for spikes S1 to S7 (see plan §8). Each entry records the question, the setup, the result against the pass criterion, and any plan amendments.

_No spikes run yet._

## Notes to take into the spikes (from simulator work, 2026-10-16)

- **S2 measurement**: the solver measures lines by advance width (the right edge of the last glyph's advance, including the hyphen). Visible ink ends about half a point earlier because of right side bearings. Decide during S2 whether InDesign's end offsets are advance-based, and whether bands should use ink or advance edges.
- **S1 steering**: the plan now reports `slack` per line, the extra width the composer needs to take one more fragment. Lines with slack under 2ε are flagged "tight-steering". Check how small a slack the teeth can reliably steer.
- **Phase flips**: 5–21 % of paragraphs in the reference texts cannot start long. Worth confirming with real InDesign text that this rate holds.
