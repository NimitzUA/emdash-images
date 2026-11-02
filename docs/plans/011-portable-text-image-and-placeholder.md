# 011 Portable Text image and placeholder

**Goal:** Ship ADR-0006: the LQIP placeholder in `Picture`, a `PortableTextImage.astro`
component for EmDash's Portable Text `image` block on the same model, and their docs.

**Context:** `docs/adr/0006-portable-text-image-and-placeholder.md` (accepted 2026-11-02);
`docs/adr/0004-picture-component.md` «Decision» and «Next»; ADR-0003 «Decision» (Changelog);
`docs/ROADMAP.md` Open item 3; `docs/plans/010-picture-sources-null-options.md` «Outcome».

Facts read while writing this plan (2026-11-02, `main` at `1a43406` plus the ADR-0006 edit
committed with this plan, version `0.2.0`, `emdash` 1.4.0, `astro-portabletext` 0.11.4,
`@unpic/placeholder` 0.1.2 installed as a dependency of `emdash`):

- `src/picture.mjs`: `pictureModel(props, context)` (line 9) resolves the media URL
  (`mediaUrl`, lines 121-139: `media.src`, then `getPublicMediaUrl(meta.storageKey)`, then
  `/_emdash/api/media/file/<id>`), builds one variant per media value, and calls
  `styleWithFocalPoint(media, style)` (lines 191-201) for the optimized `<img>` (line 112) and
  the fallback `<img>` (line 85). `EXCLUDED_ATTRIBUTES` (lines 3-6) lists the props that never
  reach `getImage` or the `<img>`; other props are forwarded (`title` reaches the `<img>`, test
  "optimized img receives forwarded title attributes").
- `src/Picture.astro:7-22` declares the props; it has no `placeholder` prop.
- `@unpic/placeholder` `dist/index.mjs:148-153`: `blurhashToImageCssObject(blurhash)` returns
  `{ backgroundImage: 'url("data:image/bmp;base64,…")', backgroundSize: "cover" }`; for
  `"abc"` it throws `The blurhash string must be at least 6 characters` (checked with
  `node .scratch/tmp/check-emdash-import.mjs` on 2026-11-02; `LEHV6nWB2yk8pyo0adR*.7kCMdnj`
  decodes). `blurhashToImageCssString` is not used (ADR-0006 «Context»).
- `import { sanitizeHref } from "emdash"` works under plain Node (same check): it keeps
  `https://example.com/a`, `/local`, `#anchor`, `mailto:x@example.com` and returns `#` for
  `javascript:alert(1)`, `" java\tscript:alert(1)"`, `//evil.example` and `data:text/html,x`.
- `test/boundary.test.mjs` fails when a file under `src/` imports a bare specifier that is not
  in `dependencies` or `peerDependencies` of `package.json`; `emdash` is a peer dependency.
- EmDash's image block (`node_modules/emdash/src/components/Image.astro:18-57, 82-119, 177-254`)
  and its node shape are summarized in ADR-0006 «Context»; render dimensions follow lines
  104-119 (both display sizes, else display width with the original aspect ratio, else display
  height with it, else the original size).
- No media value in `test/picture.test.mjs` or `astro-tests/picture.render.mjs` carries
  `blurhash` or `dominantColor`, so the placeholder on by default changes no existing
  assertion. `vitest.config.mjs` configures `imageService({ publicWidths: [640, 1200] })` and
  `remotePatterns` `[{ pathname: "/_emdash/api/media/file/**" }]`.
- `README.md`: «`Picture` component» (lines 128-167; line 167 ends "Portable Text images and the
  placeholder are not covered yet."), «Package exports» (line 216, which names no `.astro`
  export); `SKILL.md` step 5 (lines 21-31) and «Package behavior to preserve» (line 50).

**Version impact:** a new export (`./PortableTextImage.astro`), a new `placeholder` prop on
`Picture`, the placeholder on by default and a new runtime dependency: a minor version before
1.0.0 (ADR-0003), with `### Added` entries under `## Unreleased` (T3). No `version` bump, tag,
push or publish.

