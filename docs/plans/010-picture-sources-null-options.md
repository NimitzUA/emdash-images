# 010 pictureSources null options

**Goal:** `pictureSources()` treats a `null` `getImage` or `imageConfig` option like an omitted
one and reads it from `astro:assets`, which closes roadmap item 1.

**Context:** `docs/adr/0004-picture-component.md` «Decision» (`pictureSources()` stays public,
reads widths and `getImage` from `astro:assets` when the caller passes none);
`docs/plans/004-picture-component.md` «Outcome», Follow-ups; `docs/plans/005-picture-follow-ups.md`
«Outcome», Follow-ups; `docs/ROADMAP.md` Open item 1; ADR-0003 «Decision» (Changelog).

Owner decision (2026-11-02): of the three plan 004 edge cases in roadmap item 1, only the `null`
option is fixed. The other two are closed as won't fix: `picture` being `{}` rather than
`undefined` with no attributes renders the same `<picture>`, and the repeated failing
`astro:assets` import happens only under `node --test`, where Astro is absent.

Facts read while writing this plan (2026-11-02, `main` at `7bf69b3`, version `0.2.0`):

- `src/sources.mjs:26`: the `astro:assets` import runs only when
  `options.getImage === undefined || options.imageConfig === undefined`. With
  `getImage: null` and an `imageConfig`, no import runs, `getImage` (line 35,
  `options.getImage ?? astroGetImage`) is `undefined`, and line 38 throws
  `pictureSources requires a getImage function`. With `imageConfig: null` and a `getImage`, no
  import runs, `imageConfig` (line 36) is `undefined`, and the widths (lines 41-49) fall back to
  `DEFAULT_IMAGE_OPTIONS` instead of the configured ones.
- `src/sources.d.mts:19-28` documents both options as read from `astro:assets` "when omitted";
  `README.md:171` says the same. Neither changes.
- `src/picture.mjs:67-71` passes `context.getImage` and `context.imageConfig`, which
  `src/Picture.astro:2` imports from `astro:assets`; no existing test passes `null` for either
  option (`test/sources.test.mjs`, `test/picture.test.mjs`, `astro-tests/picture.render.mjs`).
- Under `node --test` the `astro:assets` import fails (`src/sources.mjs:31-33`), so only a
  vitest test can tell the fixed code from the old: `vitest.config.mjs` includes
  `astro-tests/**/*.render.mjs` and configures `imageService({ publicWidths: [640, 1200] })`
  with `remotePatterns` `[{ pathname: "/_emdash/api/media/file/**" }]`.

**Version impact:** a patch-level fix with a `### Fixed` entry under `## Unreleased`. No change
to `exports`, `src/*.d.mts` or the documented options. No `version` bump, tag, push or publish.

**Preconditions:**
- `main` is clean at 0.2.0: `git status --porcelain` prints nothing and `npm pkg get version`
  prints `"0.2.0"`.

**Branch:** `task/010-picture-sources-null-options` · **Worktree:** `.worktrees/emdash-images/010-picture-sources-null-options`

## Tasks

### T1: Read null getImage and imageConfig from astro:assets

- **Target:** `src/sources.mjs`, `astro-tests/sources.render.mjs` (new), `CHANGELOG.md`.
- **Change:**
  - `src/sources.mjs:26`: run the `astro:assets` import when `options.getImage` or
    `options.imageConfig` is `null` or `undefined` (`== null`). Lines 35-36 already use `??`
    and stay as they are.
  - New `astro-tests/sources.render.mjs` (vitest, picked up by `vitest.config.mjs`), importing
    `getImage` and `imageConfig` from `astro:assets` and `pictureSources` from
    `../src/sources.mjs`, with
    `src = "https://site.example.test/_emdash/api/media/file/photo.jpg"`, `width: 1600`,
    `height: 1000`, and two tests:
    - "pictureSources reads getImage from astro:assets when getImage is null":
      `pictureSources({ src, width, height }, { getImage: null, imageConfig })` resolves to a
      result whose `widths` deep-equal `[640, 1200]`;
    - "pictureSources reads imageConfig from astro:assets when imageConfig is null":
      `pictureSources({ src, width, height }, { getImage, imageConfig: null })` resolves to a
      result whose `widths` deep-equal `[640, 1200]`.
  - `CHANGELOG.md`, `## Unreleased`, `### Fixed` (the section exists): add the entry
    "`pictureSources()` treats a `null` `getImage` or `imageConfig` option as omitted and reads
    it from `astro:assets`; before, a `null` `getImage` threw and a `null` `imageConfig` used
    the package's default widths."
