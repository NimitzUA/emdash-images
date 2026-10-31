# 004 Picture component

**Goal:** Ship `@nimitzua/emdash-images/Picture.astro` as ADR-0004 decides, and make
`pictureSources()` take its widths and `getImage` from `astro:assets` when the caller passes none.

**Context:** `docs/adr/0004-picture-component.md` (the whole ADR is the spec);
`docs/ROADMAP.md` item 1; `docs/adr/0003-versioning-and-releases.md` «Decision» (minor version,
changelog). Reference implementations to read, not import: Astro's own
`node_modules/astro/components/Picture.astro` (scoped-style forwarding, `layout` defaults,
`<source>` `sizes`) and EmDash's `node_modules/emdash/src/components/EmDashImage.astro`
(dark variant classes, `id` suffix, global CSS rule) with
`node_modules/emdash/src/media/focal-point.ts` (`focalPointToObjectPosition`). Astro's base
service `getHTMLAttributes` (`node_modules/astro/dist/assets/services/service.js:111-121`) and
`getImage` (`node_modules/astro/dist/assets/internal.js:112-148`) show which attributes come
back for a `layout`.

**Version impact:** minor, released as 0.2.0 (not yet published). New export
`./Picture.astro`; `pictureSources()` gains the optional `attributes` input, the optional
`imageConfig` option and the `attributes` result field, `getImage` becomes optional, and with no
widths passed it now uses the configured widths instead of the package defaults. Each behavior
task adds its `CHANGELOG.md` entry under `## Unreleased`. No `version` bump, tag or publish.

**Preconditions:**
- ADR-0004 accepted and committed: `git log -n 1 --format=%s -- docs/adr/0004-picture-component.md`
  prints `Accept ADR-0004: Picture component`.
- The owner approved `vitest` `^5.0.5` as a devDependency on 2026-10-31 (it supports `vite`
  `^8`, which Astro 7 installs). T3's executor changes `package.json` and asks
  "dependencies changed, run install"; the run session runs the install in the worktree.

**Branch:** `task/004-picture-component` · **Worktree:** `.worktrees/emdash-images/004-picture-component`

## Tasks

### T1: pictureSources reads configured widths and returns attributes

- **Target:** `src/sources.mjs`, `src/sources.d.mts`, `test/sources.test.mjs`, `CHANGELOG.md`.
- **Change:**
  - `pictureSources(input, options)` resolves, once per call:
    - `getImage`: `options.getImage`; else `getImage` from `await import("astro:assets")`.
    - `imageConfig`: `options.imageConfig`; else `imageConfig` from the same import.
    - The import runs only when one of the two is missing; a failed import leaves both
      undefined. With no `getImage` after that, the call throws the current
      `TypeError("pictureSources requires a getImage function")`. The dimension check that
      returns `undefined` before it stays first, as today.
  - Widths: `options.publicWidths`, else `imageConfig.service.config.publicWidths` when it is an
    array, else `DEFAULT_IMAGE_OPTIONS.publicWidths`; the same order for `smallWidths`. The
    resolved pair is what `publicResponsiveImageWidths(originalWidth, srcsetWidths, …)` and the
    smallest-public-width check use (today line 20 passes the raw `options`).
  - `input.attributes` (new, optional object) is spread into the AVIF and the WebP `getImage`
    calls, under the package's own keys: `src`, `width`, `height`, `widths`, `densities`,
    `format` and `mediaVersion` from `attributes` are ignored. `fit` is
    `options.fit ?? attributes.fit ?? "cover"`. The probe call gets no attributes.
  - The result gains `attributes`: the WebP `getImage` result's `attributes` object, or `{}`
    when it has none.
  - `src/sources.d.mts`: `PictureSourceInput.attributes?: Record<string, unknown>`;
    `PictureSourcesOptions.getImage` optional and `imageConfig?: unknown`, each documented
    with the `astro:assets` fallback; `PictureSources.attributes: Record<string, unknown>`.
  - `test/sources.test.mjs`: the three `assert.deepEqual(result, {…})` objects (lines 39-45,
    72-78, 101-107) gain `attributes: {}`. New tests: widths from `imageConfig.service.config`
    when `options` has none (`publicWidths: [640, 1200]`, an original 1600 px wide gives
    `widths` `[640, 1200]`); explicit `options.publicWidths` win over `imageConfig`; neither
    gives the defaults (an original 2000 px wide gives `[640, 1080, 1600, 1920]`); `attributes`
    reach both format calls and not the probe, and `attributes.src`, `width`, `height`,
    `widths`, `format` and `mediaVersion` do not change those keys; the returned `attributes`
    equal the WebP result's; a call without `getImage` rejects with
    `/requires a getImage function/` (under `node --test` `astro:assets` cannot be imported).
  - `CHANGELOG.md` under `## Unreleased`: `### Changed` "`pictureSources()` reads its widths
    and `getImage` from `astro:assets` when the caller passes none, so its widths match the
    image service"; `### Added` "`pictureSources()` forwards `attributes` to `getImage` and
    returns the resulting image attributes".
