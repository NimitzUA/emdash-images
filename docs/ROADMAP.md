# Roadmap

Open work for `@nimitzua/emdash-images`, carried over from the handover in `CONTEXT.md`. The
architect turns an item into a plan in `docs/plans` and marks it done with the plan's number.

## Scope decision (2026-10-30)

The owner decided that this repository works on the package and its EmDash plugin only. Plans
do not depend on, reference or wait for an existing site (liliiachaika.com, facadesystems):
no site markup as input, no route contract from another architect, no site migration. A site
adopts the package on its own side.

## Open

0. **Self-contained package (next: plan 001).** Remove what the package still carries from the
   site it was cut from: `liliiachaika.*` global symbol keys (`src/service.mjs`,
   `src/warmup.mjs`), usage strings naming the site's `scripts/deploy/*` wrappers
   (`src/backfill.mjs`, `src/cleanup.mjs`), site npm scripts and the workspace `file:` Docker
   note in `README.md` and `SKILL.md`. Ship the package's own CLI for warm-up, backfill and
   cleanup, so a consumer needs no wrapper scripts.
   Owner decisions (2026-10-30): the CLI covers Postgres and local storage only, as the
   maintenance code does today; it reads the consumer's options from `--config <module>`
   (default export, the same object passed to `imageService()`); the command is
   `emdash-images`.
1. **`Picture` component.** A package `Picture` component on `pictureSources`, designed from the
   package's own API. Open question: ADR-0002 keeps markup out of the package, so this item
   needs the owner's decision (and a new ADR if it stays).
2. **Versioning and releases.** Choose and document a version and release process.
3. **CI.** Add CI for this repository.
4. **Other databases and storage for maintenance.** Backfill and cleanup read media rows through
   `pg` and files from a local uploads directory. Support EmDash's other databases (SQLite, D1)
   and storage (S3, R2), likely through EmDash's own APIs; needs an ADR first.

## Out of scope

- **Facadesystems' custom image route** and **facadesystems migration**: site work, dropped by
  the scope decision of 2026-10-30.

## Done

None yet.
