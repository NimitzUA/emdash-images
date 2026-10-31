# 005 Picture follow-ups

**Goal:** Make every URL a `layout` produces pass the package's own `/_image` checks, and close
the `Picture` gaps plan 004's Outcome lists, before 0.2.0 is published.

**Context:** `docs/plans/004-picture-component.md` «Outcome» (Follow-ups);
`docs/adr/0004-picture-component.md` «Decision» (Astro `layout`, Output);
`docs/ROADMAP.md` item 1; `docs/adr/0003-versioning-and-releases.md` «Decision» (changelog).

Found while writing this plan (2026-11-01), with a Container render of `src/Picture.astro` on
main `221df2b`: with any `layout` other than `"none"`, every generated URL carries
`position=center` (or the `position` prop), for example
`/_image?href=…photo.jpg&w=640&f=avif&fit=cover&position=center`. The cause is Astro, not the
component: `astro/components/Picture.astro:57-60` and `astro/components/Image.astro:31-32`
default `fit` and `position` for a layout, and the base service's `getURL`
(`node_modules/astro/dist/assets/services/service.js:197-208`) writes both into the URL. The
package's `parseURL` (`src/service.mjs:218-219`) rejects any `position` and any `fit` other than
`cover`, and the guard answers such a request with 404 (`test/guard.test.mjs:520`, "position
option"). So today `Picture` with a layout, `imageConfig.layout` set site-wide, a
non-`cover` `imageConfig.objectFit`, and Astro's own `<Image layout="…">` on this service all
render images the server refuses. Dropping them from the URL loses nothing: the service drops
`height` from public transforms (`src/service.mjs:331-335`, `normalizeGeneratedTransform`), and
sharp uses `fit` and `position` only when both width and height are set
(`node_modules/astro/dist/assets/services/sharp.js:120-129`). The CSS side stays: `getImage`
puts `data-astro-image-fit` and `data-astro-image-pos` on the `<img>` from the same options
(`node_modules/astro/dist/assets/internal.js:139-147`), before any URL is built.

Plan 004 follow-ups and what this plan does with each:

- Layout `none` ignores `imageConfig.objectFit` / `objectPosition`: kept, now pinned by a test.
  With layout `none` Astro sets no `data-astro-image-*` attributes, so `fit` and `position`
  could only reach the URL, which T1 makes free of them; following Astro would change nothing
  a visitor sees.
- `src: ""` returns `{ variants: [] }`: fixed in T2 (an empty `src` counts as not given).
- `picture` is `{}` with no attributes: kept. `src/Picture.astro:33` renders `<picture>` when
  `picture` is truthy; `undefined` would drop the `<source>` elements.
- `getImage: null` with an `imageConfig` throws: kept. The option is typed as an optional
  function, and under `node --test` no test can tell the fallback from the throw.
- Missing tests (`cover` / `center` defaults, a layout's default `sizes`, `smallWidths` from the
  config, the `darkVariant` prop in a render), the fake's `Object.hasOwn(sizes)`, the vitest
  reporter: T2 and T3.
- `src/Picture.astro:17` and `README.md:157` name the layout `"fullWidth"`; Astro's
  `ImageLayout` is `'full-width'` (`node_modules/astro/dist/assets/types.d.ts:7`): fixed in T3.

**Version impact:** none beyond 0.2.0, which is not yet published. T1 fixes service behavior
that 0.1.0 already had, so it adds a `### Fixed` entry under `## Unreleased`. T2 and T3 adjust the
unreleased `Picture` component and add no entry. No `version` bump, tag or publish.

**Preconditions:** None. Plan 004 is merged (`git log -n 1 --format=%s eb916a1` prints
`Merge plan 004: Picture component`).

**Branch:** `task/005-picture-follow-ups` · **Worktree:** `.worktrees/emdash-images/005-picture-follow-ups`

## Tasks

### T1: Keep fit and position out of generated public media URLs

- **Target:** `src/service.mjs`, `test/service.test.mjs`, `CHANGELOG.md`.
- **Change:**
  - In the transform the service's `getURL` hands to the underlying service for a **public**
    media source (`normalizeGeneratedTransform`, `src/service.mjs:331-335`, which already sets
    `height: undefined` there): `position` becomes `undefined`, and `fit` becomes `"cover"`
    when it is set (any truthy value) and stays unset otherwise. Transforms for private and
    non-media sources pass through unchanged, as today.
  - `parseURL` and the guard keep rejecting `position` and a non-`cover` `fit`; the URLs they
    receive are now the canonical ones.
  - `getHTMLAttributes` is unchanged: the `data-astro-image-fit` / `data-astro-image-pos`
    attributes come from `getImage`, not from the URL.
  - `test/service.test.mjs`, new test: with a fake underlying service that records the
    transform its `getURL` receives (as the test at `test/service.test.mjs:836-897` does),
    `service.getURL({ ...publicImageTransform, fit: "contain", position: "top" }, imageConfig(), {})`
    delegates `fit: "cover"` and `position: undefined`; with `fit` unset the delegated `fit` is
    unset; the private source `https://site.test/_emdash/api/media/file/private-cases/case/photo.png`
    with `fit: "contain", position: "top"` delegates both unchanged. A second assertion builds
    the URL with a fake `getURL` that writes `fit` and `position` the way
    `astro/dist/assets/services/service.js:197-208` does (only truthy values), and
    `service.parseURL` of that URL returns a transform, not `undefined`.
  - `CHANGELOG.md` `## Unreleased` `### Fixed`: "Generated public media URLs carry no
    `position` and only `fit=cover`, so images rendered with an Astro `layout` (or a non-`cover`
    `image.objectFit`) pass the `/_image` checks instead of returning 404".
- **Constraints:** Threat model unchanged: `parseURL` and `withImageGuard` must still reject
  every input the existing tests list (`test/service.test.mjs:795-797`,
  `test/guard.test.mjs:514-530`); do not loosen either. Cache paths and the `v` parameter are
  unchanged. Do not touch `src/guard.mjs`, `src/picture.mjs`, `src/sources.mjs`.
- **Ownership:** `src/service.mjs`, `test/service.test.mjs`, `CHANGELOG.md`.
  `normalizeGeneratedTransform` is used only at `src/service.mjs:174`. No existing test
  changes: the test at `test/service.test.mjs:836-897` passes no `fit` or `position`, and
  `parseURL`/guard expectations stay.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `test/service.test.mjs` covers each case listed under Change, and the new test fails on main's `src/service.mjs` (its failing line in the report)
  - `git diff main -- src/guard.mjs test/guard.test.mjs` prints nothing
  - `CHANGELOG.md` `## Unreleased` `### Fixed` has the entry above
- **Commit:** `Keep fit and position out of generated public media URLs`
- **Docs:** this plan's «Context»; `src/service.mjs:169-226,331-335`;
  `node_modules/astro/dist/assets/services/service.js:187-215`;
  `node_modules/astro/dist/assets/services/sharp.js:120-140`.
- **Size:** about 10 changed lines, tests excluded.

### T2: Close the Picture model gaps and missing unit tests

- **Target:** `src/picture.mjs`, `test/picture.test.mjs`, `test/sources.test.mjs`.
- **Change:**
  - `src/picture.mjs:12`: the primary URL is the `src` prop only when it is a non-empty string
    (the file's `isUrl`); otherwise the media URL. A `src: ""` with an `image` renders the
    image's URL.
  - `test/picture.test.mjs`:
    - the fake `getImage` (`createImageApi`, lines 14-52) sets the layout `sizes` the way
      Astro core does (`resolvedOptions.sizes ||=`, `node_modules/astro/dist/assets/internal.js:131`):
      only when the `sizes` option is falsy, instead of `!Object.hasOwn(rest, "sizes")`;
    - new: `layout: "constrained"` with no `imageConfig.objectFit` / `objectPosition` sends
      `fit: "cover"` and `position: "center"` to the format calls;
    - new: `layout: "constrained"` without a `sizes` prop gives `img.sizes` and both
      `sources[].sizes` equal to the fake's layout `sizes`;
    - new: `layout: "none"` with `imageConfig: { objectFit: "contain", objectPosition: "top" }`
      sends no `fit` other than `pictureSources()`'s own `"cover"` and no `position`;
    - new: `src: ""` with `image` uses the image's URL.
  - `test/sources.test.mjs`, new: `imageConfig.service.config.smallWidths` is used when
    `options` has none: `imageConfig.service.config` `{ publicWidths: [640, 1200], smallWidths: [400] }`,
    an original 1600×1000 and `srcsetWidths: [400]` give `widths` `[400, 640, 1200]` (with the
    default `smallWidths` `[320, 480]`, 400 would be dropped).
- **Constraints:** Change no behavior other than the `src: ""` case. Existing tests keep their
  expectations except where the fake's `sizes` rule changes them; name any such test in the
  report. `src/sources.mjs` is not changed.
- **Ownership:** `src/picture.mjs`, `test/picture.test.mjs`, `test/sources.test.mjs`. Grep for
  `createImageApi`: used only in `test/picture.test.mjs`. Existing test changes: only the fake
  in `createImageApi`; the test at `test/picture.test.mjs:205` ("omit sizes for layout none")
  must still pass.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `test/picture.test.mjs` and `test/sources.test.mjs` cover each new case listed under Change; the `src: ""` test fails on main's `src/picture.mjs` (its failing line in the report)
  - `git show --stat --format= HEAD` lists only `src/picture.mjs`, `test/picture.test.mjs` and `test/sources.test.mjs`
- **Commit:** `Treat an empty src as unset and cover Picture defaults in tests`
- **Docs:** this plan's «Context»; `src/picture.mjs`; `src/sources.mjs:41-66`;
  `node_modules/astro/dist/assets/internal.js:112-148`.
- **Size:** about 5 changed lines, tests excluded.

### T3: Fix the full-width layout name and prove rendered URLs pass the service

- **Target:** `src/Picture.astro`, `astro-tests/picture.render.mjs`, `package.json`,
  `README.md`.
- **Change:**
  - `src/Picture.astro:17`: `layout?: "none" | "constrained" | "fixed" | "full-width"`.
  - `package.json` `scripts.test`: `node --test && vitest run --reporter=verbose`.
  - `astro-tests/picture.render.mjs`:
    - a helper parses each URL of a rendered `srcset` and `img` `src` with the package's own
      service: the default export of `../src/service.mjs`, its
      `parseURL(new URL(url, "https://site.example.test"), imageConfig, {})` with `imageConfig`
      from `astro:assets`, and asserts each result is not `undefined`;
    - the existing local-image and `layout="constrained"` cases also run that helper, and their
      URLs contain no `position=`;
    - new: `layout="constrained"` with `position="top"` and `fit="contain"` keeps
      `data-astro-image-fit="contain"` and `data-astro-image-pos="top"` on the `<img>`, while
      its URLs contain no `position=`, only `fit=cover`, and pass the helper;
    - new: `layout="full-width"` gives `data-astro-image="full-width"` and `sizes="100vw"` on
      the `<img>`;
    - new: the top-level `darkVariant` prop (not `image.darkVariant`) renders two `<picture>`
      elements with `emdash-image--light` and `emdash-image--dark`.
  - `README.md` props table (lines 157-159): `layout` lists `"full-width"`; `fit` and
    `position` say they set the image's CSS `object-fit` / `object-position` through Astro's
    layout attributes, only with a `layout` other than `"none"`, and that generated URLs always
    use `fit=cover` and no `position`.
- **Constraints:** No new dependencies. `src/Picture.astro` stays a template over
  `pictureModel`. Do not mock `astro:assets`; if `parseURL` cannot run inside the Container
  test, `ask` with the error. Do not edit `CHANGELOG.md`.
- **Ownership:** `src/Picture.astro`, `astro-tests/picture.render.mjs`, `package.json`,
  `README.md`. Grep for `fullWidth`: `src/Picture.astro:17`, `README.md:157` and the done plan
  `docs/plans/004-picture-component.md`, which stays as it is. Grep for `"test"` in
  `package.json`: `scripts.prepublishOnly` runs `npm test` and keeps working. Existing test
  changes: the two cases in `astro-tests/picture.render.mjs` that gain the helper.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `.scratch/tmp/check.log` lists by name every vitest case in `astro-tests/picture.render.mjs`, each passed, including the three new ones
  - `npm pkg get scripts.test` prints `"node --test && vitest run --reporter=verbose"`
  - `git grep -n "fullWidth" -- src README.md SKILL.md` prints nothing
- **Commit:** `Fix the full-width layout name and check rendered URLs`
- **Docs:** this plan's «Context»; `astro-tests/picture.render.mjs`; `vitest.config.mjs`;
  `node_modules/astro/dist/assets/types.d.ts:7,180-195`; `README.md` «`Picture` component».
- **Size:** about 10 changed lines, tests excluded.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `git diff main -- src/guard.mjs src/sources.mjs src/index.mjs src/index.d.mts` prints nothing
- `node scripts/release.mjs verify` in the worktree prints `RELEASE OK 0.1.0`

## Amendments

None.

## Outcome

- **Merge:** `7a58534` (`--no-ff` of `task/005-picture-follow-ups` onto `d485492`). Task
  commits: T1 `2490285` (review 1 PASS), T2 `406fd41` (review 1 PASS), T3 `b4eb72a` (review 1
  PASS). No fix rounds. Gates: `GATES OK`; `git diff main -- src/guard.mjs src/sources.mjs
  src/index.mjs src/index.d.mts` empty; `RELEASE OK 0.1.0` in the worktree. Lockfile unchanged,
  so no install on main; `VERIFY OK`. Tests at merge: 128 `node --test`, 9 vitest render cases
  (listed by name in the check log with `--reporter=verbose`). `version` stays `0.1.0`; nothing
  tagged, pushed or published.
- **Decisions:** No executor questions; no plan amendments.
- **Surprises:**
  - T2's Ownership note said `createImageApi` is used only in `test/picture.test.mjs`;
    `test/sources.test.mjs` has its own pre-existing factory of that name. T2 changed only the
    one in `test/picture.test.mjs` (confirmed by review 1).
  - T3's commit could not be signed: the executor failed twice with
    `1Password: failed to fill whole buffer`, although `sign-probe.sh` printed `SIGN OK` at the
    start. The architect's own commit of the staged files signed. Fourth run in a row with a
    mid-run signing failure in a Codex terminal (plans 002-005).
- **Deviations:**
  - T3 was committed by the architect from the executor's staged changes, unchanged, with the
    task's message.
- **Follow-ups:**
  - README's `fit`/`position` rows say "generated URLs always use `fit=cover`"; with no fit set
    the URL carries no `fit` at all (`src/service.mjs:337`). The wording came from this plan's
    Change; "`fit=cover` when any fit is set" would be exact.
  - The `full-width` render case checks `data-astro-image` and `sizes` but does not run its
    URLs through the `parseURL` helper.
  - `src/picture.mjs:12` now uses `isUrl(props.src)`, so a non-string `src` also falls back to
    the media URL (within this plan's "non-empty string" rule).
  - The new service test's fake `getURL` builds an absolute URL where Astro builds a relative
    endpoint path; irrelevant to `parseURL`.
  - Still open from plan 004, kept by this plan's Context: `getImage: null` with an
    `imageConfig` throws; `picture` is `{}` with no attributes; without `imageConfig`,
    `pictureSources()` retries the `astro:assets` import on each call under `node --test`.
  - Tooling: 1Password signing still fails mid-run in Codex terminals.
- **Proposed rules:** None: the run had no findings.
