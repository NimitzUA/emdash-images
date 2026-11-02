# 0008 Portable Text gallery

**Status:** accepted · **Date:** 2026-11-02

## Context

ADR-0006 shipped `PortableTextImage.astro` for EmDash's Portable Text `image` block and left the
`gallery` and `cover` blocks on EmDash's components («Scope»). Images in those blocks still get
no AVIF sources, no configured widths and no versioned URLs.

Facts from the installed dependencies (`emdash` 1.4.0, read 2026-11-02):

- `src/components/Gallery.astro` renders `node.images` (each with `asset` `_ref`, `url`,
  `provider`, plus `alt`, `caption`, `width`, `height`, `focalX`, `focalY`, `blurhash`,
  `dominantColor`) and `node.columns` (default `GALLERY_DEFAULT_COLUMNS`, 3) as
  `<div class="emdash-gallery" style="--columns: N">` with one
  `<figure class="emdash-gallery-item">` per image: the image with `layout="constrained"` and
  `sizes`, its focal point as `object-position`, and a `<figcaption>` for a caption. It puts the
  LQIP placeholder on the `<figure>` (with the invalid `blurhashToImageCssString` shorthand,
  ADR-0006 «Context») and ships scoped CSS: the grid, two columns at 640px and below, square
  cropped images, the caption. Props: `node`, `placeholder` (default `true`) and `sizes`.
- `sizes` defaults to `gallerySizes(columns)` (`src/media/responsive.ts:55-65`):
  `(max-width: 640px) <cell for 2>, <cell for columns>`, where a cell is `100vw` for one column
  and `calc((100vw - <columns - 1>rem) / <columns>)` otherwise. `gallerySizes`,
  `sanitizeGalleryImages` and `resolveImageMedia` are not public exports of `emdash`.
- `src/components/Cover.astro` takes `backgroundImage` as a bare URL string (from WordPress
  imports, rewritten by `rewrite-url-helpers.ts`), with no media id, width or height. The image
  service transforms only sources with known dimensions (`pictureSources()` returns `undefined`
  without them), so a package cover would still render a plain `<img>`.
- `src/portable-text-image.mjs` maps an image block node to the media value `pictureModel`
  takes; a gallery image has the same shape.

The owner decided on 2026-11-02: the package covers `gallery`, `cover` stays on EmDash's
component, and a gallery takes its content hashes as one map.

## Decision

- **A Portable Text gallery component.** The package exports
  `@nimitzua/emdash-images/PortableTextGallery.astro` (file `src/PortableTextGallery.astro`),
  used beside the image block:
  `components={{ type: { image: PortableTextImage, gallery: PortableTextGallery } }}`. Each
  image goes through `pictureModel` as in ADR-0006, with the same node-to-media mapping, shared
  with `PortableTextImage` rather than copied; nothing marked `@internal` is imported from
  `emdash`.
- **Content hashes as a map.** A `contentHashes` prop takes a `Map` or a plain object from media
  id (`asset._ref`) to `content_hash`; an image without an entry gets unversioned URLs. A plain
  object counts only its own keys. A site passes it through a wrapper, as for
  `PortableTextImage`.
- **Markup.** EmDash's structure and class names: `<div class="emdash-gallery">` with the inline
  custom property `--columns: <columns>`, one `<figure class="emdash-gallery-item">` per image
  with the picture and an optional `<figcaption>`. `columns` is used only when it is a positive
  integer, else 3. Images that resolve no URL are skipped; a gallery with none renders nothing.
- **Layout and sizes.** Images use the `constrained` layout. `sizes` is the `sizes` prop, else
  the same value as EmDash's `gallerySizes(columns)`, computed in the package.
- **Placeholder and focal point.** As on `Picture`, on each `<img>` (not on the `<figure>` as
  EmDash does), so the placeholder code and its CSS-injection rules stay in one place;
  `placeholder={false}` turns it off.
- **Unstyled.** No CSS. `README.md` gives an example stylesheet with EmDash's gallery rules.
- **`cover` stays on EmDash.** Its image has no dimensions or media id, so the package cannot
  improve it; it is no longer a roadmap item.
- **Release.** A new export is a minor version before 1.0.0 (ADR-0003), with an `### Added`
  entry.

## Consequences

- Gallery images get AVIF and WebP sources, configured widths, placeholders and, through a site
  wrapper, versioned URLs; warm-up finds them in page HTML.
- A site switching to this component loses EmDash's gallery CSS (grid, mobile columns, square
  crop) and adds its own; the placeholder now sits on the `<img>`, which matters only where a
  site styles the `<figure>` background.
- The node-to-media mapping becomes a shared module function, so `PortableTextImage` and
  `PortableTextGallery` cannot drift apart.
- The package's markup contract grows by one component that follows EmDash's gallery shape.

## Alternatives

- **A package `cover` component.** It would copy EmDash's markup without improving the image;
  rejected by the owner.
- **A `contentHash(ref)` function prop.** More flexible, but a different input shape from the
  map a site already builds for its page; rejected by the owner.
- **The placeholder on the `<figure>`, as EmDash does.** Matches EmDash, but needs a second
  placeholder path beside `pictureModel`'s.
- **Import `gallerySizes` from `emdash`.** It is not a public export.
