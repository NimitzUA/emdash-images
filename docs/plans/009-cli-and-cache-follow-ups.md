# 009 CLI and cache-path follow-ups

**Goal:** Close the small follow-ups left by plans 002 and 005: `warm`'s cache fallback follows
`runCli`'s `cwd`, the image service trims a configured `cacheDirectory` like the CLI does, and
the remaining untested cases get tests.

**Context:** `docs/plans/002-cli-follow-ups.md` «Outcome», Follow-ups;
`docs/plans/005-picture-follow-ups.md` «Outcome», Follow-ups; `docs/ROADMAP.md` Open items 1
and 4; ADR-0003 «Decision» (Changelog). The plan 004 edge cases that plan 005 kept on purpose
(`getImage: null` with an `imageConfig`, `picture` `{}`, the repeated `astro:assets` import
under `node --test`) stay out of scope.

Facts read while writing this plan (2026-11-01, `main` at `f7b282f`, version `0.2.0`):

- `src/cli.mjs:171-176`: for `warm`, `resolveCacheDirectory` (`src/cli.mjs:191-194`) returns
  `undefined` when neither `IMAGE_CACHE_DIR` nor config `cacheDirectory` is set, and
  `warmOptions` then has no `cacheDirectory`. `warmPublicSite` (`src/warmup.mjs:358,363`) then
  falls back to `process.env.IMAGE_CACHE_DIR` or `.dev/image-cache` resolved against
  `process.cwd()`, not against `runCli`'s `cwd` option. For the binary both are the same;
  `runCli` is not a package export (`package.json` `exports`).
- `src/cli.mjs:196-199` `nonBlankString` trims `IMAGE_CACHE_DIR` and config `cacheDirectory`.
  `src/options.mjs:26-28` `imageService()` stores `options.cacheDirectory` untrimmed, and
  `src/service.mjs:118-127` `getCacheDirectory` trims only `process.env.IMAGE_CACHE_DIR`; a
  configured `" /srv/cache "` resolves to a path with the spaces kept.
- `src/cli.mjs:111-121` rejects a non-http(s) `--public-origin` with
  `Option --public-origin must be an absolute http(s) URL.`; `test/cli.test.mjs` has no case for
  a valid `--origin` with an invalid `--public-origin` (the usage test at lines 267-290 covers
  `--origin` only).
- `astro-tests/picture.render.mjs:126-136`, the `full-width` case, does not call
  `assertRenderedUrlsAcceptedByService` or `assertNoPositionParameter`
  (`astro-tests/picture.render.mjs:44-57`), which the other layout cases call.

**Version impact:** T2 fixes the image service's handling of a configured `cacheDirectory` with
surrounding spaces: a patch-level fix, with a `### Fixed` entry under `## Unreleased`. T1 changes
only the internal `runCli` (the binary behaves the same) and adds tests: no entry. No public API
or type change. No `version` bump, tag, push or publish.

**Preconditions:**
- `main` is clean at 0.2.0: `git status --porcelain` prints nothing and `npm pkg get version`
  prints `"0.2.0"`.

**Branch:** `task/009-cli-and-cache-follow-ups` · **Worktree:** `.worktrees/emdash-images/009-cli-and-cache-follow-ups`

## Tasks

### T1: Resolve warm's cache fallback against runCli's cwd

