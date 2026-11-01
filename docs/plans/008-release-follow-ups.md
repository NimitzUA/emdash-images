# 008 Release follow-ups after 0.2.0

**Goal:** Close the small release follow-ups from 0.2.0: a `bin` path npm needs not rewrite,
`verify-tag` without a misleading line when `package.json` has no version, and a
`docs/RELEASING.md` that says what actually happens and how to choose the next version.

**Context:** `docs/plans/006-ci-and-publishing.md` «Outcome» (First runs on GitHub, Follow-ups
with the architect's correction); `docs/plans/007-release-tests-any-version.md` «Outcome»;
`docs/ROADMAP.md` Open item 2; ADR-0003, ADR-0005; `docs/RELEASING.md`.

Facts read while writing this plan (2026-11-01, `main` at `8f1572a`, version `0.2.0`):

- `package.json:29-31` has `"bin": { "emdash-images": "./src/bin.mjs" }`; `package-lock.json:14-15`
  already has `"emdash-images": "src/bin.mjs"`. `npm publish` calls
  `@npmcli/package-json` `fix()` (npm `lib/commands/publish.js:282-286`), the same as
  `npm pkg fix` (`fixSteps` start with `binRefs`, `lib/index.js:29-30`). Its
  `normalizePackageBin` (`lib/normalize.js:57-72`) turns `./src/bin.mjs` into `src/bin.mjs`
  and, because the string changed, logs "script name src/bin.mjs was invalid and removed"
  while keeping the entry. The published 0.2.0 has `{ 'emdash-images': 'src/bin.mjs' }`. No
  test reads `bin`: a search of `test/` and `astro-tests/` for `"bin"` and `bin.mjs` finds
  nothing.
- `scripts/release.mjs:89-100` `verifyReleaseTag`: when `package.json` has no `version`,
  `verifyRelease` already reports `Missing version at package.json`, and the function adds
  `Tag <tag> does not match package.json version null`.
- `docs/RELEASING.md:74-76` says the tag's `release.yml` run "finds 0.2.0 already published and
  skips the publish". In fact run `41262078304` failed: `npm view` still answered `E404` for the
  brand-new package, so the job ran `npm publish`, which failed with `E404` (no trusted
  publisher yet). `docs/RELEASING.md:105` «Each later release» step 2 does not say how to choose
  `X.Y.Z`; `docs/RELEASING.md:145` «Version numbers» ends with "The next release after 0.1.0 is
  0.2.0."

**Version impact:** none. The published `package.json` keeps the same `bin` (npm already
normalized it); `scripts/` and `docs/` are not in the package. No behaviour or public API
change, so no `CHANGELOG.md` entry. No `version` bump, tag, push or publish.

**Preconditions:**
- `main` is clean at 0.2.0: `git status --porcelain` prints nothing and `npm pkg get version`
  prints `"0.2.0"`.

**Branch:** `task/008-release-follow-ups` · **Worktree:** `.worktrees/emdash-images/008-release-follow-ups`

## Tasks

### T1: Normalize the bin path and drop the null tag-version line

- **Target:** `package.json`, `scripts/release.mjs`, `test/release.test.mjs`.
- **Change:**
  - `package.json` `bin` becomes `{ "emdash-images": "src/bin.mjs" }` (no `./`). Nothing else in
    `package.json` changes; `package-lock.json` already matches and stays as it is.
  - `verifyReleaseTag(root, tag)`: when the `package.json` version is `null`, add no
    `does not match package.json version` problem; the `Missing version at package.json`
    problem from `verifyRelease` stays the only version problem. The `Tag <tag> is not vX.Y.Z`
    check and the mismatch check for a present version stay as they are.
  - `test/release.test.mjs`, one new test: with `package.json` lacking `version` (the fixture
    root and the file's `updateJson` helper), `verifyReleaseTag(root, "v1.2.3")` deep-equals
    `["Missing version at package.json"]`.
- **Constraints:** Do not change `src/`, `CHANGELOG.md`, `package-lock.json` or any existing
  test or its name. The CLI output of `verify-tag` for a present version stays
  `RELEASE TAG OK <version>`.
- **Ownership:** `package.json`, `scripts/release.mjs`, `test/release.test.mjs`.
  `verifyReleaseTag` is used only in `scripts/release.mjs` and `test/release.test.mjs`, and
  `.github/workflows/release.yml` calls the CLI, unchanged (`git grep -n -e verifyReleaseTag -e verify-tag`);
  no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `npm pkg get bin` prints the mapping `"emdash-images": "src/bin.mjs"`
  - `npm pkg fix` in the worktree, then `git diff --exit-code -- package.json` exits 0 (npm finds
    nothing to correct); before the `bin` change the same pair shows `bin` rewritten to
    `src/bin.mjs` (put both results in the report)
  - `node --test test/release.test.mjs` ends with `# fail 0`; with the `verifyReleaseTag` change
    undone the new test fails with the `does not match package.json version null` line in its
    diff
  - `node scripts/release.mjs verify-tag v0.2.0` prints `RELEASE TAG OK 0.2.0`
  - `git diff main --stat` lists only `package.json`, `scripts/release.mjs` and
    `test/release.test.mjs`
- **Commit:** `Normalize the bin path and skip the null tag-version problem`
- **Docs:** ADR-0003 «Decision» (One version, checked); `scripts/release.mjs`
  `verifyReleaseTag`; plan 006 «Outcome», Follow-ups.
- **Size:** about 10 changed lines plus one test.

### T2: Correct the release procedure

- **Target:** `docs/RELEASING.md`.
- **Change:**
  - «First release, by hand (0.2.0)»: say at its top that 0.2.0 was published this way on
    2026-11-01 and that later releases follow «Each later release». In step 6, replace "it finds
    0.2.0 already published and skips the publish" with what happens: right after the first
    publish the registry may not show the new package yet, so the tag's `Release` run tries to
    publish and fails with `E404` while no trusted publisher exists; that failure needs no
    action and the tag stays. Keep the rest of the section, including the paragraph about a
    failed local `npm publish`.
  - «Each later release» step 2: before the commands, one sentence: choose `X.Y.Z` from
    `## Unreleased` in `CHANGELOG.md` by the rule in «Version numbers».
  - «Version numbers»: replace "The next release after 0.1.0 is 0.2.0." with "0.2.0 was the
    first version published to npm." Keep the rest of the paragraph.
- **Constraints:** Every command, file and section name named exists. No other section changes;
  do not edit `CHANGELOG.md`.
- **Ownership:** `docs/RELEASING.md`. No existing test changes: no test reads it.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n -e "E404" -e "2026-11-01" -e "Version numbers" -e "0.2.0 was the first version published to npm" -- docs/RELEASING.md` prints at least one line for each pattern
  - `git grep -n -e "skips the publish" -e "The next release after 0.1.0" -- docs/RELEASING.md` prints nothing
  - `git diff main --stat` lists only `docs/RELEASING.md` beyond T1's files
- **Commit:** `Describe the first release run and how to choose a version`
- **Docs:** `docs/RELEASING.md`; ADR-0005 «Decision» (First release by hand, A failed CI
  publish is fixed forward); plan 006 «Outcome», First runs on GitHub.
- **Size:** about 15 changed lines of documentation.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` in the worktree prints `RELEASE OK 0.2.0`
- `git diff main -- src CHANGELOG.md package-lock.json .github` prints nothing

## Amendments

None.

## Outcome

Filled after merge, from `status.md`.