**Preconditions:**
- `main` is clean at 0.2.0: `git status --porcelain` prints nothing and `npm pkg get version`
  prints `"0.2.0"`.
- T1 changes `package.json` dependencies: the run installs in the worktree when the executor
  asks "dependencies changed, run install" (`AGENTS.md`).

**Branch:** `task/011-portable-text-image-and-placeholder` · **Worktree:** `.worktrees/emdash-images/011-portable-text-image-and-placeholder`

## Tasks

### T1: Render the LQIP placeholder in Picture

- **Target:** `src/placeholder.mjs` (new), `src/picture.mjs`, `src/Picture.astro`,
  `package.json`, `package-lock.json`, `test/picture.test.mjs`, `astro-tests/picture.render.mjs`.
- **Change:**
  - `package.json` `dependencies`: add `"@unpic/placeholder": "^0.1.2"`, then `ask`
    "dependencies changed, run install"; the run updates `package-lock.json`.
  - New `src/placeholder.mjs` exporting `async function placeholderStyle(media)`, which returns
    an object of CSS declarations or `undefined`:
    - blurhash: `media.blurhash`, else `media.meta?.blurhash`, used only when a non-empty
      string. Import `blurhashToImageCssObject` from `@unpic/placeholder` with a dynamic
      `import()` only in that case, and return
      `{ "background-image": backgroundImage, "background-size": backgroundSize }`. If the
      decoder throws, continue to the colour.
    - colour: `media.dominantColor`, else `media.meta?.dominantColor`, used only when it matches
      `/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i` or
      `/^rgba?\(\s*[0-9.]+%?\s*(?:,\s*[0-9.]+%?\s*){2,3}\)$/i`; return
      `{ "background-color": value }`.
  - `src/picture.mjs`:
    - add `"placeholder"` to `EXCLUDED_ATTRIBUTES`, so it reaches neither `getImage` nor the
      `<img>` (also not the fallback `<img>`);
    - replace `styleWithFocalPoint` with a variant style that combines, in this order, the
      variant media's placeholder (skipped when `props.placeholder === false`), its focal-point
      `object-position`, and the site's `style`. A string or missing `style` gives one string of
      `name: value;` declarations joined by single spaces, for example
      `background-color: rgb(10,20,30); object-position: 50% 25%; color: red;`; an object
      `style` gives `{ ...placeholder, "object-position": …, ...style }`. With none of the three
      the `<img>` has no `style`. Each variant (primary, dark) uses its own media value.
  - `src/Picture.astro` `Props`: add `placeholder?: boolean` with a one-line comment
    (default `true`; `false` for a strict Content Security Policy).
  - `test/picture.test.mjs`, new tests (`createImageApi` and `render` as they are):
    - a `blurhash` `LEHV6nWB2yk8pyo0adR*.7kCMdnj` gives an `<img>` `style` matching
      `/^background-image: url\("data:image\/bmp;base64,[A-Za-z0-9+/=]+"\); background-size: cover;$/`;
      the same value in `meta.blurhash` gives the same style;
    - `dominantColor: "rgb(10,20,30)"` gives `background-color: rgb(10,20,30);`, and
      `#a1b2c3` is accepted;
    - placeholder, focal point and site style combine as
      `background-color: rgb(10,20,30); object-position: 50% 25%; color: red;`, and an object
      `style` `{ color: "red" }` gives
      `{ "background-color": "rgb(10,20,30)", "object-position": "50% 25%", color: "red" }`;
    - `placeholder: false` gives no `style`, and no `getImage` call and no `<img>` carries a
      `placeholder` key;
    - the dark variant gets its own placeholder (`rgb(1,2,3)` and `rgb(4,5,6)`);
    - the fallback `<img>` (`{ unchanged: true }`) gets the placeholder;
    - threat cases, below.
  - `astro-tests/picture.render.mjs`, new test: an image with the blurhash above renders an
    `<img>` whose `style` contains `background-image: url(` and `background-size: cover`.