- **Constraints:** Keep every current behavior the existing tests describe (unversioned URLs
  without a hash, `undefined` for missing dimensions or an unchanged probe, the source-width
  variant below the smallest public width). Do not change `src/service.mjs`, `src/guard.mjs`
  or `src/index.mjs`. No new dependencies.
- **Ownership:** `src/sources.mjs`, `src/sources.d.mts`, `test/sources.test.mjs`,
  `CHANGELOG.md`. Grep for `pictureSources` and `PictureSources`: `src/index.mjs:9` and
  `src/index.d.mts:66-71` re-export them unchanged; `README.md` and `SKILL.md` belong to T4.
  Existing test changes: only the three `deepEqual` objects in `test/sources.test.mjs`.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `test/sources.test.mjs` covers each new case listed under Change, and the three existing `deepEqual` results include `attributes: {}`
  - `git diff main -- src/service.mjs src/guard.mjs src/index.mjs` prints nothing
  - `CHANGELOG.md` `## Unreleased` has the two entries above
- **Commit:** `Let pictureSources read configured widths and return attributes`
- **Docs:** ADR-0004 «Decision» (the `pictureSources()` item); `src/sources.mjs`;
  `src/service.mjs:93-105` (`publicResponsiveImageWidths`); `src/options.mjs`;
  `node_modules/astro/dist/assets/internal.js:112-148,211-222`.
- **Size:** about 60 changed lines, tests excluded.

### T2: Picture render model

