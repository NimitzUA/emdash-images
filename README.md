# @nimitzua/emdash-images

Reusable server-side image pipeline for EmDash sites. It provides an Astro image service, the `/_image` request guard, the `pictureSources` URL contract, cache warm-up, and media backfill and cleanup helpers.

The package does not provide an Astro `<Picture>` component or site markup. Each site owns its media queries, private access rules, middleware composition, and deployment wrappers. It does not add settings to the EmDash admin or implement facadesystems’ custom image route.

## Supported versions

| Runtime | Supported version |
| --- | --- |
| EmDash | 1.3.x |
| Astro | 7.x |
| Node.js | 26.x or later |

The package is MIT licensed. The source repository is [nimitzua/emdash-images](https://git.srv1.parshyn.dev/nimitzua/emdash-images).

## Install from a git tag

Choose a release tag and install it in the EmDash site:

```sh
npm install git+https://git.srv1.parshyn.dev/nimitzua/emdash-images.git#v0.1.0
```

Installing the dependency does not activate the native plugin. Register its descriptor in `astro.config.mjs` and deploy the site.

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

The cache directory is resolved when the service runs: `IMAGE_CACHE_DIR`, then the configured `cacheDirectory`, then `.dev/image-cache`. The environment value is not captured into the site build.

Changing AVIF or WebP encoder settings changes `imageCacheSettings8` and therefore the cache namespace. Treat encoder changes as a cache migration: deploy the new settings, warm the new variants, then run cache cleanup.

## Astro configuration

Keep the options in one site module. Set the denied prefixes to match the site's own private storage keys and routes; the example names are placeholders.

`src/lib/image-options.mjs`:

```js
export const imageOptions = {
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
import { imageOptions } from "./src/lib/image-options.mjs";

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

The middleware guard is a wrapper around the site's private-access middleware. The order is site localization, image guard, then private access. `onDeniedStorageKey` must return the site's private 404 response so private image URLs keep the site's private response headers.

`src/lib/outer-middleware.mjs`:

```js
import { withImageGuard } from "@nimitzua/emdash-images";
import { imageOptions } from "./image-options.mjs";
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

## `pictureSources` and site markup

`pictureSources()` returns unversioned URLs when a content hash is missing. It returns `undefined` only when the source cannot be transformed. The package does not render the `<picture>` element.

Astro's `data-image-component` development marker belongs to the site component. A site `Picture` component that builds `<picture>` by hand must forward `image.layout`, scoped-style attributes, and any other image attributes it uses.

## Backfill, warm-up, and cleanup

The package exports the maintenance functions; the site owns their database, storage, and command wrappers. In a site with the existing wrappers, run these commands from its root:

```sh
npm run backfill-media-hashes
npm run backfill-media-hashes -- --write
npm run warm-cache
```

The backfill is a dry run unless `--write` is present. Run warm-up again after the first successful run; it should report `Generated: 0` when the variants are already cached.

The current site has no cleanup npm script. Its existing cleanup entry point is:

```sh
IMAGE_CACHE_DIR=/path/to/image-cache node --env-file-if-exists=.env scripts/deploy/cleanup-image-cache.mjs
IMAGE_CACHE_DIR=/path/to/image-cache node --env-file-if-exists=.env scripts/deploy/cleanup-image-cache.mjs --delete
```

Review the dry-run report before adding `--delete`.

## Docker runtime image

For a workspace `file:` dependency, copying only `node_modules` leaves the package link pointing to files that are absent from the runtime image. Copy the package manifest, license, and source tree as well:

```dockerfile
COPY packages/emdash-images/package.json packages/emdash-images/LICENSE ./packages/emdash-images/
COPY packages/emdash-images/src/ ./packages/emdash-images/src/
```

## Package exports

The root export contains descriptors and helpers. `./service` is the Astro image service, `./plugin` is the native plugin entry point, `./warmup` contains warm-up functions, `./maintenance` contains backfill and cleanup functions, and `./layout` exposes cache-layout helpers.