- **Threat model:** stored media content (`dominantColor`, `blurhash`, possibly imported) must
  not add CSS beyond the placeholder declarations to the inline `style`. Blocked inputs, each
  giving no `background-color` and no other added declaration:
  `"red; background-image: url(https://tracker.example/x)"`, `"rgb(1,2,3); color: red"`,
  `"url(https://tracker.example/x)"`, `"expression(alert(1))"`, `"red"`, `"#12345"`,
  `"rgb(1,2,3)}"`, `42`. A blurhash `"abc"` or `123` gives no `background-image` and does not
  throw; with a valid `dominantColor` beside it, the colour is used. The stop condition is that
  list, proven by one table-driven test; the review checks the list, not new bypasses.
- **Constraints:** `pictureSources()` and `src/sources.mjs` unchanged. A media value without
  placeholder fields renders as before: no existing test changes. `blurhashToImageCssString` is
  not used. No CSS in `src/Picture.astro` beyond the existing dark-variant rule.
- **Ownership:** `src/placeholder.mjs`, `src/picture.mjs`, `src/Picture.astro`, `package.json`,
  `package-lock.json` (written by the run's install), `test/picture.test.mjs`,
  `astro-tests/picture.render.mjs`. `styleWithFocalPoint` and `EXCLUDED_ATTRIBUTES` are used
  only in `src/picture.mjs`; `pictureModel` is used by `src/Picture.astro` and
  `test/picture.test.mjs`; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/picture.test.mjs` ends with `# fail 0`; with the `src/picture.mjs` change
    undone the new placeholder tests fail (put the failing lines in the report)
  - `node --test test/boundary.test.mjs` ends with `# fail 0`
  - `node_modules/.bin/vitest run --reporter=verbose` passes, listing the new placeholder render
    test
  - `npm ls @unpic/placeholder` lists `@unpic/placeholder@0.1.2` as a direct dependency of
    `@nimitzua/emdash-images`
  - `git grep -n "blurhashToImageCssString" -- src` prints nothing
  - `git diff main --stat` lists only this task's files
- **Commit:** `Render the LQIP placeholder in Picture`
- **Docs:** ADR-0006 «Context» and «Decision» (Placeholder, Dependency); ADR-0004 «Decision»
  (Focal point, Unstyled); `AGENTS.md` (dependencies).
- **Size:** about 70 changed lines in `src/`, plus tests.

### T2: Add the PortableTextImage component

- **Target:** `src/portable-text-image.mjs` (new), `src/PortableTextImage.astro` (new),
  `package.json`, `test/picture.test.mjs`, `astro-tests/picture.render.mjs`.
- **Change:**
  - New `src/portable-text-image.mjs` exporting
    `async function portableTextImageModel(props, context)` (the same `context` as
    `pictureModel`). It returns `undefined` when `props.node?.asset` is missing or the picture
    model has no variants; otherwise `{ figureClass, link, caption, variants }`:
    - media for `pictureModel`: `id` = `asset._ref`, else `asset.id`; `src` = the first non-empty
      string of `asset.url`, `asset.src`; `meta` = `asset.meta`; `provider` = `asset.provider`;
      `alt`, `width`, `height` from the node, else from the asset; `blurhash` and
      `dominantColor` from the node, else `asset.meta`. `pictureModel` then resolves the URL in
      ADR-0006's order (`asset.url`, `asset.src`, `getPublicMediaUrl(asset.meta.storageKey)`,
      `/_emdash/api/media/file/<asset._ref>`);
    - `pictureModel` props: `image` (the media), `layout: "constrained"`, `contentHash`,
      `placeholder` and `title` (`node.title`) only; no other prop (`index`, `isInline`) is
      forwarded;
    - display size: the render width and height from `displayWidth` and `displayHeight` with
      the original aspect ratio, as EmDash's `Image.astro:104-119`. When set, the variant's
      `<img>` gets that `width` and `height`, and an optimized variant's `<img>` and both
      `<source>` elements get `sizes` `(min-width: <W>px) <W>px, 100vw`. The transforms keep
      the original dimensions, so every URL is one the `/_image` guard accepts;
    - `figureClass`: `emdash-image`, plus `emdash-image--align-<alignment>` for `left`,
      `center`, `right`, `wide` or `full` only;
    - `link`: from `node.link`, a string or `{ href, blank }`, trimmed; no link when empty.
      `href` = `sanitizeHref(trimmed)` imported from `emdash`; `blank: true` adds
      `target: "_blank"` and `rel: "noopener noreferrer"` unless the sanitized `href` starts
      with `#`;
    - `caption`: `node.caption` when a non-empty string.
  - New `src/PortableTextImage.astro`: a thin template over `portableTextImageModel` with
    `getImage` and `imageConfig` from `astro:assets`, `locals: Astro.locals` and
    `url: Astro.url`, as `src/Picture.astro` does. Props: `node` (EmDash's image block shape,
    ADR-0006 «Context»), `contentHash?: string`, `placeholder?: boolean`, plus the `index` and
    `isInline` that `PortableText` passes. It renders nothing for `undefined`; else
    `<figure class={figureClass}>`, the picture (or fallback `<img>`) inside `<a {...link}>`
    when `link` is set, and `<figcaption>{caption}</figcaption>` when set. No `<style>`.
  - `package.json` `exports`: add `"./PortableTextImage.astro": "./src/PortableTextImage.astro"`
    after `./Picture.astro`.
  - `test/picture.test.mjs`, new tests for `portableTextImageModel`, with the existing
    `createImageApi`:
    - the source order above (four cases, as the existing "media URLs prefer src…" test);
    - node `alt`, `width`, `height`, `blurhash`, `dominantColor` win over the asset's and
      `asset.meta`'s;
    - `displayWidth: 400` on a 1600×1000 image gives `<img>` `width` 400, `height` 250 and the
      `sizes` above on the `<img>` and both sources, and the `getImage` calls deep-equal those
      without a display size; `displayHeight: 250` alone gives the same `width` and `height`;
    - `alignment: "wide"` gives `emdash-image emdash-image--align-wide`; `"middle"` gives
      `emdash-image`;
    - `caption` is returned; `title` reaches the `<img>`; `contentHash` reaches the transforms
      as `mediaVersion`; `placeholder: false` gives no `style`;
    - no node or no `asset` gives `undefined`; `index` and `isInline` reach no `getImage` call
      and no `<img>`;
    - link cases, below.
  - `astro-tests/picture.render.mjs`, new tests rendering `PortableTextImage` with the
    existing `render` setup (`request`, `locals`):
    - a node with `asset.url` `/_emdash/api/media/file/photo.jpg`, `width` 1600, `height`
      1000, `alignment: "wide"`, `caption: "Caption"` and `link: { href: "https://example.com",
      blank: true }` renders one `<figure class="emdash-image emdash-image--align-wide">`, one
      `<a href="https://example.com" target="_blank" rel="noopener noreferrer">`, one
      `<picture>` with an AVIF and a WebP `<source>`, and `<figcaption>Caption</figcaption>`;
      `assertRenderedUrlsAcceptedByService(html)` and `assertNoPositionParameter` pass;
    - the same node with `displayWidth: 400` renders an `<img>` with `width="400"`, and
      `assertRenderedUrlsAcceptedByService(html)` passes.
