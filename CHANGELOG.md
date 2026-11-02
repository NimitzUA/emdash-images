# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Before 1.0.0, breaking changes and new features increment the minor version; fixes increment the patch version.

## Unreleased

## [0.3.1] - 2026-11-02

### Fixed

- Package metadata (`repository`, `homepage`, `bugs`) and the README name the GitHub repository
  `NimitzUA/emdash-images`, matching the provenance npm checks. `0.3.0` was tagged but never
  published because npm rejected its provenance.

## [0.3.0] - 2026-11-02

### Added

- `PortableTextImage.astro` component (`@nimitzua/emdash-images/PortableTextImage.astro`) for EmDash's Portable Text `image` block: AVIF and WebP sources, configured widths, `contentHash`, alignment classes, link, caption and display size, with no CSS.
- `Picture` renders the LQIP placeholder from `blurhash` or `dominantColor` by default; `placeholder={false}` turns it off. New dependency `@unpic/placeholder`.

### Fixed

- `pictureSources()` treats a `null` `getImage` or `imageConfig` option as omitted and reads it from `astro:assets`; before, a `null` `getImage` threw and a `null` `imageConfig` used the package's default widths.
- The image service trims a configured `cacheDirectory`, as it already trims `IMAGE_CACHE_DIR` and as the CLI does, so a path with surrounding spaces resolves to the same directory everywhere.

## [0.2.0] - 2026-11-01

### Added

- `Picture.astro` component (`@nimitzua/emdash-images/Picture.astro`): AVIF and WebP sources with hash-versioned URLs, `layout`, dark variant, focal point and `pictureAttributes` for EmDash image fields.
- `pictureSources()` forwards `attributes` to `getImage` and returns the resulting image attributes.
- Add the `emdash-images` command for `backfill`, `cleanup` and `warm`, with `--config`, `--env-file` and documented exit codes.

### Changed

- Package metadata (`repository`, `homepage`, `bugs`) and the README point to the GitHub repository `nimitzua/emdash-images`.
- Namespace process-wide `globalThis` state by package name and align maintenance usage strings to `emdash-images`.
- `pictureSources()` reads its widths and `getImage` from `astro:assets` when the caller passes none, so its widths match the image service.
- Make `warm` use sitemap pages, the root page and one locale-neutral not-found probe instead of hard-coded `/uk/` pages.
- Resolve CLI cache paths from `IMAGE_CACHE_DIR` in the merged environment (including `--env-file`) first, then configured `cacheDirectory`; `warm` falls back to `.dev/image-cache` and `cleanup` requires a configured path.

### Fixed

- Generated public media URLs carry no `position`, and `fit` only as `cover`, so images rendered with an Astro `layout` (or a non-`cover` `image.objectFit`) pass the `/_image` checks instead of returning 404.
- Resolve relative `UPLOADS_DIR` values against the current working directory.
- Validate warm-up origins as absolute HTTP(S) URLs and require `--origin` when using `--public-origin`.

## [0.1.0] - 2026-10-28

- Initial import from the source site.
