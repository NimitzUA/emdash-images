# 018 Warm-up public origin and summary

**Goal:** Warm-up stops passing silently when the site's sitemap names another origin: it reports
sitemap locations outside its public origin as failures, the `warm` command prints its summary
and failures, the docs say how to align the origins, and the fixture site from plan 017 runs on
`127.0.0.1` with `EMDASH_SITE_URL` and checks both.

**Context:** `docs/plans/017-e2e-site.md` «Outcome» (follow-ups: product, fixture, harness,
tests); `docs/ROADMAP.md` «Open» item 1; `README.md` «Astro configuration», «Command line»;
`SKILL.md` steps 8 and «Common mistakes»; `docs/TESTING.md`; ADR-0003 (releases).

Facts read while writing this plan (2026-11-04, `main` at `ba43a91`, version `0.5.0`, EmDash
1.4.0, Astro 7.4.5; paths under `node_modules/` unless they start with `src/`, `test/`, `e2e/`
or a top-level file):

- `collectSitemapPages` (`src/warmup.mjs:259-302`) maps each sitemap `<loc>` with
  `mapSiteUrlToRequestUrl` (`src/warmup.mjs:57-74`), which returns `undefined` for a URL whose
  origin is not the public origin, for credentials and for a denied path. A child sitemap
  (`:280-283`) or a page (`:285-290`) that maps to `undefined` is dropped without a failure.
  `/` and a random `/__cache-warm-404-…` path are always added (`:298-299`).
- EmDash's `/sitemap.xml` writes its `<loc>`s from `settings.url` (site settings), else
  `getPublicOrigin(url, emdash.config)` (`emdash/src/astro/routes/sitemap.xml.ts:38-42`):
  `config.siteUrl`, then `EMDASH_SITE_URL` or `SITE_URL` from `process.env` (read once and
  cached), then the request URL (`emdash/src/api/public-url.ts:40-90`).
- On the Node adapter the request URL takes the `Host` header only when it matches
  `security.allowedDomains`; otherwise it is `localhost:<server port>`
  (`astro/dist/core/app/node.js:33-46`, `:68-89`).
- `createLocalWarmupOrigins` (`src/warmup.mjs:197-210`) uses `http://127.0.0.1:<PORT or
  SITE_PORT>` as request origin and `EMDASH_SITE_URL` (not `SITE_URL`) as public origin, else
  the request origin. The native plugin's scheduler runs `warmLocalSite(process.env, options)`
  inside the site process (`src/warmup.mjs:509-512`) and logs `[image-warmup] <failures>`
  (`:471-473`).
- So with no `EMDASH_SITE_URL`, no `siteUrl`, no site settings URL and no `allowedDomains`, the
  sitemap says `http://localhost:<port>/…`, warm-up's public origin is `http://127.0.0.1:<port>`,
  every child sitemap is dropped, and warm-up renders only `/` with `failures` `[]`.
- `runCli` `warm` (`src/cli.mjs:173-187`) returns `1` when `summary.failures` is non-empty and
  `0` otherwise, and prints nothing: no summary and no failure text. `src/bin.mjs` only sets
  `process.exitCode`. `README.md:330` and `SKILL.md` step 8 nevertheless say warm "should report
  `Generated: 0`". `runCli` takes `log` and `errorLog` (`src/cli.mjs:62-68`).
- `ImageWarmupSummary` (`src/warmup.d.mts:1-13`): `pagesRequested`, `pagesRendered`,
  `pageFailures`, `sitemaps`, `variants`, `generated`, `cached`, `failedVariants`, `failures`,
  `elapsedMs`, `cacheAccountingAvailable`.
- Tests that touch this: `test/warmup.test.mjs` "warm-up renders pages before variants and
  reports the second pass as cached" (`:179-253`) serves same-origin `<loc>`s only and asserts
  no `failures`; `test/cli.test.mjs` warm tests (`:10-57`, `:350-424`) use fake commands that
  return `{ failures: [...] }` without counts and pass no `log`. No test asserts that `warm`
  prints nothing.
- The fixture (`e2e/harness.mjs:149-216`) binds `HOST=127.0.0.1` but uses origin
  `http://localhost:<port>` and sets no `EMDASH_SITE_URL`; `findFreePort` checks `127.0.0.1`
  only (`:259-270`); the startup `fetch` has no timeout (`:201`); `buildSite()` does not clear
  `dist` (`:24-27`). `startSite()` returns `{ origin, stop }`. `e2e/site.e2e.mjs` "the fixture
  site builds" only checks that `dist/server/entry.mjs` exists (`:14-17`); the `v=` checks read
  `/_image?` URLs only (`:53-56`, `:167-178`). `package.json:89` is `"test:e2e": "node --test
  --test-concurrency=1 --test-timeout=300000 e2e/*.e2e.mjs"`.
