# 0007 Staged publishing

**Status:** accepted · **Date:** 2026-11-02

## Context

ADR-0005 publishes a release from CI: a pushed `v*` tag runs `.github/workflows/release.yml`,
which checks the npm CLI is at least 11.5.1 and runs `npm publish` through trusted publishing,
and the trusted publisher on npmjs.com allows `npm publish`. Nobody approves the version
between the tag push and the registry, so anyone who can push a `v*` tag or change the workflow
can publish a version.

While adding the trusted publisher before 0.3.0 (2026-11-02), npmjs.com marked "allow npm
publish" as "Not recommended. For stronger security, leave this unchecked to require staged
publishing for new versions."

Facts from npm's documentation, read 2026-11-02:

- docs.npmjs.com/staged-publishing: "Staged publishing requires npm CLI version 11.15.0 or
  later and Node version 22.14.0 or higher." `npm stage publish` "does not require 2FA"; a
  maintainer approves with `npm stage approve <stage-id>` or on npmjs.com, and "You will be
  prompted for 2FA verification whether you approve the package in the CLI or on npmjs.com."
  The account needs two-factor authentication enabled.
- docs.npmjs.com/trusted-publishers: "`npm stage publish` is always allowed"; `npm publish` and
  `npm dist-tag` are separate permissions. "The first successful publish validates the
  configuration and binds it to the repository's immutable identity"; the page does not say
  whether a staged publish counts for the two-day expiry of a new configuration.
- docs.npmjs.com/cli/v11/commands/npm-stage: `npm stage publish` "has parity with
  `npm publish`" and takes `--provenance`, `--tag` and `--access`; a staged version is "not
  available for public access" until approved. The page does not say whether staged versions
  expire or whether `npm view` shows them.
- Locally (npm 11.20.0, 2026-11-02), `npm stage --help` lists `publish`, `list`, `view`,
  `approve`, `reject` and `download`, and `npm stage publish --dry-run` with no package spec
  stages the current directory and runs `prepublishOnly` (`npm test && node scripts/release.mjs
  verify`) first, as `npm publish` does.

The owner decided on 2026-11-02 to leave "allow npm publish" unchecked and approve every
release.

## Decision

- **CI stages, the owner approves.** `release.yml` runs `npm stage publish` instead of
  `npm publish`, and its npm CLI check requires 11.15.0 or later. The version reaches the
  registry only when the owner approves it with two-factor authentication, with
  `npm stage approve <stage-id>` or on npmjs.com.
- **The trusted publisher allows staging only.** On npmjs.com the configuration is `nimitzua`,
  `emdash-images`, `release.yml`, no environment, with "allow npm publish" unchecked. It is added
  right before the next release, as ADR-0005 says, and the owner approves the staged version
  within the configuration's two days.
- **The rest of ADR-0005 stands:** the tag check (`release.mjs verify-tag`), the skip when the
  version is already on the registry, `npm ci`, no npm token, a pushed tag never moved or
  deleted, and failed publishes fixed forward.
- **A rejected or wrong staged version is fixed forward.** If the owner rejects a staged
  version (`npm stage reject <stage-id>`), the fix becomes the next patch version with a new tag.

## Consequences

- No version reaches npm without the owner's two-factor approval, even from a pushed tag or a
  changed workflow.
- Every release gains one owner step after the tag's workflow run: list the staged version,
  review it and approve it. `docs/RELEASING.md` («Trusted publisher», «Each later release»,
  «If the CI publish fails») describes it.
- `release.yml` changes; like ADR-0005's workflows, it can only be proven on GitHub, at the
  owner's first staged release (0.3.0).
- Unknowns are checked at that release: whether approving counts as the first successful
  publish for the two-day expiry, and how a re-run behaves while a version is staged (the
  registry skip step sees only published versions). A surprise becomes a fix plan.

## Alternatives

- **Allow `npm publish` (ADR-0005 as is).** No extra step, but no human gate between a tag and
  the registry; npm marks it "Not recommended". Rejected by the owner.
- **Stage from the owner's machine.** Needs `npm login` again and loses the CI provenance link.
- **A GitHub environment with required reviewers.** A gate on GitHub's side, but it protects
  only that workflow; a staged version is gated on npm itself.
