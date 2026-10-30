# 003 Versioning and releases

**Goal:** The repository can cut a release the way ADR-0003 describes: one checked version, a
hand-written changelog, a script that prepares and verifies a release, an npm-ready manifest and
the owner's release steps written down.

**Context:** `docs/adr/0003-versioning-and-releases.md`; `docs/ROADMAP.md` item 2;
`docs/plans/001-self-contained-package.md` and `docs/plans/002-cli-follow-ups.md` «Outcome»
(what changed since 0.1.0); `docs/ORCA.md` «Notes» (agents never tag or push).

**Version impact:** none for the API. `package.json` gains metadata, `publishConfig`, a
`prepublishOnly` script and `CHANGELOG.md` in `files`. The plan does not bump `version`, tag or
publish: the owner releases 0.2.0 after the merge, following `docs/RELEASING.md`.

**Preconditions:** None. (Publishing itself needs the `@nimitzua` scope on npmjs.com; that is
the owner's step after the merge, not this plan's.)

**Branch:** `task/003-versioning-and-releases` · **Worktree:** `.worktrees/emdash-images/003-versioning-and-releases`

## Tasks

### T1: Release script and version consistency check

- **Target:** new `scripts/release.mjs`, new `test/release.test.mjs`, `test/plugin.test.mjs`.
- **Change:**
  - `scripts/release.mjs` exports `readVersions(root)`, `verifyRelease(root)` and
    `prepareRelease(root, version, { date })`, and runs as
    `node scripts/release.mjs prepare <X.Y.Z>` or `node scripts/release.mjs verify` when it is
    the entry module (`import.meta.main`). `root` is the repository directory; the CLI passes
    the directory above `scripts/`.
  - `readVersions(root)` returns the version found in each location: `package.json` `version`;
    `package-lock.json` top-level `version` and `packages[""].version`; the
    `const version = "…";` line of `src/plugin.mjs`; the `version: "…";` member of
    `EmdashImagesDescriptor` in `src/index.d.mts`. A location whose pattern is missing is
    reported as missing, not skipped.
  - `verifyRelease(root)` returns a list of problems (empty when ready): any location differing
    from `package.json`; a missing location; `CHANGELOG.md` without a `## [<version>] - YYYY-MM-DD`
    section for the current version. A missing `CHANGELOG.md` is a problem. The `verify` command
    prints each problem and exits 1, or prints `RELEASE OK <version>` and exits 0.
  - `prepareRelease(root, version, { date })` refuses (throws; the command exits 2 with the
    message) when `version` is not `X.Y.Z` (digits only, no prerelease), is not greater than the
    current version, `verifyRelease` reports a location mismatch, or `CHANGELOG.md`'s
    `## Unreleased` section is missing or has no non-blank line before the next `## `. Otherwise
    it writes the new version into every location (JSON files re-serialised with tab
    indentation and a trailing newline, matching the current files; source files by replacing
    only the version string), inserts `## [<version>] - <date>` directly under
    `## Unreleased` so the old entries move into the new section and `## Unreleased` stays,
    empty, on top, and prints the changed files. `date` defaults to today in UTC
    (`YYYY-MM-DD`). It runs no `npm` or `git` command.
  - `test/plugin.test.mjs:45` compares the descriptor's version with `package.json`'s `version`
    read in the test, instead of the literal `"0.1.0"`.
  - `test/release.test.mjs` covers the functions on temporary copies of the five files:
    the repository's own files pass `readVersions` consistency (every location equals
    `package.json`); a mismatch in each location is reported; `prepareRelease` rejects `0.2`,
    `0.2.0-rc.1`, `0.1.0` and `0.0.9` against `0.1.0`, an empty `## Unreleased` and a missing one;
    a successful `prepareRelease(root, "0.2.0", { date: "2026-11-01" })` updates all five
    locations, produces `## Unreleased\n\n## [0.2.0] - 2026-11-01` followed by the former entries,
    and then `verifyRelease` returns no problems.
- **Constraints:** No new dependencies. Do not change `src/` files. The repository's
  `verifyRelease` result is not asserted empty here (there is no `CHANGELOG.md` until T2); the
  consistency of the version locations is. `scripts/release.mjs` is not added to `files`.
