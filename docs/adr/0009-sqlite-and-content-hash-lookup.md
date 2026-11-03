# 0009 SQLite for maintenance and a content-hash lookup

**Status:** accepted · **Date:** 2026-11-03

## Context

The `emdash-images` commands `backfill` and `cleanup` (`src/backfill.mjs`, `src/cleanup.mjs`)
open their own `pg` `Pool` from `DATABASE_URL`, `EMDASH_DATABASE_URL` or the `PG*` variables
and run PostgreSQL-only SQL (`<> ALL($1::text[])`, `unnest`, `left`, `char_length`). `backfill`
also reads original files from a local directory (`UPLOADS_DIR`, default `uploads`). The rest of
the package does not depend on the database: the `/_image` guard and the image service read the
`media` table through EmDash's own Kysely connection (`src/media-database.mjs`).

ADR-0004 left an open question: a component only versions its URLs when the site passes the
content hash, and a lookup without the site's help costs one query per image.

Facts from the installed dependencies (`emdash` 1.4.0, read 2026-11-03):

- EmDash's documentation names SQLite as the simplest Node.js database, and its Node.js guide
  configures `sqlite({ url: "file:./data/emdash.db" })`. A site on SQLite can use the image
  service, the guard and the components today, but `backfill` and `cleanup` fail on it.
- `emdash/db/sqlite` and `emdash/db/postgres` are public exports with
  `createDialect(config)`, returning a Kysely dialect; `sqlite()` and `postgres()` in
  `emdash/db` return descriptors whose `entrypoint` names those modules. SQLite runs on
  Node.js's built-in `node:sqlite`, which the package's `engines` floor (Node.js 26) has. `pg`
  is an optional dependency of `emdash`.
- D1, Hyperdrive and the R2 binding exist only on Cloudflare Workers, where the package's image
  service (sharp and a disk cache) does not run at all.
- `MediaValue` (image field values, Portable Text image and gallery values) carries no content
  hash: not as a field, not in `meta`, not in the media URL. The hash lives only in the
  `content_hash` column of `media`. EmDash's public `MediaRepository.findById()` returns it one
  id at a time; no public export returns the hashes of several ids. "Replace original" keeps
  the storage key and changes `content_hash`, which is why EmDash serves local files with
  `max-age=0, must-revalidate`.

The owner decided on 2026-11-03: the maintenance commands support SQLite and PostgreSQL and
nothing else; original files stay on the local disk only; the content-hash lookup is a package
helper, in a plan of its own.

## Decision

- **Two databases.** `backfill` and `cleanup` work with SQLite and PostgreSQL. libSQL, D1 and
  Hyperdrive are not supported.
- **Chosen from the environment.** The command reads the connection as today, from
  `DATABASE_URL`, then `EMDASH_DATABASE_URL`, then the `PG*` variables (from the process or
  `--env-file`). A URL starting with `file:` selects SQLite, its path resolved against the
  current directory as `UPLOADS_DIR` is; a `postgres:` or `postgresql:` URL or the `PG*`
  variables select PostgreSQL. Any other scheme fails with an error that names the two
  supported databases. There is no default database: with nothing set, the command fails as
  today, and the message also names the `file:` form. (Architect's call: two databases need no
  new config surface, and a default path would open a database nobody named.)
- **EmDash's dialects, Kysely queries.** The commands build their connection with
  `createDialect` from `emdash/db/sqlite` or `emdash/db/postgres` and query through Kysely, with
  no dialect-specific SQL. `backfill` still selects only `ready` rows with an empty field and
  applies the denied-prefix filter in JavaScript afterwards, so its counts and output stay the
  same. Each update keeps today's guard in one statement: it writes a field only while the row
  is still `ready`, has the same `storage_key` and the field is still empty, and counts the
  field filled only when one row changed. A command closes the connection it opened and leaves
  a supplied one open, as with `pool` today.
- **No own `pg` dependency.** `pg` leaves `dependencies`; PostgreSQL comes through EmDash's
  dialect and EmDash's optional `pg`. Kysely is resolved so that the dialect and the query
  builder agree; the plan settles whether that is a peer dependency or EmDash's copy.
- **Local originals only.** `backfill` reads originals from `UPLOADS_DIR` as today. S3 and R2
  are not supported; `README.md` says so.
- **Maintenance API.** In `@nimitzua/emdash-images/maintenance`, the `pool` option of
  `backfillMediaRows` and `cleanupImageCache` and the `MaintenancePool` type give way to a
  `database` option taking a Kysely instance. CLI output and exit codes do not change.
- **A content-hash lookup.** The package exports a function, provisionally
  `loadContentHashes(emdash, ids)`, that returns a `Map` from media id to `content_hash` for the
  given ids in one query over `getMediaDatabase()`. A site calls it once per page and passes
  the result to `Picture` (`contentHash`) and `PortableTextGallery` (`contentHashes`).
  Components still never query the database. This answers ADR-0004's open question. The map
  holds only ids whose row is `ready` with a non-empty hash; other ids are left out, so their
  URLs stay unversioned. Without a database it returns an empty map rather than throwing, since
  unversioned URLs are the documented fallback. A long id list is split into batches below
  SQLite's bound-variable limit, one query per batch. (Architect's calls.)
- **Two plans.** Plan 015 carries the maintenance commands, plan 016 the lookup.
- **Release.** Both are minor before 1.0.0 (ADR-0003): SQLite and the lookup under `### Added`,
  the `database` option replacing `pool` and the dropped `pg` dependency under `### Changed`.

## Consequences

- A Node.js site on EmDash's default SQLite can run `backfill` and `cleanup`.
- Tests can run the commands against a real SQLite database instead of a fake `pool`.
- A script that calls `backfillMediaRows` or `cleanupImageCache` with `pool` has to pass a
  Kysely instance; the CLI is unaffected.
- The commands now depend on EmDash's public dialect modules, so an EmDash upgrade that changes
  them is checked against the commands.
- Sites stop writing their own query against EmDash's `media` table for content hashes; the
  package already depends on that table's `id`, `status`, `storage_key` and `content_hash`
  columns in the guard and the commands, and the lookup adds no new column.
- `README.md` «Options» (connection variables, the SQLite URL, the unsupported databases and
  storage), `SKILL.md`, `CHANGELOG.md`, `src/maintenance.d.mts` and `src/index.d.mts` change.

## Alternatives

- **Database and storage descriptors in the `--config` module.** One description shared with
  `astro.config.mjs`, but the config module is a plain object of image options, and two
  databases are chosen from one URL as well; not needed.
- **Original files through EmDash's `storage.download()`.** Would add S3 and R2 for `backfill`;
  rejected by the owner.
- **libSQL, D1 and Hyperdrive.** libSQL is a third dialect nobody has asked for; D1 and
  Hyperdrive only exist where the package does not run. Rejected by the owner.
- **Components that read `content_hash` themselves.** One query per image on a list page and a
  database dependency in rendering (ADR-0004).
- **EmDash's `MediaRepository.findById()` per image.** Public, but still one query per image.
- **Leave the maintenance commands on PostgreSQL and document it.** Cheapest, but EmDash's own
  default Node.js database could not run them; the owner chose SQLite support.
