# 007 Release tests for any current version

**Goal:** Make the `prepareRelease` tests in `test/release.test.mjs` derive the release version
from the current `package.json` version, so `npm test` (and `prepublishOnly`) passes after
`node scripts/release.mjs prepare 0.2.0`.

**Context:** `docs/adr/0003-versioning-and-releases.md` «Decision» (One version, checked);
`docs/RELEASING.md` «First release, by hand (0.2.0)»; plan 003, which added the tests.

Found by the owner on 2026-11-01 while publishing 0.2.0 by hand: after
`node scripts/release.mjs prepare 0.2.0`, `npm publish` stopped in `prepublishOnly` because
three tests call `prepareRelease(root, "0.2.0", …)` with a literal version, and
`prepareRelease` (`scripts/release.mjs:146-148`) rejects it first with
`Release version 0.2.0 must be greater than current version 0.2.0.`:

- `prepareRelease rejects a mismatch before writing files` (`test/release.test.mjs:120-128`);
- `prepareRelease rejects an empty or missing Unreleased section` (`test/release.test.mjs:130-138`);
- `prepareRelease updates every version and moves Unreleased entries under the new dated section`
  (`test/release.test.mjs:140-165`), which also expects `Array(5).fill("0.2.0")`,
  `'const version = "0.2.0";'`, `'version: "0.2.0";'` and the pattern `## \[0\.2\.0\]`.

Nothing was published; the owner removed the local tag and the release commit, and `main` is at
`4bd2a0c`. The other tests already use `currentVersion` (`test/release.test.mjs:11`) or versions
that do not depend on it (`9.9.9`, `0.0.9`, the malformed tags at line 98).

**Version impact:** none. `test/` is not in the package (`package.json` `files`), and no
behaviour or public API changes, so no `CHANGELOG.md` entry. No `version` bump, tag, push or
publish.

**Preconditions:**
- `main` is clean at 0.1.0: `git status --porcelain` prints nothing and `npm pkg get version`
  prints `"0.1.0"`.

**Branch:** `task/007-release-tests-any-version` · **Worktree:** `.worktrees/emdash-images/007-release-tests-any-version`

## Tasks

### T1: Derive the prepareRelease test version from package.json

- **Target:** `test/release.test.mjs`.
- **Change:**
  - Next to `currentVersion` (line 11), a `nextVersion` computed from it: major unchanged,
    minor plus one, patch `0` (`0.1.0` gives `0.2.0`, `0.2.0` gives `0.3.0`, `1.4.2` gives
    `1.5.0`).
  - Every `prepareRelease(…, "0.2.0", …)` call (lines 125, 133, 137, 143) uses `nextVersion`.
  - The test at lines 140-165 expects `nextVersion` everywhere it now expects `"0.2.0"`:
    `Array(5).fill(nextVersion)`, `` `const version = "${nextVersion}";` ``,
    `` `version: "${nextVersion}";` `` and the changelog check. The changelog check keeps its
    meaning (`## Unreleased`, a blank line, `## [<nextVersion>] - 2026-11-01`, a blank line,
    `### Added`, `- A fixture entry.`, as consecutive lines starting at a line start) and puts no
    unescaped version into a `RegExp`: compare strings, or escape the dots.
  - The list at line 114 (`"0.2"`, `"0.2.0-rc.1"`, `currentVersion`, `"0.0.9"`) and the tag list
    at line 98 stay as they are: they are invalid or older for any current version from 0.1.0
    on.
- **Constraints:** Do not change `scripts/release.mjs`, `src/`, `CHANGELOG.md` or any other
  test file. Keep every existing test name and every existing assertion's intent; no test is
  removed or skipped. The fixture changelog (`initialChangelog`, line 18) stays as it is.
- **Ownership:** `test/release.test.mjs`. `prepareRelease` is called only there and in
  `scripts/release.mjs` (`git grep -n prepareRelease`); no other test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/release.test.mjs` in the worktree ends with `# fail 0`
  - `git grep -n -F -e '"0.2.0"' -e '0\.2\.0' -- test/release.test.mjs` prints nothing
  - In a temporary copy at the next version, the release tests pass. Run from the worktree root:
    `tmp=$(mktemp -d) && mkdir -p "$tmp/src" "$tmp/scripts" "$tmp/test" && cp package.json package-lock.json CHANGELOG.md "$tmp/" && cp src/plugin.mjs src/index.d.mts "$tmp/src/" && cp scripts/release.mjs "$tmp/scripts/" && cp test/release.test.mjs "$tmp/test/" && node "$tmp/scripts/release.mjs" prepare 0.2.0 && node --test "$tmp/test/release.test.mjs"`
    prints the five changed files (`package.json` … `CHANGELOG.md`) and ends with `# fail 0`;
    the same command on `main`'s `test/release.test.mjs` ends with `# fail 3` (put both result
    lines in the report)
  - `git diff main --stat` lists only `test/release.test.mjs`
- **Commit:** `Derive the release test version from package.json`
- **Docs:** ADR-0003 «Decision» (One version, checked); `scripts/release.mjs` `prepareRelease`;
  `docs/RELEASING.md` «First release, by hand (0.2.0)».
- **Size:** about 15 changed lines, all in the test file.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` in the worktree prints `RELEASE OK 0.1.0`
- `git diff main -- src scripts CHANGELOG.md package.json package-lock.json` prints nothing

After the merge the owner repeats `docs/RELEASING.md` «First release, by hand (0.2.0)» from a
clean `main`.

## Amendments

None.

## Outcome

Filled after merge, from `status.md`.
