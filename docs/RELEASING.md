# Releasing

## Before the first publish

Create the `@nimitzua` scope on npmjs.com, sign in with `npm login`, and enable two-factor authentication for publishing.

## Each release

1. Start from a clean `main` branch that is up to date with `origin/main`:

   ```sh
   git switch main
   git pull --ff-only origin main
   git status --short
   ```

   `git status --short` should print nothing.

2. Choose the next version from `## Unreleased` and the version rule below, then prepare it:

   ```sh
   node scripts/release.mjs prepare X.Y.Z
   ```

3. Review the complete release diff:

   ```sh
   git diff
   ```

   Confirm that the version, lockfile, plugin descriptor, type declaration and changelog agree.

4. Commit the release with a signed commit, then verify the release:

   ```sh
   git add package.json package-lock.json src/plugin.mjs src/index.d.mts CHANGELOG.md
   git commit -S -m "Release X.Y.Z"
   node scripts/release.mjs verify
   ```

5. Review the package contents before publishing:

   ```sh
   npm pack --dry-run
   ```

   The package should contain only files under `src/` and `README.md`, `SKILL.md`, `CHANGELOG.md`, `LICENSE`, and `package.json` at its root. Check that there are no tests, scripts, or docs in the package.

6. Create a signed annotated tag, publish, and push the release commit and tag:

   ```sh
   git tag -s vX.Y.Z -m "X.Y.Z"
   npm publish
   git push origin main vX.Y.Z
   ```

   `npm publish` runs `prepublishOnly`, which runs the test suite and `node scripts/release.mjs verify`.

If `npm publish` fails after the tag is created, do not push. Delete the local tag with `git tag -d vX.Y.Z`, remove the unpushed release commit with `git reset --hard HEAD^`, fix the cause in a normal commit, and start the release procedure again from clean `main`. If the registry result is unclear, confirm whether that version was published before trying to publish it again.

## Version numbers

While the package is below 1.0.0, a breaking change or a new feature raises the minor version; a fix raises the patch version. Choose the next number by reviewing `## Unreleased`: use a minor release if it contains a feature or breaking change, and a patch release for fixes alone. The first 1.0.0 release is for when the public API, `Picture` component and CLI have settled. The next release after 0.1.0 is 0.2.0.
