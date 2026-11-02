# 014 Portable Text gallery

**Goal:** Ship ADR-0008: a `PortableTextGallery.astro` component for EmDash's Portable Text
`gallery` block on the same model as `PortableTextImage`, and its docs.

**Context:** `docs/adr/0008-portable-text-gallery.md` (accepted 2026-11-02);
`docs/adr/0006-portable-text-image-and-placeholder.md` «Decision»; ADR-0003 «Decision»
(Changelog); `docs/plans/011-portable-text-image-and-placeholder.md` «Outcome».

Facts read while writing this plan (2026-11-02, `main` at `91ac970` plus the ADR-0008 and
roadmap commit made with this plan, version `0.3.1`, `emdash` 1.4.0):

- `src/portable-text-image.mjs:6-54` `portableTextImageModel(props, context)` builds the media
  value inline (lines 11-22: `id` from `asset._ref`/`asset.id`, `src` from
  `asset.url`/`asset.src`, `meta`, `provider`, `alt`/`width`/`height` from the node then the
  asset, `blurhash`/`dominantColor` from the node then `asset.meta`) and calls `pictureModel`
  (lines 24-30) with `image`, `layout: "constrained"`, `contentHash`, `placeholder`, `title`.
  The media value carries no `focalX`/`focalY`; `pictureModel` reads them from the media value
  (`src/picture.mjs`, focal point style).
- `src/PortableTextImage.astro` is the template pattern (model from `astro:assets` `getImage`
  and `imageConfig`, `locals: Astro.locals`, `url: Astro.url`; each variant renders
  `<picture>` with sources and `<img>`, or the fallback `<img>`).
- EmDash's gallery node, markup and default `sizes` are in ADR-0008 «Context»
  (`node_modules/emdash/src/components/Gallery.astro`, `src/media/responsive.ts:45-65`).
- `pictureModel` forwards a `sizes` prop to `getImage` and the `<img>`, and its sources carry
  the result's `sizes` (test "optimized img uses service attributes and explicit component
  attributes").
- Tests: `test/picture.test.mjs` imports `pictureModel` and `portableTextImageModel` and has
  `createImageApi`, `render` and `renderPortableText` helpers (lines 15-80);
  `astro-tests/picture.render.mjs` renders `Picture` and `PortableTextImage` with
  `assertRenderedUrlsAcceptedByService` and `assertNoPositionParameter`.
- `package.json:50` exports `./PortableTextImage.astro`. `README.md` «Portable Text images»
  (line 174 on), line 252 "This override only replaces the `image` block; `gallery` and `cover`
  continue to use EmDash's components.", «Package exports» (line 297) and the opening lines 3
  and 5; `SKILL.md` step 5 (lines 33-41) and line 61. `CHANGELOG.md` `## Unreleased` is empty.

**Version impact:** a new export, a minor version before 1.0.0 (ADR-0003), with an `### Added`
entry under `## Unreleased` (T2). No `version` bump, tag, push or publish.

**Preconditions:**
- `main` is clean at 0.3.1: `git status --porcelain` prints nothing and `npm pkg get version`
  prints `"0.3.1"`.

**Branch:** `task/014-portable-text-gallery` · **Worktree:** `.worktrees/emdash-images/014-portable-text-gallery`

## Tasks

### T1: Add the PortableTextGallery component

- **Target:** `src/portable-text-image.mjs`, `src/portable-text-gallery.mjs` (new),
  `src/PortableTextGallery.astro` (new), `package.json`, `test/picture.test.mjs`,
  `astro-tests/picture.render.mjs`.
