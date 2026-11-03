# 017 End-to-end test site

**Goal:** Prove the package in a real built EmDash site: a fixture site in the repository is
built with Astro and the Node adapter, served, and checked over HTTP for pages, `/_image`
variants, the guard, `backfill`, warm-up and cleanup, by a separate `npm run test:e2e` that CI
runs.

**Context:** ADR-0002 (package boundary: the fixture is test code, not site markup the package
ships), ADR-0004, ADR-0006, ADR-0008 (the components), ADR-0009 (SQLite maintenance and
`loadContentHashes`); `README.md` «Astro configuration», «`Picture` component», «Portable Text
images»; `SKILL.md` «Steps»; `docs/plans/016-content-hash-lookup.md` «Outcome».

Facts read while writing this plan (2026-11-03, `main` after `1f816d4`, version `0.5.0`,
EmDash 1.4.0, Astro 7.4.5 installed; paths under `node_modules/` unless they start with `src/`,
`test/` or `.github/`):

- Today every test runs against fakes of EmDash: `npm test` is `node --test && vitest run
  --reporter=verbose`; `node --test` with no patterns runs Node's default globs (among them
  `**/*.test.mjs` and `**/test/**/*.mjs`), and `vitest.config.mjs` includes only
  `astro-tests/**/*.render.mjs`. `.github/workflows/ci.yml` runs `npm ci`, `npm test`,
  `node scripts/release.mjs verify` on Node 26.
- `README.md:62-118` is the documented site setup: `@astrojs/node` standalone, `emdash()` from
  `emdash/astro` with `database`, `storage: local({ directory, baseUrl:
  "/_emdash/api/media/file" })`, `plugins: [emdashImages(...)]`,
  `middleware: { outer: "./src/lib/outer-middleware.mjs" }`, and Astro `image.remotePatterns:
  [{ pathname: "/_emdash/api/media/file/**" }]`, `image.service: imageService(imageOptions)`.
- `@astrojs/node` is not installed; its latest is 11.1.9 with peer `astro: ^7.2.1`.
  `@astrojs/react`, `react`, `react-dom` are installed (EmDash peers). EmDash only warns when
  `@astrojs/react` is not in the config; the build succeeds and only the admin does not hydrate
  (`emdash/src/astro/integration/index.ts:309-334`).
- `sqlite({ url })` from `emdash/db`; the `file:` path is opened relative to `process.cwd()`
  (`emdash/src/db/sqlite.ts:19-21`), and `local()` resolves `directory` with `path.resolve`
  (`emdash/src/storage/local.ts:48`): the fixture passes absolute paths.
- Migrations run on the first request that initializes the runtime (default mode `auto`,
  `emdash/src/database/migrations/policy.ts:27-28`); `/_image` requests skip runtime init
  (`emdash/src/astro/middleware.ts:813-824`). `runMigrations` is exported from `emdash/db`;
  `test/sqlite-media.mjs` already creates a migrated SQLite database with `createDialect` from
  `emdash/db/sqlite` and inserts `media` rows.
- `applySeed(db, seed, options)` and `validateSeed` are exported from `emdash`
  (`emdash/src/index.ts:699`); `SeedApplyOptions` has `includeContent`, `onConflict`, `storage`
  (`emdash/src/seed/types.ts:365-402`); a collection takes `urlPattern`
  (`emdash/src/seed/types.ts:97`). Seed `$media` only downloads public http(s) URLs (SSRF
  guard), so local media cannot come from a seed: the fixture writes the original files and the
  `media` rows itself and puts literal `MediaValue`s into the content. A local `MediaValue` is
  `{ provider: "local", id, alt, width, height, mimeType, filename, meta: { storageKey } }`; its
  URL is `/_emdash/api/media/file/<storageKey>`. A Portable Text `image` block is
  `{ _type: "image", _key, asset: { _ref: <media id>, url, alt, width, height } }`, a `gallery`
  block holds `images` of the same `asset` shape (`emdash/src/content/converters/gallery.ts`).