- `./scripts/orca/check.sh --e2e` runs `npm test` and `npm run test:e2e` and ends with
  `CHECK OK`; reviewer sandboxes cannot run the e2e step (`listen EPERM`, plan 017 «Outcome»).

Architect's calls made in this plan:

- **Any sitemap location outside the public origin is a failure**, not only a sitemap with no
  in-origin location: the sitemap protocol keeps a sitemap's locations on its own host, and a
  partly wrong sitemap also leaves pages cold. One failure line per sitemap file, with the
  count and the first such location; locations under denied paths, with credentials or that do
  not parse are not counted. Warm-up still warms the in-origin locations.
- **The documented fix is `EMDASH_SITE_URL`**, set to the public origin in the site's runtime
  environment and in the `warm` command's environment; site settings URL and `siteUrl` must
  name the same origin. `security.allowedDomains` is named as the reason the request URL says
  `localhost`, not as the fix.
- **Not in this plan:** reading `SITE_URL` in `createLocalWarmupOrigins`, and any change to how
  warm-up maps or requests URLs. The docs say that warm reads `EMDASH_SITE_URL` only.

**Version impact:** minor, next release `0.6.0` (pre-1.0 behaviour change, ADR-0003). Warm-up
returns new `failures` entries, so `warm` can exit `1` and the plugin can log where it was
silent; `warm` prints a summary. No change to `exports`, `src/*.d.mts` or options. `CHANGELOG.md`
`## Unreleased` gains `### Changed` (T1) and `### Fixed` (T2). No `version` bump, tag, push or
publish.

**Preconditions:**
- `main` is clean: `git status --porcelain` prints nothing, `npm pkg get version` prints
  `"0.5.0"`, `git log --oneline -n 3` shows `Record plan 017 outcome and update the roadmap`.

**Branch:** `task/018-warm-up-public-origin` · **Worktree:**
`.worktrees/emdash-images/018-warm-up-public-origin`

## Tasks

### T1: Report sitemap locations outside the public origin

- **Target:** `src/warmup.mjs`, `test/warmup.test.mjs`, `CHANGELOG.md`.
- **Change:**
  - In `collectSitemapPages`, for each fetched sitemap file (index or `urlset`), count the
    `<loc>`s that parse against the public origin to a URL whose `origin` differs from the
    public origin's `origin`. When the count is above 0, push one failure:
    `` `sitemap ${localUrl.pathname}: ${count} of ${locations.length} locations are outside ${publicOrigin.origin} (first: ${first})` ``,
    where `first` is the first such location as written in the sitemap. Locations that fail to
    parse, carry credentials or fall under a denied path are not counted. In-origin locations
    are handled as today.
  - `test/warmup.test.mjs` gains a test "warm-up reports sitemap locations outside its public
    origin": a local server whose `/sitemap.xml` index lists one in-origin child sitemap and one
    `http://localhost:<port>/…` child, and whose child `urlset` lists one in-origin page and one
    off-origin page; `warmPublicSite(origin, origin, { cacheDirectory })` with origin
    `http://127.0.0.1:<port>` returns exactly two failures, `sitemap /sitemap.xml: 1 of 2
    locations are outside http://127.0.0.1:<port> (first: http://localhost:<port>/…)` and the
    child's equivalent, and still renders the in-origin page (`pagesRendered` counts it).
  - `CHANGELOG.md` `## Unreleased` gains `### Changed` with one item: warm-up reports sitemap
    locations outside its public origin as failures (so `warm` exits `1` and the plugin logs
    them) instead of skipping them silently; set `EMDASH_SITE_URL` to the origin the sitemap
    uses.
- **Constraints:** no change to `mapSiteUrlToRequestUrl`, `extractSitemapLocations`, the
  `ImageWarmupSummary` shape, `src/*.d.mts`, request headers or redirect handling; existing
  failure texts unchanged.