- **Change:**
  - `src/portable-text-image.mjs`: move the media mapping of lines 11-22 into an exported
    `portableTextMedia(node)` that returns the media value, or `undefined` when `node.asset` is
    not an object, and also carries the node's `focalX` and `focalY` when they are numbers.
    `portableTextImageModel` calls it; its output does not change (image blocks carry no focal
    point).
  - New `src/portable-text-gallery.mjs` exporting
    `async function portableTextGalleryModel(props, context)` (the `context` of
    `pictureModel`). It returns `undefined` when no image renders; otherwise
    `{ style, items }`:
    - `columns`: `props.node.columns` when it is a positive integer (`Number.isInteger`, > 0),
      else 3; `style` is `--columns: <columns>`;
    - `sizes`: `props.sizes` when a non-empty string, else
      `(max-width: 640px) <cell 2>, <cell columns>` with a cell `100vw` for one column and
      `calc((100vw - <columns - 1>rem) / <columns>)` otherwise (EmDash's `gallerySizes`);
    - for each entry of `props.node.images` (skipped when it is not an array) whose
      `portableTextMedia(entry)` is defined: `pictureModel` with `image` (that media),
      `layout: "constrained"`, `sizes`, `contentHash` and `placeholder: props.placeholder`;
      entries with no variants are skipped; each item is
      `{ caption, variants }`, `caption` when a non-empty string;
    - `contentHash` for an image: from `props.contentHashes` by the media id, through `.get`
      for a `Map`, or an own property of a plain object (`Object.hasOwn`); otherwise none.
  - New `src/PortableTextGallery.astro`: a thin template as `src/PortableTextImage.astro`. Props:
    `node` (EmDash's gallery shape, ADR-0008 «Context»), `contentHashes?:
    Map<string, string> | Record<string, string>`, `placeholder?: boolean`, `sizes?: string`,
    and `index`/`isInline`. Renders nothing for `undefined`; else
    `<div class="emdash-gallery" style={style}>` with one
    `<figure class="emdash-gallery-item">` per item (the picture or fallback `<img>`, then
    `<figcaption>` when set). No `<style>`.
  - `package.json` `exports`: add
    `"./PortableTextGallery.astro": "./src/PortableTextGallery.astro"` after
    `./PortableTextImage.astro`.
  - `test/picture.test.mjs`, new tests with the existing `createImageApi`:
    - `portableTextMedia` maps an image node as `portableTextImageModel` did, and passes
      `focalX`/`focalY`; the existing `portableTextImageModel` tests pass unchanged;
    - a gallery of two images gives two items in order, with captions, and each image's
      `getImage` calls use its own source;
    - `columns` 2 gives `--columns: 2` and sizes
      `(max-width: 640px) calc((100vw - 1rem) / 2), calc((100vw - 1rem) / 2)`; no `columns`
      gives `--columns: 3` and `(max-width: 640px) calc((100vw - 1rem) / 2), calc((100vw - 2rem) / 3)`;
      `columns` 1 gives `… , 100vw`; a `sizes` prop replaces the default on the `<img>` and both
      sources;
    - `contentHashes` as a `Map` and as a plain object version the matching image only
      (`mediaVersion` on its transforms); a `contentHashes` object without an own key for the
      id (for example an id `"constructor"`) gives no version;
    - focal point and placeholder reach each `<img>` `style`; `placeholder: false` gives none;
    - entries without an object `asset`, a non-array `images`, or no images give `undefined`
      when nothing renders, and are skipped otherwise; `index` and `isInline` reach no
      `getImage` call;
    - threat cases, below.
  - `astro-tests/picture.render.mjs`, new test rendering `PortableTextGallery` with the existing
    `request` and `locals`: two images with `asset.url` `/_emdash/api/media/file/a.jpg` and
    `/_emdash/api/media/file/b.jpg` (1600×1000), `columns: 2` and one caption render one
    `<div class="emdash-gallery" style="--columns: 2">`, two
    `<figure class="emdash-gallery-item">`, two `<picture>` elements each with an AVIF and a
    WebP `<source>`, one `<figcaption>`; `assertRenderedUrlsAcceptedByService(html)` and
    `assertNoPositionParameter` pass.
- **Threat model:** `columns` is stored content that reaches an inline `style`. Blocked inputs,
  each giving `--columns: 3` and nothing else in the `style`: `"2; background: url(https://tracker.example/x)"`,
  `"4"`, `-1`, `0`, `2.5`, `Infinity`, `null`. Placeholder values follow T1 of plan 011
  (unchanged `src/placeholder.mjs`). The stop condition is that list, proven by one
  table-driven test.
- **Constraints:** `src/picture.mjs`, `src/placeholder.mjs`, `src/sources.mjs`,
  `src/Picture.astro` and `src/PortableTextImage.astro` unchanged; the gallery model calls
  `portableTextMedia` and `pictureModel` instead of copying them. Nothing imported from `emdash`
  in the new files; nothing marked `@internal`. No `cover` component. No existing test changes.
- **Ownership:** `src/portable-text-image.mjs`, `src/portable-text-gallery.mjs`,
  `src/PortableTextGallery.astro`, `package.json`, `test/picture.test.mjs`,
  `astro-tests/picture.render.mjs`. `portableTextImageModel` is used by
  `src/PortableTextImage.astro` and `test/picture.test.mjs` (behaviour unchanged);
  `portableTextMedia`, `portableTextGalleryModel` and `PortableTextGallery` are new names; no
  existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/picture.test.mjs` ends with `# fail 0` and lists the new gallery tests
  - `node_modules/.bin/vitest run --reporter=verbose` passes, listing the new
    `PortableTextGallery` render test
  - `node --test test/boundary.test.mjs` ends with `# fail 0`
  - `npm pkg get exports` prints `"./PortableTextGallery.astro": "./src/PortableTextGallery.astro"`
  - `git grep -n -e "<style" -e "@internal" -e "from \"emdash\"" -- src/PortableTextGallery.astro src/portable-text-gallery.mjs`
    prints nothing
  - `git diff main --stat` lists only this task's files
- **Commit:** `Add the PortableTextGallery component`
- **Docs:** ADR-0008; ADR-0006 «Decision»; `src/portable-text-image.mjs`,
  `src/PortableTextImage.astro`; `node_modules/emdash/src/components/Gallery.astro`.
- **Size:** about 100 changed lines in `src/`, plus tests.

### T2: Document PortableTextGallery

- **Target:** `README.md`, `SKILL.md`, `CHANGELOG.md`.
- **Change:**
  - `README.md`:
    - opening lines 3 and 5 name `PortableTextGallery.astro` beside the other two components;
    - «Portable Text images»: the usage with both overrides
      (`components={{ type: { image: PortableTextImage, gallery: PortableTextGallery } }}`);
      the `contentHashes` prop (a `Map` or plain object from media id to `content_hash`, own
      keys only) with a wrapper example in the style of the existing one; `columns` (positive
      integer, else 3), the default `sizes` and the `sizes` prop, `placeholder`, and that the
      placeholder sits on each `<img>`; the markup (`emdash-gallery` with `--columns`,
      `emdash-gallery-item`, `figcaption`); no CSS, with an example stylesheet copied from
      EmDash's gallery rules (`node_modules/emdash/src/components/Gallery.astro:206-233`, as
      global CSS);
    - line 252: only `cover` still uses EmDash's component, because its image has no
      dimensions to transform;
    - «Package exports» names `./PortableTextGallery.astro`.
  - `SKILL.md`: step 5's Portable Text example adds `gallery: PortableTextGallery` and its
    import; line 61 names `PortableTextGallery.astro`.
  - `CHANGELOG.md` `## Unreleased`: `### Added` with one entry:
    "`PortableTextGallery.astro` component (`@nimitzua/emdash-images/PortableTextGallery.astro`)
    for EmDash's Portable Text `gallery` block: AVIF and WebP sources per image, configured
    widths, `contentHashes`, `columns`, `sizes`, captions and placeholders, with no CSS."
- **Constraints:** Docs only. Every prop, export and path named exists after T1. No `version`
  change.
- **Ownership:** `README.md`, `SKILL.md`, `CHANGELOG.md`; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n "PortableTextGallery" -- README.md SKILL.md` prints lines in README's opening,
    «Portable Text images», «Package exports» and SKILL step 5
  - `git grep -n "gallery. and .cover. continue" -- README.md` prints nothing
  - `git grep -n -e "^### Added" -e "PortableTextGallery.astro. component" -- CHANGELOG.md` prints
    both lines above `## [0.3.1]`
  - `node scripts/release.mjs verify` prints `RELEASE OK 0.3.1`
  - `git diff main --stat` lists only T1's and this task's files
- **Commit:** `Document PortableTextGallery`
- **Docs:** ADR-0008; ADR-0003 «Decision» (Changelog); `README.md` «Portable Text images»;
  `SKILL.md`.
- **Size:** about 60 changed lines of docs.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` from the worktree's copy prints `RELEASE OK 0.3.1`
- `git diff main -- src/picture.mjs src/placeholder.mjs src/sources.mjs src/Picture.astro src/PortableTextImage.astro package-lock.json .github` prints nothing

## Amendments

None.

## Outcome

Filled after merge, from `status.md`.