- **Threat model:** the link `href` comes from stored content. Blocked inputs, each rendering
  `href="#"` and no `target`: `javascript:alert(1)`, `" java\tscript:alert(1)"`,
  `//evil.example`, `data:text/html,x`, each also as `{ href, blank: true }`. Kept:
  `https://example.com/a`, `/local`, `mailto:x@example.com`; `#top` with `blank: true` gets no
  `target`. The stop condition is that list, proven by one table-driven test; the package
  relies on `emdash`'s `sanitizeHref` and does not write its own URL check.
- **Constraints:** `src/picture.mjs`, `src/Picture.astro` and `src/sources.mjs` unchanged; the
  new model calls `pictureModel` instead of copying its logic. Nothing imported from `emdash`
  except `sanitizeHref`; nothing marked `@internal`. `gallery` and `cover` blocks are out of
  scope. No existing test changes.
- **Ownership:** `src/portable-text-image.mjs`, `src/PortableTextImage.astro`, `package.json`,
  `test/picture.test.mjs`, `astro-tests/picture.render.mjs`. `portableTextImageModel` and
  `PortableTextImage` are new names (no existing use in `src/`, `test/` or `astro-tests/`);
  `pictureModel` is called, not changed; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/picture.test.mjs` ends with `# fail 0` and lists the new
    `portableTextImageModel` tests
  - `node_modules/.bin/vitest run --reporter=verbose` passes, listing both new
    `PortableTextImage` render tests
  - `node --test test/boundary.test.mjs` ends with `# fail 0`
  - `npm pkg get exports` prints `"./PortableTextImage.astro": "./src/PortableTextImage.astro"`
  - `git grep -n -e "<style" -e "@internal" -- src/PortableTextImage.astro src/portable-text-image.mjs`
    prints nothing
  - `git diff main --stat` lists only T1's and this task's files
