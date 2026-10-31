# 0004 Picture component

**Status:** accepted · **Date:** 2026-10-31

## Context

ADR-0002 (accepted 2026-10-28, kept in the source site's repository) gave the package the
server side of the image pipeline and left all markup to the sites: "The package does not ship
markup, private cases, or the custom route used by facadesystems" (`CONTEXT.md`, «Dated
decisions»). `README.md` repeats it: the package "does not provide an Astro `<Picture>`
component or site markup" and "does not render the `<picture>` element".

The package delivers AVIF and WebP as explicit formats: every URL names its format (`f=avif`,
`f=webp`), and the browser picks one from a `<picture>` element with one `<source>` per format.
So the format choice needs that markup, and today every site writes it by hand around
`pictureSources()`. Each one has to get the same details right: resolving the media URL,
passing a content hash, forwarding `image.layout`, scoped-style attributes and other image
attributes (`README.md` «`pictureSources` and site markup»), and passing `pictureSources()`
the same widths as the image service. The last one fails silently: `pictureSources()` takes
`publicWidths` and `smallWidths` from its own `options` and falls back to the package
defaults, while the service and the `/_image` guard read the configured widths from
`imageConfig.service.config`. A site that changes its widths but does not pass them to
`pictureSources()` gets `srcset` entries the guard answers with 404.

The scope decision of 2026-10-30 means the component cannot be designed from any site's
markup; it is designed from the package's API and EmDash's documented media value.

Facts from the installed dependencies (`emdash` 1.3, `astro` 7):

- EmDash ships its own `Image` (`emdash/ui`, `src/components/EmDashImage.astro`). It renders one
  `<img>` or Astro `<Image layout="constrained">`, a dark variant as a second image with the
  classes `emdash-image--light` / `emdash-image--dark` and a global CSS rule keyed on a
  `dark`/`light` class on `<html>` and `prefers-color-scheme`, the focal point as
  `object-position`, and an LQIP placeholder. It renders no AVIF and WebP `<source>` elements
  and no hash-versioned URLs. Portable Text image blocks are rendered by a separate EmDash
  component (`PTImage`), which a site can replace through `PortableText`'s `components` prop.
- An image field's value is EmDash's `MediaValue` (`id`, `provider`, `src?`, `width?`,
  `height?`, `alt?`, `focalX?`, `focalY?`, `blurhash?`, `dominantColor?`, `meta.storageKey?`,
  and `darkVariant` in the same shape). It carries **no content hash**; the hash lives only in
  the `media` table row.
- EmDash resolves a local media URL with `buildRenderMediaUrl`, which is marked `@internal`
  and is not a public export. The public part is `Astro.locals.emdash.getPublicMediaUrl(key)`.
- The package's image service versions and transforms only `/_emdash/api/media/file/<key>`
  sources (`src/service.mjs`, `mediaFileSource`). The guard already reads `imageConfig` from
  `astro:assets` (`src/guard.mjs`), so other package code can read the configured widths the
  same way.

The owner decided on 2026-10-31 to ship the component, with the inputs, hash source, scope and
release below.

## Decision

- **Explicit formats stay.** AVIF and WebP keep their own URLs and reach the browser through
  `<picture>` and `<source>` elements. The `/_image` endpoint does not negotiate the format
  from the `Accept` header.
- **The package ships the markup for image fields.** It exports
  `@nimitzua/emdash-images/Picture.astro` (file `src/Picture.astro`), the recommended way to
  render an EmDash image field on a site that uses this package, in place of `emdash/ui`
  `Image`. It covers what `emdash/ui` `Image` does for image fields except the placeholder (see
  the last item), so a site does not need both. This replaces ADR-0002's "no markup" rule for
  this component and its follow-ups only; the rest of ADR-0002 stands: private-access rules,
  site routes, site styles and EmDash admin settings stay out of the package.
- **`pictureSources()` stays public** for markup the component does not produce, such as art
  direction with media queries. When its caller passes no `publicWidths`, `smallWidths` or
  `getImage`, it reads them from `astro:assets` (`imageConfig.service.config` and `getImage`)
  instead of the package defaults, so its widths always match the service and the guard.
- **Input.** `image` takes an EmDash media value. `src`, `width`, `height` and `alt` props
  override the value's fields, and `src` with `width` and `height` works without `image`. The
  source URL is, in order: the `src` prop, `image.src`,
  `Astro.locals.emdash.getPublicMediaUrl(image.meta.storageKey)`, then
  `/_emdash/api/media/file/<image.id>`. The component imports nothing marked `@internal` from
  `emdash`.
- **Content hash from the site.** The component takes `contentHash` (and `darkContentHash` for
  the dark variant) as props and never queries the database. Without a hash the URLs are
  unversioned, as `pictureSources()` already does. The site may load the hashes for a whole
  page in one query.
- **Output.** A `<picture>` with an AVIF and a WebP `<source>` from `pictureSources()` and an
  `<img>` with the WebP `src`, `width`, `height` and `alt`. `sizes`, `loading` (default
  `lazy`), `decoding` (`async`), `priority` (`eager` and `fetchpriority="high"`), `class`,
  `style` and every other attribute, including Astro's scoped-style `data-astro-cid-*`, go to
  the `<img>`. A `pictureAttributes` prop, as on Astro's own `<Picture>`, carries attributes
  for the `<picture>` element.
