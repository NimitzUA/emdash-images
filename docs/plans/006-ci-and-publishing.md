# 006 CI and publishing from GitHub

**Goal:** Move the package's metadata to the GitHub repository and add CI and a tag-triggered
npm publish with trusted publishing, as ADR-0005 decides, before 0.2.0 is published by hand.

**Context:** `docs/adr/0005-ci-and-publishing-from-github.md` (the spec);
`docs/adr/0003-versioning-and-releases.md`; `docs/RELEASING.md`; `scripts/release.mjs`;
`docs/ROADMAP.md` item 2. npm's trusted publishing page (docs.npmjs.com/trusted-publishers) is
summarized in ADR-0005 «Context»; its example workflow uses `actions/checkout@v6`,
`actions/setup-node@v6` with `registry-url: 'https://registry.npmjs.org'` and
`package-manager-cache: false`, and `permissions: id-token: write, contents: read`.

**Version impact:** none to the public API. T3 changes package metadata (`repository`,
`homepage`, `bugs`) and adds a `### Changed` entry under `## Unreleased`; `scripts/` and
`.github/` are not in the package (`package.json` `files`). No `version` bump, tag, push or
publish.

**Preconditions:**
- ADR-0005 accepted and committed: `git log -n 1 --format=%s -- docs/adr/0005-ci-and-publishing-from-github.md`
  prints `Accept ADR-0005: CI and publishing from GitHub`.
- Owner decisions of 2026-11-01 in ADR-0005: GitHub `nimitzua/emdash-images`, public; a pushed
  `vX.Y.Z` tag publishes; this plan before 0.2.0.

**Branch:** `task/006-ci-and-publishing` · **Worktree:** `.worktrees/emdash-images/006-ci-and-publishing`

## Tasks

### T1: Add a verify-tag command to the release script

- **Target:** `scripts/release.mjs`, `test/release.test.mjs`.
- **Change:**
  - New export `verifyReleaseTag(root, tag)` returning a list of problems, like
    `verifyRelease(root)`: every problem `verifyRelease(root)` reports, plus
    `Tag <tag> is not vX.Y.Z` when `tag` does not match `/^v\d+\.\d+\.\d+$/`, else
    `Tag <tag> does not match package.json version <version>` when it is not `v` plus the
    `package.json` version.
  - CLI: `node scripts/release.mjs verify-tag <tag>` prints each problem to stderr and exits 1,
    or prints `RELEASE TAG OK <version>` and exits 0. `usage()` lists the new command; any
    other argument shape keeps printing the usage with exit 2.
  - `test/release.test.mjs`, new tests: the current `v<version>` gives no problems; `v9.9.9`
    gives the mismatch problem; `0.1.0`, `v0.1` and `v0.1.0-rc.1` each give the format problem;
    a fixture root without a dated changelog section for its version reports the
    `verifyRelease` problem through `verifyReleaseTag` too (reuse the file's existing fixture
    helpers).
- **Constraints:** `prepare` and `verify` behave and print exactly as today. No new
  dependencies. No `CHANGELOG.md` entry: `scripts/` is repository tooling, not in the package.
- **Ownership:** `scripts/release.mjs`, `test/release.test.mjs`. Grep for `release.mjs`:
  `package.json` `scripts.prepublishOnly` (runs `verify`, unchanged), `docs/RELEASING.md` (T4),
  `scripts/orca/*` do not call it. No existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `test/release.test.mjs` covers each case listed under Change
  - `node scripts/release.mjs verify-tag v0.1.0` prints `RELEASE TAG OK 0.1.0` and exits 0
  - `node scripts/release.mjs verify-tag v9.9.9` exits 1 and prints `Tag v9.9.9 does not match package.json version 0.1.0`
  - `node scripts/release.mjs verify` still prints `RELEASE OK 0.1.0`
- **Commit:** `Add a verify-tag command to the release script`
- **Docs:** ADR-0005 «Decision» (Publishing from a pushed tag); `scripts/release.mjs:77-87,193-227`;
  `test/release.test.mjs`.
- **Size:** about 30 changed lines, tests excluded.

### T2: Add the CI and release workflows

