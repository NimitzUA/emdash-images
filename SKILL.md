# Add `@nimitzua/emdash-images` to an EmDash site

Use this when wiring the package into an EmDash site. The package is a trusted native dependency, not a sandboxed registry plugin or an Astro integration.

## Steps

1. **Install a tag.** Use the tag selected by the site. Check that the site uses EmDash 1.3, Astro 7, and Node 26 or later. The package needs its `astro`, `emdash`, and `sharp` peer dependencies; `pg` is installed as a package dependency.

2. **Keep site options in one module.** Create or update `src/lib/image-options.mjs`. Set `deniedStorageKeyPrefixes` to storage-key prefixes (for example, `private-cases/`) and `deniedPagePathPrefixes` to private page paths (for example, `/private`). They are separate settings. The package defaults both lists to empty.

3. **Register both package entry points in `astro.config.mjs`.** Set `image.service` to `imageService(imageOptions)`. Add `emdashImages({ deniedStorageKeyPrefixes, deniedPagePathPrefixes })` to EmDash's `plugins` list, passing both lists from `imageOptions`. The native plugin has the `content:read` capability and one hook, `content:afterPublish`; it schedules warm-up after publication. Do not add admin settings for these options.

4. **Compose the middleware in order.** Keep the site middleware chain as:

   ```text
   site localization → withImageGuard → site private-access middleware
   ```

   `withImageGuard` wraps the site's private-access handler. Pass its storage-key list and set `onDeniedStorageKey` to the site's private 404 response. Point EmDash's `middleware.outer` at that composed module. The package does not install the guard automatically.

5. **Pass the same lists to scheduled warm-up.** Manual publish and media-replacement call sites should call `scheduleImageWarmup({ deniedStorageKeyPrefixes, deniedPagePathPrefixes })` using values from `imageOptions`. The deploy warm-up entry point should pass those lists to `warmPublicSite()` too.

6. **Make the package available in the runtime image.** For this repository's workspace `file:` dependency, copying only `node_modules` leaves a dangling link; copy `packages/emdash-images/package.json`, `LICENSE`, and `src/` into the runtime image. With a git-tag install, make sure the npm-installed package contents are present in the runtime `node_modules` tree.

7. **Backfill, then warm twice.** Run the site's backfill in dry-run mode, review it, then add `--write` to fill missing media metadata. Run the site's warm-up command twice. The first run may generate variants; the second should report `Generated: 0` and no failures. See the README for the command names used by this repository.

8. **Review cache cleanup before deleting.** Run the cleanup entry point without `--delete`, inspect its report, then rerun with `--delete` when the candidates are expected. Encoder changes create a new cache namespace.

## Common mistakes

- **Reading the cache path at build time.** The running service resolves `IMAGE_CACHE_DIR` first, then `cacheDirectory` in Astro's service config, then `.dev/image-cache`. Set the environment value in the runtime environment; the build does not capture it.
- **Omitting the runtime package files.** A copied `node_modules` tree does not include the target of this workspace link. Copy the package manifest, license, and source tree; for a git-tag install, copy the installed `node_modules` contents.
- **Passing a route instead of a private-key prefix.** `deniedStorageKeyPrefixes` takes storage keys such as `private-cases/`, without the media URL prefix. Use `deniedPagePathPrefixes` for a page route such as `/private`.

## Package behavior to preserve

- `pictureSources()` creates unversioned URLs when a media row has no content hash; it returns `undefined` only when the source cannot be transformed.
- The package does not render `<picture>`. Astro's `data-image-component` development marker is site-owned. A hand-built site component must forward `image.layout`, scoped-style attributes, and other image attributes that it uses.
- A site that manually handles successful publish or media replacement should pass the same deny lists to the scheduler as the native plugin descriptor.