- **Target:** new `src/picture.mjs`, new `test/picture.test.mjs`.
- **Change:** `src/picture.mjs` exports `pictureModel(props, context)`, where `props` are the
  component's props and `context` is `{ getImage, imageConfig, locals, url }` (`url` a `URL`).
  It returns `{ variants }`; each variant is `{ picture, sources, img }` (`picture` an attribute
  object or `undefined`, `sources` an array of `{ type, srcset, sizes }`, `img` an attribute
  object). It calls `pictureSources()` from `./sources.mjs` with `context.getImage` and
  `context.imageConfig`.
  - **Media URL** for a media value `m`: `m.src`; else
    `locals.emdash.getPublicMediaUrl(m.meta.storageKey)` when the key is a non-empty string and
    the resolver a function; else `/_emdash/api/media/file/<m.id>` when `m.id` is a non-empty
    string; else none. The `src` prop replaces the primary's URL. A relative URL is made
    absolute against `context.url` for `pictureSources()`; the fallback `<img>` keeps it as
    resolved.
  - **Values:** `width ?? image.width`, `height ?? image.height` and
    `alt ?? image.alt ?? ""` for the primary and the dark variant alike;
    `contentHash` for the primary, `darkContentHash` for the dark variant; `srcsetWidths`
    passed through.
  - **Layout:** `layout ?? imageConfig.layout ?? "none"`; when not `"none"`, `fit` defaults to
    `imageConfig.objectFit ?? "cover"` and `position` to `imageConfig.objectPosition ?? "center"`
    (as `astro/components/Picture.astro:54-64`).
  - **Attributes to `pictureSources()`:** every prop except `image`, `darkVariant`, `src`,
    `width`, `height`, `contentHash`, `darkContentHash`, `srcsetWidths`, `pictureAttributes`,
    `class`, `style` and `id`, plus `alt`, and `layout`, `fit`, `position` as resolved.
  - **`<picture>` variant:** `sources` are `image/avif` then `image/webp` with the result's
    srcsets and `sizes: result.attributes.sizes` when present. `img` is
    `{ ...result.attributes, src: result.src, alt, id, class, style }`. `picture` is a copy of
    `pictureAttributes`, plus every `data-astro-cid*` prop, plus the scoped class matched by
    `/\bastro-\w{8}\b/` in `class` appended to its `class` (as `Picture.astro:41-52,66-71`).
  - **Fallback** when `pictureSources()` returns `undefined`: `picture` undefined, `sources`
    `[]`, `img` the resolved URL with `alt`, `width`, `height`, `sizes`, `id`, `class`,
    `style`, the remaining props except `layout`, `fit`, `position` and `priority`, `loading` `"eager"` with `priority` else `loading ?? "lazy"`,
    `decoding ?? "async"`, and `fetchpriority` `"high"` with `priority`.
  - **Focal point:** finite `focalX` and `focalY` in [0, 1] on a media value give
    `object-position: X% Y%;` (each rounded to two decimals, as
    `focalPointToObjectPosition`) at the start of that variant's `style`, before the `style`
    prop.
  - **Dark variant:** `darkVariant ?? image.darkVariant`. When it and the primary both resolve,
    the primary's `class` starts with `emdash-image--light`, the dark one's with
    `emdash-image--dark`, and the dark one's `id` is `<id>--dark` when `id` is set. The `class`
    prop follows these classes.
  - No resolvable primary URL returns `{ variants: [] }`; a dark variant without a URL is left
    out.
  - `test/picture.test.mjs` (fake `getImage` that returns `attributes` like Astro's base
    service) covers: each step of the media URL order; the `src` prop override; a relative URL
    absolutised for `pictureSources()` and kept in the fallback; `alt` fallback to `""`; the
    hashes per variant; `layout` from `imageConfig` and the `fit`/`position` defaults;
    excluded props not reaching `getImage`; `sources` order, `type` and `sizes`; `img` keys;
    `pictureAttributes`, `data-astro-cid*` and the scoped class on `picture`; the fallback for
    an unchanged probe with lazy and with `priority`; the focal style and its absence for
    out-of-range values; the dark variant's classes and `id`; `{ variants: [] }`.
- **Constraints:** No database access and nothing imported from `emdash` (ADR-0004: the
  component imports nothing marked `@internal`). No access decisions. Plain JavaScript like
  the rest of `src/`. `pictureModel` is internal: not exported from `package.json` or
  `src/index.mjs`.
- **Ownership:** `src/picture.mjs` (new), `test/picture.test.mjs` (new). No existing test
  changes: `test/boundary.test.mjs` scans the new file and passes as long as it imports only
  `./sources.mjs`.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `test/picture.test.mjs` covers every case listed under Change
  - `git grep -n -E -e "(from|import\() *[\"']emdash" -e "selectFrom" -- src/picture.mjs` prints nothing
  - `git show --stat --format= HEAD` lists only `src/picture.mjs` and `test/picture.test.mjs`
- **Commit:** `Add the render model for the Picture component`
- **Docs:** ADR-0004 «Decision» (Input, Content hash, Output, Fallback, Astro `layout`, Dark
  variant, Focal point); `node_modules/astro/components/Picture.astro`;
  `node_modules/emdash/src/components/EmDashImage.astro:89-98,218-279`;
  `node_modules/emdash/src/media/focal-point.ts`; `src/sources.d.mts` after T1.
- **Size:** about 150 changed lines, tests excluded.

### T3: Picture.astro, its export and a render test

- **Target:** new `src/Picture.astro`, `package.json`, `package-lock.json` (by the install),
  new `vitest.config.mjs`, new `astro-tests/picture.render.mjs`, `CHANGELOG.md`.