- **Target:** new `.github/workflows/ci.yml`, new `.github/workflows/release.yml`.
- **Change:**
  - `ci.yml`, name `CI`: on `push` to branch `main` and on `pull_request`; top-level
    `permissions: contents: read`; one job `test` on `ubuntu-latest`: `actions/checkout@v6`,
    `actions/setup-node@v6` with `node-version: '26'` and `cache: npm`, then `npm ci`,
    `npm test`, `node scripts/release.mjs verify`.
  - `release.yml`, name `Release`: on `push` of tags `v*`; top-level `permissions` exactly
    `contents: read` and `id-token: write`; `concurrency: { group: release, cancel-in-progress: false }`;
    one job `publish` on `ubuntu-latest` with these steps in order:
    1. `actions/checkout@v6`;
    2. `actions/setup-node@v6` with `node-version: '26'`,
       `registry-url: 'https://registry.npmjs.org'` and `package-manager-cache: false`;
    3. `node scripts/release.mjs verify-tag "$GITHUB_REF_NAME"`;
    4. fail unless the npm CLI is at least 11.5.1:
       `printf '%s\n' 11.5.1 "$(npm --version)" | sort -V -C`;
    5. step `id: registry`: read the version with `node -p 'require("./package.json").version'`
       and write `published=true` to `$GITHUB_OUTPUT` when
       `npm view "@nimitzua/emdash-images@<version>" version` (stderr discarded) prints exactly
       that version, else `published=false`;
    6. `npm ci`, only `if: steps.registry.outputs.published == 'false'`;
    7. `npm publish`, with the same `if`.
  - No `secrets.*`, `NPM_TOKEN` or `NODE_AUTH_TOKEN` anywhere: trusted publishing needs none
    (ADR-0005).
- **Constraints:** Exactly the triggers, permissions and steps above; no other jobs, no
  third-party actions, no `workflow_dispatch` (ADR-0005 «Alternatives»). The workflow file name
  stays `release.yml`: the owner enters it on npmjs.com. No package files change.
- **Ownership:** `.github/workflows/ci.yml` (new), `.github/workflows/release.yml` (new). No
  existing test changes: no test reads `.github/`, and `package.json` `files` keeps it out of
  the package.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n "id-token: write" -- .github/workflows` prints one line, in `.github/workflows/release.yml`
  - `git grep -n -e "secrets\." -e "NPM_TOKEN" -e "NODE_AUTH_TOKEN" -e "workflow_dispatch" -- .github/workflows` prints nothing
  - `git grep -n -e "verify-tag" -e "sort -V -C" -e "package-manager-cache: false" -e "steps.registry.outputs.published" -- .github/workflows/release.yml` prints at least one line for each pattern
  - `git grep -n -e "node-version: '26'" -- .github/workflows` prints one line in each file
  - `git show --stat --format= HEAD` lists only the two workflow files
- **Commit:** `Add the CI and release workflows`
- **Docs:** ADR-0005 «Decision»; this plan's «Context» (npm's example workflow);
  `package.json` `scripts`, `engines`, `files`.
- **Size:** about 60 lines of YAML.

### T3: Point the package metadata at GitHub

- **Target:** `package.json`, `README.md`, `CHANGELOG.md`.
- **Change:**
  - `package.json`: `repository` becomes
    `{ "type": "git", "url": "git+https://github.com/nimitzua/emdash-images.git" }`;
    `homepage` `https://github.com/nimitzua/emdash-images#readme`; new
    `bugs` `{ "url": "https://github.com/nimitzua/emdash-images/issues" }` after `homepage`.
    Keep the file's tab indentation and key order otherwise.
  - `README.md:15`: the source repository link becomes
    `[nimitzua/emdash-images](https://github.com/nimitzua/emdash-images)`.
  - `CHANGELOG.md` `## Unreleased` `### Changed`: "Package metadata (`repository`, `homepage`,
    `bugs`) and the README point to the GitHub repository `nimitzua/emdash-images`".
- **Constraints:** `repository.url` must be exactly the string above: npm's trusted publishing
  fails the publish when it does not match the GitHub repository (ADR-0005). No other
  `package.json` change; `package-lock.json` does not change (it holds no `repository`). Dated
  ADRs and done plans keep their git.srv1 mentions.