- **Constraints:** An explicit non-null `getImage` or `imageConfig` still wins over
  `astro:assets`; without Astro, a missing `getImage` still throws
  `pictureSources requires a getImage function` (`test/sources.test.mjs` "pictureSources
  rejects when getImage is unavailable" keeps passing unchanged). `src/sources.d.mts`,
  `src/picture.mjs`, `src/Picture.astro`, `README.md` and `SKILL.md` unchanged. Do not cache
  the `astro:assets` import (owner decision above).
- **Ownership:** `src/sources.mjs`, `astro-tests/sources.render.mjs`, `CHANGELOG.md`.
  `pictureSources` is used by `src/picture.mjs` (passes non-null values from `astro:assets`),
  re-exported by `src/index.mjs` and `src/index.d.mts`, and tested in `test/sources.test.mjs`,
  none of which pass `null`; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node_modules/.bin/vitest run --reporter=verbose` passes, listing
    "pictureSources reads getImage from astro:assets when getImage is null" and
    "pictureSources reads imageConfig from astro:assets when imageConfig is null"
  - with the `src/sources.mjs` change undone, both new tests fail (put the failing lines in the
    report)
  - `git grep -n -e "^### Fixed" -e "treats a .null." -- CHANGELOG.md` prints both lines above
    `## [0.2.0]`
  - `git diff main --stat` lists only `src/sources.mjs`, `astro-tests/sources.render.mjs` and
    `CHANGELOG.md`
- **Commit:** `Read null pictureSources options from astro:assets`
- **Docs:** ADR-0004 «Decision» (`pictureSources()` stays public); `README.md:171`;
  `src/sources.d.mts`; plan 004 «Outcome», Follow-ups.
- **Size:** about 1 changed line in `src/`, plus about 40 lines of tests and one changelog entry.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` from the worktree's copy prints `RELEASE OK 0.2.0`
- `git diff main -- src/sources.d.mts src/index.d.mts src/picture.mjs src/Picture.astro package.json package-lock.json` prints nothing

## Amendments

None.

## Outcome

- **Merge:** `4375b4d` (`--no-ff` of `task/010-picture-sources-null-options` onto `26c136d`).
  Task commit: T1 `0bce0dd` (review 1 PASS, no findings). No fix rounds. Gates: `GATES OK`;
  `RELEASE OK 0.2.0` from the worktree's `scripts/release.mjs`;
  `git diff main -- src/sources.d.mts src/index.d.mts src/picture.mjs src/Picture.astro package.json package-lock.json`
  empty. Lockfile unchanged, so no install on main; `VERIFY OK`. Tests: vitest `11 passed`,
  including the two new `astro-tests/sources.render.mjs` tests; `CHECK OK`. `version` stays
  `0.2.0`; nothing tagged, pushed or published.
- **Decisions:** No executor questions; no plan amendments.
- **Surprises:** None. On the old code the new tests fail as the plan's facts predicted: a `null`
  `getImage` threw `pictureSources requires a getImage function`, a `null` `imageConfig` gave
  the default widths `[640, 1080, 1600]` instead of `[640, 1200]` (executor's run with the change
  undone; the reviewer confirmed it from the diff).
- **Deviations:** None.
- **Follow-ups:**
  - Roadmap item 1 is closed: the `null` option is fixed here; `picture` `{}` and the repeated
    `astro:assets` import under `node --test` are won't fix (owner decision, 2026-11-02).
  - The `### Fixed` entries under `## Unreleased` (plans 009 and 010) make the next release a
    patch at least.
- **Proposed rules:** None: the run had no findings.
