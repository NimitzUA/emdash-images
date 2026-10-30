# 002 CLI follow-ups

**Goal:** `warm` stops requesting the source site's `/uk/` pages, and the `emdash-images`
command resolves the cache and uploads directories the way the image service does, with clear
usage errors for bad origins.

**Context:** `docs/plans/001-self-contained-package.md` «Outcome» (Surprises, Follow-ups);
`docs/ROADMAP.md` item 5; `README.md` «Command line»; `CONTEXT.md` «ADR-0002 in brief».
Owner decisions (2026-10-30): drop the hard-coded `/uk/` warm-up pages with no replacement
option; the CLI uses one cache-directory order for `warm` and `cleanup`, the image service's:
`IMAGE_CACHE_DIR`, then the config's `cacheDirectory`.

**Version impact:** patch. Behaviour fixes only; no export, type or option changes. `warm` no
longer requests `/uk/` and `/uk/__cache-warm-404-uk-*`. The plan does not bump `version`, tag or
publish.

**Preconditions:** None.

**Branch:** `task/002-cli-follow-ups` · **Worktree:** `.worktrees/emdash-images/002-cli-follow-ups`

## Tasks

### T1: Drop the source site's locale from warm-up

- **Target:** `src/warmup.mjs`, `test/warmup.test.mjs`.
- **Change:**
  - In `collectSitemapPages` (`src/warmup.mjs:298-301`) remove `pageLocations.add("/uk/")` and
    the `/uk/__cache-warm-404-uk-${randomUUID()}` entry. Rename the remaining not-found probe from
    `/__cache-warm-404-en-${randomUUID()}` to `/__cache-warm-404-${randomUUID()}`, since it
    carries no locale any more.
  - In `warmPublicSite` (`src/warmup.mjs:370`) the expected-404 test becomes
    `location.startsWith("/__cache-warm-404-")` only.
  - Update the warm-up test «warm-up renders pages before variants and reports the second pass
    as cached» (`test/warmup.test.mjs:179`): the run now requests 3 pages (`/en/work/sample`
    from the sitemap, `/`, one not-found probe), so `pagesRendered`, `pagesRequested` and
    `firstImagePageCount` (lines 239, 240, 244) expect `3`; add an assertion that no requested
    page path starts with `/uk`.
- **Constraints:** Keep `/` and the single not-found probe. Do not add an option for extra or
  locale pages. The `/uk/work/sample` URLs in `test/warmup.test.mjs:82-99` are sitemap sample
  data for URL mapping and stay unchanged.
- **Ownership:** `src/warmup.mjs`, `test/warmup.test.mjs`. Grep: `__cache-warm-404` and `/uk/`
  appear in `src` only at `src/warmup.mjs:299-301` and `:370`; in tests only the page counts at
  `test/warmup.test.mjs:239-244` depend on them (`:230` matches `cache-warm-404` and keeps
  working).
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n -E "\"/uk|/uk/__cache" -- src` prints nothing
  - `git grep -n "__cache-warm-404-" -- src` lists only `src/warmup.mjs` (the probe and the expected-404 test)
  - `node --test test/warmup.test.mjs` with the updated test and the old `src/warmup.mjs` fails on the page count (`5 !== 3`) or the `/uk` assertion; with the change it passes
- **Commit:** `Stop warming the source site's locale pages`
- **Docs:** `docs/plans/001-self-contained-package.md` «Outcome»; `src/warmup.d.mts`.
- **Size:** about 10 changed lines, tests excluded.

### T2: Resolve CLI paths like the image service and reject bad origins

