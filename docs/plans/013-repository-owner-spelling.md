# 013 Repository owner spelling

**Goal:** Package metadata and docs name the GitHub repository as `NimitzUA/emdash-images`, so
npm accepts the provenance of the next staged release (0.3.1).

**Context:** `docs/adr/0005-ci-and-publishing-from-github.md` «Decision» (a cause in the code
becomes the next patch version); `docs/adr/0007-staged-publishing.md`; `docs/RELEASING.md`;
ADR-0003 «Decision» (Changelog).

Facts read while writing this plan (2026-11-02, `main` at `ca9b599` «Release 0.3.0», version
`0.3.0`):

- The owner tagged and pushed `v0.3.0`. GitHub answered the push with
  `This repository moved. Please use the new location: https://github.com/NimitzUA/emdash-images.git`.
- `release.yml` run `41372704831` (re-run after the owner set the trusted publisher to
  `NimitzUA/emdash-images`, `release.yml`, no environment, stage only, status Valid) passed the
  OIDC exchange and failed in `npm stage publish` with
  `npm error code E422` and `Error verifying sigstore provenance bundle: Failed to validate
  repository information: package.json: "repository.url" is
  "git+https://github.com/nimitzua/emdash-images.git", expected to match
  "https://github.com/NimitzUA/emdash-images" from provenance`. Nothing was staged; 0.3.0 is
  not on npm, and its tag stays (ADR-0005).
- The repository owner spelling `nimitzua` appears in GitHub URLs at `package.json:18`
  (`repository.url`), `package.json:20` (`homepage`), `package.json:22` (`bugs.url`),
  `README.md:15` (the link and its text) and `docs/RELEASING.md:5,8`. The npm scope
  `@nimitzua` is a different name and stays lowercase everywhere. No test or script reads
  these URLs (`git grep -n "github.com/nimitzua" -- test scripts` prints nothing).

**Version impact:** a patch (0.3.1): package metadata only, with a `### Fixed` entry under
`## Unreleased`. No code or API change. No `version` bump, tag, push or publish.

**Preconditions:**
- `main` is clean at 0.3.0: `git status --porcelain` prints nothing and `npm pkg get version`
  prints `"0.3.0"`.

**Branch:** `task/013-repository-owner-spelling` · **Worktree:** `.worktrees/emdash-images/013-repository-owner-spelling`

## Tasks

### T1: Name the repository NimitzUA/emdash-images

- **Target:** `package.json`, `README.md`, `docs/RELEASING.md`, `CHANGELOG.md`.
- **Change:**
  - `package.json`: `repository.url` `git+https://github.com/NimitzUA/emdash-images.git`,
    `homepage` `https://github.com/NimitzUA/emdash-images#readme`, `bugs.url`
    `https://github.com/NimitzUA/emdash-images/issues`. Nothing else.
  - `README.md:15`: the link text and URL name `NimitzUA/emdash-images`.
  - `docs/RELEASING.md`:
    - «Repository» (lines 5 and 8): `NimitzUA/emdash-images` and
      `git remote set-url origin https://github.com/NimitzUA/emdash-images.git`, with one
      sentence that `repository.url` must match GitHub's spelling of the owner exactly, because
      npm compares it with the provenance case-sensitively;
    - a short paragraph after «Each later release» step 4, or in «If the CI publish fails»:
      `v0.3.0` was tagged on 2026-11-02 but not published, because npm rejected its provenance
      with `E422` (owner spelling); its tag stays, and 0.3.1 is the next published version.
  - `CHANGELOG.md` `## Unreleased`: a `### Fixed` section with one entry: "Package metadata
    (`repository`, `homepage`, `bugs`) and the README name the GitHub repository
    `NimitzUA/emdash-images`, matching the provenance npm checks. 0.3.0 was tagged but never
    published because npm rejected its provenance."
- **Constraints:** The npm package name and scope `@nimitzua/emdash-images` do not change
  anywhere (`package.json` `name`, imports, `Symbol.for` keys, `release.yml`, docs). Dated ADRs,
  done plans and released `CHANGELOG.md` sections stay as written. `src/`, `test/`,
  `scripts/`, `.github/` and `package-lock.json` unchanged.
- **Ownership:** `package.json`, `README.md`, `docs/RELEASING.md`, `CHANGELOG.md`. No test or
  script reads the changed URLs; no existing test changes.
- **Acceptance:**
  - `./scripts/orca/check.sh` ends with `CHECK OK`
  - `npm pkg get repository.url homepage bugs.url` prints the three `NimitzUA` URLs above
  - `git grep -n "github.com/nimitzua" -- package.json README.md docs/RELEASING.md` prints
    nothing
  - `npm pkg get name` prints `"@nimitzua/emdash-images"`
  - `git grep -n -e "^### Fixed" -e "NimitzUA/emdash-images" -- CHANGELOG.md` prints both
    lines above `## [0.3.0]`
  - `node scripts/release.mjs verify` prints `RELEASE OK 0.3.0`
  - `git diff main --stat` lists only `package.json`, `README.md`, `docs/RELEASING.md` and
    `CHANGELOG.md`
- **Commit:** `Name the repository NimitzUA/emdash-images for provenance`
- **Docs:** ADR-0005 «Decision»; ADR-0007; `docs/RELEASING.md`.
- **Size:** 3 lines of metadata, about 10 lines of docs.

## Plan gates

`./scripts/orca/plan-gates.sh` in the worktree (install, test), then:

- `node scripts/release.mjs verify` from the worktree's copy prints `RELEASE OK 0.3.0`
- `git diff main -- src test scripts .github package-lock.json` prints nothing

## Amendments

None.

## Outcome

- **Merge:** `f13402f` (`--no-ff` of `task/013-repository-owner-spelling` onto `f6bb539`). Task
  commit: T1 `6255855`, review 1 PASS with no findings. No fix rounds. Gates: `GATES OK`;
  `node scripts/release.mjs verify` printed `RELEASE OK 0.3.0`;
  `git diff main -- src test scripts .github package-lock.json` empty; `VERIFY OK` on main. The
  lockfile did not change, so no install on main. `version` stays `0.3.0`; nothing tagged,
  pushed or published.
- **Decisions:** None: the executor asked no questions; no plan amendments.
- **Surprises:** None.
- **Deviations:** None. `CHANGELOG.md` writes `0.3.0` in backticks where the plan's entry text
  has it plain (review note; harmless).
- **Follow-ups:**
  - `docs/RELEASING.md:94` «Trusted publisher» still tells the owner to enter owner `nimitzua`,
    while the working trusted publisher uses `NimitzUA` and the new sentence in «Repository»
    says the owner spelling must match GitHub exactly. The plan named only the GitHub URL lines
    (its grep covered `github.com/nimitzua`), so the run left it (T1 review note).
  - The owner's manual steps for 0.3.1: `release.mjs prepare 0.3.1`, tag and push, then approve
    the staged version with a two-factor code (`docs/RELEASING.md`); check whether `gh run rerun`
    on an already staged version stages it again (ADR-0007 unknown).
- **Proposed rules:** None: the run had no findings.
