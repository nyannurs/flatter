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
| 5. Tracking assist | Off. |
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
