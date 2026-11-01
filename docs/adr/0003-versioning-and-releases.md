# 0003 Versioning and releases

**Status:** accepted; publishing from CI and the GitHub repository by 0005 · **Date:** 2026-10-31

## Context

The package was imported as 0.1.0, installed by sites from a git tag
(`git+https://git.srv1.parshyn.dev/nimitzua/emdash-images.git#v0.1.0`). Plans 001 and 002
changed its behaviour and added a `bin`, but `version` is still `0.1.0` and there is no release
process. The version string is written in four places by hand: `package.json`,
`package-lock.json` (twice), the plugin descriptor constant in `src/plugin.mjs` and the literal
type in `src/index.d.mts`; `test/plugin.test.mjs` repeats it. Agents are denied `git tag` and
`git push` (`docs/ORCA.md` «Notes»). ADR-0001 and ADR-0002 live in the source site's
repository; this repository's ADRs continue the numbering.

## Decision

- **Registry.** Releases are published to the public npm registry as
  `@nimitzua/emdash-images` (`publishConfig.access` `public`). Every release also gets a signed
  annotated git tag `vX.Y.Z` on its release commit. The npm install is the documented one; a
  git-tag install keeps working but is not advertised.
- **Version numbers.** SemVer. Before 1.0.0, a breaking change or a new feature raises the minor
  version and a fix raises the patch version, which is what npm's `^0.y.z` range expects. 1.0.0
  comes when the public API, the `Picture` component and the CLI have settled. The next release
  is 0.2.0 (plan 001 added the `emdash-images` command).
- **One version, checked.** `package.json` is the source of truth. A test fails whenever
  `package-lock.json`, the descriptor in `src/plugin.mjs` or the type in `src/index.d.mts`
  disagree with it, so no plan or release can leave them out of step.
- **Changelog.** `CHANGELOG.md` in the Keep a Changelog format, written by hand, shipped in the
  npm package. Every plan that changes behaviour, the public API or the documented usage adds
  its lines under `## Unreleased` in one of its tasks. A release turns `## Unreleased` into
  `## [X.Y.Z] - YYYY-MM-DD`.
- **Who releases.** The owner, by hand, from a clean `main`. A repository script prepares the
  release (bumps every version location, dates the changelog section) and verifies it; the
  owner reviews the diff, commits, tags, publishes with npm two-factor authentication and
  pushes. Plans never bump the version, tag or publish.

## Consequences

- Consumers get semver ranges, `npm outdated` and installs that do not depend on
  git.srv1.parshyn.dev being reachable.
- The owner needs the `@nimitzua` scope on npmjs.com and npm two-factor authentication before
  the first publish.
- Every plan carries a changelog task item; reviewers can check it.
- Publishing from CI (tokens, provenance) is not covered; it can follow once CI exists
  (`docs/ROADMAP.md`, CI).

## Alternatives

- **Git tags only.** No registry account or token, but no semver ranges, and every install
  depends on the self-hosted git server.
- **The Forgejo/Gitea npm registry on git.srv1.** Every consumer would have to configure that
  registry in `.npmrc`; wrong for a public MIT package.
- **Changesets.** Automates version and changelog, but adds a devDependency and per-change files
  for a single package with one author.
- **Publish from CI on a tag push.** Needs CI and an npm token in its secrets first; deferred.
- **1.0.0 now.** The API is still expected to change (`Picture`, other databases and storage).