- **Change:**
  - `src/Picture.astro`: frontmatter imports `getImage` and `imageConfig` from `astro:assets`,
    `pictureModel` from `./picture.mjs`, and types only (`import type`) `ImageValue` and
    `MediaValue` from `emdash` and `HTMLAttributes` from `astro/types`. `interface Props`
    extends `Omit<HTMLAttributes<"img">, "src" | "width" | "height">` with `image`,
    `darkVariant`, `src`, `width`, `height`, `alt`, `contentHash`, `darkContentHash`,
    `srcsetWidths`, `layout`, `fit`, `position`, `priority` and
    `pictureAttributes: HTMLAttributes<"picture">`. It calls
    `pictureModel(Astro.props, { getImage, imageConfig, locals: Astro.locals, url: Astro.url })`
    and renders each variant: `<picture {...picture}>`, one `<source>` per entry, then
    `<img {...img} />`, or the `<img>` alone when `picture` is undefined. A `<style is:global>`
    holds the dark-variant rule, copied from `EmDashImage.astro:332-350`. No other CSS.
  - `package.json`: export `"./Picture.astro": "./src/Picture.astro"`; devDependency
    `"vitest": "^5.0.5"`; `scripts.test` becomes `node --test && vitest run`. Then `ask`
    "dependencies changed, run install" and wait for the answer.
  - `vitest.config.mjs`: `getViteConfig` from `astro/config` with
    `{ test: { include: ["astro-tests/**/*.render.mjs"], environment: "node" } }` and the
    inline Astro config
    `{ image: { service: imageService({ publicWidths: [640, 1200] }), remotePatterns: [{ pathname: "/_emdash/api/media/file/**" }] } }`.
    The directory and file names keep `node --test`'s default patterns (`**/*.test.mjs`,
    `**/test/**`, `test-*`) from picking the file up; if `node --test` ran it, it would fail on
    the `.astro` import, so `CHECK OK` also proves the split.
  - `astro-tests/picture.render.mjs` renders `src/Picture.astro` with
    `experimental_AstroContainer` (`astro/container`), a `request` for
    `https://site.example.test/page` and `locals.emdash.getPublicMediaUrl` returning
    `/_emdash/api/media/file/<key>`, and asserts:
    - a local image (`meta.storageKey` `photo.jpg`, 1600×1000, a `sha1:` hash) renders one
      `<picture>` with `<source type="image/avif"` and `<source type="image/webp"`, srcsets
      through `/_image?` with `f=avif` / `f=webp`, `v=` the hash's 16 characters, `1200w`
      present and `1080w` absent, and an `<img` whose `src` has `f=webp`;
    - `layout="constrained"` puts `data-astro-image="constrained"` and a `sizes` on the `<img>`;
    - a `darkVariant` renders two `<picture>` elements, `emdash-image--light` and
      `emdash-image--dark`, and `id="hero"` / `id="hero--dark"`;
    - `src="https://cdn.example.test/photo.jpg"` with dimensions renders one `<img` and no
      `<picture>`;
    - `pictureAttributes={{ class: "frame" }}` lands on `<picture>`;
    - `focalX: 0.5, focalY: 0.25` gives `object-position: 50% 25%`.
  - `CHANGELOG.md` `## Unreleased` `### Added`: "`Picture.astro` component
    (`@nimitzua/emdash-images/Picture.astro`): AVIF and WebP sources with hash-versioned URLs,
    `layout`, dark variant, focal point and `pictureAttributes` for EmDash image fields".
- **Constraints:** Do not install or update dependencies yourself (AGENTS.md); only the
  `vitest` devDependency is new. `src/Picture.astro` stays a template over `pictureModel`:
  no URL, width or attribute logic of its own. If the container cannot render `astro:assets`
  with the inline config, `ask` with the error instead of mocking `astro:assets`.
- **Ownership:** `src/Picture.astro` (new), `package.json`, `package-lock.json`,
  `vitest.config.mjs` (new), `astro-tests/picture.render.mjs` (new), `CHANGELOG.md`. Grep for
  `"test"` in `package.json`: `scripts.prepublishOnly` runs `npm test` and keeps working;
  `scripts/orca/check.sh` and `scripts/orca/plan-gates.sh` call `npm test` unchanged. No
  existing test changes: `test/boundary.test.mjs` reads only `dependencies` and
  `peerDependencies`, and the imports in `src/Picture.astro` (`astro:assets`, `astro/types`,
  `emdash`, `./picture.mjs`) are declared.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `.scratch/tmp/check.log` shows the `node --test` results and a vitest summary in which `astro-tests/picture.render.mjs` passed with every case listed under Change
  - `npm pkg get exports` prints an object with `"./Picture.astro": "./src/Picture.astro"`; `npm pkg get scripts.test` prints `"node --test && vitest run"`
  - `git grep -n -e "selectFrom" -e "emdash/" -- src/Picture.astro` prints nothing