- **Ownership:** `scripts/release.mjs` (new), `test/release.test.mjs` (new),
  `test/plugin.test.mjs`. Grep for `0.1.0`: `src/plugin.mjs:5`, `src/index.d.mts:26`,
  `package.json:3`, `package-lock.json:3,9` (read, not changed) and `test/plugin.test.mjs:45`
  (changed); `README.md:22` belongs to T2.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node scripts/release.mjs verify` exits 1 and names `CHANGELOG.md` as missing, and reports no version mismatch
  - `node scripts/release.mjs prepare 0.2` exits 2 with a message naming `X.Y.Z`
  - `git status --short` after both commands shows no change to tracked files
  - `test/release.test.mjs` covers every case listed under Change
  - `git grep -n "0.1.0" -- test` prints nothing
- **Commit:** `Add a release script that keeps every version in step`
- **Docs:** `docs/adr/0003-versioning-and-releases.md` «Decision»; `src/plugin.mjs`;
  `src/index.d.mts:24-31`.
- **Size:** about 150 changed lines, tests excluded.

### T2: Changelog, manifest and release guide

- **Target:** new `CHANGELOG.md`, new `docs/RELEASING.md`, `package.json`, `README.md`,
  `SKILL.md`.
- **Change:**
  - `CHANGELOG.md`: a short header naming Keep a Changelog and the 0.x rule from ADR-0003, then
    `## Unreleased` with `### Added`, `### Changed`, `### Fixed` entries for what plans 001 and
    002 changed for a consumer (from their «Outcome» and commits: the `emdash-images` command
    with `backfill`, `cleanup`, `warm`, `--config`, `--env-file` and exit codes; the
    package-named `globalThis` keys and usage strings; `warm` no longer requests `/uk/` pages;
    CLI cache-directory order, `UPLOADS_DIR` against the current directory, origin validation),
    then `## [0.1.0] - 2026-10-28` with one line: initial import from the source site. No site
    names in the file.
  - `package.json`: add `description` (the README's first sentence, shortened), `keywords`
    (`emdash`, `emdash-plugin`, `astro`, `image`, `avif`, `webp`, `sharp`), `homepage`
    (`https://git.srv1.parshyn.dev/nimitzua/emdash-images`), `publishConfig`
    `{ "access": "public" }`, `CHANGELOG.md` in `files`, and the script
    `"prepublishOnly": "npm test && node scripts/release.mjs verify"`.
  - `docs/RELEASING.md`: the owner's procedure, every command exact. Before the first publish:
    the `@nimitzua` scope on npmjs.com, `npm login`, two-factor authentication. Each release:
    clean `main` up to date with `origin/main`; `node scripts/release.mjs prepare X.Y.Z`; review
    `git diff`; signed commit `Release X.Y.Z`; `node scripts/release.mjs verify`;
    `npm pack --dry-run` and what to look for (only `src/`, `README.md`, `SKILL.md`,
    `CHANGELOG.md`, `LICENSE`, `package.json`); signed annotated tag
    `git tag -s vX.Y.Z -m "X.Y.Z"`; `npm publish` (`prepublishOnly` runs the tests and the
    verify); `git push origin main vX.Y.Z`. What to do when `npm publish` fails after tagging
    (delete the local tag, fix, start again). The version rule from ADR-0003 and how to pick the
    next number from `## Unreleased`.
  - `README.md`: replace «Install from a git tag» with «Install»
    (`npm install @nimitzua/emdash-images`), keep the activation sentence, add one line on
    versioning (0.x rule) linking `CHANGELOG.md`.
  - `SKILL.md` step 1: install from npm (`npm install @nimitzua/emdash-images`) instead of a
    tag.
- **Constraints:** Document only what exists after T1. Do not change `version`. `CHANGELOG.md`
  describes consumer-visible changes, not Orca or plan mechanics.
- **Ownership:** `CHANGELOG.md` (new), `docs/RELEASING.md` (new), `package.json`, `README.md`,
  `SKILL.md`. No existing test changes: `test/boundary.test.mjs` reads only `dependencies` and
  `peerDependencies` from `package.json`.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `CHANGELOG.md` has `## Unreleased` with at least one entry and `## [0.1.0] - 2026-10-28`
  - `npm pkg get publishConfig.access` prints `"public"`; `npm pkg get scripts.prepublishOnly` prints `"npm test && node scripts/release.mjs verify"`
  - `npm pack --dry-run --json` lists `CHANGELOG.md`, `README.md`, `SKILL.md`, `LICENSE`, `package.json` and files under `src/` only
  - `git grep -n -i -E "liliiachaika|facadesystems|git\+https" -- README.md SKILL.md CHANGELOG.md` prints nothing
  - every `node scripts/release.mjs …` command in `docs/RELEASING.md` exists in `scripts/release.mjs`'s usage (`node scripts/release.mjs` with no arguments prints it)
- **Commit:** `Add the changelog, npm metadata and the release guide`
- **Docs:** `docs/adr/0003-versioning-and-releases.md`; the «Outcome» of plans 001 and 002;
  `README.md` «Install from a git tag»; `SKILL.md` step 1.
- **Size:** about 40 changed lines of manifest and README, plus the two new documents.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` in the worktree prints `RELEASE OK 0.1.0` and exits 0
  (every location is `0.1.0` and `CHANGELOG.md` has `## [0.1.0] - 2026-10-28`)
- `npm pack --dry-run` in the worktree lists `CHANGELOG.md`

## Amendments

None.

## Outcome

- **Merge:** `c27eae6` (`--no-ff` of `task/003-versioning-and-releases` onto `8a53dc1`). Task
  commits: T1 `8c83393` (review 1 PASS), T2 `29cd1a0` (review 1 PASS). No FIX rounds. Gates:
  `GATES OK`; `node scripts/release.mjs verify` in the worktree printed `RELEASE OK 0.1.0`;
  `npm pack --dry-run` listed 26 files: `CHANGELOG.md`, `LICENSE`, `README.md`, `SKILL.md`,
  `package.json` and `src/**` only. Lockfile unchanged, so no install; after merge `VERIFY OK`.
  `version` stays `0.1.0`; nothing tagged, pushed or published.
- **Decisions:**
  - T2: after the executor's commit failed on 1Password (see Surprises), the user confirmed
    signing; a fresh commit-only executor committed the five staged files unchanged.
  - Executors asked no questions.
- **Surprises:**
  - T2's executor could not sign its commit: two attempts printed
    `error: 1Password: failed to fill whole buffer`, while `sign-probe.sh` printed `SIGN OK` at the
    start of the run and again right after the failure. This is the second run in a row (plan 002,
    T1) where a Codex terminal's signing failed while the probe from the architect's terminal
    passed; the commit-only executor signed without trouble once the user was watching.
  - The reviewer role cannot run `npm pack --dry-run` (npm cache `EPERM` under `~/.npm/_cacache`),
    so T2's Acceptance item 4 was NOT RUN in review; the architect ran it at the plan gates with
    `--cache` pointing into the worktree.
- **Deviations:**
  - T2 was committed by a second, commit-only executor (spec `T2.commit.spec.md`) instead of the
    executor that wrote it; the content is the first executor's, unchanged.
  - `docs/RELEASING.md`'s failure path adds `git reset --hard HEAD^` to the plan's "delete the
    local tag, fix, start again": `prepare` refuses a version equal to the current one, so the
    release commit has to go too. The reviewer accepted it as needed.
  - No amendments.
- **Follow-ups:**
  - `test/release.test.mjs:84`: the `0.2.0-rc.1` case asserts only a rejection, not the `X.Y.Z`
    message; a loosened format check would still pass because `BigInt("0-rc")` throws later.
  - No test for numeric ordering across digit counts (`0.9.0` to `0.10.0`); the implementation
    compares each part with `BigInt` (`scripts/release.mjs:89-97`) and is correct.
  - `scripts/release.mjs:45`: the descriptor regex stops at the first `}`; a nested object type
    above `version` in `EmdashImagesDescriptor` would make the version read as missing (fails
    loudly). `scripts/release.mjs` is 227 lines against the ~150 estimate (defensive parsing).
  - `node scripts/release.mjs` with no arguments prints usage and exits 2.
  - `CHANGELOG.md` lists the package-named `globalThis` keys and usage strings under `### Added`;
    Keep a Changelog would file a rename under `### Changed`. Worth moving before 0.2.0 is cut.
  - The owner's next step: cut 0.2.0 by following `docs/RELEASING.md` (npm scope, login and
    two-factor first).
  - Tooling: Codex-terminal signing through 1Password failed in two consecutive runs; the reviewer
    role cannot run `npm pack` (npm cache) or port-binding tests (plan 002).
- **Proposed rules:** None: the run had no FIX findings.
