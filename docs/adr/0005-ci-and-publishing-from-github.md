# 0005 CI and publishing from GitHub

**Status:** accepted · **Date:** 2026-11-01

## Context

ADR-0003 has the owner publish every release by hand: `npm login`, a two-factor code and
six command blocks in `docs/RELEASING.md`, from a clean `main`. It deferred publishing from
CI because there was no CI and an npm token in CI secrets was the only option it considered
(ADR-0003 «Alternatives», «Consequences»). `docs/ROADMAP.md` item 3 asks for CI.

The owner decided on 2026-11-01:

- The repository is hosted on GitHub as `nimitzua/emdash-images` (public). The self-hosted
  Forgejo at git.srv1.parshyn.dev is no longer used; `package.json` `repository` and
  `homepage` and the link in `README.md:15` still point there.
- A pushed `vX.Y.Z` tag publishes the release from CI.
- This CI work lands before 0.2.0, and 0.2.0 is published by hand as the first release.

Facts from npm's documentation on trusted publishing (docs.npmjs.com/trusted-publishers,
read 2026-11-01):

- A GitHub Actions job with `permissions: id-token: write` publishes through OIDC with no npm
  token. It needs npm CLI 11.5.1 or later and Node 22.14.0 or later, and a GitHub-hosted runner.
- The trusted publisher is set per package on npmjs.com: owner, repository, the workflow file
  name, an optional environment, and the allowed actions (`npm publish` is a separate opt-in).
  npm does not validate it on save; errors show only at publish time.
- `repository.url` in `package.json` must match the GitHub repository, or the publish fails.
- Provenance is added automatically for a public package from a public repository.
- "A newly created trusted publisher configuration must complete its first successful publish
  within 2 days"; otherwise it expires and must be deleted and created again.
- A trusted publisher can only be configured for a package that already exists on the
  registry, so the first version is published by hand (npm `npm-trust(1)`; secondary sources).

Local tooling at the time: Node 26.13.0, npm 11.20.0; the package requires Node 26 or later
(`package.json` `engines`).

## Decision

- **GitHub is the source repository.** `package.json` `repository.url` is
  `git+https://github.com/nimitzua/emdash-images.git`, `homepage` and `bugs` point to the
  GitHub repository, and the README links there. Nothing in the package or its docs names
  git.srv1 any more; the dated ADRs and done plans stay as written.
- **CI on every push to `main` and every pull request.** One workflow, `.github/workflows/ci.yml`,
  on `ubuntu-latest` with Node 26: `npm ci`, `npm test`, `node scripts/release.mjs verify`. It
  runs with `contents: read` only.
- **Publishing from a pushed tag.** `.github/workflows/release.yml` runs on a pushed `v*` tag
  with `contents: read` and `id-token: write`. It checks that the tag is `v` plus the
  `package.json` version and that the release verifies (a new `release.mjs verify-tag` command),
  checks the npm CLI is at least 11.5.1, runs `npm ci`, and runs `npm publish`, whose
  `prepublishOnly` runs the tests and `verify` again. When that version is already on the
  registry the job skips the publish and succeeds, so pushing the tag of a hand-published
  release (0.2.0) is harmless. No npm token is stored anywhere.
- **The owner still releases.** The owner runs `release.mjs prepare`, reviews the diff, commits
  and tags with signatures, and pushes `main` and the tag; CI publishes. Plans still never bump
  the version, tag, push or publish (ADR-0003 «Who releases» otherwise stands).
- **First release by hand.** 0.2.0 follows the manual procedure of ADR-0003. Only right before
  the next release does the owner add the trusted publisher on npmjs.com (`nimitzua`,
  `emdash-images`, `release.yml`, no environment, `npm publish` allowed), because of the
  two-day expiry. After the first CI publish the owner may set the package's publishing access
  to "require two-factor authentication and disallow tokens", which does not affect trusted
  publishing.
- **A failed CI publish is fixed forward.** A pushed tag is never moved or deleted. If the
  publish failed for a configuration reason (trusted publisher missing or expired), the owner
  fixes it and re-runs the job; if the release needs a code change, it becomes the next patch
  version.
- **Actions by major version.** The workflows use `actions/checkout@v6` and
  `actions/setup-node@v6`, as npm's own example does, and the release job turns off the
  package-manager cache.

## Consequences

- Releases after 0.2.0 need no `npm login` and no two-factor code on the owner's machine, and
  each published version carries npm provenance that links it to the tag's workflow run.
- `docs/RELEASING.md` gains the GitHub steps: the first push, the trusted-publisher setup and
  its two-day window, the CI release, and fixing a failed publish forward.
- The plan's workflows can only be proven on GitHub. The plan checks their text and the
  `verify-tag` command locally; the owner's first push of `main` is the first real CI run, and
  a failure there becomes a fix plan.
- The owner may protect `main` with the CI check as a required status. The Orca run merges
  locally, so a failing CI shows only after the owner's push.
- ADR-0003's alternative "Publish from CI on a tag push" is taken, without the npm token it
  assumed.

## Alternatives

- **An npm automation token in GitHub secrets.** Works for the first publish too, but a
  long-lived token can leak and bypasses two-factor; trusted publishing needs neither.
- **Publish on a GitHub Release, or from a manual `workflow_dispatch`.** A Release adds a step
  for the owner; npm warns that `workflow_dispatch` can mismatch the trusted publisher's
  workflow check. The owner chose the tag push.
- **Pin actions by commit SHA.** Stronger against a moved tag, but needs updates by hand or a
  bot; the two actions are GitHub's own. Can follow with Dependabot.
- **Publish 0.2.0 first and add CI after.** 0.2.0 would ship metadata pointing at git.srv1.
- **Keep git.srv1 as the source and mirror to GitHub.** The owner dropped the Forgejo host.