- **Ownership:** `package.json`, `README.md`, `CHANGELOG.md`. Grep for `git.srv1`:
  `package.json:16-17`, `README.md:15`, and the dated `docs/adr/0003-versioning-and-releases.md`
  and `docs/plans/003-versioning-and-releases.md`, which stay. No existing test changes: no test
  reads `repository`, `homepage` or `bugs`.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `npm pkg get repository.url` prints `"git+https://github.com/nimitzua/emdash-images.git"`
  - `npm pkg get bugs.url` prints `"https://github.com/nimitzua/emdash-images/issues"`
  - `git grep -n "git.srv1" -- package.json README.md SKILL.md CONTEXT.md src` prints nothing
  - `git show --stat --format= HEAD` lists only `package.json`, `README.md` and `CHANGELOG.md`
  - `CHANGELOG.md` `## Unreleased` `### Changed` has the entry above
- **Commit:** `Point the package metadata at the GitHub repository`
- **Docs:** ADR-0005 «Decision» (GitHub is the source repository); npm `package.json` docs for
  `repository`, `homepage`, `bugs`.
- **Size:** about 10 changed lines.

### T4: Document the GitHub release procedure

- **Target:** `docs/RELEASING.md`.
- **Change:** rewrite it into these sections, keeping «Version numbers» as it is:
  - **Repository:** GitHub `nimitzua/emdash-images`; once, point `origin` at it
    (`git remote set-url origin https://github.com/nimitzua/emdash-images.git`), push `main`
    (`git push -u origin main`) and check the first CI run
    (`gh run list --workflow ci.yml --limit 1`).
  - **First release, by hand (0.2.0):** npm requires the package to exist before a trusted
    publisher can be added. The current steps 1-6 (clean `main`, `prepare`, `git diff`, signed
    commit and `verify`, `npm pack --dry-run`, signed tag, `npm publish`, push), with
    `npm login` and two-factor. Pushing the tag starts `release.yml`, which finds the version
    already published and skips.
  - **Trusted publisher (once, right before the second release):** on npmjs.com, the package's
    settings, «Trusted Publisher», GitHub Actions: owner `nimitzua`, repository
    `emdash-images`, workflow `release.yml`, no environment, allow `npm publish`. It expires
    if no publish succeeds within 2 days; then delete it and add it again. Optionally, after
    the first CI publish, set publishing access to require two-factor authentication and
    disallow tokens.
  - **Each later release:** clean `main`; `prepare X.Y.Z`; `git diff`; signed commit and
    `verify`; `npm pack --dry-run`; `node scripts/release.mjs verify-tag vX.Y.Z`; signed tag;
    `git push origin main vX.Y.Z`; follow the run (`gh run watch`) and confirm with
    `npm view @nimitzua/emdash-images version`. No `npm login` and no two-factor code.
  - **If the CI publish fails:** never move or delete a pushed tag. A configuration cause
    (trusted publisher missing, expired or with a wrong field) is fixed on npmjs.com and the
    run re-run (`gh run rerun <run-id>`); a cause in the code becomes the next patch version.
    Replace the current paragraph about deleting the local tag and `git reset --hard`, which
    applies only before anything is pushed: keep it under «First release» for a failed local
    `npm publish`.
- **Constraints:** Every command, flag, file name and setting named exists: the workflow files
  from T2, `verify-tag` from T1, the npmjs.com fields from ADR-0005 «Context». No site names.
  Do not edit `CHANGELOG.md`.
- **Ownership:** `docs/RELEASING.md`. No existing test changes: no test reads it.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n -e "release.yml" -e "verify-tag" -e "gh run rerun" -e "2 days" -- docs/RELEASING.md` prints at least one line for each pattern
  - `git grep -n "git.srv1" -- docs/RELEASING.md` prints nothing
  - `git grep -n -e "^## Version numbers" -e "The next release after 0.1.0 is 0.2.0" -- docs/RELEASING.md` prints one line for each pattern
- **Commit:** `Document the GitHub release procedure`
- **Docs:** ADR-0005; ADR-0003 «Decision»; `docs/RELEASING.md`; `.github/workflows/release.yml`
  and `scripts/release.mjs` after T1-T2.
- **Size:** about 80 changed lines of documentation.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` in the worktree prints `RELEASE OK 0.1.0`
- `git diff main -- src` prints nothing
- `npm pack --dry-run --json` in the worktree (with `--cache` in the worktree) lists no
  `.github/` or `scripts/` path

