# 001 Self-contained package

**Goal:** The package carries nothing from the site it was cut from and ships its own
`emdash-images` command for warm-up, backfill and cleanup, so a consumer needs no wrapper scripts.

**Context:** `docs/ROADMAP.md` item 0 and its owner decisions of 2026-10-30 (package-only scope;
CLI for Postgres and local storage only; options from `--config <module>`; command name
`emdash-images`); `CONTEXT.md` «ADR-0002 in brief» and «Dated decisions»; `README.md`; `SKILL.md`.

**Version impact:** minor. T2 adds a `bin` entry (new public surface). T1 renames internal
`globalThis` symbol keys and changes the usage strings of `backfillMediaRows` and
`cleanupImageCache`; neither is exported API. The plan does not bump `version`, tag or publish.

**Preconditions:** None.

**Branch:** `task/001-self-contained-package` · **Worktree:** `.worktrees/emdash-images/001-self-contained-package`

## Tasks

### T1: Drop the site's names from the package source

- **Target:** `src/service.mjs`, `src/warmup.mjs`, `src/backfill.mjs`, `src/cleanup.mjs`,
  `test/plugin.test.mjs`, `test/boundary.test.mjs`.
- **Change:**
  - Rename the three `globalThis` symbol keys from the `liliiachaika.` namespace to the package
    name: `Symbol.for("liliiachaika.image-encode-limiter")` (`src/service.mjs:26`),
    `Symbol.for("liliiachaika.image-cache-context")` (`src/service.mjs:28`) and
    `Symbol.for("liliiachaika.image-warmup-scheduler")` (`src/warmup.mjs:445`) become
    `Symbol.for("@nimitzua/emdash-images.image-encode-limiter")`,
    `Symbol.for("@nimitzua/emdash-images.image-cache-context")` and
    `Symbol.for("@nimitzua/emdash-images.image-warmup-scheduler")`. Update the scheduler key in
    `test/plugin.test.mjs:11` to match.
  - Replace the usage strings that name the site's wrappers:
    `src/backfill.mjs:6` becomes `"Usage: emdash-images backfill [--write]"` and
    `src/cleanup.mjs:14` becomes `"Usage: emdash-images cleanup [--delete] | --help"`.
  - Extend `test/boundary.test.mjs` with a check that no file under `src` contains
    `liliiachaika`, `facadesystems` or `scripts/deploy` anywhere in its text (comments
    included), case-insensitive, reported as `<file>: names a site (<match>)`.
- **Constraints:** No behaviour change besides the key names and the usage text. Keep the
  existing `private-cases` literal check in `test/boundary.test.mjs` as it is. Test fixtures that
  use `private-cases/` as sample data stay unchanged.
- **Ownership:** `src/service.mjs`, `src/warmup.mjs`, `src/backfill.mjs`, `src/cleanup.mjs`,
  `test/plugin.test.mjs`, `test/boundary.test.mjs`. Grep: the three keys are used only at the
  lines above and `test/plugin.test.mjs:11`; `test/maintenance.test.mjs:193` and `:324` match the
  usage text with `/Usage/` and keep passing, so no other existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n -i -E "liliiachaika|facadesystems|scripts/deploy" -- src` prints nothing
  - `git grep -n "@nimitzua/emdash-images.image-" -- src test` lists `src/service.mjs` (2 lines), `src/warmup.mjs` (1 line) and `test/plugin.test.mjs` (1 line)
  - `git grep -n "Usage: emdash-images" -- src` lists `src/backfill.mjs` and `src/cleanup.mjs`
  - `node --test test/boundary.test.mjs` with the new check and the old `src` fails with a line naming `src/service.mjs` and `liliiachaika`; with the change it passes
- **Commit:** `Drop the source site's names from the package`
- **Docs:** `CONTEXT.md` «ADR-0002 in brief»; `docs/ROADMAP.md` item 0.
- **Size:** about 30 changed lines, tests excluded.

### T2: Add the `emdash-images` command

- **Target:** new `src/cli.mjs`, new `src/bin.mjs`, `package.json`, `package-lock.json`, new
  `test/cli.test.mjs`.