- **Ownership:** the Target files; no existing test changes (grep: the only warm-up run in
  `test/` with sitemaps, `test/warmup.test.mjs:179-253`, serves same-origin `<loc>`s; the e2e
  warm-up test calls `warmPublicSite(site.origin, site.origin)` against a sitemap on the same
  `localhost` origin).
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`, and `.scratch/tmp/check.log` lists the test
    "warm-up reports sitemap locations outside its public origin" as passed
  - the new test fails with the `src/warmup.mjs` change undone (report the failing line, then
    restore)
  - `./scripts/orca/check.sh --e2e` ends with `CHECK OK` (the plan 017 e2e tests still pass;
    the reviewer marks it `NOT RUN` if its sandbox cannot listen, and the gates rerun it)
  - `git diff main --stat` lists only `src/warmup.mjs`, `test/warmup.test.mjs`, `CHANGELOG.md`
- **Commit:** `Report sitemap locations outside the warm-up public origin`
- **Docs:** this plan's facts list; `CHANGELOG.md` top; `README.md` «Command line».
- **Size:** about 30 changed lines, tests excluded.

### T2: Print the warm command's summary and failures

- **Target:** `src/cli.mjs`, `test/cli.test.mjs`, `CHANGELOG.md`.
- **Change:**
  - After `warm` runs, `runCli` prints with `log`, one per line:
    `Sitemaps: <sitemaps>`, `Pages: <pagesRendered> of <pagesRequested> rendered`,
    `Variants: <variants>`, `Generated: <generated>`, `Cached: <cached>`,
    `Failures: <failures.length>`. `Generated` and `Cached` print `unknown` unless
    `cacheAccountingAvailable` is `true`; a missing count prints `0`. Then each failure is
    printed with `errorLog` as `- <failure>`. The exit code stays `1` with failures, else `0`.
  - `test/cli.test.mjs` gains a test "warm prints its summary and each failure": fake
    `warmLocalSite` returns a full summary with two failures and `cacheAccountingAvailable:
    true`; `runCli(["warm"], { env: { PORT: "4321" }, log, errorLog, commands })` returns `1`,
    `log` received exactly the six lines in order, `errorLog` exactly the two `- …` lines; and
    a second run with `cacheAccountingAvailable: false` and no failures returns `0` with
    `Generated: unknown`, `Cached: unknown`, `Failures: 0`.
  - `CHANGELOG.md` `## Unreleased` gains `### Fixed` with one item: `emdash-images warm` prints
    its summary (sitemaps, pages, variants, generated, cached, failures) and each failure;
    before, it printed nothing and only set the exit code.
- **Constraints:** no change to argument parsing, usage texts, exit codes, the commands' options
  or to `backfill` and `cleanup` output; existing tests unchanged (their fake summaries without
  counts must not throw).
- **Ownership:** the Target files; no existing test changes (grep: no test in `test/` asserts
  that `warm` prints nothing; the warm tests at `test/cli.test.mjs:10-57` and `:350-424` pass
  no `log`, so the new lines go to `console.log` there).
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`, and `.scratch/tmp/check.log` lists "warm
    prints its summary and each failure" as passed
  - the new test fails with the `src/cli.mjs` change undone (report the failing line, then
    restore)
  - `node src/bin.mjs warm --origin http://127.0.0.1:9` prints `Sitemaps: `, `Pages: `,
    `Variants: `, `Generated: `, `Cached: `, a `Failures: ` line with a count above 0 and at
    least one `- sitemap /sitemap.xml failed: …` line, and exits with code 1
  - `git diff <T1 commit> --stat` lists only `src/cli.mjs`, `test/cli.test.mjs`, `CHANGELOG.md`
- **Commit:** `Print the warm command's summary and failures`
- **Docs:** `README.md` «Command line»; `SKILL.md` step 8; this plan's facts list.
- **Size:** about 30 changed lines, tests excluded.

### T3: Run the fixture on its public origin and check warm-up through the command

- **Target:** `e2e/harness.mjs`, `e2e/site.e2e.mjs`, `package.json` (`scripts.test:e2e` only).
- **Change:**
  - `startSite()` uses origin `http://127.0.0.1:<port>`, starts the server with
    `EMDASH_SITE_URL` set to that origin, gives each startup `fetch` `AbortSignal.timeout(5000)`,
    and returns `{ origin, port, stop }`.
  - `buildSite()` removes `e2e/site/dist` before `build()`; "the fixture site builds" also
    asserts that `dist/server/entry.mjs` was written after the test started (its `mtimeMs`).
  - The first page test also asserts that no `src` or `srcset` URL in an `<img>` or `<source>`
    of `/posts/hello` has a path under `/_emdash/api/media/file/`: every image goes through
    `/_image`.
  - After "warm-up generates once and then serves from cache", two tests on the same server:
    - "the warm command warms the running site": `runPackageCli(["warm", "--config",
      "src/lib/image-options.mjs"], { PORT, EMDASH_SITE_URL: site.origin, IMAGE_CACHE_DIR })`
      exits `0`, and its output has the lines `Generated: 0` and `Failures: 0` (the cache is
      already warm).
    - "warm-up reports a sitemap on another origin": `warmPublicSite(site.origin,
      "http://localhost:<port>", options)` returns a failure that starts with
      `sitemap /sitemap.xml: ` and contains `outside http://localhost:<port>`.
  - `package.json` `scripts.test:e2e` gains `--test-force-exit`, so a failed Astro build ends
    the run instead of leaving it open.
