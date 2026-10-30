# @nimitzua/emdash-images

Reusable server-side image pipeline for EmDash sites. It provides an Astro image service, the `/_image` request guard, the `pictureSources` URL contract, cache warm-up, and media backfill and cleanup helpers.

The package does not provide an Astro `<Picture>` component or site markup. Each site owns its media queries, private access rules, middleware composition, and deployment wrappers. It does not add settings to the EmDash admin.

## Supported versions

| Runtime | Supported version |
| --- | --- |
| EmDash | 1.3.x |
| Astro | 7.x |
| Node.js | 26.x or later |

The package is MIT licensed. The source repository is [nimitzua/emdash-images](https://git.srv1.parshyn.dev/nimitzua/emdash-images).

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

The image service resolves its cache directory at request time: `IMAGE_CACHE_DIR`, then the configured `cacheDirectory`, then `.dev/image-cache`. The environment value is not captured into the site build. CLI `warm` and `cleanup` use `IMAGE_CACHE_DIR` from the process environment or `--env-file` before the configured `cacheDirectory`; relative paths resolve against the current working directory.

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

## `pictureSources` and site markup

`pictureSources()` returns unversioned URLs when a content hash is missing. It returns `undefined` only when the source cannot be transformed. The package does not render the `<picture>` element.

Astro's `data-image-component` development marker belongs to the site component. A site `Picture` component that builds `<picture>` by hand must forward `image.layout`, scoped-style attributes, and any other image attributes it uses.

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

Backfill and cleanup connect to PostgreSQL using `DATABASE_URL` or `EMDASH_DATABASE_URL`; otherwise they use `PGHOST`, `PGPORT` (default `5432`), `PGDATABASE`, `PGUSER`, and optional `PGPASSWORD`. Maintenance supports PostgreSQL only; backfill reads original media from a local uploads directory only, set with `UPLOADS_DIR` (default `uploads`).

Cleanup uses `IMAGE_CACHE_DIR` from the process environment or `--env-file`, then `cacheDirectory` from the config, with relative paths resolved against the current working directory. It refuses when neither is set. Warm uses the same order and then falls back to `.dev/image-cache`. Backfill resolves `UPLOADS_DIR` against the current working directory (default `uploads`). Without `--origin`, warm reads a valid `PORT` or `SITE_PORT` for its local request origin and uses `EMDASH_SITE_URL` as the public origin when set (otherwise it uses the local origin); these URL settings can come from `--env-file`. With `--origin`, that URL is the request origin; `--public-origin` requires `--origin` and can set a different public origin. Both options must be absolute `http:` or `https:` URLs; invalid URLs exit with code `2`.

The CLI exits with code `0` on success, `1` on an operational error or warm-up failures, `2` on invalid command-line usage, and `3` when backfill reports failed rows.

## Docker runtime image

The runtime image needs the installed package in its `node_modules` tree. Set `IMAGE_CACHE_DIR` in the runtime environment to the cache directory the image service should use.

## Package exports

The root export contains descriptors and helpers. `./service` is the Astro image service, `./plugin` is the native plugin entry point, `./warmup` contains warm-up functions, `./maintenance` contains backfill and cleanup functions, and `./layout` exposes cache-layout helpers.