- **Change:**
  - `src/cli.mjs` exports
    `runCli(argv, { env = process.env, cwd = process.cwd(), log = console.log, errorLog = console.error, commands } = {})`,
    which returns the exit code and never calls `process.exit`. `commands` defaults to
    `{ backfillMediaRows, cleanupImageCache, warmLocalSite, warmPublicSite }` imported from the
    package's own modules; tests inject stubs.
  - Grammar: `emdash-images <command> [--config <path>] [--env-file <path>] [command options]`
    with commands `backfill [--write]`, `cleanup [--delete]` and
    `warm [--origin <url>] [--public-origin <url>]`. Parse with `parseArgs` from `node:util`.
  - `--config <path>` resolves against `cwd` and is imported with `pathToFileURL`. Its default
    export must be a plain object of image options, the same object the consumer passes to
    `imageService()`. Without `--config` the command uses `DEFAULT_IMAGE_OPTIONS`.
    - `backfill` gets `{ args, env, deniedStorageKeyPrefixes }`.
    - `cleanup` gets `{ args, env, encoder, deniedStorageKeyPrefixes }`.
    - `warm` gets `{ cacheDirectory, deniedStorageKeyPrefixes, deniedPagePathPrefixes }` as its
      options, with `cacheDirectory` left out when the config does not set it.
  - `--env-file <path>` reads the file with `parseEnv` from `node:util`; values already in `env`
    win over the file, as with Node's own `--env-file`. The merged object is the `env` the
    command receives; `process.env` is not mutated.
  - `warm` without `--origin` calls `warmLocalSite(env, options)`; with `--origin` it calls
    `warmPublicSite(new URL(origin), new URL(publicOrigin ?? origin), options)`.
  - Exit codes: `0` success; `backfill` returns its result's `exitCode` (`0` or `3`); `warm`
    returns `1` when `summary.failures` is not empty; `1` for a runtime error (message on
    `errorLog`); `2` for a usage error (unknown command, unknown or missing option value, no
    command), with the usage text on `errorLog`.
  - `--help` / `-h` alone prints the general usage (every command and global option) on `log`
    and returns `0`; `<command> --help` prints that command's usage and returns `0` without
    calling the command.
  - `src/bin.mjs` starts with `#!/usr/bin/env node` and only runs
    `process.exitCode = await runCli(process.argv.slice(2));`. Commit it with mode `100755`.
  - `package.json` gets `"bin": { "emdash-images": "./src/bin.mjs" }`; mirror it in
    `package-lock.json` under `packages[""]` as `"bin": { "emdash-images": "src/bin.mjs" }`,
    which is how npm writes it.
- **Constraints:** No new dependencies. Do not change `backfillMediaRows`, `cleanupImageCache`,
  `warmLocalSite` or `warmPublicSite`; the CLI only wraps them. Do not add the CLI to `exports`.
  The CLI keeps the maintenance code's limit: Postgres and local storage only.
- **Ownership:** `src/cli.mjs` (new), `src/bin.mjs` (new), `test/cli.test.mjs` (new),
  `package.json`, `package-lock.json`. No existing test changes: `test/boundary.test.mjs` scans
  every `src` file and passes, since the CLI imports only Node built-ins and package modules.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `node src/bin.mjs --help` exits 0 and its output names `warm`, `backfill`, `cleanup`, `--config` and `--env-file`
  - `node src/bin.mjs backfill --help`, `node src/bin.mjs cleanup --help` and `node src/bin.mjs warm --help` each exit 0
  - `node src/bin.mjs` and `node src/bin.mjs frobnicate` each exit 2 with the usage on stderr
  - `node src/bin.mjs backfill --config ./missing.mjs` exits 1 with a message naming `missing.mjs`
  - `git ls-files -s src/bin.mjs` shows mode `100755`
  - `npm pkg get bin` prints the `emdash-images` → `./src/bin.mjs` mapping
  - `test/cli.test.mjs` covers, with stub commands: the config's deny lists reach `backfill`; `encoder` and deny lists reach `cleanup`; `cacheDirectory` and both deny lists reach `warm`; no `--config` uses `DEFAULT_IMAGE_OPTIONS`; a config without a default object export returns 1; `--env-file` values reach `env` and an existing `env` value wins; `backfill` result `exitCode: 3` returns 3; `warm` with failures returns 1; `warm` without `--origin` calls `warmLocalSite`, with `--origin`/`--public-origin` calls `warmPublicSite` with those URLs; an unknown option returns 2
- **Commit:** `Add the emdash-images command for warm-up, backfill and cleanup`
- **Docs:** `README.md` «Options» and «Backfill, warm-up, and cleanup»; `SKILL.md` steps 2, 5, 7
  and 8; `src/maintenance.d.mts`; `src/warmup.d.mts`.
- **Size:** about 150 changed lines, tests excluded.

### T3: Rewrite the docs for any consumer

- **Target:** `README.md`, `SKILL.md`.
- **Change:**
  - Remove every reference to the source site or facadesystems: the facadesystems sentence in
    `README.md` line 5, the site npm scripts (`npm run backfill-media-hashes`,
    `npm run warm-cache`), the `scripts/deploy/cleanup-image-cache.mjs` entry point, «The
    current site has no cleanup npm script», and the workspace `file:` Docker note
    (`packages/emdash-images/...`) in both files. In `SKILL.md`, replace the `private-cases/`
    examples with `restricted/`.
  - The options-module example becomes a default export (`export default { … }`) and
    `astro.config.mjs` imports it as a default, so the same file serves `--config`.
  - Replace «Backfill, warm-up, and cleanup» with a «Command line» section: the
    `emdash-images` grammar from T2, each command with an example (`npx emdash-images backfill --config ./src/lib/image-options.mjs`, `… --write`, `cleanup` with and without
    `--delete`, `warm` local and with `--origin`), `--env-file`, the exit codes, and the
    environment each command reads: `DATABASE_URL` / `EMDASH_DATABASE_URL` or `PGHOST`,
    `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`; `UPLOADS_DIR` (backfill, default
    `uploads`); `IMAGE_CACHE_DIR` (cleanup requires it; warm falls back to it);
    `PORT` / `SITE_PORT` and `EMDASH_SITE_URL` (warm without `--origin`). State the limit:
    Postgres and a local uploads directory only.
  - The Docker note becomes generic: the runtime image needs the installed package in its
    `node_modules`, and `IMAGE_CACHE_DIR` set at runtime.
  - `SKILL.md` steps 6–8 use the `emdash-images` commands.
