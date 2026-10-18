# Flatter: working notes for Claude Code

Flatter is a UXP panel plugin for Adobe InDesign that sets left-aligned ragged text (Flattersatz) in a strict long, short, long, short rhythm. The full design is in `docs/plan.md`. Read it before changing behaviour.

## Start here

1. Read `docs/progress.md` for what is done, what is in progress and what is next.
2. Read `docs/decisions.md` for decisions already made. Do not reopen them without asking the user.
3. Run `npm install` then `npm test` to confirm a green baseline.

## Keep the handoff docs current (standing instruction from the user)

The user wants any Claude Code instance to be able to pick up this project. At the end of every work session, and whenever you finish a meaningful step:

- Update `docs/progress.md`: what changed, current status, next steps, open questions for the user. Use absolute dates.
- Add new decisions to `docs/decisions.md` as numbered ADRs, with the reason.
- Record InDesign findings in `docs/spike-results.md` (Phase 0 spikes, plan §8).
- Update this file when commands, layout or conventions change.

## Commands

```bash
npm install             # workspace install (npm workspaces)
npm test                # vitest: unit, scenario, property and simulator snapshot tests
npm run typecheck       # tsc for core, simulator and playground
npm run sim -- --help   # simulator CLI: text -> SVG + report (default: German reference text, 60 chars)
npm run sim -- --tracking 10 --precise --word-spaces 25   # precise Laufweite with word spaces; prints edge precision
npm run playground      # bundles the live playground to packages/simulator/out/playground.html
npm run corpus-report -- de de   # golden-corpus review: unsafe points, wrong class A, coverage (also en-US, en-GB)
npm run test:indesign   # adapter integration tests inside the running InDesign (throwaway documents)
npm run panel           # dev build into dist/dev-panel as "Flatter (dev)" (own plugin id: runs beside the installed release)
npm run package         # release build → dist/Flatter-<version>.ccx (bump "version" in packages/panel/plugin/manifest.json first)
"/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent" --install "$PWD/dist/Flatter-<version>.ccx"   # install for the user (InDesign restart needed)
node tools/indesign/uxp-load.mjs load     # load the panel into InDesign via the UXP Developer Tool service (no clicks)
node tools/indesign/uxp-load.mjs reload   # after every panel build
tools/indesign/panel-command.sh '{"cmd":"s4","ticks":30,"visible":true}'   # drive the loaded dev panel (ping, s4)
```

The user has the release build installed (Creative Cloud, `--list all` shows it). The dev build is "Flatter (dev)" with the id com.flatter.panel.dev, so it runs beside the installed release (com.flatter.panel) without clashing. Both show their version in the panel footer.

The UXP Developer Tool must be open (its window may stay hidden; the service on port 14001 is what matters). Adobe's `uxp` CLI does not run on Node 24 (native helper missing); `uxp-load.mjs` speaks its WebSocket protocol directly.

To view the playground locally, start the `playground` entry in `.claude/launch.json` (a tiny Node static server, `packages/simulator/serve.mjs`). The published copy for the user is the private artifact https://claude.ai/artifact/SvGpvN2649PeRYDPECqJkp; republish it from `packages/simulator/out/playground-artifact.html` after `npm run playground` so the link stays the same.

Snapshot tests pin the line breaks of the reference texts. When a solver change moves breaks on purpose, review the diff, then update with `npx vitest run -u`.

## Layout

```
packages/core/        solver: item model, metrics, DP, checker, text builder. Pure TS, no InDesign or DOM APIs.
packages/hyphenation/ hyphenation: TeX patterns + second opinion -> classes A/B/C/X, hard rules, exceptions,
                      ambiguous words, Sinneinheiten break costs. German second opinion = 2006 rule syllabifier
                      with a stem lexicon (src/lexicon-de.ts); English = US and UK patterns must agree.
packages/indesign-adapter/  InDesign side. Pure, Node-tested: items.ts (items from measured advances, merging probed
                      points), geometry.ts (teeth), settings.ts (required settings), apply.ts (plan → steer → read back →
                      re-plan loop against the Port interface). UXP only: dom-port.ts (Port with the DOM), dom.ts
                      (applyFlatter / removeFlatter / checkSettings, one undo step each). Tests use a fake greedy composer.
packages/panel/       UXP panel: plugin/ (manifest, index.html, icons; index.js is built), src/main.ts (UI and live
                      loop: debounce 30 ms, verify after 250 ms), src/dev.ts (dev-build command channel and the S4 test).
packages/simulator/   dev harness, never shipped: Source Serif 4 metrics (opentype.js) + Liang patterns (hyphen) -> SVG,
                      CLI (src/cli.ts), playground (playground/, build-playground.mjs), local server (serve.mjs)
test/fixtures/texts/  German and English reference texts (written for this project, seeded with hard hyphenation cases)
test/hyphenation/     golden corpora de.tsv, en-US.tsv, en-GB.tsv ("=" main joint, "-" acceptable break)
docs/plan.md          architecture and implementation plan (source of truth for intent)
docs/progress.md      status log and next steps
docs/decisions.md     ADRs and the designer's answers to plan §11
docs/spike-results.md InDesign spike findings (Phase 0)
InDesign Test File/   the user's local InDesign test document; git-ignored on purpose
```

Threaded frames of different widths are supported (per-line measures, ADR-018); the panel has German / English language buttons.

Planned but not created yet: review list (Phase 5), signing and licence texts in the package (Phase 7). Freeze/Unfreeze exists (ADR-019).

## Conventions

