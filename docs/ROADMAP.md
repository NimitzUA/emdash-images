# Roadmap

Open work for `@nimitzua/emdash-images`, carried over from the handover in `CONTEXT.md`. The
architect turns an item into a plan in `docs/plans` and marks it done with the plan's number.

## Scope decision (2026-10-30)

The owner decided that this repository works on the package and its EmDash plugin only. Plans
do not depend on, reference or wait for an existing site (liliiachaika.com, facadesystems):
no site markup as input, no route contract from another architect, no site migration. A site
adopts the package on its own side.

## Open

1. **`Picture` component.** A package `Picture` component on `pictureSources`, designed from the
   package's own API. Open question: ADR-0002 keeps markup out of the package, so this item
   needs the owner's decision (and a new ADR if it stays).
2. **Versioning and releases.** Choose and document a version and release process.
3. **CI.** Add CI for this repository.
4. **Other databases and storage for maintenance.** Backfill and cleanup read media rows through
   `pg` and files from a local uploads directory. Support EmDash's other databases (SQLite, D1)
   and storage (S3, R2), likely through EmDash's own APIs; needs an ADR first.
5. **Small CLI follow-ups from plan 002.** A unit test for a valid `--origin` with an invalid
   `--public-origin`; `warm`'s `.dev/image-cache` fallback resolves against `process.cwd()`, not
   `runCli`'s `cwd`; the CLI trims config `cacheDirectory` while the service does not. Details in
   plan 002's Outcome, Follow-ups.

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
