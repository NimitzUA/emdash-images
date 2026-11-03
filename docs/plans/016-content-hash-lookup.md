# 016 Content-hash lookup

**Goal:** Ship the lookup half of ADR-0009: a root export `loadContentHashes(emdash, ids)` that
returns the `content_hash` of a page's media in one query per batch, its docs, and the plan 015
follow-ups the owner approved.

**Context:** `docs/adr/0009-sqlite-and-content-hash-lookup.md` (accepted 2026-11-03), «Decision»
bullet «A content-hash lookup»; ADR-0004 (the open question it answers); ADR-0003 «Decision»
(Changelog); `docs/plans/015-sqlite-maintenance.md` «Outcome»; `docs/ROADMAP.md` «Open» item 2
(owner decisions of 2026-11-03).

Facts read while writing this plan (2026-11-03, `main` after `f64123d`, version `0.4.0`):

- `src/media-database.mjs` `getMediaDatabase(emdash)` returns `emdash.db` when it has a
  `selectFrom` function, else `getDb()` from `emdash/runtime`, else `undefined` (it catches the
  import and call). `src/index.mjs:11` exports it from the root; `src/index.d.mts:58` types it.
- `src/guard.mjs:78-81` is the existing query pattern:
  `db.selectFrom("media").select([...]).where(...)`.
- `src/layout.mjs:22-25` `contentHashVersion` accepts only `sha1:` plus 40 hex characters; any
  other value leaves URLs unversioned.
- `Picture` takes `contentHash` and `darkContentHash` (`README.md:154-155`);
  `PortableTextImage` takes `contentHash`; `PortableTextGallery` takes `contentHashes` as a
  `Map` or own-key object (`src/portable-text-gallery.mjs:41-48`).
- `README.md:164`, `:191` and `:205` tell the site to "fetch hashes for the page's media IDs in
  one site-owned query"; `SKILL.md:31` says the same. The `PortableTextImage` wrapper example
  (`README.md:193-201`) reads `Astro.locals.imageHashes?.get(ref)`.
- `test/maintenance.test.mjs:36-65` `createCleanupDatabase(directory, rows)` creates a SQLite
  database through `emdash/db/sqlite` and `runMigrations` from `emdash/db` and inserts `media`
  rows; `:67-70` `createBackfillDatabase` wraps it; `:76` `createRecordingPostgresDatabase`
  records compiled PostgreSQL queries. `node --test` with no patterns runs every `.mjs` file
  under `test/`.
- Plan 015 follow-ups (owner, 2026-11-03): `src/maintenance-database.mjs:72-74` (the
  `SQLite database path is not a regular file` branch) has no test; the test
  "backfill opens and closes a file URL database" (`test/maintenance.test.mjs:268-299`) would
  pass with the connection left open; `CHANGELOG.md` `## Unreleased` (lines 5-14) does not say
  that `backfill` now also fills rows with an upper-case `IMAGE/…` MIME type; the `file:` forms
  stay as EmDash takes them and `README.md` names `file:./…` and `file:/…`.

Architect's calls made in this plan, within ADR-0009:

- **Root export.** `loadContentHashes` is exported from `@nimitzua/emdash-images` beside
  `getMediaDatabase`, in a new `src/content-hashes.mjs`.
- **Input.** `ids` is any iterable; values that are not non-empty strings are skipped, and
  duplicates are queried once. So a site may pass `entry.data.image?.id` without checking it.
- **Batches of 500 ids**, well below SQLite's bound-variable limit and PostgreSQL's.
- **No query without ids.** An empty id list returns an empty `Map` without asking for a
  database.
- **Query errors propagate.** Only a missing database gives an empty `Map` (ADR-0009); a failing
  query throws, so a broken database is not hidden behind unversioned URLs.
- **Values as stored.** The map holds the row's `content_hash` string as stored (non-empty after
  trimming); the components already ignore a value that is not a valid `sha1:` hash.

**Version impact:** a new root export, a minor version before 1.0.0 (ADR-0003); `### Added` under
`## Unreleased` (T2). The release is 0.5.0 after this plan, together with plan 015 (owner,
2026-11-03). No `version` bump, tag, push or publish.

**Preconditions:**
- `main` is clean after plan 015: `git status --porcelain` prints nothing,
  `npm pkg get version` prints `"0.4.0"`, and `git log --oneline -n 20` shows
  `Merge plan 015: SQLite for maintenance`.

**Branch:** `task/016-content-hash-lookup` · **Worktree:** `.worktrees/emdash-images/016-content-hash-lookup`

## Tasks

### T1: Add loadContentHashes

- **Target:** `src/content-hashes.mjs` (new), `src/index.mjs`, `src/index.d.mts`,
  `test/sqlite-media.mjs` (new), `test/content-hashes.test.mjs` (new),
  `test/maintenance.test.mjs`.
