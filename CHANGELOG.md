# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Before 1.0.0, breaking changes and new features increment the minor version; fixes increment the patch version.

## Unreleased

### Added

- Add the `emdash-images` command for `backfill`, `cleanup` and `warm`, with `--config`, `--env-file` and documented exit codes.
- Namespace process-wide `globalThis` state by package name and align maintenance usage strings to `emdash-images`.

### Changed

- Make `warm` use sitemap pages, the root page and one locale-neutral not-found probe instead of hard-coded `/uk/` pages.
- Resolve CLI cache paths from `IMAGE_CACHE_DIR` in the merged environment (including `--env-file`) first, then configured `cacheDirectory`; `warm` falls back to `.dev/image-cache` and `cleanup` requires a configured path.

### Fixed

- Resolve relative `UPLOADS_DIR` values against the current working directory.
- Validate warm-up origins as absolute HTTP(S) URLs and require `--origin` when using `--public-origin`.

## [0.1.0] - 2026-10-28

- Initial import from the source site.