- **Commit:** `Add the PortableTextImage component`
- **Docs:** ADR-0006 «Context» and «Decision»; `node_modules/emdash/src/components/Image.astro`;
  `src/Picture.astro`, `src/picture.mjs`.
- **Size:** about 110 changed lines in `src/`, plus tests.

### T3: Document the placeholder and PortableTextImage

- **Target:** `README.md`, `SKILL.md`, `CHANGELOG.md`.
- **Change:**
  - `README.md`:
    - the opening paragraphs (lines 3 and 5) name `PortableTextImage.astro` beside
      `Picture.astro`;
    - «`Picture` component»: a `placeholder` row in the props table ("LQIP placeholder from
      `blurhash`, else a hex or `rgb()` `dominantColor`, as an inline background; default
      `true`; pass `false` for a strict Content Security Policy"), and line 167's last sentence
      replaced by one on the placeholder;
    - a new `## Portable Text images` section after «Custom markup with `pictureSources`»: the
      `components={{ type: { image: PortableTextImage } }}` usage with `emdash/ui`
      `PortableText`; a site wrapper passing `contentHash` (the ADR-0006 example); the output
      (`figure`, alignment classes, link through `sanitizeHref`, caption, display size, layout
      `constrained`); that the component ships no CSS and a site replacing EmDash's image block
      must style the alignment classes and caption itself, with an example stylesheet copied
      from EmDash's rules (`node_modules/emdash/src/components/Image.astro:256-302`, as global
      CSS); that `gallery` and `cover` still use EmDash's components;
    - «Package exports»: name `./Picture.astro` and `./PortableTextImage.astro`.
  - `SKILL.md`: step 5 adds the Portable Text usage in one sentence and a short code block;
    «Package behavior to preserve» line 50 names `PortableTextImage.astro` and the placeholder
    default.
  - `CHANGELOG.md` `## Unreleased`: a `### Added` section above `### Fixed` with two entries:
    - "`PortableTextImage.astro` component (`@nimitzua/emdash-images/PortableTextImage.astro`)
      for EmDash's Portable Text `image` block: AVIF and WebP sources, configured widths,
      `contentHash`, alignment classes, link, caption and display size, with no CSS."
    - "`Picture` renders the LQIP placeholder from `blurhash` or `dominantColor` by default;
      `placeholder={false}` turns it off. New dependency `@unpic/placeholder`."
