# Add `@nimitzua/emdash-images` to an EmDash site

Use this when wiring the package into an EmDash site. The package is a trusted native dependency, not a sandboxed registry plugin or an Astro integration.

## Steps

1. **Install from npm.** Run `npm install @nimitzua/emdash-images`. Check that the site uses EmDash 1.3, Astro 7, and Node 26 or later. The package needs its `astro`, `emdash`, and `sharp` peer dependencies; `kysely` is a peer dependency shared with EmDash, and PostgreSQL maintenance uses `pg` from EmDash.

2. **Keep site options in one module.** Create or update `src/lib/image-options.mjs` with a default-exported options object. Set `deniedStorageKeyPrefixes` to storage-key prefixes (for example, `restricted/`) and `deniedPagePathPrefixes` to private page paths (for example, `/private`). They are separate settings. The package defaults both lists to empty. Import the same module as a default in `astro.config.mjs` and pass its path to CLI commands with `--config`.

3. **Register both package entry points in `astro.config.mjs`.** Set `image.service` to `imageService(imageOptions)`. Add `emdashImages({ deniedStorageKeyPrefixes, deniedPagePathPrefixes })` to EmDash's `plugins` list, passing both lists from `imageOptions`. The native plugin has the `content:read` capability and one hook, `content:afterPublish`; it schedules warm-up after publication. Do not add admin settings for these options.

4. **Compose the middleware in order.** Keep the site middleware chain as:

   ```text
   site localization → withImageGuard → site private-access middleware
   ```

   `withImageGuard` wraps the site's private-access handler. Pass its storage-key list and set `onDeniedStorageKey` to the site's private 404 response. Point EmDash's `middleware.outer` at that composed module. The package does not install the guard automatically.

5. **Render image fields with `Picture`.** Import `Picture` from `@nimitzua/emdash-images/Picture.astro` and pass an EmDash image value with its `contentHash`:

   ```astro
   ---
   import Picture from "@nimitzua/emdash-images/Picture.astro";
   ---

   <Picture image={entry.data.featured_image} contentHash={featuredImageContentHash} sizes="(min-width: 60rem) 50vw, 100vw" />
   ```

   The component does not query for the hash. Fetch `content_hash` for the page's media IDs in one site-owned query and pass the matching value; without it, generated URLs are unversioned. Astro's `image.remotePatterns` must allow `/_emdash/api/media/file/**` for EmDash media paths.

   For Portable Text, replace the `image` and `gallery` blocks on EmDash's `PortableText` with `PortableTextImage.astro` and `PortableTextGallery.astro`:

   ```astro
   ---
   import { PortableText } from "emdash/ui";
   import PortableTextImage from "@nimitzua/emdash-images/PortableTextImage.astro";
   import PortableTextGallery from "@nimitzua/emdash-images/PortableTextGallery.astro";
   ---

   <PortableText value={entry.data.body} components={{ type: { image: PortableTextImage, gallery: PortableTextGallery } }} />
   ```

6. **Pass the same lists to scheduled warm-up.** Manual publish and media-replacement call sites should call `scheduleImageWarmup({ deniedStorageKeyPrefixes, deniedPagePathPrefixes })` using values from `imageOptions`. Any code that manually starts a warm-up should pass those lists to `warmPublicSite()` too.

7. **Make the package available in the runtime image.** Ensure the installed package is present in the runtime image's `node_modules` tree. Set `IMAGE_CACHE_DIR` in the runtime environment to the image cache directory.

8. **Backfill, then warm twice.** Run `npx emdash-images backfill --config ./src/lib/image-options.mjs` in dry-run mode and review it, then add `--write` to fill missing media metadata. Backfill and cleanup read the database from `DATABASE_URL` (or `EMDASH_DATABASE_URL`), such as a SQLite `file:./data/emdash.db` URL run from the site's root, or from the `PG*` variables; these can come from the environment or `--env-file`. The site must be running, and the `warm` command's environment or `--env-file` must carry the same valid `PORT` or `SITE_PORT` the site listens on; otherwise pass `--origin`. Run `npx emdash-images warm --config ./src/lib/image-options.mjs` twice. The first run may generate variants; the second should report `Generated: 0` and no failures.

9. **Review cache cleanup before deleting.** Run `npx emdash-images cleanup --config ./src/lib/image-options.mjs`, inspect its dry-run report, then rerun with `--delete` when the candidates are expected. Encoder changes create a new cache namespace.

## Common mistakes

- **Reading the cache path at build time.** The running service resolves `IMAGE_CACHE_DIR` first, then `cacheDirectory` in Astro's service config, then `.dev/image-cache`. Set the environment value in the runtime environment; the build does not capture it.
- **Omitting the runtime package.** Ensure the installed package is present in the runtime `node_modules` tree.
- **Passing a route instead of a private-key prefix.** `deniedStorageKeyPrefixes` takes storage keys such as `restricted/`, without the media URL prefix. Use `deniedPagePathPrefixes` for a page route such as `/private`.

## Package behavior to preserve

- `pictureSources()` creates unversioned URLs when a media row has no content hash; it returns `undefined` only when the source cannot be transformed.
- `Picture.astro` renders image fields with the placeholder enabled by default; `PortableTextImage.astro` renders Portable Text `image` blocks; `PortableTextGallery.astro` renders Portable Text `gallery` blocks. `pictureSources()` reads configured widths from `astro:assets` when `publicWidths` or `smallWidths` are not passed. Astro's `data-image-component` development marker is site-owned. A hand-built site component must forward `image.layout`, scoped-style attributes, and other image attributes that it uses.
- A site that manually handles successful publish or media replacement should pass the same deny lists to the scheduler as the native plugin descriptor.
