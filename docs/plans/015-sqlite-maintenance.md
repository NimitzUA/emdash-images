# 015 SQLite for maintenance

**Goal:** Ship the maintenance half of ADR-0009: `backfill` and `cleanup` run on SQLite or
PostgreSQL through EmDash's dialects and Kysely, `pg` leaves `dependencies`, and the
`./maintenance` functions take a `database` option in place of `pool`.

**Context:** `docs/adr/0009-sqlite-and-content-hash-lookup.md` (accepted 2026-11-03), «Decision»
bullets «Two databases» to «Release»; ADR-0003 «Decision» (Changelog);
`docs/plans/014-portable-text-gallery.md` «Outcome». The content-hash lookup is plan 016 and
is out of scope here.

Facts read while writing this plan (2026-11-03, `main` at `c709431`, version `0.4.0`,
`emdash` 1.4.0, `kysely` 0.29.7 hoisted at `node_modules/kysely`):

- `src/backfill.mjs:3` and `src/cleanup.mjs:3` import `Pool` from `pg`; each has its own
  `databaseConfig(env)` (`backfill.mjs:48-61`, `cleanup.mjs:106-119`): `DATABASE_URL ||
  EMDASH_DATABASE_URL` as `connectionString`, else `PGHOST`/`PGPORT` (default 5432)/
  `PGDATABASE`/`PGUSER`/`PGPASSWORD`, else the error
  `Set DATABASE_URL or the PGHOST, PGDATABASE, and PGUSER variables.`
- `backfill.mjs:202-205` selects with PostgreSQL-only SQL (`<> ALL($1::text[])`, `unnest`,
  `left`, `char_length`); `backfill.mjs:163-169` `fillMissingField` updates one field with
  `WHERE id = $2 AND storage_key = $3 AND status = 'ready' AND <empty predicate>` and counts it
  only when `rowCount === 1`; the empty predicates are `emptyFieldPredicates` (lines 9-15).
  `missingFields(row, deniedPrefixes)` (lines 107-116) already applies the lower-cased
  `image/` check and the denied prefixes in JavaScript.
- `cleanup.mjs:342` and `:357` run `SELECT id, status, storage_key, content_hash FROM media
  ORDER BY id`. Both commands take `pool: suppliedPool` and call `pool.end()` only when they
  opened it (`backfill.mjs:291`, `cleanup.mjs:376`).
- `src/maintenance.d.mts:1-7` declares `MaintenancePool`; `pool?: MaintenancePool` on
  `BackfillMediaRowsOptions` (line 12) and `CleanupImageCacheOptions` (line 30).
  `src/maintenance.mjs` re-exports both functions. `src/index.d.mts` names neither.
- `src/cli.mjs:144-169` passes `env` (with `UPLOADS_DIR` resolved against `cwd` for backfill,
  `IMAGE_CACHE_DIR` for cleanup) and never a `pool`.
- `emdash` exports `./db/sqlite` and `./db/postgres`, each with `createDialect(config)`.
  `emdash/db/sqlite` (`node_modules/emdash/dist/db/sqlite.mjs`) takes `{ url }`, strips a
  leading `file:` and opens Node's `DatabaseSync` through `openNodeSqliteDatabase` with WAL;
  `DatabaseSync` creates a missing file. `emdash/db/postgres` imports `pg` at the top of the
  module and takes `{ connectionString, host, port, database, user, password }`.
  `emdash/db` exports `runMigrations(db)`, which creates EmDash's real `media` table.
- `emdash` 1.3.0 and 1.4.0 both depend on `kysely` `^0.29.0` and list `pg` as an optional
  dependency (`npm view emdash@1.3.0`).
- `package.json`: `dependencies` `@unpic/placeholder`, `pg` `^8.16.3`; `peerDependencies`
  `astro`, `emdash` `^1.3.0`, `sharp`; `test/boundary.test.mjs` fails on a bare import that is
  not a dependency or peer dependency.
- Tests: `test/maintenance.test.mjs` drives both commands with fake `pool` objects
  (`createBackfillPool`, lines 20-52; plain `{ query }` objects at lines 334, 398, 498) and
  asserts the SQL text at lines 125-127. `test/cli.test.mjs` replaces the commands with stubs.
