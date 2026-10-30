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
5. **CLI follow-ups from plan 001.** `warm` reads `IMAGE_CACHE_DIR` only from the process
   environment, not from `--env-file`, and prefers the config's `cacheDirectory` while the image
   service prefers `IMAGE_CACHE_DIR`; `--public-origin` without `--origin` is silently ignored;
   smaller items in plan 001's Outcome, Follow-ups.

## Out of scope

- **Facadesystems' custom image route** and **facadesystems migration**: site work, dropped by
  the scope decision of 2026-10-30.

## Done

0. **Self-contained package — plan 001** (merge `a14e3ca`). The package no longer names the
   site it was cut from (symbol keys, usage strings, README and SKILL), and ships the
   `emdash-images` command (`backfill`, `cleanup`, `warm`) with `--config <module>` and
   `--env-file`; Postgres and local storage only.
