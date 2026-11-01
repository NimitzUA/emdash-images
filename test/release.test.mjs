import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareRelease, readVersions, verifyRelease, verifyReleaseTag } from "../scripts/release.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const currentVersion = packageJson.version;
const [majorVersion, minorVersion] = currentVersion.split(".");
const nextVersion = `${majorVersion}.${Number(minorVersion) + 1}.0`;
const versionFiles = [
	"package.json",
	"package-lock.json",
	"src/plugin.mjs",
	"src/index.d.mts",
];
const initialChangelog = `# Changelog\n\n## Unreleased\n\n### Added\n- A fixture entry.\n\n## [${currentVersion}] - 2026-10-28\n- Existing release entry.\n`;

test("readVersions finds every repository version and they agree with package.json", async () => {
	const versions = await readVersions(packageRoot);
	assert.deepEqual(Object.values(versions), Array(5).fill(currentVersion));
});

test("verifyRelease reports a mismatch in each version location", async (t) => {
	const mismatchCases = [
		["package-lock.json version", async (root) => updateJson(root, "package-lock.json", (value) => { value.version = "9.9.9"; })],
		["package-lock.json packages[\"\"].version", async (root) => updateJson(root, "package-lock.json", (value) => { value.packages[""].version = "9.9.9"; })],
		["src/plugin.mjs", async (root) => updateText(root, "src/plugin.mjs", (source) => source.replace(`const version = "${currentVersion}";`, 'const version = "9.9.9";'))],
		["src/index.d.mts", async (root) => updateText(root, "src/index.d.mts", (source) => source.replace(`version: "${currentVersion}";`, 'version: "9.9.9";'))],
	];

	for (const [location, mutate] of mismatchCases) {
		await t.test(location, async (testContext) => {
			const root = await createReleaseRoot();
			testContext.after(() => rm(root, { recursive: true, force: true }));
			await mutate(root);
			const problems = await verifyRelease(root);
			assert.ok(problems.some((problem) => problem.startsWith(`Version mismatch at ${location}:`)), problems.join("\n"));
		});
	}
});

test("verifyRelease reports each missing version location", async (t) => {
	const missingCases = [
		["package.json", "packageJson", async (root) => updateJson(root, "package.json", (value) => { delete value.version; })],
		["package-lock.json version", "packageLock", async (root) => updateJson(root, "package-lock.json", (value) => { delete value.version; })],
		["package-lock.json packages[\"\"].version", "packageLockPackage", async (root) => updateJson(root, "package-lock.json", (value) => { delete value.packages[""].version; })],
		["src/plugin.mjs", "plugin", async (root) => updateText(root, "src/plugin.mjs", (source) => source.replace(/^const version = .*\n/m, ""))],
		["src/index.d.mts", "descriptor", async (root) => updateText(root, "src/index.d.mts", (source) => source.replace(/^\s*version: .*\n/m, ""))],
	];

	for (const [location, versionKey, mutate] of missingCases) {
		await t.test(location, async (testContext) => {
			const root = await createReleaseRoot();
			testContext.after(() => rm(root, { recursive: true, force: true }));
			await mutate(root);
			const versions = await readVersions(root);
			const problems = await verifyRelease(root);
			assert.equal(versions[versionKey], null);
			assert.ok(problems.includes(`Missing version at ${location}`), problems.join("\n"));
		});
	}
});

test("verifyRelease reports a missing changelog and no version mismatch", async (t) => {
	const root = await createReleaseRoot(null);
	t.after(() => rm(root, { recursive: true, force: true }));
	const problems = await verifyRelease(root);
	assert.deepEqual(problems, ["CHANGELOG.md is missing"]);
});

test("verifyRelease requires a dated section for the current package version", async (t) => {
	const root = await createReleaseRoot("# Changelog\n\n## Unreleased\n\n- A pending entry.\n");
	t.after(() => rm(root, { recursive: true, force: true }));
	assert.deepEqual(await verifyRelease(root), [
		`CHANGELOG.md is missing a section for ${currentVersion} (expected ## [${currentVersion}] - YYYY-MM-DD)`,
	]);
});

test("verifyReleaseTag accepts the current package version", async (t) => {
	const root = await createReleaseRoot();
	t.after(() => rm(root, { recursive: true, force: true }));
	assert.deepEqual(await verifyReleaseTag(root, `v${currentVersion}`), []);
});

test("verifyReleaseTag reports a tag version mismatch", async (t) => {
	const root = await createReleaseRoot();
	t.after(() => rm(root, { recursive: true, force: true }));
	assert.deepEqual(await verifyReleaseTag(root, "v9.9.9"), [
		`Tag v9.9.9 does not match package.json version ${currentVersion}`,
	]);
});

test("verifyReleaseTag reports tags outside the vX.Y.Z format", async (t) => {
	const root = await createReleaseRoot();
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const tag of ["0.1.0", "v0.1", "v0.1.0-rc.1"]) {
		assert.deepEqual(await verifyReleaseTag(root, tag), [`Tag ${tag} is not vX.Y.Z`]);
	}
});

