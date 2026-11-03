# @nimitzua/emdash-images

Reusable server-side image pipeline for EmDash sites. It provides an Astro image service, the `/_image` request guard, the `pictureSources` URL contract, an optional `Picture.astro` component for EmDash image fields, a `PortableTextImage.astro` component for Portable Text image blocks, a `PortableTextGallery.astro` component for Portable Text gallery blocks, cache warm-up, and media backfill and cleanup helpers.

The package ships three optional components: `Picture.astro` for EmDash image fields, `PortableTextImage.astro` for Portable Text image blocks, and `PortableTextGallery.astro` for Portable Text gallery blocks. Each site still owns art direction, private access rules, middleware composition, and deployment wrappers. It does not add settings to the EmDash admin.

## Supported versions

| Runtime | Supported version |
| --- | --- |
| EmDash | 1.3.x |
| Astro | 7.x |
| Node.js | 26.x or later |

The package is MIT licensed. The source repository is [NimitzUA/emdash-images](https://github.com/NimitzUA/emdash-images).

## Install

Install the package from npm:

```sh
npm install @nimitzua/emdash-images
```

Installing the dependency does not activate the native plugin. Register its descriptor in `astro.config.mjs` and deploy the site.

Before 1.0.0, features and breaking changes increment the minor version and fixes increment the patch version; see the [changelog](./CHANGELOG.md).

## Options

Pass one options object to `imageService()` and pass its private-prefix lists to `emdashImages()` and the site middleware.

| Option | Default | Used for |
| --- | --- | --- |
| `publicWidths` | `[640, 1080, 1600, 1920, 2400]` | Allowed public image widths. |
| `smallWidths` | `[320, 480]` | Additional small public widths. |
| `privateWidths` | `[640, 960, 1600, 1920, 2560]` | Site-owned private image route. |
| `encoder.avif` | `{ quality: 55, effort: 4, chromaSubsampling: "4:4:4" }` | AVIF output settings. |
| `encoder.webp` | `{ quality: 75, effort: 4, smartSubsample: true }` | WebP output settings. |
| `cacheDirectory` | Unset; runtime fallback is `.dev/image-cache` | Disk cache path. |
| `encodeLimit` | `2` | Maximum concurrent Sharp encodes in the process. |
| `deniedStorageKeyPrefixes` | `[]` | Storage-key prefixes excluded from public transforms and warm-up. Values are storage keys, such as `restricted/`, not media URLs. |
| `deniedPagePathPrefixes` | `[]` | Page-path prefixes excluded from warm-up, such as `/members`. |

The image service resolves its cache directory at request time: `IMAGE_CACHE_DIR`, then the configured `cacheDirectory`, then `.dev/image-cache`. The environment value is not captured into the site build. CLI `warm` and `cleanup` use `IMAGE_CACHE_DIR` from the process environment or `--env-file` before the configured `cacheDirectory`; relative paths resolve against the current working directory. When neither is set, `warm` falls back to `.dev/image-cache` in the current working directory, while `cleanup` stops with `IMAGE_CACHE_DIR must be set to an existing directory.`

Changing AVIF or WebP encoder settings changes `imageCacheSettings8` and therefore the cache namespace. Treat encoder changes as a cache migration: deploy the new settings, warm the new variants, then run cache cleanup.

## Astro configuration

Keep the options in one site module. Set the denied prefixes to match the site's own private storage keys and routes; the example names are placeholders.

`src/lib/image-options.mjs`:

```js
export default {
	deniedStorageKeyPrefixes: ["restricted/"],
	deniedPagePathPrefixes: ["/members"],
};
```

The following is a complete Node-hosted EmDash configuration showing the package registration. Keep the site's database, storage, adapter, and other integrations appropriate to that site.

`astro.config.mjs`:

```js
import node from "@astrojs/node";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { postgres } from "emdash/db";
import { emdashImages, imageService } from "@nimitzua/emdash-images";
import imageOptions from "./src/lib/image-options.mjs";

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	integrations: [
		emdash({
			database: postgres({ connectionString: process.env.DATABASE_URL }),
			storage: local({
				directory: "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
			plugins: [
				emdashImages({
					deniedStorageKeyPrefixes: imageOptions.deniedStorageKeyPrefixes,
					deniedPagePathPrefixes: imageOptions.deniedPagePathPrefixes,
				}),
			],
			middleware: { outer: "./src/lib/outer-middleware.mjs" },
		}),
	],
	image: {
		remotePatterns: [{ pathname: "/_emdash/api/media/file/**" }],
		service: imageService(imageOptions),
	},
});
```

The default-exported options module can also be passed directly to the package CLI with `--config`.

The middleware guard is a wrapper around the site's private-access middleware. The order is site localization, image guard, then private access. `onDeniedStorageKey` must return the site's private 404 response so private image URLs keep the site's private response headers.

`src/lib/outer-middleware.mjs`:

```js
import { withImageGuard } from "@nimitzua/emdash-images";
import imageOptions from "./image-options.mjs";
import { onRequest as privateAccessOnRequest, privateNotFound } from "./private-access-middleware.mjs";

const imageGuard = withImageGuard(privateAccessOnRequest, {
	deniedStorageKeyPrefixes: imageOptions.deniedStorageKeyPrefixes,
	onDeniedStorageKey: () => privateNotFound(),
});

// If the site uses schema localization, wrap imageGuard with it here.
export const onRequest = imageGuard;
```

For successful content publishes and media replacements, the site middleware should call `scheduleImageWarmup()` with both prefix lists from `imageOptions`. The native plugin independently schedules it after `content:afterPublish`.

The native plugin declares the `content:read` capability and uses only the `content:afterPublish` hook. It schedules a debounced warm-up; the hook does not add site-specific settings.

## Native trust boundary

This is a native plugin package and runs in the same process as the EmDash site. Its code has the authority available to that process, including filesystem access, environment variables, and direct network calls. The declared `content:read` capability gates EmDash plugin APIs; it is not a sandbox for native code. Install and review it as a trusted site dependency. See EmDash’s “Distributing native plugins” guide.

## `Picture` component

Import `Picture.astro` to render an EmDash image field:

```astro
---
import { loadContentHashes } from "@nimitzua/emdash-images";
import Picture from "@nimitzua/emdash-images/Picture.astro";
const contentHashes = await loadContentHashes(Astro.locals.emdash, [entry.data.featured_image?.id]);
---

<Picture
	image={entry.data.featured_image}
	contentHash={contentHashes.get(entry.data.featured_image?.id)}
	sizes="(min-width: 60rem) 50vw, 100vw"
/>
```

`Picture` accepts an EmDash media value or a URL string. `src`, `width`, `height`, and `alt` can override the image value; a direct `src` can also be used with dimensions and no `image`.

| Prop | Description |
| --- | --- |
| `image` | EmDash media value, URL string, or `null`. |
| `darkVariant` | Alternate dark image value or URL; defaults to `image.darkVariant`. |
| `src` | Source URL override. |
| `width` | Width override in pixels; image dimensions are used by default. |
| `height` | Height override in pixels; image dimensions are used by default. |
| `alt` | Alternative text override; defaults to the image value's `alt`, then an empty string. |
| `contentHash` | The primary media row's `content_hash`, used to version generated URLs. |
| `darkContentHash` | The dark variant's `content_hash`, used to version its generated URLs. |
| `srcsetWidths` | Additional responsive width candidates, subject to the configured public and small widths. |
| `layout` | `"none"`, `"constrained"`, `"fixed"`, or `"full-width"`; defaults to Astro's `image.layout`. |
| `fit` | Sets CSS `object-fit` through Astro's layout attributes when `layout` is not `"none"`; generated URLs carry `fit=cover` whenever a fit is set, and no `fit` otherwise. |
| `position` | Sets CSS `object-position` through Astro's layout attributes when `layout` is not `"none"`; generated URLs never include `position`. |
| `priority` | Load eagerly and request high fetch priority. |
| `pictureAttributes` | Attributes to apply to the wrapping `<picture>`. |
| `placeholder` | LQIP placeholder from `blurhash`, else a hex, `rgb()` or `rgba()` `dominantColor` (other values are ignored), as an inline background; defaults to `true`; pass `false` for a strict Content Security Policy. |

Standard `<img>` attributes such as `sizes`, `loading`, `decoding`, `class`, `style`, and `id` pass through to the `<img>`. The component does not query for `content_hash`: call `loadContentHashes` once per page with its media IDs and pass each matching value as `contentHash` (and `darkContentHash` for a dark variant). It returns only `ready` rows with a hash, runs one query per 500 IDs, and returns an empty map when there is no database. Without a valid hash, generated URLs are unversioned.

When an EmDash image is resolved by its media ID, Astro must allow its path in `image.remotePatterns`, for example `{ pathname: "/_emdash/api/media/file/**" }`. External providers and other sources Astro cannot transform render a plain `<img>` with the resolved URL.

When a dark variant resolves, the component renders the primary and dark variants and applies `emdash-image--light` and `emdash-image--dark` classes to their `<img>` elements. A `dark` or `light` class on `<html>` overrides the system `prefers-color-scheme`; without either class, the component follows that preference. A placeholder is rendered inline by default when the image has a `blurhash` or valid `dominantColor`; pass `placeholder={false}` for a strict Content Security Policy.

### Custom markup with `pictureSources`

Use `pictureSources()` when site markup needs art direction or output beyond this component. When omitted, `getImage` and `imageConfig` come from `astro:assets`; `publicWidths` and `smallWidths` come from its service configuration (or package defaults if Astro has no configured values). Its input `attributes` are forwarded to image transforms, and the returned `attributes` are the generated image attributes. A hand-built component must forward scoped-style attributes, along with `image.layout` and any other image attributes it uses.

## Portable Text images

Use `PortableTextImage.astro` and `PortableTextGallery.astro` to replace EmDash's Portable Text `image` and `gallery` blocks while keeping the other default block renderers:

```astro
---
import { PortableText } from "emdash/ui";
import PortableTextImage from "@nimitzua/emdash-images/PortableTextImage.astro";
import PortableTextGallery from "@nimitzua/emdash-images/PortableTextGallery.astro";
---

<PortableText
	value={entry.data.body}
	components={{ type: { image: PortableTextImage, gallery: PortableTextGallery } }}
/>
```

`PortableText` gives the block component `node`, `index`, and `isInline`, so it cannot pass `contentHash` directly. Call `loadContentHashes` once for the page with the media IDs from its Portable Text value: `node.asset._ref` for each `image` block and `images[].asset._ref` for each `gallery` block. Expose the resulting map to the site wrappers, for example through `Astro.locals`, then pass the matching hash to `PortableTextImage`. For example, if site middleware or page data setup places that map in `Astro.locals.imageHashes`, the wrapper can do this:

```astro
---
import PortableTextImage from "@nimitzua/emdash-images/PortableTextImage.astro";
const ref = Astro.props.node?.asset?._ref;
const contentHash = ref ? Astro.locals.imageHashes?.get(ref) : undefined;
---

<PortableTextImage {...Astro.props} contentHash={contentHash} />
```

Without a valid `contentHash`, the generated URLs are unversioned. The component renders a `<figure class="emdash-image emdash-image--align-<alignment>">` when an alignment is set, an optional link whose `href` is passed through EmDash's `sanitizeHref`, the image, and an optional `<figcaption>`. A link with `blank: true` opens in a new tab with `rel="noopener noreferrer"`, except a same-page `#` link, which gets no `target`. `displayWidth` and `displayHeight` set the image's display dimensions, and the image uses the `constrained` layout. The `placeholder` prop works as on `Picture`: default `true`, `false` for a strict Content Security Policy.

`PortableTextGallery` accepts `contentHashes` as a `Map` or plain object from media ID to `content_hash`. A plain object is read by own keys only. Pass the page-level hash map through a site wrapper as `contentHashes`, for example when site middleware or page data setup exposes it as `Astro.locals.imageHashes`:

```astro
---
import PortableTextGallery from "@nimitzua/emdash-images/PortableTextGallery.astro";
const contentHashes = Astro.locals.imageHashes;
---

<PortableTextGallery {...Astro.props} contentHashes={contentHashes} />
```

The gallery uses `node.columns` when it is a positive integer and defaults to `3` otherwise. Its `sizes` default is `(max-width: 640px) calc((100vw - 1rem) / 2), calc((100vw - 2rem) / 3)` with three columns; the desktop slot adjusts to the column count, and one column uses `100vw`. Pass the `sizes` prop to override that value. The `placeholder` prop works as on `Picture`: default `true`, `false` for a strict Content Security Policy; the placeholder background is applied to each rendered `<img>`.

The component renders a `<div class="emdash-gallery" style="--columns: …">` containing one `<figure class="emdash-gallery-item">` per rendered image and a `<figcaption>` when the image has a caption. It ships no CSS. Add these rules to the site's global stylesheet; they copy EmDash's gallery rules from `node_modules/emdash/src/components/Gallery.astro`:

```css
.emdash-gallery {
	display: grid;
	grid-template-columns: repeat(var(--columns, 3), 1fr);
	gap: 1rem;
	margin: 1.5rem 0;
}
.emdash-gallery-item {
	margin: 0;
}
.emdash-gallery-item img {
	width: 100%;
	height: auto;
	object-fit: cover;
	aspect-ratio: 1;
}
.emdash-gallery-item figcaption {
	font-size: 0.75rem;
	color: var(--emdash-caption-color, var(--color-muted, #666));
	margin-top: 0.25rem;
	text-align: center;
}
@media (max-width: 640px) {
	.emdash-gallery {
		grid-template-columns: repeat(2, 1fr);
	}
}
```

The component ships no CSS. A site replacing EmDash's image block must style the alignment classes and caption itself. This global stylesheet copies EmDash's rules from `node_modules/emdash/src/components/Image.astro`:

```css
.emdash-image {
	margin: 1.5rem 0;
}
.emdash-image img {
	max-width: 100%;
	height: auto;
}
.emdash-image figcaption {
	font-size: 0.875rem;
	color: var(--emdash-caption-color, var(--color-muted, #666));
	margin-top: 0.5rem;
	text-align: center;
}
.emdash-image--align-left,
.emdash-image--align-right {
	width: fit-content;
	max-width: 50%;
}
.emdash-image--align-left {
	float: left;
	margin: 0 1.5rem 1rem 0;
}
.emdash-image--align-right {
	float: right;
	margin: 0 0 1rem 1.5rem;
}
.emdash-image--align-center {
	width: fit-content;
	margin-inline: auto;
}
.emdash-image--align-wide,
.emdash-image--align-full {
	width: 100%;
}
@media (max-width: 640px) {
	.emdash-image--align-left,
	.emdash-image--align-right {
		float: none;
		width: 100%;
		max-width: 100%;
		margin-inline: 0;
	}
}
```

`PortableTextImage` replaces the `image` block, and `PortableTextGallery` can replace the `gallery` block. The `cover` block still uses EmDash's component because its image has no dimensions to transform.

## Command line

The package CLI supports these commands and options:

```sh
emdash-images <command> [options]

Commands:
  backfill [--write]
  cleanup [--delete]
  warm [--origin <url>] [--public-origin <url>]

Global options:
  --config <path>
  --env-file <path>
  -h, --help
```

Use `--config` with the same default-exported options module used by `astro.config.mjs`:

```sh
npx emdash-images backfill --config ./src/lib/image-options.mjs
npx emdash-images backfill --config ./src/lib/image-options.mjs --write
npx emdash-images cleanup --config ./src/lib/image-options.mjs
npx emdash-images cleanup --config ./src/lib/image-options.mjs --delete
npx emdash-images warm --config ./src/lib/image-options.mjs
npx emdash-images warm --config ./src/lib/image-options.mjs --origin https://example.com
```

Backfill and cleanup default to dry runs; `--write` applies backfill metadata and `--delete` removes eligible cache files. Review each dry-run report before applying changes. Run warm-up again after its first successful run; it should report `Generated: 0` when the variants are already cached. Add `--env-file ./.env` to a command to load environment values from a file; existing process environment values take precedence over values in that file.

Backfill and cleanup work with SQLite and PostgreSQL. The connection comes from `DATABASE_URL`, then `EMDASH_DATABASE_URL`, then `PGHOST`, `PGPORT` (default `5432`), `PGDATABASE`, `PGUSER`, and optional `PGPASSWORD`. A `file:` URL selects SQLite; its path is resolved against the current working directory (for example, `DATABASE_URL=file:./data/emdash.db`, the path from EmDash's `sqlite({ url })`), and the file must exist. A `postgres:` or `postgresql:` URL, or the `PG*` variables, selects PostgreSQL, which needs `pg` (EmDash installs it as an optional dependency). LibSQL, D1, and Hyperdrive are not supported. Backfill reads originals from the local `UPLOADS_DIR` only (default `uploads`); S3 and R2 storage are not supported.

Cleanup uses `IMAGE_CACHE_DIR` from the process environment or `--env-file`, then `cacheDirectory` from the config, with relative paths resolved against the current working directory. It refuses when neither is set. Warm uses the same order and then falls back to `.dev/image-cache`. Backfill resolves `UPLOADS_DIR` against the current working directory (default `uploads`). Without `--origin`, warm reads a valid `PORT` or `SITE_PORT` for its local request origin and uses `EMDASH_SITE_URL` as the public origin when set (otherwise it uses the local origin); these URL settings can come from `--env-file`. With `--origin`, that URL is the request origin; `--public-origin` requires `--origin` and can set a different public origin. Both options must be absolute `http:` or `https:` URLs; invalid URLs exit with code `2`.

The CLI exits with code `0` on success, `1` on an operational error or warm-up failures, `2` on invalid command-line usage, and `3` when backfill reports failed rows.

## Docker runtime image

The runtime image needs the installed package in its `node_modules` tree. Set `IMAGE_CACHE_DIR` in the runtime environment to the cache directory the image service should use.

## Package exports

The root export contains descriptors and helpers, including `loadContentHashes(emdash, ids)`. `./Picture.astro` renders EmDash image fields, `./PortableTextImage.astro` renders Portable Text image blocks, and `./PortableTextGallery.astro` renders Portable Text gallery blocks. `./service` is the Astro image service, `./plugin` is the native plugin entry point, `./warmup` contains warm-up functions, `./maintenance` contains backfill and cleanup functions, and `./layout` exposes cache-layout helpers. `backfillMediaRows` and `cleanupImageCache` from `./maintenance` take a `database` option, an open Kysely instance; if omitted, they open and close a connection using `env` as the CLI does, and they no longer accept `pool`.