- After `applySeed` with collections, `seed_complete` is set and the runtime's own auto-seed
  does not run (`emdash/src/emdash-runtime.ts:1851-1876`).
- Pages query with `getEmDashEntry(type, idOrSlug)` from `emdash`; the site needs
  `src/live.config.ts` with `_emdash: defineLiveCollection({ loader: emdashLoader() })`
  (`emdash/README.md:44-52`). EmDash routes `/sitemap.xml` and `/sitemap-[collection].xml`,
  built from each collection's `urlPattern` (`emdash/src/astro/integration/routes.ts:1046-1056`).
- `/_emdash/api/media/file/` is a public API prefix (`emdash/src/astro/middleware/auth.ts:108`).
- Package behaviour the test checks: `withImageGuard(onRequest, { deniedStorageKeyPrefixes,
  onDeniedStorageKey })` answers a denied `/_image` request with `onDeniedStorageKey(context)`
  (`src/guard.mjs:11-25`); a versioned image response gets `Cache-Control: public,
  max-age=31536000, immutable` (`src/guard.mjs:8`, `:186-188`); the version parameter is `v`
  (`src/service.mjs:296`), the first 16 hex characters of a `sha1:` hash (`src/layout.mjs:22-25`).
  `backfill` reads originals from `UPLOADS_DIR` (`src/backfill.mjs:183`) and the database from
  `DATABASE_URL`. `warmPublicSite(requestOrigin, publicOrigin, options)` from
  `@nimitzua/emdash-images/warmup` returns `{ variants, generated, cached, failures, ... }`
  (`src/warmup.d.mts:1-13`, `:48-52`) and starts from `/sitemap.xml` (`src/warmup.mjs:260`).

Architect's calls made in this plan:

- **A separate command.** `npm run test:e2e` runs `node --test` on `e2e/*.e2e.mjs` only. `npm
  test`, `prepublishOnly` and `release.yml` stay as they are; CI runs the e2e step after
  `npm test`. A file name ending in `.e2e.mjs` is outside Node's default test globs, so
  `npm test` never picks it up.
- **One e2e file, one build.** `e2e/site.e2e.mjs` builds the fixture once and runs its checks in
  order (build, serve, maintenance); T1 to T3 each add their part.
- **The fixture imports the package by its published specifiers** (`@nimitzua/emdash-images`,
  `/Picture.astro`, `/PortableTextImage.astro`, `/PortableTextGallery.astro`, `/warmup`), through
  Node's package self-reference or a git-ignored `e2e/site/node_modules/@nimitzua/emdash-images`
  link to the repository root that the harness creates; never through aliases or relative paths
  into `src/`, so the `exports` map is tested too.
- **Fresh data per run** under the git-ignored `e2e/site/.data/`: SQLite database, uploads and
  image cache, created by the harness before the server starts.
- **No source change.** The plan changes nothing under `src/`. If the site exposes a package bug,
  the executor stops and asks; the fix becomes a task or the next plan.
- **Docs:** `docs/TESTING.md` (new) for contributors; `README.md` and `SKILL.md` name EmDash 1.4
  as supported once the site passes on it.

**Version impact:** none. A new dev dependency (`@astrojs/node`), test files, CI and docs; no
change to `exports`, `src/*.d.mts`, options or behaviour, so no `CHANGELOG.md` entry
(ADR-0003). No `version` bump, tag, push or publish.

**Preconditions:**
- `main` is clean: `git status --porcelain` prints nothing, `npm pkg get version` prints
  `"0.5.0"`, `git log --oneline -n 5` shows `Update astro, kysely and vitest within their
  ranges`.
- `npm view @astrojs/node@11.1.9 peerDependencies` prints `astro: '^7.2.1'`.

**Branch:** `task/017-e2e-site` · **Worktree:** `.worktrees/emdash-images/017-e2e-site`

## Tasks

### T1: Build a fixture EmDash site