- **Commit:** `Add the Picture component with its export and a render test`
- **Docs:** ADR-0004; `node_modules/astro/components/Picture.astro`;
  `node_modules/emdash/src/components/EmDashImage.astro:325-350`; Astro docs «Testing» →
  «Vitest and Container API» and the Container API reference (`renderToString`, `props`,
  `request`, `locals`); `README.md:93-96` (`image.remotePatterns`).
- **Size:** about 80 changed lines, tests and the lockfile excluded.

### T4: Document the Picture component

- **Target:** `README.md`, `SKILL.md`.
- **Change:**
  - `README.md`:
    - line 3 names the `Picture` component among what the package provides;
    - line 5 says the package ships one optional component, `Picture.astro`, for EmDash image
      fields, while each site still owns art direction, private access rules, middleware
      composition and deployment wrappers;
    - the section «`pictureSources` and site markup» becomes «`Picture` component»: import
      from `@nimitzua/emdash-images/Picture.astro`, a usage example with
      `image={entry.data.featured_image}`, `contentHash` and `sizes`, the props table (from T3's
      `Props`), how the site gets `content_hash` (one query for the page; without it URLs are
      unversioned), that `image.remotePatterns` must allow `/_emdash/api/media/file/**`, that
      external providers and untransformable sources render a plain `<img>`, the dark-variant
      class convention (`dark` / `light` class on `<html>`, `prefers-color-scheme`), and that
      Portable Text images and the placeholder are not covered yet;
    - a following subsection «Custom markup with `pictureSources`»: the configured widths and
      `getImage` come from `astro:assets` when not passed, `attributes` in and out, and that a
      hand-built component must forward scoped-style attributes.
  - `SKILL.md`: a new step after step 4, «Render image fields with `Picture`», with the
    import, the `contentHash` prop and the `remotePatterns` requirement; renumber the later
    steps; in «Package behavior to preserve» replace the line "The package does not render
    `<picture>`…" with one on `Picture.astro` and `pictureSources()` reading configured widths.
- **Constraints:** Document only what T1-T3 shipped; every prop, import path and option named
  must exist in `src/Picture.astro`, `src/sources.d.mts` or `package.json`. No site names.
  Do not edit `CHANGELOG.md` (T1 and T3 did).
- **Ownership:** `README.md`, `SKILL.md`. No existing test changes: no test reads either file.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n "does not provide an Astro" -- README.md SKILL.md` prints nothing
  - `git grep -n "@nimitzua/emdash-images/Picture.astro" -- README.md SKILL.md` prints at least one line in each file
  - every prop in the `README.md` props table appears in `interface Props` of `src/Picture.astro`
  - `git grep -n -i -E "liliiachaika|facadesystems" -- README.md SKILL.md` prints nothing
- **Commit:** `Document the Picture component and pictureSources defaults`
- **Docs:** ADR-0004; `README.md` «`pictureSources` and site markup» and «Astro
  configuration»; `SKILL.md`; `src/Picture.astro` and `src/sources.d.mts` after T1-T3.
- **Size:** about 90 changed lines of documentation.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `npm pack --dry-run --json` in the worktree (with `--cache` in the worktree) lists
  `src/Picture.astro` and `src/picture.mjs`, and no `astro-tests/` or `vitest.config.mjs`
- `git diff main -- src/service.mjs src/guard.mjs src/index.mjs src/index.d.mts` prints nothing
- `node scripts/release.mjs verify` in the worktree prints `RELEASE OK 0.1.0` (no version
  bump in this plan)

## Amendments

- 2026-10-31, T2: the Acceptance grep matched the `emdash` strings the Change itself requires
  (`locals.emdash`, `/_emdash/api/media/file/`, the `emdash-image--*` classes); it now matches
  only static and dynamic imports from `emdash` and `selectFrom`.

## Outcome

Filled after merge, from `status.md`.