test("verifyReleaseTag includes verifyRelease changelog problems", async (t) => {
	const root = await createReleaseRoot("# Changelog\n\n## Unreleased\n\n- A pending entry.\n");
	t.after(() => rm(root, { recursive: true, force: true }));
	assert.deepEqual(await verifyReleaseTag(root, `v${currentVersion}`), [
		`CHANGELOG.md is missing a section for ${currentVersion} (expected ## [${currentVersion}] - YYYY-MM-DD)`,
	]);
});

test("prepareRelease rejects malformed, prerelease, current, and older versions", async (t) => {
	const root = await createReleaseRoot();
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const version of ["0.2", "0.2.0-rc.1", currentVersion, "0.0.9"]) {
		await assert.rejects(prepareRelease(root, version, { date: "2026-11-01" }));
	}
	await assert.rejects(prepareRelease(root, currentVersion, { date: "2026-11-01" }), /must be greater than current version/);
});

test("prepareRelease rejects a mismatch before writing files", async (t) => {
	const root = await createReleaseRoot();
	t.after(() => rm(root, { recursive: true, force: true }));
	await updateText(root, "src/plugin.mjs", (source) => source.replace(`const version = "${currentVersion}";`, 'const version = "9.9.9";'));
	await assert.rejects(
		prepareRelease(root, nextVersion, { date: "2026-11-01" }),
		/Version mismatch at src\/plugin\.mjs/,
	);
});

test("prepareRelease rejects an empty or missing Unreleased section", async (t) => {
	const emptyRoot = await createReleaseRoot(`# Changelog\n\n## Unreleased\n\n## [${currentVersion}] - 2026-10-28\n- Existing entry.\n`);
	t.after(() => rm(emptyRoot, { recursive: true, force: true }));
	await assert.rejects(prepareRelease(emptyRoot, nextVersion, { date: "2026-11-01" }), /has no entries/);

	const missingRoot = await createReleaseRoot(`# Changelog\n\n## [${currentVersion}] - 2026-10-28\n- Existing entry.\n`);
	t.after(() => rm(missingRoot, { recursive: true, force: true }));
	await assert.rejects(prepareRelease(missingRoot, nextVersion, { date: "2026-11-01" }), /missing the ## Unreleased section/);
});

test("prepareRelease updates every version and moves Unreleased entries under the new dated section", async (t) => {
	const root = await createReleaseRoot();
	t.after(() => rm(root, { recursive: true, force: true }));
	const changedFiles = await prepareRelease(root, nextVersion, { date: "2026-11-01" });
	assert.deepEqual(changedFiles, ["package.json", "package-lock.json", "src/plugin.mjs", "src/index.d.mts", "CHANGELOG.md"]);
	assert.deepEqual(Object.values(await readVersions(root)), Array(5).fill(nextVersion));
	for (const file of ["package.json", "package-lock.json"]) {
		const jsonSource = await readFile(path.join(root, file), "utf8");
		assert.ok(jsonSource.startsWith("{\n\t\"name\""));
		assert.ok(jsonSource.endsWith("\n"));
	}
	const originalPlugin = await readFile(path.join(packageRoot, "src", "plugin.mjs"), "utf8");
	const originalDescriptor = await readFile(path.join(packageRoot, "src", "index.d.mts"), "utf8");
	assert.equal(
		await readFile(path.join(root, "src", "plugin.mjs"), "utf8"),
		originalPlugin.replace(`const version = "${currentVersion}";`, `const version = "${nextVersion}";`),
	);
	assert.equal(
		await readFile(path.join(root, "src", "index.d.mts"), "utf8"),
		originalDescriptor.replace(`version: "${currentVersion}";`, `version: "${nextVersion}";`),
	);
	const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
	assert.ok(changelog.includes(`\n## Unreleased\n\n## [${nextVersion}] - 2026-11-01\n\n### Added\n- A fixture entry.`));
	assert.ok(changelog.includes(`## [${currentVersion}] - 2026-10-28`));
	assert.deepEqual(await verifyRelease(root), []);
});

async function createReleaseRoot(changelog = initialChangelog) {
	const root = await mkdtemp(path.join(os.tmpdir(), "emdash-release-"));
	await mkdir(path.join(root, "src"), { recursive: true });
	for (const file of versionFiles) {
		await copyFile(path.join(packageRoot, file), path.join(root, file));
	}
	if (changelog !== null) await writeFile(path.join(root, "CHANGELOG.md"), changelog);
	return root;
}

async function updateJson(root, file, mutate) {
	const filePath = path.join(root, file);
	const value = JSON.parse(await readFile(filePath, "utf8"));
	mutate(value);
	await writeFile(filePath, `${JSON.stringify(value, null, "\t")}\n`);
}

async function updateText(root, file, mutate) {
	const filePath = path.join(root, file);
	const source = await readFile(filePath, "utf8");
	await writeFile(filePath, mutate(source));
}