- **Target:** `e2e/site/astro.config.mjs`, `e2e/site/src/live.config.ts`,
  `e2e/site/src/lib/image-options.mjs`, `e2e/site/src/lib/outer-middleware.mjs`,
  `e2e/site/src/pages/posts/[slug].astro` (all new), `e2e/harness.mjs` (new),
  `e2e/site.e2e.mjs` (new), `package.json`, `package-lock.json`, `.gitignore`.
- **Change:**
  - `package.json`: `devDependencies` gains `"@astrojs/node": "^11.1.9"`; `scripts` gains
    `"test:e2e": "node --test --test-concurrency=1 --test-timeout=300000 e2e/*.e2e.mjs"`. Then
    `ask` "dependencies changed, run install"; the architect installs and commits nothing.
  - `.gitignore` ignores `e2e/site/.data/`, `e2e/site/dist/`, `e2e/site/.astro/`,
    `e2e/site/node_modules/`.
  - The fixture follows `README.md` «Astro configuration»: `output: "server"`,
    `adapter: node({ mode: "standalone" })`, `emdash({ database: sqlite({ url }), storage:
    local({ directory, baseUrl: "/_emdash/api/media/file" }), plugins: [emdashImages(...)],
    middleware: { outer: "./src/lib/outer-middleware.mjs" } })`, `image.service:
    imageService(imageOptions)` and `image.remotePatterns: [{ pathname:
    "/_emdash/api/media/file/**" }]`. The database and uploads paths are absolute paths under
    `e2e/site/.data/`, computed from `import.meta.url`. No `@astrojs/react`.
  - `image-options.mjs` default-exports `{ publicWidths: [640, 1200],
    deniedStorageKeyPrefixes: ["restricted/"], deniedPagePathPrefixes: [] }`.
  - `outer-middleware.mjs` exports `onRequest = withImageGuard((context, next) => next(),
    { deniedStorageKeyPrefixes, onDeniedStorageKey: () => new Response("private", { status:
    404, headers: { "Cache-Control": "no-store", "X-E2E-Denied": "1" } }) })`.
  - `posts/[slug].astro` loads the entry with `getEmDashEntry("posts", slug)` (404 when
    missing), calls `loadContentHashes(Astro.locals.emdash, ids)` once with the ids of the
    `hero` field and of every image and gallery image in `body`, renders `hero` with
    `Picture` (`contentHash` from the map) and `body` with EmDash's `PortableText` from
    `emdash/ui`, its `image` and `gallery` types replaced by small wrappers or inline
    components that pass the map's hash (`contentHash` / `contentHashes`) to
    `PortableTextImage` and `PortableTextGallery`, as `README.md` «Portable Text images» shows.
  - `e2e/harness.mjs` exports `buildSite()`, which links the package if needed and runs Astro's
    programmatic `build({ root })` for `e2e/site`.
  - `e2e/site.e2e.mjs` has a first test "the fixture site builds" that calls `buildSite()` and
    asserts `e2e/site/dist/server/entry.mjs` exists.
