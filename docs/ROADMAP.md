# Roadmap

Open work for `@nimitzua/emdash-images`, carried over from the handover in `CONTEXT.md`. The
architect turns an item into a plan in `docs/plans` and marks it done with the plan's number.

## Scope decision (2026-10-30)

The owner decided that this repository works on the package and its EmDash plugin only. Plans
do not depend on, reference or wait for an existing site (liliiachaika.com, facadesystems):
no site markup as input, no route contract from another architect, no site migration. A site
adopts the package on its own side.

## Open

1. **Release 0.3.0.** Staged publishing is in place (plan 012). The owner adds the trusted
   publisher with "allow npm publish" unchecked and releases 0.3.0 by `docs/RELEASING.md`; the
   configuration expires unless a publish succeeds within 2 days. Check then whether
   `gh run rerun` on a run whose version is already staged tries to stage it again (ADR-0007
   unknown).
2. **Other databases and storage for maintenance.** Backfill and cleanup read media rows through
   `pg` and files from a local uploads directory. Support EmDash's other databases (SQLite, D1)
   and storage (S3, R2), likely through EmDash's own APIs; needs an ADR first. That ADR also
   answers ADR-0004's open question (a content-hash lookup without the site's help), since the
   guard too reads EmDash's `media` table directly.
3. **Portable Text `gallery` and `cover` blocks.** Left on EmDash's components by ADR-0006
   «Scope».

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
5. **CI and publishing from GitHub — plan 006** (merge `d1e1f61`). ADR-0005 in place:
   `.github/workflows/ci.yml` (push to `main`, pull requests: `npm ci`, `npm test`, release
   verify) and `release.yml` (a pushed `v*` tag: `verify-tag`, npm >= 11.5.1, skip when the
   version is already on npm, else `npm publish` through trusted publishing, no tokens);
   `node scripts/release.mjs verify-tag <tag>`; `package.json` `repository`/`homepage`/`bugs`
   and README point at GitHub `nimitzua/emdash-images`; `docs/RELEASING.md` holds the GitHub
   procedure. First CI run on GitHub green (run `41261640735`).
6. **Release tests for any current version — plan 007** (merge `9ae4211`). The `prepareRelease`
   tests in `test/release.test.mjs` compute `nextVersion` (minor plus one) from `package.json`
   instead of the literal `0.2.0`, so `npm test` and `prepublishOnly` pass after
   `release.mjs prepare 0.2.0`. Test-only; no `CHANGELOG.md` entry.
7. **Release 0.2.0** (commit `6bb7f87`, tag `v0.2.0`, 2026-11-01). Published by hand, the
   package's first version on npm, with the `emdash-images` command. The tag's `Release` run
   failed as expected (no trusted publisher yet, the registry still lagging); the tag stays.
8. **Release follow-ups after 0.2.0 — plan 008** (merge `5a08cf8`). `package.json` `bin` is
   `src/bin.mjs`, so `npm pkg fix` and `npm publish` find nothing to rewrite; `verify-tag` on a
   `package.json` without `version` reports only `Missing version at package.json`;
   `docs/RELEASING.md` records the by-hand 0.2.0 on 2026-11-01, the expected `E404` of its tag
   run, and how to choose `X.Y.Z` from `## Unreleased`. No package behaviour change.
9. **CLI and cache-path follow-ups — plan 009** (merge `29c6a40`). `warm` falls back to
   `.dev/image-cache` under `runCli`'s `cwd`; the image service trims a configured
   `cacheDirectory` (`imageService()` and `getCacheDirectory`, a blank value falls through) —
   `### Fixed` under `## Unreleased`; tests for an invalid `--public-origin` and the
   `full-width` render URLs. Unreleased. `README.md` «Options» names `warm`'s fallback and
   `cleanup`'s error when no cache directory is set (architect, 2026-11-02).
10. **Small `Picture` follow-ups — plan 010** (merge `4375b4d`). `pictureSources()` treats a
    `null` `getImage` or `imageConfig` as omitted and reads it from `astro:assets` (`### Fixed`
    under `## Unreleased`), with vitest tests for both. The other plan 004 edge cases (`picture`
    `{}`, the repeated `astro:assets` import under `node --test`) are won't fix (owner,
    2026-11-02). Unreleased.
11. **Portable Text image and placeholder — plan 011** (merge `7fc9edf`). ADR-0006 in place:
    `Picture` renders an LQIP placeholder from `blurhash` (through `@unpic/placeholder`, a new
    dependency) or a strictly matched hex/`rgb()`/`rgba()` `dominantColor`, on by default,
    `placeholder={false}` for a strict CSP; `@nimitzua/emdash-images/PortableTextImage.astro`
    renders EmDash's Portable Text `image` block over `pictureModel` (alignment classes, link
    through `emdash`'s `sanitizeHref`, caption, display size, layout `constrained`, no CSS);
    README, SKILL.md and `### Added` in `CHANGELOG.md`. Unreleased; the next release is 0.3.0.
    The Outcome's README follow-ups (`rgba()`, the `placeholder` prop and `#` links in
    «Portable Text images», a guarded wrapper example) fixed by the architect on 2026-11-02.
12. **Staged publishing — plan 012** (merge `dd544f2`). ADR-0007 in place: `release.yml` checks
    npm >= 11.15.0 and runs `npm stage publish`, so CI can only stage; `docs/RELEASING.md` has
    the owner review and approve each version (`npm stage list`, `view`, `approve` with a
    two-factor code), reject with `npm stage reject`, and watch runs by id
    (`gh run watch <run-id> --exit-status`). No package change.