After the merge, the owner's first push of `main` to GitHub is the first real CI run
(ADR-0005 «Consequences»); its result goes into this plan's Outcome when known, and a failure
becomes a fix plan.

## Amendments

None.

## Outcome

- **Merge:** `d1e1f61` (`--no-ff` of `task/006-ci-and-publishing` onto `9f9ae07`). Task
  commits: T1 `2621568` (review 1 PASS), T2 `295cc20` (review 1 PASS), T3 `c5f1cbb` (review 1
  PASS), T4 `b5abdf1` (review 1 PASS). No fix rounds. Gates: `GATES OK`; `RELEASE OK 0.1.0` in
  the worktree; `git diff main -- src` empty; `npm pack --dry-run --json` lists 28 files, none
  under `.github/` or `scripts/`. Lockfile unchanged, so no install on main; `VERIFY OK`. Tests
  at merge: 132 `node --test` plus the vitest render cases. `version` stays `0.1.0`; nothing
  tagged, pushed or published.
- **First runs on GitHub (2026-11-01, after plan 007 and the by-hand 0.2.0 release):**
  - `CI`: run `41261640735` on `Add plan 007…` success (34s), the first CI run; run
    `41262078365` on `Release 0.2.0` success (39s).
  - `Release` on tag `v0.2.0`: run `41262078304` failure (37s). `verify-tag` and the npm version
    gate passed; the `registry` step wrote `published=false` although the by-hand publish had
    already happened (`npm access get status` reported `public`, while `npm view` still
    returned `E404` minutes later: the registry or its CDN had not caught up on the brand-new
    package). `npm ci` and `npm publish` then ran; prepublishOnly passed (132 tests, 9 render
    tests, `RELEASE OK 0.2.0`) and the PUT failed with `E404` because no trusted publisher
    exists yet. A configuration cause, as `docs/RELEASING.md` «If the CI publish fails»
    describes; the tag stays.
  - Both the CI publish and, per the same npm version, possibly the by-hand publish logged
    `npm warn publish "bin[emdash-images]" script name src/bin.mjs was invalid and removed`
    (`package.json` `bin` is `./src/bin.mjs`, git mode `100755`): the `emdash-images` command
    may be missing from the published 0.2.0.
- **Decisions:** No executor questions; no plan amendments.
- **Surprises:**
  - All four executor commits signed; the first run since plan 002 without a mid-run
    1Password failure.
  - The Codex executor policy refuses `gh run … --help`, `git push -h` and `git tag -h`
    ("No remote operations from executors") although `--help` calls nothing remote; T4 used
    `git help push` / `git help tag`. The reviewer sandbox also denies `~/.config/gh`, so no
    role could run `gh … --help`; T4's review checked the `gh run list -w/--workflow -L/--limit`,
    `gh run watch` and `gh run rerun [<run-id>]` syntax against the cli.github.com manual.
  - The reviewer hook refuses `sort`, so the release workflow's npm version gate
    (`printf … | sort -V -C`) was checked by reasoning only; its first execution is the first
    tag run.
- **Deviations:** None.
- **Follow-ups:**
  - Check `npm view @nimitzua/emdash-images@0.2.0 bin` once the registry shows 0.2.0. If `bin`
    is missing, the CLI is not installed for users: a fix plan for the `bin` entry and a patch
    release (0.2.1), which is also the first CI publish through the trusted publisher.
  - `docs/RELEASING.md` «First release, by hand»: say that the tag's `Release` run can fail
    with `E404` when the registry does not yet show the new package, and that this needs no
    action; or have `release.yml` treat that case as published.
  - `docs/RELEASING.md` «Each later release» no longer says to choose the version from
    `## Unreleased` and the version rule; «Version numbers» still covers it (nit).
  - `verify-tag` with a `package.json` lacking `version` prints `... does not match package.json
    version null` next to `Missing version at package.json`; no crash, wording could be smoother.
  - An npm prerelease version string would sort oddly under `sort -V`; Node 26 ships stable npm,
    no action.
- **Proposed rules:** None: the run had no findings.