- **Change:**
  - New `src/content-hashes.mjs` exporting
    `async function loadContentHashes(emdash, ids)`:
    - collects the distinct non-empty string values of `ids` (any iterable; `null`/`undefined`
      `ids` count as empty), in first-seen order; with none, returns `new Map()` without
      calling `getMediaDatabase`;
    - `getMediaDatabase(emdash)` from `./media-database.mjs`; `undefined` gives `new Map()`;
    - for each batch of at most 500 ids, one query:
      `selectFrom("media").select(["id", "content_hash"]).where("id", "in", batch).where("status", "=", "ready")`;
    - the result `Map` has an entry `id → content_hash` for each returned row whose
      `content_hash` is a string that is non-empty after `trim()`; other ids are absent;
    - a query error is not caught.
  - `src/index.mjs`: export `loadContentHashes` from `./content-hashes.mjs`.
  - `src/index.d.mts`:
    `export declare function loadContentHashes(emdash: unknown, ids: Iterable<string | null | undefined> | null | undefined): Promise<Map<string, string>>;`
  - New `test/sqlite-media.mjs`: move `createCleanupDatabase` there unchanged under the name
    `createMediaDatabase` (exported); `test/maintenance.test.mjs` imports it, and its
    `createCleanupDatabase` and `createBackfillDatabase` call it. No other change to
    `test/maintenance.test.mjs`.
  - New `test/content-hashes.test.mjs`, against a real SQLite database from
    `createMediaDatabase`, passed as `{ db: database }`:
    - `ready` rows with a hash are in the map; an `uploading` row, `ready` rows with a `null`,
      `""` or `"  "` hash, and an unknown id are absent;
    - ids given as an array with duplicates, `undefined`, `null`, `""` and a number, and as a
      `Set`, give the same map; `loadContentHashes` is importable from
      `@nimitzua/emdash-images`;
    - 1,201 distinct ids give exactly 3 queries of at most 500 ids each, and every `ready` row
      among them is in the map (count with a Kysely plugin through `database.withPlugin`);
    - an empty id list makes no query and does not call `getMediaDatabase` (an `emdash` whose
      `db` getter throws);
    - `loadContentHashes({}, ["id"])` with no database returns an empty map;
    - a database without a `media` table rejects;
    - the query compiled for PostgreSQL (a Kysely instance with `PostgresAdapter`,
      `PostgresQueryCompiler` and a recording driver, as in `test/maintenance.test.mjs`) uses
      `in ($1, …)` with only `$n` parameters.
- **Constraints:** `src/media-database.mjs`, `src/guard.mjs`, `src/picture.mjs`,
  `src/portable-text-*.mjs`, the `.astro` components and `package.json` unchanged. Components
  still never query the database. No new dependency; no `kysely` import in
  `src/content-hashes.mjs`.
- **Ownership:** `src/content-hashes.mjs`, `src/index.mjs`, `src/index.d.mts`,
  `test/sqlite-media.mjs`, `test/content-hashes.test.mjs`, `test/maintenance.test.mjs` (the
  helper move only). `loadContentHashes` and `createMediaDatabase` are new names;
  `createCleanupDatabase` is used only in `test/maintenance.test.mjs`. No existing test changes
  beyond that move.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/content-hashes.test.mjs` ends with `# fail 0` and lists the tests above
  - `node --test test/maintenance.test.mjs` ends with `# fail 0` with the same test count as on
    `main`
  - `node --test test/boundary.test.mjs` ends with `# fail 0`
  - `node --input-type=module -e "import { loadContentHashes } from '@nimitzua/emdash-images'; console.log(typeof loadContentHashes)"`
    prints `function`
  - `git grep -n "loadContentHashes" -- src/index.mjs src/index.d.mts` prints one line in each
  - `git diff main --stat` lists only this task's Ownership files
- **Commit:** `Add loadContentHashes for page-level content hashes`
- **Docs:** ADR-0009 «Decision»; `src/media-database.mjs`; `src/guard.mjs:69-90`;
  `test/maintenance.test.mjs:36-110`.
- **Size:** about 40 changed lines in `src/`, plus tests.

### T2: Document loadContentHashes

- **Target:** `README.md`, `SKILL.md`, `CHANGELOG.md`.
- **Change:**
  - `README.md` «`Picture` component»: the usage example loads the hash with
    `const contentHashes = await loadContentHashes(Astro.locals.emdash, [entry.data.featured_image?.id]);`
    and passes `contentHash={contentHashes.get(entry.data.featured_image?.id)}`; line 164's
    "fetch hashes … in one site-owned query" becomes: call `loadContentHashes` once per page
    with the page's media ids and pass each matching value; it returns only `ready` rows with a
    hash, one query per 500 ids, and an empty map when there is no database.
  - `README.md` «Portable Text images» (lines 191 and 205): the site loads the map with
    `loadContentHashes` for the image and gallery media ids of the page (`node.asset._ref` of
    `image` blocks, `images[].asset._ref` of `gallery` blocks) and exposes it to the wrappers as
    today; the two wrapper examples stay.
  - `README.md` «Package exports»: the root export names `loadContentHashes`.
  - `SKILL.md` step 5 (line 31): the hash comes from `loadContentHashes` instead of a
    site-owned query; the example on line 28 keeps its `contentHash` prop.
  - `CHANGELOG.md` `## Unreleased` `### Added`, a second entry:
    "`loadContentHashes(emdash, ids)` returns a `Map` from media id to `content_hash` for
    `ready` media in one query per 500 ids, to version `Picture`, `PortableTextImage` and
    `PortableTextGallery` URLs without a site-owned query."