- **Constraints:** Docs only. Every prop, export and path named exists after T2 (check with
  `git grep` or `ls`). No `version` change.
- **Ownership:** `README.md`, `SKILL.md`, `CHANGELOG.md`; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n -e "PortableTextImage" -- README.md SKILL.md` prints lines in README's opening,
    «Portable Text images», «Package exports» and SKILL step 5
  - `git grep -n "not covered yet" -- README.md` prints nothing
  - `git grep -n -e "^### Added" -e "PortableTextImage.astro. component" -e "LQIP placeholder" -- CHANGELOG.md`
    prints the three lines above `## [0.2.0]`
  - `node scripts/release.mjs verify` prints `RELEASE OK 0.2.0`
  - `git diff main --stat` lists only T1's, T2's and this task's files
- **Commit:** `Document the placeholder and PortableTextImage`
- **Docs:** ADR-0006; ADR-0003 «Decision» (Changelog); `README.md` «`Picture` component»;
  `SKILL.md`.
- **Size:** about 80 changed lines of docs.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` from the worktree's copy prints `RELEASE OK 0.2.0`
- `git diff main -- src/sources.mjs src/service.mjs src/guard.mjs src/index.mjs src/index.d.mts src/sources.d.mts` prints nothing

## Amendments

None.

## Outcome

- **Merge:** `7fc9edf` (`--no-ff` of `task/011-portable-text-image-and-placeholder` onto
  `ee993bb`). Task commits: T1 `ac229eb`, T2 `8b7c9fa`, T3 `a0da5c5`, each with review 1 PASS
  and no findings. No fix rounds. Gates: `GATES OK`;
  `git diff main -- src/sources.mjs src/service.mjs src/guard.mjs src/index.mjs src/index.d.mts src/sources.d.mts`
  empty; `RELEASE OK 0.2.0` from the worktree (T3 executor and T3 review 1). The lockfile
  changed, so main was installed: `INSTALL OK`; then `VERIFY OK`. Tests: `test/picture.test.mjs`
  43 pass, vitest `14 passed`, `CHECK OK`. `version` stays `0.2.0`; nothing tagged, pushed or
  published.
- **Decisions:** T1 asked "dependencies changed, run install"; the run ran `install-main.sh` in
  the worktree (`INSTALL OK`), as the plan's Preconditions foresaw. No other questions; no plan
  amendments.
- **Surprises:** The plan gate `node scripts/release.mjs verify`, run in an Orca terminal with
  `exec`, exited 0 but the terminal kept no output, so the `RELEASE OK 0.2.0` evidence comes
  from T3's executor and reviewer at the same HEAD; `verify-main.sh` reran release checks on main.
  T1: with `src/picture.mjs` undone, 7 new placeholder tests fail; the threat-table negatives
  also pass on the base code (it never read `dominantColor`), so the positive tests and the
  regexes give that table its meaning.
- **Deviations:** None.
- **Follow-ups:**
  - `Picture` now normalizes a string site `style` (trimmed, one trailing `;`, empty gives no
    `style`) and drops a non-string, non-object `style`; same CSS meaning (T1 review note).
  - `PortableTextImage` with `displayWidth` but no original height uses the original width in
    `sizes` where EmDash emits none; only media without a height, which `pictureModel` cannot
    optimize anyway (T2 review note). The `displayWidth` render test does not assert `sizes`;
    the model test does.
  - README: the placeholder row says "hex or `rgb()`" though `rgba()` is accepted; «Portable
    Text images» does not name `PortableTextImage`'s `placeholder` prop or that a `#` link gets
    no `target`; the ADR-0006 wrapper example has no guard for a missing
    `Astro.locals.imageHashes` (T3 review notes). A small docs plan can cover them.
  - `## Unreleased` now holds `### Added` (plan 011) and `### Fixed` (plans 009, 010): the next
    release is a minor, 0.3.0 (ADR-0003).
- **Proposed rules:** None: the run had no findings.
