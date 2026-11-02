# 0006 Portable Text image and placeholder

**Status:** accepted · **Date:** 2026-11-02

## Context

ADR-0004 shipped `Picture.astro` for EmDash image fields and left two items for later («Next»):
a Portable Text image block component on the same code, so images inside rich text get AVIF and
WebP sources and versioned URLs, and the LQIP placeholder (`blurhash`, `dominantColor`) that
`emdash/ui` `Image` renders and `Picture` does not. Until then rich-text images go through
EmDash's own component, without AVIF sources or versioned URLs (ADR-0004 «Consequences»).

Facts from the installed dependencies (`emdash` 1.4.0, `astro-portabletext` 0.11.4, read
2026-11-02):

- `emdash/ui` `PortableText` (`src/components/PortableText.astro`) merges EmDash's default
  components, plugin block components and the site's `components` prop, in that order, so a site
  replaces the image block with `components={{ type: { image: Component } }}`
  (`src/components/index.ts`, `emdashComponents.type.image`).
- `astro-portabletext` gives a type component only `node`, `index` and `isInline`
  (`lib/types.ts`); a site cannot pass extra props through `PortableText` and passes them by
  wrapping the component.
- EmDash's image block component (`src/components/Image.astro`) reads `node.asset` (`_ref`,
  `url`, `provider`, `meta`), `alt`, `caption`, `title`, `width`, `height`, `blurhash`,
  `dominantColor` (falling back to `asset.meta` for older snapshots), `displayWidth`,
  `displayHeight`, `alignment` (`left`, `center`, `right`, `wide`, `full`) and `link` (a string,
  or `{ href, blank }`). It renders a `<figure class="emdash-image emdash-image--align-…">` with
  an optional `<a>` (the `href` passed through `sanitizeHref`; `target="_blank"` and
  `rel="noopener noreferrer"` only for `blank` links that are not `#` anchors), one image with
  `layout="constrained"`, and a `<figcaption>`, plus scoped CSS for the alignment floats, widths
  and the caption. The node carries no content hash.
- `sanitizeHref` is a public export of `emdash` (`src/index.ts:149`); `resolveImageMedia`,
  `normalizeImageLink` and `buildRenderMediaUrl` are not.
- EmDash builds the placeholder with `blurhashToImageCssString` from `@unpic/placeholder`
  (MIT, 0.1.2, a dependency of `emdash`), imported only when a `blurhash` is present; without
  one it uses `background-color: <dominantColor>`. A `placeholder` prop (default `true`) turns
  it off for a strict Content Security Policy, since the placeholder is an inline style.
- `Picture` resolves URLs, sources, layout attributes, the dark variant and the focal point in
  `src/picture.mjs` (`pictureModel`); the `.astro` file is a thin template over it.

The owner decided on 2026-11-02: the content hash comes from a prop, the block keeps EmDash's
class names but ships no CSS, the placeholder uses `@unpic/placeholder` and is on by default,
and this step covers the `image` block only.

## Decision

- **A Portable Text image component.** The package exports
  `@nimitzua/emdash-images/PortableTextImage.astro` (file `src/PortableTextImage.astro`), used
  as `<PortableText value={…} components={{ type: { image: PortableTextImage } }} />`. It
  renders the image through the same model as `Picture` (AVIF and WebP `<source>` elements,
  configured widths, the plain `<img>` fallback for sources the service does not transform)
  and imports nothing marked `@internal` from `emdash`.
- **Input.** The `node` prop is EmDash's image block. The source is, in order: `asset.url`,
  `asset.src`, `getPublicMediaUrl(asset.meta.storageKey)`, then
  `/_emdash/api/media/file/<asset._ref>`. `alt`, `width` and `height` come from the node, then
  from the asset; `blurhash` and `dominantColor` from the node, then from `asset.meta`.
- **Display size.** `displayWidth` and `displayHeight` (either one, with the aspect ratio from
  the original dimensions) set the `<img>` `width` and `height` as EmDash does. Sources are
  built so that every URL is one the `/_image` guard accepts.