- **Constraints:** nothing under `src/`, `test/`, `astro-tests/` or `e2e/site/` changes; no
  `security.allowedDomains` in the fixture; the cleanup test stays last. If the site answers
  differently with `EMDASH_SITE_URL` set (a redirect, another status), `ask` with the response
  before changing anything else.
- **Ownership:** the Target files; no existing test changes (grep: `localhost` appears in `e2e/`
  only at `e2e/harness.mjs:151`; `site.origin` users are in `e2e/site.e2e.mjs`).
- **Acceptance:**
  - `./scripts/orca/check.sh --e2e` ends with `CHECK OK` (reviewer: `NOT RUN` if its sandbox
    cannot listen; the gates rerun it)
  - `.scratch/tmp/check.log` lists all 10 e2e tests as passed, among them "the warm command
    warms the running site" and "warm-up reports a sitemap on another origin"
  - "warm-up reports a sitemap on another origin" fails with T1's `src/warmup.mjs` change undone
    (report the failing line, then restore)
  - `npm pkg get scripts.test:e2e` prints a value containing `--test-force-exit`
  - `git diff <T2 commit> --stat` lists only `e2e/harness.mjs`, `e2e/site.e2e.mjs`,
    `package.json`
- **Commit:** `Run the fixture site on its public origin and warm it by command`
- **Docs:** `docs/TESTING.md`; plan 017 «Outcome» follow-ups; this plan's facts list.
- **Size:** about 70 changed lines.

### T4: Document the warm-up public origin and summary

- **Target:** `README.md`, `SKILL.md`, `docs/TESTING.md`.
- **Change:**
  - `README.md` «Astro configuration», after the native plugin paragraph: a short paragraph
    "Warm-up public origin": warm-up reads `/sitemap.xml` and warms only locations on its public
    origin, and reports others as failures; EmDash writes sitemap locations from the site
    settings URL, then EmDash's `siteUrl`, then `EMDASH_SITE_URL` or `SITE_URL`, then the
    request URL, which on the Node adapter without `security.allowedDomains` is
    `http://localhost:<port>`; set `EMDASH_SITE_URL` to the public origin in the site's runtime
    environment (and keep site settings URL and `siteUrl` empty or equal to it). Warm reads
    `EMDASH_SITE_URL`, not `SITE_URL`.
  - `README.md` «Command line»: `warm` prints the six summary lines as T2 prints them and one
    `- <failure>` line per failure; replace "it should report `Generated: 0`" with the line it
    now prints; name the outside-origin failure.
  - `SKILL.md` step 8: the site and `warm` share `EMDASH_SITE_URL`; the second run prints
    `Generated: 0` and `Failures: 0`. «Common mistakes» gains "Leaving the public origin unset":
    without `EMDASH_SITE_URL` the sitemap says `localhost`, and warm-up reports its locations as
    outside the public origin.
  - `docs/TESTING.md`: the fixture runs on `127.0.0.1` with `EMDASH_SITE_URL`; the e2e run also
    warms the site through `emdash-images warm` and checks the outside-origin failure.
- **Constraints:** docs only; every command, variable and output line named exists in `src/`
  as merged by T1 and T2 (quote them from `src/cli.mjs` and `src/warmup.mjs`, not from this
  plan); no new sections beyond those named.
- **Ownership:** the Target files; no existing test changes (grep: `test/` does not read
  `README.md`, `SKILL.md` or `docs/TESTING.md`).
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `README.md` «Command line» lists `Sitemaps:`, `Pages:`, `Variants:`, `Generated:`,
    `Cached:`, `Failures:` in the order `src/cli.mjs` prints them, and no longer says "should
    report `Generated: 0`" without the printed line
  - `README.md`, `SKILL.md` and `docs/TESTING.md` each name `EMDASH_SITE_URL` in the changed
    text
  - `git diff <T3 commit> --stat` lists only `README.md`, `SKILL.md`, `docs/TESTING.md`
- **Commit:** `Document the warm-up public origin and summary`
- **Docs:** `README.md` «Astro configuration», «Command line»; `SKILL.md` «Steps», «Common
  mistakes»; `docs/TESTING.md`; this plan's facts list.
- **Size:** about 40 changed lines.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `npm run test:e2e` twice in a row from an Orca terminal outside the sandbox, both ending with
  `ℹ fail 0` and 10 passing tests; no `dist/server/entry.mjs` process left afterwards
  (`ps`, gate script)
- `node scripts/release.mjs verify` ends with `RELEASE OK 0.5.0`
- `git diff main --stat -- src` lists only `src/warmup.mjs` and `src/cli.mjs`
- `CHANGELOG.md` `## Unreleased` has exactly the `### Changed` item of T1 and the `### Fixed`
  item of T2

## Amendments

None.

## Outcome

Filled after merge, from `status.md`. The next plan reads this, not the run's conversation.