- **Constraints:** nothing under `src/`, `test/`, `astro-tests/` changes; `npm test`, `vitest`
  config and `prepublishOnly` unchanged; the fixture imports only published specifiers of the
  package (see «Architect's calls»); no network beyond the local install. If the build fails
  inside EmDash or Astro rather than in the fixture, `ask` with the first error line.
- **Ownership:** the Target files; no existing test changes (grep: no test reads
  `devDependencies` or `scripts`; `test/boundary.test.mjs` reads only `dependencies` and
  `peerDependencies` and scans `src/`).
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `npm run test:e2e` passes "the fixture site builds"
  - `npm test` after `npm run test:e2e` reports `pass 211` for `node --test` and
    `Tests  15 passed (15)` for vitest (no e2e or build file is picked up)
  - `git status --short` after `npm run test:e2e` lists no file under `e2e/site/.data/`,
    `e2e/site/dist/`, `e2e/site/.astro/` or `e2e/site/node_modules/`
  - `git diff main --stat -- src test astro-tests vitest.config.mjs` prints nothing
- **Commit:** `Add a fixture EmDash site that builds with the package`
- **Docs:** `README.md` «Astro configuration», «`Picture` component», «Portable Text images»;
  this plan's facts list.
- **Size:** about 150 changed lines, lockfile excluded.

### T2: Serve the fixture site and check pages and /_image

- **Target:** `e2e/harness.mjs`, `e2e/site.e2e.mjs`.
- **Change:**
  - `e2e/harness.mjs` gains:
    - `prepareSiteData()`: deletes and recreates `e2e/site/.data/`; creates the SQLite database
      with `createDialect` and `runMigrations`; applies a seed object with `applySeed` (schema
      and content, `includeContent: true`): a `posts` collection with `urlPattern`
      `"/posts/{slug}"` and fields `title` (string), `hero` (image), `body` (portableText), and
      one published entry, slug `hello`, whose `hero` is a local `MediaValue`, whose `body` has
      one text block, one `image` block and one `gallery` block with two images; writes three
      PNG originals generated with `sharp` (each at least 1400 px wide, distinct sizes) into the
      uploads directory and a fourth under the storage key prefix `restricted/`; inserts the
      four `media` rows (`status` `ready`, `width`, `height`, `mime_type`, `size`,
      `storage_key`) **without** `content_hash`, `blurhash` or `dominant_color`.
    - `startSite()`: spawns `node e2e/site/dist/server/entry.mjs` with `HOST=127.0.0.1`, a free
      `PORT`, `IMAGE_CACHE_DIR` under `.data/`, `NODE_ENV=production`, `cwd` `e2e/site`; waits
      until `GET /posts/hello` answers; returns `{ origin, stop }`. `stop()` ends the process
      and is called in an `after` hook even when a test fails.
  - `e2e/site.e2e.mjs` adds, after the build test, with one server for all of them:
    - "a post renders AVIF and WebP sources for its hero, image block and gallery": `GET
      /posts/hello` is 200; the HTML has a `<picture>` per image (hero, the `image` block, two
      gallery images), each with `type="image/avif"` and `type="image/webp"` sources whose
      `srcset` URLs start with `/_image?`; no generated URL carries `v=` (no hashes yet).
    - "every generated /_image URL serves an image": each distinct URL from the page is 200 with
      `Content-Type` `image/avif` or `image/webp` matching its `f` parameter and a non-empty
      body; a second request for one URL returns the same bytes, and the image cache directory
      has files.
    - "a denied storage key is answered by the site's handler": a `/_image` URL built like the
      page's but with `href` `/_emdash/api/media/file/restricted/<key>` is 404 with
      `X-E2E-Denied: 1`.
- **Constraints:** as T1. Content is written only through `applySeed` and `media` inserts in the
  harness, never through the admin API. If the server cannot listen on `127.0.0.1` in the
  sandbox, `ask` with the error line. If a check fails because of package code under `src/`,
  `ask` with the failing assertion; do not change `src/`.
- **Ownership:** the Target files; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `npm run test:e2e` passes the build test and the three tests named in Change
  - `npm run test:e2e` with each of the three tests' key assertion inverted fails that test
    (report the failing line for each, then restore)
  - after `npm run test:e2e`, no `node` process started by the harness is left (`pgrep -fl
    'dist/server/entry.mjs'` prints nothing)
  - `git diff <T1 commit> --stat -- src test astro-tests` prints nothing
- **Commit:** `Serve the fixture site and check pages and image variants`
- **Docs:** `README.md` «Options» (`IMAGE_CACHE_DIR`), «Astro configuration» (the guard);
  this plan's facts list.
- **Size:** about 150 changed lines.

### T3: Run backfill, warm-up and cleanup against the fixture site

- **Target:** `e2e/site.e2e.mjs`, `e2e/harness.mjs` (helpers only).
- **Change:** `e2e/site.e2e.mjs` adds, after T2's tests and on the same running server and
  data:
  - "backfill versions the page's image URLs": runs `node src/bin.mjs backfill --write` with
    `DATABASE_URL=file:<absolute .data database>` and `UPLOADS_DIR=<absolute .data uploads>`;
    exit code 0 and the output line `Failed rows: 0`; then `GET /posts/hello` again: every
    generated `/_image` URL now carries `v=` with 16 lower-case hex characters, equal to the
    first 16 hex characters of that media row's `content_hash` read from the database.
  - "a versioned variant is immutable": one versioned URL is 200 with `Cache-Control`
    `public, max-age=31536000, immutable`.
  - "warm-up generates once and then serves from cache": `warmPublicSite(origin, origin,
    { cacheDirectory, deniedStorageKeyPrefixes: ["restricted/"] })` from
    `@nimitzua/emdash-images/warmup` twice; the first has `failures` `[]` and `variants` > 0;
    the second has `failures` `[]` and `generated` 0.
  - "cleanup finds nothing to delete in a fresh cache": runs `node src/bin.mjs cleanup` (dry
    run) with the same `DATABASE_URL` and `IMAGE_CACHE_DIR`; exit code 0 and the output line
    `Candidates: 0 files, 0 bytes`.
- **Constraints:** as T2. The commands run as a site owner would run them (`src/bin.mjs` with
  environment variables), not through internal functions. If warm-up cannot find the post
  through `/sitemap.xml`, `ask` before changing anything else.
- **Ownership:** the Target files; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `npm run test:e2e` passes all tests of T1, T2 and the four named here
  - `npm run test:e2e` with the backfill step skipped fails "backfill versions the page's image
    URLs" (report the failing line, then restore)
  - `git diff <T2 commit> --stat -- src test astro-tests` prints nothing
- **Commit:** `Check backfill, warm-up and cleanup against the fixture site`
- **Docs:** `README.md` «Command line», `SKILL.md` steps 8 and 9; this plan's facts list.
- **Size:** about 120 changed lines.

### T4: Run the e2e site in CI and document it

- **Target:** `.github/workflows/ci.yml`, `docs/TESTING.md` (new), `README.md`, `SKILL.md`.
- **Change:**
  - `ci.yml`: a step `- run: npm run test:e2e` after `- run: npm test`.
  - `docs/TESTING.md`: what `npm test` covers (unit tests with fakes, Astro render tests) and
    what `npm run test:e2e` covers (the fixture site, its data under `e2e/site/.data/`, the
    checks of T2 and T3), how to run it locally, that it is not part of `prepublishOnly`, and
    that a failure there that points into `src/` is a package bug.
  - `README.md` «Supported versions»: the EmDash row reads `1.3.x, 1.4.x`. `SKILL.md` step 1:
    "EmDash 1.3 or 1.4".
- **Constraints:** `release.yml` unchanged; no `CHANGELOG.md` entry (no package behaviour or API
  change); nothing under `src/`, `test/`, `e2e/` changes.
- **Ownership:** the Target files; no existing test changes (grep: no test reads `ci.yml`,
  `README.md` or `SKILL.md`).
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `.github/workflows/ci.yml` has `- run: npm run test:e2e` directly after `- run: npm test`
  - `docs/TESTING.md` names `npm test`, `npm run test:e2e` and `e2e/site/.data/`, and every
    command in it runs as written
  - `README.md` «Supported versions» EmDash row is `1.3.x, 1.4.x`; `SKILL.md` step 1 names
    EmDash 1.3 or 1.4
  - `git diff <T3 commit> --stat` lists only the four Target files
- **Commit:** `Run the e2e site in CI and document the test suites`
- **Docs:** `docs/RELEASING.md` (what `prepublishOnly` runs), `README.md` «Supported versions».
- **Size:** about 60 changed lines.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `npm run test:e2e` passes every test of T1 to T3
- `node scripts/release.mjs verify` prints `RELEASE OK 0.5.0`
- `git diff main --stat -- src .github/workflows/release.yml` prints nothing
- `git diff main --stat -- package.json` shows only the `devDependencies` and `scripts` lines of T1

## Amendments

None.

## Outcome

Filled after merge, from `status.md`. The next plan reads this, not the run's conversation.