- **Constraints:** Docs only. Every name and prop exists after T1. Released `CHANGELOG.md`
  sections stay. No `version` change.
- **Ownership:** `README.md`, `SKILL.md`, `CHANGELOG.md`; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n "site-owned query" -- README.md SKILL.md` prints nothing
  - `git grep -n "loadContentHashes" -- README.md SKILL.md` prints lines in «`Picture`
    component», «Portable Text images», «Package exports» and SKILL step 5
  - `git grep -n "loadContentHashes(emdash, ids)" -- CHANGELOG.md` prints one line above
    `## [0.4.0]`
  - `node scripts/release.mjs verify` prints `RELEASE OK 0.4.0`
  - `git diff main --stat` lists only T1's and this task's Ownership files
- **Commit:** `Document loadContentHashes`
- **Docs:** ADR-0009; ADR-0003 «Decision» (Changelog); `README.md` «`Picture` component»,
  «Portable Text images», «Package exports»; `SKILL.md` step 5.
- **Size:** about 30 changed lines of docs.

### T3: Close plan 015 follow-ups

- **Target:** `test/maintenance-database.test.mjs`, `test/maintenance.test.mjs`, `README.md`,
  `CHANGELOG.md`.
- **Change:**
  - `test/maintenance-database.test.mjs`, new test: `openMaintenanceDatabase` with
    `DATABASE_URL` set to `file:` plus an existing directory rejects with
    `SQLite database path is not a regular file`, and the directory is unchanged.
  - `test/maintenance.test.mjs`: the test "backfill opens and closes a file URL database" also
    proves the close, and a new cleanup test does the same for `cleanupImageCache` with a
    `file:` URL. The check must fail when the `close()` call in the command's `finally` is
    removed; one way is that the database's `-wal` file is gone after the call once every other
    connection to it is closed (SQLite removes it when the last connection closes). The report
    shows the failing line with `close()` removed from `src/backfill.mjs` and from
    `src/cleanup.mjs`, and the passing line with the code restored.
  - `README.md` «Command line», the database paragraph (line 330): one sentence that the
    `file:` URL is read as EmDash's `sqlite({ url })` reads it, so use `file:./…` or `file:/…`;
    `file://` forms and percent-encoding are not decoded.
  - `CHANGELOG.md` `## Unreleased` `### Changed`, a third entry: "`backfill` now also fills
    metadata for rows whose MIME type is stored in upper case (`IMAGE/…`), which PostgreSQL
    used to skip."
- **Constraints:** Tests and docs only: `src/` unchanged. Released `CHANGELOG.md` sections
  stay. No `version` change.
- **Ownership:** `test/maintenance-database.test.mjs`, `test/maintenance.test.mjs`,
  `README.md`, `CHANGELOG.md`. The changed test is
  "backfill opens and closes a file URL database" (`test/maintenance.test.mjs:268-299`); no
  other existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node --test test/maintenance-database.test.mjs` ends with `# fail 0` and lists the
    non-regular-file test
  - `node --test test/maintenance.test.mjs` ends with `# fail 0` and lists the new cleanup close
    test
  - the report holds the failing result line of both close checks with `close()` removed, and
    `git diff main -- src` prints nothing
  - `git grep -n -e "file:./" -e "percent-encoding" -- README.md` prints the «Command line»
    sentence
  - `git grep -n "IMAGE/" -- CHANGELOG.md` prints one line above `## [0.4.0]`
  - `node scripts/release.mjs verify` prints `RELEASE OK 0.4.0`
  - `git diff main --stat` lists only T1's, T2's and this task's Ownership files
- **Commit:** `Test maintenance database edge cases and note them`
- **Docs:** `docs/plans/015-sqlite-maintenance.md` «Outcome» «Follow-ups»;
  `src/maintenance-database.mjs`; `src/backfill.mjs` and `src/cleanup.mjs` (`finally`);
  `node_modules/emdash/dist/db/sqlite.mjs`.
- **Size:** about 10 lines of docs, plus tests.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` from the worktree's copy prints `RELEASE OK 0.4.0`
- `git diff main -- src/media-database.mjs src/guard.mjs src/service.mjs src/picture.mjs src/maintenance-database.mjs src/backfill.mjs src/cleanup.mjs src/cli.mjs package.json package-lock.json .github` prints nothing

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
