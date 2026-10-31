# Roadmap

Open work for `@nimitzua/emdash-images`, carried over from the handover in `CONTEXT.md`. The
architect turns an item into a plan in `docs/plans` and marks it done with the plan's number.

## Scope decision (2026-10-30)

The owner decided that this repository works on the package and its EmDash plugin only. Plans
do not depend on, reference or wait for an existing site (liliiachaika.com, facadesystems):
no site markup as input, no route contract from another architect, no site migration. A site
adopts the package on its own side.

## Open

1. **Small `Picture` follow-ups from plan 005.** The `full-width` render case without the URL
   helper, and the edge cases kept from plan 004; details in plan
   005's Outcome, Follow-ups. None blocks 0.2.0.
2. **Release 0.2.0.** The `Picture` component is merged (plan 004) and its follow-ups (plan 005). The owner's step: follow
   `docs/RELEASING.md` (npm scope, login, two-factor, then prepare, commit, tag, publish, push). The `globalThis`-keys entry in `CHANGELOG.md` was
   moved to `### Changed` on 2026-11-01 (plan 003's Outcome).
3. **CI.** Add CI for this repository.
4. **Other databases and storage for maintenance.** Backfill and cleanup read media rows through
   `pg` and files from a local uploads directory. Support EmDash's other databases (SQLite, D1)
   and storage (S3, R2), likely through EmDash's own APIs; needs an ADR first. That ADR also
   answers ADR-0004's open question (a content-hash lookup without the site's help), since the
   guard too reads EmDash's `media` table directly.
5. **Small CLI follow-ups from plan 002.** A unit test for a valid `--origin` with an invalid
   `--public-origin`; `warm`'s `.dev/image-cache` fallback resolves against `process.cwd()`, not
   `runCli`'s `cwd`; the CLI trims config `cacheDirectory` while the service does not. Details in
   plan 002's Outcome, Follow-ups.
6. **Portable Text images and the placeholder.** ADR-0004 «Next»: a Portable
   Text image block component on the same code as `Picture`, and the LQIP placeholder.

## Out of scope

- **Facadesystems' custom image route** and **facadesystems migration**: site work, dropped by
  the scope decision of 2026-10-30.

## Done

0. **Self-contained package — plan 001** (merge `a14e3ca`). The package no longer names the
   site it was cut from (symbol keys, usage strings, README and SKILL), and ships the
   `emdash-images` command (`backfill`, `cleanup`, `warm`) with `--config <module>` and
   `--env-file`; Postgres and local storage only.
1. **CLI follow-ups — plan 002** (merge `3dfe4ad`). `warm` no longer requests the source site's
   `/uk/` pages; `warm` and `cleanup` resolve the cache directory in the image service's order
   (`IMAGE_CACHE_DIR` from the process environment or `--env-file`, then config
   `cacheDirectory`) against the current directory; `UPLOADS_DIR` follows the current directory;
   `--public-origin` requires `--origin`, and both must be absolute http(s) URLs.
2. **Versioning and releases — plan 003** (merge `c27eae6`). ADR-0003 in place:
   `scripts/release.mjs` (`prepare X.Y.Z`, `verify`) keeps the five version locations in step and
   dates `CHANGELOG.md`; `package.json` is npm-ready (`publishConfig.access` public,
   `prepublishOnly` runs tests and verify, `CHANGELOG.md` in `files`); README and SKILL install
   from npm; `docs/RELEASING.md` holds the owner's procedure. Still at 0.1.0, nothing published.
3. **`Picture` component — plan 004** (merge `eb916a1`). ADR-0004 in place:
   `@nimitzua/emdash-images/Picture.astro` renders EmDash image fields with AVIF and WebP
   sources, hash-versioned URLs, `layout`, dark variant, focal point and `pictureAttributes`,
   over an internal `pictureModel`; `pictureSources()` reads its widths and `getImage` from
   `astro:assets` when not passed and forwards and returns `attributes`; a vitest Container API
   render test (`npm test` runs `node --test && vitest run`). Unreleased, for 0.2.0.
4. **`Picture` follow-ups — plan 005** (merge `7a58534`). Generated public media URLs carry no
   `position` and only `fit=cover`, so images with an Astro `layout` pass `/_image` instead of
   404 (`### Fixed`); an empty `src` counts as unset; the layout name is `"full-width"`; render
   tests parse every rendered URL with the package's `parseURL`; `vitest --reporter=verbose`;
   layout `none` keeps ignoring `imageConfig.objectFit` / `objectPosition`, now pinned by a test.