- **Fallback.** When `pictureSources()` returns `undefined` (no usable dimensions, an external
  provider, a source the service does not transform), the component renders one plain `<img>`
  with the resolved URL and the same attributes. It renders nothing when no URL resolves.
- **Astro `layout`.** A `layout` prop (`constrained`, `full-width`, `fixed`, `none`) defaults
  to the site's `image.layout`. The layout attributes on the `<img>` (`data-astro-image`, and
  the `sizes` default when `sizes` is not given) come from what Astro's own `getImage()` returns
  for that layout, not from hand-written copies of Astro internals.
- **Dark variant.** With `image.darkVariant` or a `darkVariant` prop, the component renders a
  second `<picture>` for it, with the class names EmDash uses (`emdash-image--light`,
  `emdash-image--dark`), an `id` suffixed `--dark`, and the primary image's `alt`, `sizes` and
  loading attributes. It ships the one global rule that hides the variant not matching the
  scheme, keyed on the same `<html>` class convention and `prefers-color-scheme` as EmDash.
- **Focal point.** `focalX` and `focalY` of each media value become `object-position: X% Y%`
  on that variant's `<img>`, merged with any `style` the site passes.
- **Unstyled.** Apart from the dark-variant rule the component ships no CSS.
- **Access stays server-side.** The component decides no access. The image service and the
  `/_image` guard remain the only enforcement of `deniedStorageKeyPrefixes` and
  `deniedPagePathPrefixes`.
- **Release.** The new export and the `pictureSources()` defaults are a minor version before
  1.0.0 (ADR-0003). Both ship in 0.2.0, which is not yet published; their `CHANGELOG.md`
  entries go under `## Unreleased`.
- **Next, in a later plan.** A Portable Text image block component on the same code, so images
  inside rich text take the same path as image fields, and the LQIP placeholder (`blurhash`,
  `dominantColor`), which `emdash/ui` `Image` renders and this component does not yet.

## Open question

The content hash depends on the site passing it. A lookup without the site's help (the
component or the service reading `content_hash` per image) would make versioned URLs a
server-side guarantee, but costs one database query per image (N+1 on a list page) and a
database dependency in rendering. Revisit it with roadmap item 4, which already has to replace
the package's direct reads of EmDash's `media` table.

## Consequences

- Sites render image fields with one component and get AVIF and WebP, hash-versioned URLs,
  layout, dark variant and focal point; a site that needs art direction keeps its own markup on
  `pictureSources()`, which now gets the configured widths on its own.
- The package owns a markup contract. The component's props are public API under ADR-0003, and
  it follows EmDash's `MediaValue` shape and Astro's layout attributes; an upgrade of either
  peer dependency is checked against the component.
- `pictureSources()` with no widths and a site whose widths differ from the defaults now
  produces the configured widths instead of the defaults. A site that relied on the defaults
  while configuring other widths was already getting 404s for them.
- Until the Portable Text component lands, images inside rich text still go through EmDash's
  own component, without AVIF sources or versioned URLs.
- The component's logic (URL resolution, attribute and style building) lives in plain `.mjs`
  modules that `node --test` covers; the `.astro` file stays a thin template over them, and the
  plan adds a check that it compiles and renders.
- `README.md` (the opening paragraph and «`pictureSources` and site markup»), `SKILL.md`,
  `CHANGELOG.md` and `package.json` (the export) change with it.
- Publishing 0.2.0 waits for the component plan.

## Alternatives

- **Negotiate the format from `Accept`.** `/_image` would serve AVIF or WebP to the same URL
  with `Vary: Accept`, so any `<img>`, including `emdash/ui` `Image` and Portable Text images,
  would get AVIF with no markup. Rejected: `Vary: Accept` lowers CDN hit rates and some CDNs
  ignore it and can serve AVIF to a browser without support, warm-up would have to request both
  formats per URL, and it breaks Astro's URL contract, in which `f` names the format.
- **Keep ADR-0002 as it is.** No component, at most a reference example in the README. Rejected:
  every site repeats the same markup and its pitfalls.
- **A helper that returns attributes, with no markup.** Keeps ADR-0002 intact, but the site
  still writes the `<picture>`, the dark variant and the layout handling.
- **A minimal component without layout, dark variant and focal point.** Rejected: a site would
  still need `emdash/ui` `Image` for the fields that use them, and two render paths mean two
  sets of URLs, caching and warm-up.
- **The component reads `content_hash` from the database.** See the open question.
- **The dark variant as a `<source media="(prefers-color-scheme: dark)">`.** One download per
  visitor, but it ignores the `<html>` class that EmDash sites use to pin the scheme. Rejected
  to stay consistent with `emdash/ui` `Image`.
- **Delegate external providers to `emdash/ui` `Image`.** Would give provider-built `srcset`,
  but mixes two components' markup and classes in one output. Not in this version; external
  providers get the plain `<img>` fallback.