- Docs: `README.md:330` («Command line»: PostgreSQL only); `SKILL.md:7` («`pg` is installed as
  a package dependency»); `CHANGELOG.md` `## Unreleased` is empty.

Architect's calls made in this plan, within ADR-0009:

- **Kysely as a peer dependency.** `kysely` `^0.29.0` goes into `peerDependencies` and
  `devDependencies`: the dialect from EmDash and the query builder then share one copy (npm
  dedupes it with EmDash's own), and `src/maintenance.d.mts` can import its `Kysely` type.
- **A missing SQLite file is an error.** A `file:` path that is not an existing regular file
  fails with an error naming that path, before anything opens it, so the command never creates
  an empty database.
- **`pool` is refused.** Passing the removed `pool` option throws a `TypeError` naming
  `database`, instead of silently opening the database from the environment.
- **Selection without dialect SQL.** `backfill` selects `ready` rows where `content_hash` is
  empty or any metadata field is empty, then keeps the rows whose `missingFields` is non-empty.
  For EmDash's lower-case MIME types the rows, counts and output are those of today; a stored
  upper-case `IMAGE/…` type, which today's SQL `LIKE 'image/%'` skips on PostgreSQL, now gets
  its metadata like the lower-case one.

**Version impact:** `database` replaces `pool` in the public `./maintenance` API and `pg` leaves
`dependencies`: a minor version before 1.0.0 (ADR-0003, ADR-0009 «Release»), with `### Added`
and `### Changed` entries under `## Unreleased` (T4). No `version` bump, tag, push or publish.

**Preconditions:**
- `main` is clean at 0.4.0 with ADR-0009 accepted: `git status --porcelain` prints nothing,
  `npm pkg get version` prints `"0.4.0"`, and `docs/adr/0009-sqlite-and-content-hash-lookup.md`
  line 3 reads `**Status:** accepted`.
- T1 and T2 change `package.json` dependencies: the run installs in the worktree when the
  executor asks (`npm install`), and the lockfile change is part of that task's commit.

**Branch:** `task/015-sqlite-maintenance` · **Worktree:** `.worktrees/emdash-images/015-sqlite-maintenance`

## Tasks

### T1: Run cleanup on SQLite or PostgreSQL through Kysely

- **Target:** `src/maintenance-database.mjs` (new), `src/cleanup.mjs`,
  `src/maintenance.d.mts`, `package.json`, `package-lock.json`,
  `test/maintenance-database.test.mjs` (new), `test/maintenance.test.mjs`.
- **Change:**
  - New internal module `src/maintenance-database.mjs` (not in `exports`):
    - `databaseSettings(env, cwd = process.cwd())`: the URL is `env.DATABASE_URL ||
      env.EMDASH_DATABASE_URL`. A URL starting with `file:` gives
      `{ dialect: "sqlite", path }` with the rest of the URL resolved against `cwd`; a
      `postgres:` or `postgresql:` URL gives `{ dialect: "postgres", config: {
      connectionString } }`; any other scheme throws an `Error` naming the scheme and the two
      supported databases (`file:` for SQLite, `postgres:`/`postgresql:` for PostgreSQL).
      Without a URL, `PGHOST`, `PGDATABASE` and `PGUSER` give
      `{ dialect: "postgres", config }` as today's `databaseConfig`; with nothing set it throws
      an `Error` that names `DATABASE_URL`, the `file:` form and the `PG*` variables.
    - `openMaintenanceDatabase(env)`: for SQLite, rejects with an `Error` naming the path when
      it is not an existing regular file; otherwise `new Kysely({ dialect })` with
      `createDialect` from a dynamic `import("emdash/db/sqlite")` (`{ url: path }`) or
      `import("emdash/db/postgres")` (`config`), so PostgreSQL's `pg` loads only when chosen.
    - `maintenanceDatabase({ database, pool, env })`: throws a `TypeError` naming `database`
      when `pool` is not `undefined`; with `database` it requires a `selectFrom` function
      (else `TypeError`) and returns `{ database, close }` with a `close` that does nothing;
      otherwise it opens from `env` and its `close` calls `database.destroy()`.
  - `src/cleanup.mjs`: drop `pg` and `databaseConfig`; option `database` in place of `pool`
    (the `pool` key stays in the destructuring only so `maintenanceDatabase` can refuse it).
    Validate the arguments and the cache directory first as today, then open through
    `maintenanceDatabase`, and read the rows with
    `selectFrom("media").select(["id", "status", "storage_key", "content_hash"]).orderBy("id")`;
    `close()` in `finally`. Output, result and categories do not change.
  - `src/maintenance.d.mts`: `CleanupImageCacheOptions.database?: Kysely<any>` in place of
    `pool`, with `import type { Kysely } from "kysely"`. `MaintenancePool` stays for backfill
    until T2.
  - `package.json`: `kysely` `^0.29.0` in `peerDependencies` and `devDependencies`. Then `ask`
    "dependencies changed, run install" and commit the resulting `package-lock.json`.
  - `test/maintenance-database.test.mjs`: one table-driven test of `databaseSettings` for the
    cases in the threat model and for `file:./data/emdash.db` (resolved against the given
    `cwd`), `file:/tmp/x.db`, `EMDASH_DATABASE_URL` used when `DATABASE_URL` is empty,
    `postgres://` and `postgresql://` URLs, and the `PG*` variables (port `5432` by default);
    `openMaintenanceDatabase` on a missing `file:` path rejects and the file still does not
    exist afterwards; `maintenanceDatabase` refuses `pool` and an object without `selectFrom`.
  - `test/maintenance.test.mjs`, cleanup tests (lines 327-518): replace the fake pools with a
    real SQLite database in the test's temporary directory, created through
    `createDialect` from `emdash/db/sqlite` and `runMigrations` from `emdash/db`, with the rows
    inserted into `media`; pass it as `database`. Their assertions on categories, counts,
    bytes, output lines and files stay. The listing-race test keeps its timing with a Kysely
    plugin (`database.withPlugin`) whose `transformResult` writes the variant on the first
    query. New: `cleanupImageCache` with `env.DATABASE_URL` set to a `file:` URL of such a
    database and no `database` option gives the same dry-run candidates; a supplied
    `database` is still usable after the call; `pool` is refused; and the cleanup query
    compiled for PostgreSQL (a Kysely instance with `PostgresAdapter`,
    `PostgresQueryCompiler` and a driver that records each compiled query and returns no rows)
    contains none of `unnest`, `::`, `char_length`.
- **Threat model:** connection URLs carry passwords and tokens, and the commands print errors
  to the terminal and CI logs. Blocked: every thrown message for
  `postgres://user:secret@db.example/emdash` (unreachable is not tested; only selection),
  `mysql://user:secret@db.example/emdash`, `libsql://site.turso.io?authToken=secret`,
  `d1://binding` and `https://user:secret@db.example` must not contain `secret`, and the last
  four must fail in `databaseSettings` before any import or connection. A missing `file:`
  path must not be created. Stop condition: the table-driven test above and the missing-file
  test.
- **Constraints:** `src/backfill.mjs`, `src/cli.mjs`, `src/media-database.mjs`,
  `src/guard.mjs`, `src/service.mjs` and `src/warmup.mjs` unchanged. No dialect-specific SQL
  and no `sql` template literal in `src/cleanup.mjs`. `pg` stays in `dependencies` until T2.
  Nothing new in `package.json` `exports`.
- **Ownership:** `src/maintenance-database.mjs`, `src/cleanup.mjs`, `src/maintenance.d.mts`,
  `package.json`, `package-lock.json`, `test/maintenance-database.test.mjs`,
  `test/maintenance.test.mjs`. `cleanupImageCache` is called by `src/cli.mjs` (passes no
  `pool`; unchanged) and `test/cli.test.mjs` (stubs it; unchanged). Existing tests that change:
  the three cleanup tests in `test/maintenance.test.mjs` (lines 327-518), which pass `pool`.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/maintenance-database.test.mjs` ends with `# fail 0` and lists the
    selection, credential and missing-file tests
  - `node --test test/maintenance.test.mjs` ends with `# fail 0` and lists the new cleanup tests
    (`file:` URL, supplied `database`, `pool` refused, PostgreSQL compile)
  - `node --test test/boundary.test.mjs` ends with `# fail 0`
  - `npm pkg get peerDependencies.kysely devDependencies.kysely` prints `^0.29.0` for both
  - `npm ls kysely` lists `kysely@0.29.7` once and EmDash's copy as `deduped`
  - `git grep -n -e "from \"pg\"" -e "\.query(" -e "databaseConfig" -- src/cleanup.mjs` prints
    nothing
  - `git diff main --stat` lists only this task's Ownership files
- **Commit:** `Run cleanup on SQLite or PostgreSQL through Kysely`
- **Docs:** ADR-0009 «Decision»; `node_modules/emdash/dist/db/sqlite.mjs`,
  `node_modules/emdash/dist/db/postgres.mjs`, `node_modules/emdash/dist/db/index.d.mts`;
  `node_modules/kysely/README.md`.
- **Size:** about 120 changed lines in `src/`, plus tests.

### T2: Run backfill on SQLite or PostgreSQL through Kysely

- **Target:** `src/backfill.mjs`, `src/maintenance-database.mjs`, `src/maintenance.d.mts`,
  `package.json`, `package-lock.json`, `test/maintenance.test.mjs`.
- **Change:**
  - `src/backfill.mjs`: drop `pg`, `databaseConfig` and `emptyFieldPredicates`; option
    `database` in place of `pool`, opened and closed through T1's `maintenanceDatabase`.
    - Selection through Kysely: `media` rows with `status = 'ready'` where `content_hash` is
      null or `''`, `width` or `height` is null, or `blurhash` or `dominant_color` is null or
      `''`, the same columns as today, ordered by `id`; then keep only rows whose
      `missingFields(row, deniedPrefixes)` is non-empty, before listing candidates.
    - `fillMissingField(database, candidate, field, value)`: one Kysely `updateTable("media")`
      setting `field` where `id`, `storage_key` and `status = 'ready'` match and the field is
      still empty (`is null` for `width`/`height`, `is null` or `''` for the others); filled
      only when `numUpdatedRows` is `1n`.
    - Output lines, counts, `exitCode` and the result object do not change.
  - `src/maintenance.d.mts`: `BackfillMediaRowsOptions.database?: Kysely<any>` in place of
    `pool`; remove `MaintenancePool`.
  - `package.json`: remove `pg` from `dependencies`. Then `ask` "dependencies changed, run
    install" and commit the resulting `package-lock.json`.
  - `src/maintenance-database.mjs`: change only what backfill needs from T1's helpers.
  - `test/maintenance.test.mjs`, backfill tests (lines 20-325): replace `createBackfillPool`
    with a real SQLite database as in T1 (`runMigrations`), passed as `database`, and read the
    rows back from it where the tests read `pool.rows`. Their assertions on results, counts,
    output lines and rows stay; the SQL-text assertions at lines 125-127 go, replaced by a test
    that runs `backfillMediaRows` (dry run and `--write`) against the recording PostgreSQL
    Kysely of T1, whose compiled queries contain none of `unnest`, `::`, `char_length`,
    `left(` and only `$n` parameters. New: a row whose `storage_key` changes after the
    selection (changed through a second connection from the `log` callback on
    `Rows needing backfill: 1`) is not written and counts in `Skipped because rows changed: 1`;
    `backfillMediaRows` with `env.DATABASE_URL` set to a `file:` URL fills the row and leaves
    the database closed for a new connection to read; `pool` is refused.
- **Constraints:** `src/cleanup.mjs` and `src/cli.mjs` unchanged. No dialect-specific SQL and
  no `sql` template literal in `src/backfill.mjs`. `storageFilePath`, `hashStoredMediaFile`
  and `parseArguments` keep their exports and behaviour. Nothing new in `package.json`
  `exports`.
- **Ownership:** `src/backfill.mjs`, `src/maintenance-database.mjs`, `src/maintenance.d.mts`,
  `package.json`, `package-lock.json`, `test/maintenance.test.mjs`. `backfillMediaRows` is
  called by `src/cli.mjs` (passes no `pool`; unchanged) and `test/cli.test.mjs` (stubs it;
  unchanged). Existing tests that change: the five backfill tests in
  `test/maintenance.test.mjs` that pass `pool` (lines 77-155, 167-188, 196-325) and the
  `createBackfillPool` helper; `MaintenancePool` is used nowhere else.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/maintenance.test.mjs` ends with `# fail 0` and lists the new backfill
    tests (PostgreSQL compile, changed row skipped, `file:` URL, `pool` refused)
  - `node --test test/boundary.test.mjs` ends with `# fail 0`
  - `npm pkg get dependencies` prints `@unpic/placeholder` only
  - `git grep -n -e "from \"pg\"" -e "unnest" -e "::text" -e "char_length" -e "MaintenancePool" -- src`
    prints nothing
  - `npm ls pg` shows `pg` only under `emdash`
  - `git diff main --stat` lists only T1's and this task's Ownership files
- **Commit:** `Run backfill on SQLite or PostgreSQL through Kysely`
- **Docs:** ADR-0009 «Decision» («EmDash's dialects, Kysely queries»); `src/backfill.mjs`;
  T1's `src/maintenance-database.mjs`; `node_modules/kysely/README.md`.
- **Size:** about 80 changed lines in `src/`, plus tests.

### T3: Resolve relative SQLite paths in the CLI against cwd

- **Target:** `src/cli.mjs`, `src/maintenance-database.mjs`, `test/cli.test.mjs`.
- **Change:**
  - `src/cli.mjs`: for `backfill` and `cleanup`, when the URL `databaseSettings` would read
    (`DATABASE_URL`, else `EMDASH_DATABASE_URL`, of the merged environment including
    `--env-file`) is a `file:` URL, the environment passed to the command carries that same
    variable as `file:` plus the path resolved against `runCli`'s `cwd`, as `UPLOADS_DIR` is
    today. Other values are passed unchanged; the caller's `env` object is not mutated. A
    helper for this goes into `src/maintenance-database.mjs` next to `databaseSettings`.
  - `test/cli.test.mjs`, new tests:
    - with stub commands, `DATABASE_URL=file:./data/emdash.db` reaches backfill and cleanup
      as `file:<cwd>/data/emdash.db`; the same from `EMDASH_DATABASE_URL` and from an
      `--env-file`; a `postgres://` URL and an absolute `file:` path pass unchanged;
    - end to end, without stubs: in a temporary `cwd` with `data/emdash.db` (migrated with
      `runMigrations`, one `ready` image row with empty fields), `uploads/` holding its file and
      `IMAGE_CACHE_DIR` pointing at an empty directory, `runCli(["backfill", "--write"])`
      returns `0` and fills the row, and `runCli(["cleanup"])` returns `0`;
    - `DATABASE_URL=mysql://user:secret@db.example/emdash` makes `runCli(["backfill"])` return
      `1` with an error that names SQLite and PostgreSQL and does not contain `secret`.
- **Constraints:** Usage text, option parsing and exit codes do not change. `src/backfill.mjs`
  and `src/cleanup.mjs` unchanged. No existing test changes.
- **Ownership:** `src/cli.mjs`, `src/maintenance-database.mjs`, `test/cli.test.mjs`; no
  existing test changes (the existing tests set no database URL, so their `env` assertions
  hold).
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/cli.test.mjs` ends with `# fail 0` and lists the new database URL,
    end-to-end and unsupported-scheme tests
  - `git diff main --stat` lists only T1's, T2's and this task's Ownership files
- **Commit:** `Resolve relative SQLite paths in the CLI against cwd`
- **Docs:** ADR-0009 «Decision» («Chosen from the environment»); `src/cli.mjs`;
  `README.md` «Command line».
- **Size:** about 30 changed lines in `src/`, plus tests.

### T4: Document SQLite maintenance and the database option

- **Target:** `README.md`, `SKILL.md`, `CHANGELOG.md`.
- **Change:**
  - `README.md` «Command line», the paragraph at line 330: backfill and cleanup work with
    SQLite and PostgreSQL. The connection comes from `DATABASE_URL`, then
    `EMDASH_DATABASE_URL`, then `PGHOST`, `PGPORT` (default `5432`), `PGDATABASE`, `PGUSER`
    and optional `PGPASSWORD`; a `file:` URL selects SQLite, its path resolved against the
    current working directory (example `DATABASE_URL=file:./data/emdash.db`, the path from
    EmDash's `sqlite({ url })`), and the file must exist; a `postgres:` or `postgresql:` URL
    or the `PG*` variables select PostgreSQL, which needs `pg` (EmDash installs it as an
    optional dependency). libSQL, D1 and Hyperdrive are not supported; backfill reads
    originals from the local `UPLOADS_DIR` only, so S3 and R2 storage are not supported.
  - `README.md` «Package exports»: one sentence that `backfillMediaRows` and
    `cleanupImageCache` from `./maintenance` take `database`, a Kysely instance that stays open,
    and otherwise open and close the connection from `env` as the CLI does; `pool` is no
    longer accepted.
  - `SKILL.md` step 1: replace "`pg` is installed as a package dependency." with `kysely` as a
    peer dependency shared with EmDash and `pg` coming from EmDash for PostgreSQL; step 8
    («Backfill, then warm twice») adds one sentence: backfill and cleanup read the database
    from `DATABASE_URL` (a `file:` URL such as `file:./data/emdash.db` for SQLite, run from the
    site's root) or the `PG*` variables, from the environment or `--env-file`.
  - `CHANGELOG.md` `## Unreleased`:
    - `### Added`: "`emdash-images backfill` and `cleanup` work with SQLite: a `file:`
      `DATABASE_URL` or `EMDASH_DATABASE_URL`, resolved against the current directory."
    - `### Changed`: "`backfillMediaRows` and `cleanupImageCache` take `database`, a Kysely
      instance, in place of `pool`; passing `pool` throws and `MaintenancePool` is removed." and
      "`pg` is no longer a dependency: PostgreSQL maintenance uses EmDash's dialect and its
      optional `pg`; `kysely` is a peer dependency."
- **Constraints:** Docs only. Every variable, option, type and path named exists after T3.
  Dated ADRs, done plans and released `CHANGELOG.md` sections stay as written. No `version`
  change.
- **Ownership:** `README.md`, `SKILL.md`, `CHANGELOG.md`; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n -e "PostgreSQL only" -e "pg. is installed as a package dependency" -- README.md SKILL.md`
    prints nothing
  - `git grep -n -e "file:./data/emdash.db" -e "Hyperdrive" -e "database" -- README.md` prints
    lines in «Command line» and «Package exports»
  - `git grep -n "kysely" -- SKILL.md` prints step 1; `git grep -n "file:./data/emdash.db" -- SKILL.md`
    prints step 8
  - `git grep -n -e "^### Added" -e "^### Changed" -e "work with SQLite" -e "in place of .pool." -- CHANGELOG.md`
    prints all four lines above `## [0.4.0]`
  - `node scripts/release.mjs verify` prints `RELEASE OK 0.4.0`
  - `git diff main --stat` lists only T1's to T3's and this task's Ownership files
- **Commit:** `Document SQLite maintenance and the database option`
- **Docs:** ADR-0009; ADR-0003 «Decision» (Changelog); `README.md` «Command line» and
  «Package exports»; `SKILL.md`.
- **Size:** about 30 changed lines of docs.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` from the worktree's copy prints `RELEASE OK 0.4.0`
- `git diff main -- src/service.mjs src/guard.mjs src/media-database.mjs src/warmup.mjs src/picture.mjs src/index.mjs src/index.d.mts .github` prints nothing
- `npm ls kysely` lists `kysely@0.29.7` once and EmDash's copy as `deduped`

## Amendments

None.

## Outcome

Filled after merge, from `status.md`. The next plan reads this, not the run's conversation.

- **Merge:** merge commit, task commits, review rounds per task, gates.
- **Decisions:** taken during the run (task, question, answer, why).
- **Surprises:** what the plan did not foresee.
- **Deviations:** what was done differently from the plan, and why.
- **Follow-ups:** work left for a later plan.
- **Proposed rules:** a FIX finding that came back in two or more reviews, as a rule for
  the project's own docs, `.orca-setup.json` or the orca-setup kit; the user decides and applies
  it (generated files change only by a re-render).
