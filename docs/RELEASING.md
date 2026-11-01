# Releasing

## Repository

The source repository is GitHub `nimitzua/emdash-images`. Point `origin` at it once:

```sh
git remote set-url origin https://github.com/nimitzua/emdash-images.git
```

Push `main` and check the first CI run:

```sh
git push -u origin main
gh run list --workflow ci.yml --limit 1
```

## First release, by hand (0.2.0)

0.2.0 was published by hand on 2026-11-01. Before the second release, add the trusted publisher
(«Trusted publisher»); later releases then follow «Each later release».

npm requires the package to exist before a trusted publisher can be added. Before the first
publish, create the `@nimitzua` scope on npmjs.com, sign in with `npm login`, and enable two-factor
authentication for publishing. npm will ask for a two-factor code during the publish.

1. Start from a clean `main` branch that is up to date with `origin/main`:

   ```sh
   git switch main
   git pull --ff-only origin main
   git status --short
   ```

   `git status --short` should print nothing.

2. Prepare the first release:

   ```sh
   node scripts/release.mjs prepare 0.2.0
   ```

3. Review the complete release diff:

   ```sh
   git diff
   ```

   Confirm that the version, lockfile, plugin descriptor, type declaration and changelog agree.

4. Commit the release with a signed commit, then verify it:

   ```sh
   git add package.json package-lock.json src/plugin.mjs src/index.d.mts CHANGELOG.md
   git commit -S -m "Release 0.2.0"
   node scripts/release.mjs verify
   ```

5. Review the package contents before publishing:

   ```sh
   npm pack --dry-run
   ```

   The package should contain only files under `src/` and `README.md`, `SKILL.md`, `CHANGELOG.md`,
   `LICENSE`, and `package.json` at its root. Check that there are no tests, scripts, or docs in the
   package.

6. Create a signed annotated tag, publish, and push the release commit and tag:

   ```sh
   git tag -s v0.2.0 -m "0.2.0"
   npm publish
   git push origin main v0.2.0
   ```

   `npm publish` runs `prepublishOnly`, which runs the test suite and
   `node scripts/release.mjs verify`. Pushing the tag starts `release.yml`. Right after the first
   publish, the registry may not show the new package yet, so the tag's `Release` run tries to
   publish and fails with `E404` while no trusted publisher exists. This failure needs no action,
   and the tag stays.

If the local `npm publish` fails after the tag is created, do not push. Delete the local tag with
`git tag -d v0.2.0`, remove the unpushed release commit with `git reset --hard HEAD^`, fix the cause
in a normal commit, and start the release procedure again from clean `main`. If the registry result
is unclear, confirm whether 0.2.0 was published before trying to publish it again.

## Trusted publisher (once, right before the second release)

On npmjs.com, open the package settings and choose **Trusted Publisher**. Select **GitHub Actions**
and enter owner `nimitzua`, repository `emdash-images`, workflow `release.yml`, and no environment;
allow `npm publish`. If no publish succeeds within 2 days, the trusted publisher expires. Delete it
and add it again before retrying.

After the first CI publish, you may optionally set publishing access to require two-factor
authentication and disallow tokens.

## Each later release

1. Start from a clean `main` branch that is up to date with `origin/main`:

   ```sh
   git switch main
   git pull --ff-only origin main
   git status --short
   ```

   `git status --short` should print nothing.

2. Prepare the next version, review the diff, commit with a signature, and verify it:

   Choose `X.Y.Z` from `## Unreleased` in `CHANGELOG.md` using the rule in «Version numbers».

   ```sh
   node scripts/release.mjs prepare X.Y.Z
   git diff
   git add package.json package-lock.json src/plugin.mjs src/index.d.mts CHANGELOG.md
   git commit -S -m "Release X.Y.Z"
   node scripts/release.mjs verify
   ```

3. Review the package contents and verify the tag matches the release:

   ```sh
   npm pack --dry-run
   node scripts/release.mjs verify-tag vX.Y.Z
   ```

4. Create a signed annotated tag and push the release commit and tag:

   ```sh
   git tag -s vX.Y.Z -m "X.Y.Z"
   git push origin main vX.Y.Z
   ```

   Follow the workflow run with `gh run watch` and confirm the published version:

   ```sh
   npm view @nimitzua/emdash-images version
   ```

   No `npm login` or two-factor code is needed for these releases.

## If the CI publish fails

Never move or delete a pushed tag. For a configuration cause (trusted publisher missing, expired,
or with a wrong field), fix the configuration on npmjs.com and re-run the workflow with
`gh run rerun <run-id>`. A cause in the code becomes the next patch version.

## Version numbers

While the package is below 1.0.0, a breaking change or a new feature raises the minor version; a fix raises the patch version. Choose the next number by reviewing `## Unreleased`: use a minor release if it contains a feature or breaking change, and a patch release for fixes alone. The first 1.0.0 release is for when the public API, `Picture` component and CLI have settled. 0.2.0 was the first version published to npm.