- **Constraints:** Describe only what the code does after T1 and T2. Keep the trust-boundary,
  options table and middleware sections, apart from the edits above. Keep the statement that
  the package does not render `<picture>`: it is still true.
- **Ownership:** `README.md`, `SKILL.md`. No existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n -i -E "liliiachaika|facadesystems|scripts/deploy|packages/emdash-images|npm run|private-cases|backfill-media-hashes|warm-cache" -- README.md SKILL.md` prints nothing
  - `git grep -n -E "DATABASE_URL|UPLOADS_DIR|IMAGE_CACHE_DIR|EMDASH_SITE_URL|SITE_PORT|--env-file|--config" -- README.md` shows each of these names at least once, inside `## Command line`
  - every `emdash-images` command line in `README.md` and `SKILL.md` parses: for each command shown, `node src/bin.mjs <command> --help` exits 0
- **Commit:** `Document the package for any EmDash site`
- **Docs:** `CONTEXT.md` «ADR-0002 in brief»; the T2 section of this plan.
- **Size:** docs only.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node src/bin.mjs --help` in the worktree exits 0
- `git grep -n -i -E "liliiachaika|facadesystems|scripts/deploy" -- src README.md SKILL.md` prints nothing

## Amendments

None.

## Outcome

- **Merge:** `a14e3ca` (`--no-ff` of `task/001-self-contained-package` onto `b771f2f`). Task
  commits: T1 `45809ff` (review 1 PASS), T2 `c47f763` (review 1 PASS), T3 `6b6e16e` (review 1
  FIX with one `[docs]` finding; fix round 1 amended `e3629d4`, accepted on the architect's
  reading after `docs-only.sh` printed `DOCS ONLY`). Gates: `GATES OK`; `node src/bin.mjs --help`
  exit 0; `git grep -i -E "liliiachaika|facadesystems|scripts/deploy" -- src README.md SKILL.md`
  empty; after merge `INSTALL OK` (lockfile changed) and `VERIFY OK`.
- **Decisions:**
  - T2 asked whether to edit `README.md`, `SKILL.md`, `src/maintenance.d.mts` and
    `src/warmup.d.mts`, named under its Docs field. Answer: no, stay in Ownership. A task's Docs
    field lists documents to read for context, not files to edit; T3 owned README and SKILL, and
    T2's Constraints forbade changing the wrapped functions.
  - T3 was told to document `warm`'s cache-directory fallback as the code does it (see
    Surprises), with no code change in this plan.
- **Surprises:**
  - `warmPublicSite` defaults `cacheDirectory` from `process.env.IMAGE_CACHE_DIR`
    (`src/warmup.mjs:360`), so an `IMAGE_CACHE_DIR` given only in `--env-file` does not reach
    `warm`, while it does reach `cleanup` (which reads the merged `env`). The plan's T3 phrase
    "warm falls back to it" holds only for the process environment; README says so.
  - `warm` prefers the config's `cacheDirectory` over `IMAGE_CACHE_DIR`, while the image service
    prefers `IMAGE_CACHE_DIR` (`src/service.mjs:119`); with both set they use different
    directories.
  - Orca: `worker-release` returned `retained` / `user_takeover` / `processAction: none` for the
    T1 and T3 executors (T2 and the T3 fix released normally with `closed_agent_terminal`); the
    idle terminals were closed by hand. The T2 executor sent its one question twice, 16 s apart.
- **Deviations:** None. Every task ran as written; no amendments.
- **Follow-ups:**
  - Make `warm` take `IMAGE_CACHE_DIR` from the merged `env` (CLI passes `cacheDirectory`, or
    `warmPublicSite` takes an `env`), and align `warm` and the service on which of config
    `cacheDirectory` and `IMAGE_CACHE_DIR` wins.
  - `--public-origin` without `--origin` is accepted and silently ignored
    (`src/cli.mjs:149-155`); reject it or document it.
  - `warm --origin not-a-url` exits 1 with a bare `Invalid URL`; name the option in the message.
  - `test/cli.test.mjs:136-144` (`--origin` only) asserts inside the stub and does not check that
    the stub was called.
  - The CLI forwards a whitespace-only `cacheDirectory`, which `resolveImageOptions` ignores.
  - `UPLOADS_DIR` resolves against `process.cwd()`, not `runCli`'s `cwd` option
    (`src/backfill.mjs:198`); harmless for the binary, visible to programmatic callers.
  - The renamed `Symbol.for` keys mean an old and a new build in one process no longer share the
    encode limiter, cache context or scheduler; intended, not public API.
- **Proposed rules:** None: the run had one FIX finding (`[docs]`, T3), and no finding kind
  recurred in two reviews.