- **Target:** `src/cli.mjs`, `test/cli.test.mjs`, `README.md`.
- **Change:**
  - **Cache directory.** `runCli` resolves one cache directory for `warm` and `cleanup`, in the
    image service's order (`src/service.mjs:119-121`): `IMAGE_CACHE_DIR` from the merged
    command env (so a value from `--env-file` counts), trimmed; else the config's
    `cacheDirectory`, trimmed; a blank or whitespace-only value counts as unset. A set value is
    resolved against `runCli`'s `cwd` with `path.resolve`.
    - `warm` passes it as `options.cacheDirectory`; when neither is set, `cacheDirectory` stays
      out of the options, as today.
    - `cleanup` receives the command env with `IMAGE_CACHE_DIR` set to the resolved directory;
      when neither is set, the env is passed unchanged, so `cleanupImageCache` keeps refusing
      with its `IMAGE_CACHE_DIR must be set …` error (exit 1).
  - **Uploads directory.** `backfill` receives the command env with `UPLOADS_DIR` set to
    `path.resolve(cwd, env.UPLOADS_DIR?.trim() || "uploads")`, so a relative value and the
    default follow `cwd`, not `process.cwd()`.
  - **Origins.** `--public-origin` without `--origin` is a usage error (exit 2, message naming
    both options, then the `warm` usage). `--origin` and `--public-origin` must parse as
    absolute `http:` or `https:` URLs; otherwise exit 2 with
    `Option --<name> must be an absolute http(s) URL.` and the `warm` usage. The `warm` usage
    line for `--public-origin` says it requires `--origin`.
  - **Test gap.** In `test/cli.test.mjs` the `--origin`-only case (lines 136-144) records the
    stub's arguments and asserts after `runCli` that the stub was called and returned exit 0.
  - **README.** Rewrite the cache paragraph of «Command line» (`README.md:165`) for the new
    order: both commands use `IMAGE_CACHE_DIR` (process environment or `--env-file`), then the
    config's `cacheDirectory`, resolved against the current directory; `cleanup` refuses when
    neither is set; `warm` then falls back to `.dev/image-cache`. State that `UPLOADS_DIR` is
    resolved against the current directory, that `--public-origin` requires `--origin`, and that
    both must be absolute http(s) URLs (exit `2` otherwise).
- **Constraints:** Change no function outside `src/cli.mjs`: `cleanupImageCache`,
  `backfillMediaRows`, `warmLocalSite`, `warmPublicSite` and the image service stay as they are.
  `cleanup`'s directory checks (existing, not the root, not a symbolic link) stay in
  `cleanupImageCache`. Do not mutate `process.env` or the caller's `env` object.
- **Ownership:** `src/cli.mjs`, `test/cli.test.mjs`, `README.md`. Existing test changes:
  `test/cli.test.mjs:41-45` (warm's `cacheDirectory` becomes `path.join(cwd, "image-cache")`,
  absolute) and `:136-144` (the test gap above); the cleanup and backfill assertions that compare
  `env` gain the resolved `IMAGE_CACHE_DIR` / `UPLOADS_DIR` where the test sets them.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node src/bin.mjs warm --public-origin https://example.com` exits 2 with a message naming `--origin`
  - `node src/bin.mjs warm --origin not-a-url` exits 2 with `Option --origin must be an absolute http(s) URL.`
  - `node src/bin.mjs warm --origin ftp://example.com` exits 2 with the same message
  - `test/cli.test.mjs` covers: `IMAGE_CACHE_DIR` from `--env-file` reaches `warm` as `cacheDirectory` and `cleanup` as `env.IMAGE_CACHE_DIR`; `IMAGE_CACHE_DIR` wins over the config's `cacheDirectory`; a relative value resolves against `cwd`; a whitespace-only config `cacheDirectory` with no `IMAGE_CACHE_DIR` leaves `warm` without `cacheDirectory` and `cleanup`'s env without `IMAGE_CACHE_DIR`; `backfill` gets `UPLOADS_DIR` resolved against `cwd`, both from a relative value and from the `uploads` default; the caller's `env` object is unchanged after each run; the `--origin`-only stub is called once with equal request and public origins
  - `git grep -n -E "falls back|cache fallback" -- README.md` no longer describes warm's process-environment-only fallback (the old sentence «An `IMAGE_CACHE_DIR` value found only in `--env-file` does not set warm's cache fallback.» is gone)
- **Commit:** `Resolve CLI cache and uploads paths like the image service`
- **Docs:** `README.md` «Options» (cache paragraph) and «Command line»; `src/service.mjs:118-127`;
  `src/cleanup.mjs:77-104`; `docs/plans/001-self-contained-package.md` «Outcome».
- **Size:** about 70 changed lines, tests excluded.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node src/bin.mjs warm --public-origin https://example.com` in the worktree exits 2
- `git grep -n -E "\"/uk|/uk/__cache" -- src` prints nothing

## Amendments

None.

## Outcome

Filled after merge, from `status.md`.