- **Target:** `src/cli.mjs`, `test/cli.test.mjs`.
- **Change:**
  - For `warm` only, when `resolveCacheDirectory` returns `undefined`, `runCli` passes
    `cacheDirectory: path.resolve(cwd, ".dev/image-cache")` in `warmOptions`, so `warmLocalSite`
    and `warmPublicSite` always receive a cache directory. `cleanup` keeps requiring a configured
    path: with nothing configured its env still has no `IMAGE_CACHE_DIR`.
  - `test/cli.test.mjs` tests that today assert no `cacheDirectory` in `warmOptions` expect the
    fallback instead:
    - line 58, "no config uses DEFAULT_IMAGE_OPTIONS and leaves an unset cacheDirectory out of
      warm options" (assertion at line 82): `path.resolve(process.cwd(), ".dev/image-cache")`,
      since that call passes no `cwd`; rename the test to say warm gets the fallback;
    - line 176, "blank config cacheDirectory stays unset…" (assertion at line 193):
      `path.join(cwd, ".dev/image-cache")`; rename the test so it no longer says "stays unset";
      the cleanup assertions at lines 201-202 stay;
    - line 225, "warm reports failures…" (`publicCall.options` at lines 244-247): add the
      fallback `cacheDirectory` for `process.cwd()`.
  - New tests in `test/cli.test.mjs`:
    - `runCli(["warm"], { cwd, env: {} })` with a temporary `cwd` different from
      `process.cwd()`: `warmOptions.cacheDirectory` equals `path.join(cwd, ".dev/image-cache")`;
    - a valid `--origin` with an invalid `--public-origin` (`mailto:x@example.com`) returns 2,
      calls no warm command, and the error contains
      `Option --public-origin must be an absolute http(s) URL.`
- **Constraints:** Do not change `src/warmup.mjs` or its fallback for programmatic callers. The
  precedence stays: `IMAGE_CACHE_DIR` (process environment or `--env-file`), then config
  `cacheDirectory`, then the fallback. `backfill` and `cleanup` behave as before. Only the three
  test names above change.
- **Ownership:** `src/cli.mjs`, `test/cli.test.mjs`. `resolveCacheDirectory` and `warmOptions`
  are used only in `src/cli.mjs`; the existing tests this breaks are the three listed above.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/cli.test.mjs` ends with `# fail 0`; with the `src/cli.mjs` change undone
    the new `cwd` fallback test fails (put the failing line in the report)
  - `node src/bin.mjs warm --origin https://example.com --public-origin mailto:x@example.com`
    exits 2 and prints `Option --public-origin must be an absolute http(s) URL.`
  - `git diff main --stat` lists only `src/cli.mjs` and `test/cli.test.mjs`
- **Commit:** `Resolve the warm cache fallback against the CLI working directory`
- **Docs:** `README.md` «Options» (cache directory order, line 45); plan 002 «Outcome»;
  `src/cli.mjs`, `src/warmup.mjs` `warmPublicSite`.
- **Size:** about 5 changed lines in `src/cli.mjs`, plus tests.

### T2: Trim a configured cacheDirectory and check full-width URLs

- **Target:** `src/options.mjs`, `src/service.mjs`, `test/service.test.mjs`,
  `astro-tests/picture.render.mjs`, `CHANGELOG.md`.
