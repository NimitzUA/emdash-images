# 012 Staged publishing

**Goal:** Ship ADR-0007: the release workflow stages each version with `npm stage publish`, and
`docs/RELEASING.md` describes the owner's approval, so 0.3.0 can be released.

**Context:** `docs/adr/0007-staged-publishing.md`; `docs/adr/0005-ci-and-publishing-from-github.md`
«Decision»; `docs/RELEASING.md`; `docs/plans/011-portable-text-image-and-placeholder.md`
«Outcome».

Facts read while writing this plan (2026-11-02, `main` at `a979235`, version `0.2.0`):

- `.github/workflows/release.yml:27` checks the npm CLI with
  `printf '%s\n' 11.5.1 "$(npm --version)" | sort -V -C`, and line 38 runs `npm publish`
  (when `steps.registry.outputs.published == 'false'`). Nothing in `test/` or `scripts/` reads
  the workflow files.
- `docs/RELEASING.md`: «Repository» (lines 11-16) and «Each later release» step 4
  (lines 129-142) use `gh run watch` with no run id, which fails outside an interactive
  terminal with `run ID required when not running interactively` (seen 2026-11-02);
  `gh run list --workflow ci.yml --limit 1` prints the id. «Trusted publisher» (lines 88-96)
  says "allow `npm publish`"; «Each later release» step 4 ends "No `npm login` or two-factor
  code is needed for these releases."; «If the CI publish fails» (lines 144-148).
- npm commands from ADR-0007 «Context»: `npm stage publish`, `npm stage list [<package-spec>]`,
  `npm stage view <stage-id>`, `npm stage approve <stage-id>`, `npm stage reject <stage-id>`;
  staging needs npm CLI 11.15.0 or later. Locally, `npm stage publish --dry-run` with no
  package spec stages the current directory and runs `prepublishOnly` first (ADR-0007
  «Context»), so the workflow line needs no argument.

**Version impact:** none. The workflow and the release docs change; the package does not. No
`CHANGELOG.md` entry. No `version` bump, tag, push or publish.

**Preconditions:**
- `main` is clean at 0.2.0: `git status --porcelain` prints nothing and `npm pkg get version`
  prints `"0.2.0"`.
- ADR-0007 is accepted and committed (`git log -n 1 -- docs/adr/0007-staged-publishing.md`
  prints a commit).

**Branch:** `task/012-staged-publishing` · **Worktree:** `.worktrees/emdash-images/012-staged-publishing`

## Tasks

### T1: Stage releases from the workflow and document the approval

- **Target:** `.github/workflows/release.yml`, `docs/RELEASING.md`.
- **Change:**
  - `.github/workflows/release.yml`: line 27 checks `11.15.0` instead of `11.5.1`; line 38 runs
    `npm stage publish` instead of `npm publish`, with the same `if`. Nothing else changes.
  - `docs/RELEASING.md`:
    - «Repository»: watch the first CI run with `gh run list --workflow ci.yml --limit 1` and
      then `gh run watch <run-id> --exit-status`;
    - «Trusted publisher»: "allow npm publish" stays unchecked (ADR-0007), so CI can only stage;
      the owner approves the first staged version within 2 days of adding the configuration;
    - «Each later release» step 4: after pushing the tag, `gh run list --workflow release.yml --limit 1`
      and `gh run watch <run-id> --exit-status`; then
      `npm stage list @nimitzua/emdash-images`, `npm stage view <stage-id>` to review it, and
      `npm stage approve <stage-id>`, which asks for a two-factor code (or Approve under
      Staged Packages on npmjs.com); then `npm view @nimitzua/emdash-images version`. Replace
      "No `npm login` or two-factor code is needed for these releases." with a sentence that
      approving needs the owner signed in (`npm login`, or on npmjs.com) and a two-factor code;
    - «If the CI publish fails»: a staged version that should not ship is rejected with
      `npm stage reject <stage-id>`, and the fix becomes the next patch version with a new tag;
    - «First release, by hand (0.2.0)» stays as written.
- **Constraints:** `.github/workflows/ci.yml`, `scripts/`, `package.json` and `src/` unchanged.
  The workflow keeps `permissions`, `concurrency`, `verify-tag`, the registry skip step and
  `npm ci` as they are. No npm token anywhere.
- **Ownership:** `.github/workflows/release.yml`, `docs/RELEASING.md`. No code or test reads
  either file; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `git grep -n -e "npm stage publish" -e "11.15.0" -- .github/workflows/release.yml` prints
    lines 27 and 38
  - `git grep -n -e "npm publish$" -e "11.5.1" -- .github/workflows/release.yml` prints nothing
  - `git grep -n -e "npm stage approve" -e "npm stage list" -e "npm stage reject" -e "gh run watch <run-id> --exit-status" -- docs/RELEASING.md`
    prints lines in «Each later release» and «If the CI publish fails», and the watch line
    also in «Repository»
  - `git grep -n "No .npm login. or two-factor code is needed" -- docs/RELEASING.md` prints
    nothing
  - `npm stage --help` lists `publish`, `list`, `view`, `approve` and `reject` (run it and put
    the line in the report)
  - `git diff main --stat` lists only `.github/workflows/release.yml` and `docs/RELEASING.md`
- **Commit:** `Stage releases from CI for owner approval`
- **Docs:** ADR-0007; ADR-0005 «Decision»; `docs/RELEASING.md`.
- **Size:** 2 changed lines in the workflow, about 30 lines of docs.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` from the worktree's copy prints `RELEASE OK 0.2.0`
- `git diff main -- src package.json package-lock.json CHANGELOG.md .github/workflows/ci.yml` prints nothing

## Amendments

None.

## Outcome

- **Merge:** `dd544f2` (`--no-ff` of `task/012-staged-publishing` onto `a458b3d`). Task commit:
  T1 `19ba03d`, review 1 PASS with no findings. No fix rounds. Gates: `GATES OK`;
  `node scripts/release.mjs verify` from the worktree's copy printed `RELEASE OK 0.2.0`;
  `git diff main -- src package.json package-lock.json CHANGELOG.md .github/workflows/ci.yml`
  empty; `VERIFY OK` on main. The lockfile did not change, so no install on main. `version` stays
  `0.2.0`; nothing tagged, pushed or published.
- **Decisions:** None: the executor asked no questions; no plan amendments.
- **Surprises:** The executor's policy refused `gh run list --help` and `gh run watch --help`
  ("No remote operations from executors."), and the reviewer's sandbox could not read
  `~/.config/gh`, so the `gh` flags in `docs/RELEASING.md` (`--workflow`, `--limit`,
  `--exit-status`) were checked against the cli.github.com manual, not run locally.
- **Deviations:** None.
- **Follow-ups:**
  - «If the CI publish fails» still advises `gh run rerun <run-id>`. When the version is already
    staged, the registry skip step does not see it (it is not yet on npm), so a rerun may try to
    stage it a second time. This is an ADR-0007 unknown; check it at the 0.3.0 release (T1
    review note).
  - The owner's manual steps for 0.3.0: add the trusted publisher on npmjs.com with "allow npm
    publish" unchecked, then release within 2 days and approve the staged version with a
    two-factor code (`docs/RELEASING.md`).
- **Proposed rules:** None: the run had no findings.