- **Content hash from the site.** A `contentHash` prop versions the URLs, as on `Picture`.
  `PortableText` cannot pass it, so a site that wants versioned URLs wraps the component, for
  example `<PortableTextImage {...Astro.props} contentHash={hashes.get(Astro.props.node.asset._ref)} />`
  with the hashes for the page loaded in one query. Without it the URLs are unversioned. A lookup
  without the site's help stays ADR-0004's open question, for the database and storage ADR.
- **Markup.** The same structure and class names as EmDash's component: a `<figure>` with
  `emdash-image` and `emdash-image--align-<alignment>`, an optional `<a>`, the picture, and a
  `<figcaption>` when there is a caption. The link `href` goes through `emdash`'s
  `sanitizeHref`; `blank` links that are not `#` anchors get `target="_blank"` and
  `rel="noopener noreferrer"`. `title` goes to the `<img>`. The layout is `constrained`, as in
  EmDash.
- **Unstyled.** The component ships no CSS. The site styles the alignment classes and the
  caption; `README.md` gives an example stylesheet with EmDash's rules.
- **Placeholder.** `Picture` and `PortableTextImage` take a `placeholder` prop, default `true`.
  With a `blurhash`, the `<img>` gets the inline style from `@unpic/placeholder`'s
  `blurhashToImageCssString`, imported only when a blurhash is present; otherwise, with a
  `dominantColor`, `background-color: <dominantColor>`. Each `Picture` variant uses its own
  media value's fields, so the dark variant gets its own placeholder. The placeholder style is
  merged with the focal point and the site's `style`. `placeholder={false}` renders no
  placeholder style.
- **Dependency.** `@unpic/placeholder` becomes a dependency of the package (`^0.1.2`).
- **Scope.** The `image` block only. `gallery` and `cover` stay on EmDash's components; they are
  a later roadmap item.
- **Release.** The new export, the new `placeholder` prop and the placeholder now on by default
  in `Picture` are a minor version before 1.0.0 (ADR-0003), with `CHANGELOG.md` entries under
  `## Unreleased`.

## Consequences

- Images inside rich text get AVIF and WebP sources, configured widths and, through a site
  wrapper, versioned URLs; warm-up finds them in the page HTML as it finds `Picture` output.
- `Picture` output changes by default: an image with a `blurhash` or `dominantColor` now has an
  inline background style. A site with a strict CSP passes `placeholder={false}`.
- The package owns a second markup contract, following EmDash's image block shape and class
  names; an `emdash` upgrade is checked against both components.
- A site that replaces EmDash's image block with this one loses EmDash's scoped alignment and
  caption CSS and must add its own; `README.md` says so next to the example stylesheet.
- The package gains a runtime dependency, which `package-lock.json` records.
- `README.md`, `SKILL.md`, `CHANGELOG.md` and `package.json` (export and dependency) change.

## Alternatives

- **No hash prop until the database ADR.** Simpler, but rich-text images would have no way to
  get versioned URLs, while `Picture` already has one; rejected.
- **The component reads `content_hash` from the database.** One query per image and a database
  dependency in rendering; this is ADR-0004's open question, left for the database and storage
  ADR.
- **Copy EmDash's CSS.** A drop-in replacement would keep the floats and the caption style, but
  it breaks ADR-0004's «Unstyled» rule and ADR-0002's rule that site styles stay in the site,
  and the copy would have to follow EmDash's changes; rejected by the owner.
- **Placeholder off by default.** Safe for a strict CSP, but differs from `emdash/ui` `Image`, so
  a site switching components would lose it silently; rejected by the owner.
- **`dominantColor` only, no dependency.** No new package, but a flat colour instead of the
  blurred preview EmDash gives; rejected by the owner.
- **`image`, `gallery` and `cover` at once.** More work in one step, likely two plans; deferred.