- TypeScript, ESM, imports with explicit `.ts` extensions. `erasableSyntaxOnly` is on so Node can run sources directly with type stripping: no enums, no parameter properties, no namespaces.
- `packages/core` must stay free of InDesign APIs and of `DOM` types (plan §0.3).
- Tests live in `packages/*/test/*.test.ts`. Use Vitest; property tests use fast-check.
- Hyphenation correctness rules are never relaxed, not even in Soft mode: class X is never used, class C only in Normal mode (plan §5.3).
- Golden corpora are precision tests: every Safe point (A/B) must be listed as acceptable, every A must be a listed main joint. When the report flags a point, decide whether the corpus or the engine is wrong; never add a division you are not sure of. Fix a wrong engine result with the lexicon, the rules or `src/lists.ts` (exceptions per variety, ambiguous words, misleading English splits).
- Units are points throughout. "gap" means available width minus line width (distance from the right edge of the measure).

## Solver in one paragraph

Text becomes items (box, glue, penalty). `ParagraphMetrics` precomputes widths and legal breaks. `solveParagraph` runs a dynamic program whose state is one whole line (start break, end break) plus role, consecutive-hyphen run and hyphen count, so rules between neighbouring lines are exact. Strict mode treats bands, contrast, the hyphen limit and the last-line rules as hard. If strict fails it tries the other phase, then falls back to soft costs (tiered by the priority list in plan §7.4) with a beam of 48 states per break. With tracking enabled (opt-in, ADR-010), lines that miss their band may take a small tracking value, tried only after strict fails without it. In precise mode (ADR-013, what the panel uses) every band line is instead pulled onto its edge by letter tracking and word-space tracking within their maxima (ADR-015), measured without ligatures (ADR-014). `checkPlan` re-derives all violations independently from the finished lines. `evaluateBreaks` scores any given set of breaks, which is what the InDesign adapter will use to check read-back lines.

## Running code in InDesign

InDesign 2026 (21.6) is installed on the user's Mac and Claude may drive it (user, 2026-10-16). Use scripting, not screen clicks:

```bash
tools/indesign/run.sh tools/indesign/environment.idjs   # UXP script; result via the "flatter-result" app label
tools/indesign/run.sh some-script.jsx                    # ExtendScript; result = last expression
```

- UXP scripts run through `app.doScript(..., ScriptLanguage.UXPSCRIPT)`, so most Phase 0 spikes need no plugin and no UXP Developer Tool. The UDT is only needed to load the panel (Phase 4, spike S4).
- Never modify the user's open documents (e.g. `InDesign Test File/TestFile.indd`). Spikes create their own documents and close them without saving unless asked.
- macOS asks once whether the terminal may control InDesign; the user has to click OK.
- Spikes: TypeScript in `tools/indesign/spikes/src/`, bundled with the real packages by `node tools/indesign/build-spikes.mjs [prefix]` into `tools/indesign/spikes/dist/*.idjs` (git-ignored). Results and the UXP pitfalls found so far are in `docs/spike-results.md`. Read it before writing InDesign code.
- Units: always run DOM work inside `inPoints` (dom.ts); the user's TestFile is in millimetres.
- Tests that run several Apply variants in one document must `removeFlatter` between them: teeth are labelled by story id and stay behind when frames are removed.
- `tools/indesign/spikes/src/i14-analyse.ts` compares settings variants on a copy of the user's Flatter story (rhythm problems, hyphens, lines as planned).
- Performance: never read thousands of character positions in a frame of the user's document (it slows every later change to that frame); measure in the hidden bench document (ADR-016). `i3-user-copy.ts` prints a per-method profile.
- `tools/indesign/spikes/src/i3-user-copy.ts` reproduces a problem on a copy of the user's text: it reads the open TestFile (read-only), copies the story into threaded frames of the same size in a throwaway document and runs Apply plus slider ticks. Default source: the untouched one-paragraph story; set the app label `flatter-i3-source` to `flatter` to copy the story Flatter worked on. App label `flatter-i3-settings` (JSON) overrides the settings, `flatter-i3-diag` = `off` skips the read-heavy diagnostics (they slow later writes, so use it for timing). Clear the labels afterwards. Not part of `test:indesign` (it needs the user's file).
- Never register event listeners from a one-off script: when the script ends InDesign shows the user an error dialog for every event ("Script context is not available anymore"). Listeners belong in the loaded panel. If one slips through, find it in `app.eventListeners` (by id) and remove only that one.
- A UXP script whose text contains "async" followed by a word runs asynchronously; `run.sh` polls for the result, so a script must always write its result label, even on error.

## Environment gotchas

- When writing files through a shell heredoc, escapes like ` ` can end up as the literal invisible character. Check with a grep or write escapes via Python. This already broke a regex once.
- npm 11 blocks esbuild's install script; esbuild still works because its platform binary comes as an optional dependency.
- opentype.js 2.0's `toPathData(decimals)` sometimes writes `NaN`, which makes SVG stop drawing mid-line. The simulator serializes path commands itself (`packages/simulator/src/font.ts`). opentype.js also ignores this font's kerning, so simulator widths run slightly wide.
- The Browser pane pauses `requestAnimationFrame` while hidden. Show the pane before driving the playground with scripts.
- Python's `http.server` cannot read the working directory from the preview launcher here; use `serve.mjs`.
- This repo commits with the user's GitHub no-reply email (set in the repo's local git config) because GitHub blocks pushes that expose their private address. Do not change it.
- Git workflow (user's instruction, 2026-10-16): commit directly to `main` and push. No pull requests, no long-lived feature branches. Still commit only when the user asks or the task clearly includes it.
- The user is a designer, not a developer. When they need to do something in an app or terminal, tell them exactly where to click or what to paste.