- **Change:**
  - `imageService()` (`src/options.mjs:26-28`) stores `options.cacheDirectory.trim()`.
  - `getCacheDirectory` (`src/service.mjs:118-127`) trims each candidate, in the same order:
    `process.env.IMAGE_CACHE_DIR`, `serviceConfig(imageConfig).cacheDirectory`,
    `options.cacheDirectory`; the first non-blank trimmed string wins, else `.dev/image-cache`.
    A blank configured value falls through to the next candidate.
  - `test/service.test.mjs`, new tests: `imageService({ cacheDirectory: " /tmp/image-cache " })`
    gives `config.cacheDirectory` `"/tmp/image-cache"`; with `IMAGE_CACHE_DIR` unset, a
    hand-written `{ service: { config: { cacheDirectory: \` ${dir} \` } } }` writes the variant
    under `dir` (follow the pattern of "IMAGE_CACHE_DIR takes precedence over a configured
    cacheDirectory", lines 147-174, including restoring `process.env.IMAGE_CACHE_DIR`).
  - `astro-tests/picture.render.mjs`, the `full-width` case (lines 126-136): add
    `await assertRenderedUrlsAcceptedByService(html);` and
    `assertNoPositionParameter(renderedImageUrls(html));`, as the `constrained` case does.
  - `CHANGELOG.md`, `## Unreleased`, new `### Fixed` section with one entry: "The image service
    trims a configured `cacheDirectory`, as it already trims `IMAGE_CACHE_DIR` and as the CLI
    does, so a path with surrounding spaces resolves to the same directory everywhere."
- **Constraints:** The cache namespace and file layout do not change (`src/layout.mjs`
  untouched). No other test changes; the existing `imageService` test at lines 94-116 keeps
  passing unchanged. `src/*.d.mts` unchanged.
- **Ownership:** `src/options.mjs`, `src/service.mjs`, `test/service.test.mjs`,
  `astro-tests/picture.render.mjs`, `CHANGELOG.md`. `imageService` is re-exported by
  `src/index.mjs:1` (unchanged) and `getCacheDirectory` is used only in `src/service.mjs`
  (lines 238, 250); no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/service.test.mjs` ends with `# fail 0`; with the `src/` changes undone
    both new tests fail (put the failing lines in the report)
  - `node_modules/.bin/vitest run --reporter=verbose` passes, listing
    "full-width layout uses Astro full-width image attributes"
  - `git grep -n -A 12 "full-width layout uses" -- astro-tests/picture.render.mjs` shows
    `assertRenderedUrlsAcceptedByService` and `assertNoPositionParameter`
  - `git grep -n -e "^### Fixed" -e "trims a configured" -- CHANGELOG.md` prints both lines
    above `## [0.2.0]`
  - `git diff main --stat` lists only T1's files and this task's five files
- **Commit:** `Trim a configured cache directory and check full-width URLs`
- **Docs:** `README.md` «Options» (lines 40-45); `SKILL.md` line 43; ADR-0003 «Decision»
  (Changelog); plan 005 «Outcome».
- **Size:** about 10 changed lines in `src/`, plus tests and one changelog entry.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` in the worktree prints `RELEASE OK 0.2.0`
- `git diff main -- src/warmup.mjs src/layout.mjs src/index.d.mts package.json package-lock.json` prints nothing

## Amendments

None.

## Outcome

- **Merge:** `29c6a40` (`--no-ff` of `task/009-cli-and-cache-follow-ups` onto `188c4de`). Task
  commits: T1 `60254b0` (review 1 PASS, no findings), T2 `984615c` (review 1 PASS, no
  findings). No fix rounds. Gates: `GATES OK`; `RELEASE OK 0.2.0` from the worktree's
  `scripts/release.mjs`; `git diff main -- src/warmup.mjs src/layout.mjs src/index.d.mts package.json package-lock.json`
  empty. Lockfile unchanged, so no install on main; `VERIFY OK`. Tests: `test/cli.test.mjs`
  `pass 11`, `test/service.test.mjs` `pass 34`, vitest `9 passed`. `version` stays `0.2.0`;
  nothing tagged, pushed or published.
- **Decisions:** No executor questions; no plan amendments.
- **Surprises:**
  - The CLI `--public-origin` check already existed (`src/cli.mjs:111-121`), so T1's new
    invalid-`--public-origin` test passes on the old code too; it is coverage, as the plan asked.
  - A blank-after-trim service-config `cacheDirectory` now falls through to
    `options.cacheDirectory` (before, `" "` was truthy and became a path of spaces under cwd);
    this is the plan's "blank value falls through". On the old code T2's variant test would
    leave a directory named ` ` under cwd.
  - `scripts/release.mjs` resolves its root from its own location, not from cwd; the plan gate
    "in the worktree" is met by running the worktree's copy.
- **Deviations:** None.
- **Follow-ups:**
  - `README.md` «Options» (line 45) does not name the CLI `warm` fallback to
    `<cwd>/.dev/image-cache` (T1 review 1 note; outside T1 Ownership).
  - The plan 004 edge cases kept by plan 005 stay open (`getImage: null` with an `imageConfig`,
    `picture` `{}`, the repeated `astro:assets` import under `node --test`).
  - T2's `### Fixed` entry under `## Unreleased` makes the next release a patch at least.
- **Proposed rules:** None: the run had no findings.
