import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const versionLocations = {
	packageJson: "package.json",
	packageLock: "package-lock.json version",
	packageLockPackage: 'package-lock.json packages[""].version',
	plugin: "src/plugin.mjs",
	descriptor: "src/index.d.mts",
};

async function readFileIfPresent(filePath) {
	try {
		return await readFile(filePath, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

function parseJson(source) {
	if (source === null) return null;
	try {
		return JSON.parse(source);
	} catch (error) {
		if (error instanceof SyntaxError) return null;
		throw error;
	}
}

function extractVersion(source, pattern) {
	return source?.match(pattern)?.[1] ?? null;
}

export async function readVersions(root) {
	const [packageSource, lockSource, pluginSource, descriptorSource] = await Promise.all([
		readFileIfPresent(path.join(root, "package.json")),
		readFileIfPresent(path.join(root, "package-lock.json")),
		readFileIfPresent(path.join(root, "src", "plugin.mjs")),
		readFileIfPresent(path.join(root, "src", "index.d.mts")),
	]);
	const packageJson = parseJson(packageSource);
	const packageLock = parseJson(lockSource);
	const descriptor = descriptorSource?.match(/export interface EmdashImagesDescriptor\s*\{([\s\S]*?)\}/)?.[1];

	return {
		packageJson: typeof packageJson?.version === "string" ? packageJson.version : null,
		packageLock: typeof packageLock?.version === "string" ? packageLock.version : null,
		packageLockPackage: typeof packageLock?.packages?.[""]?.version === "string"
			? packageLock.packages[""].version
			: null,
		plugin: extractVersion(pluginSource, /^const version = "([^"]+)";\s*$/m),
		descriptor: extractVersion(descriptor, /^\s*version: "([^"]+)";\s*$/m),
	};
}

function versionProblems(versions) {
	const problems = [];
	const currentVersion = versions.packageJson;
	for (const [key, location] of Object.entries(versionLocations)) {
		const version = versions[key];
		if (version === null) {
			problems.push(`Missing version at ${location}`);
		} else if (key !== "packageJson" && currentVersion !== null && version !== currentVersion) {
			problems.push(`Version mismatch at ${location}: ${version} (package.json: ${currentVersion})`);
		}
	}
	return problems;
}

function hasCurrentChangelogSection(source, version) {
	const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}[ \\t]*\\r?$`, "m").test(source);
}

export async function verifyRelease(root) {
	const versions = await readVersions(root);
	const problems = versionProblems(versions);
	const changelog = await readFileIfPresent(path.join(root, "CHANGELOG.md"));
	if (changelog === null) {
		problems.push("CHANGELOG.md is missing");
	} else if (versions.packageJson !== null && !hasCurrentChangelogSection(changelog, versions.packageJson)) {
		problems.push(`CHANGELOG.md is missing a section for ${versions.packageJson} (expected ## [${versions.packageJson}] - YYYY-MM-DD)`);
	}
	return problems;
}

export async function verifyReleaseTag(root, tag) {
	const problems = await verifyRelease(root);
	if (typeof tag !== "string" || !/^v\d+\.\d+\.\d+$/.test(tag)) {
		problems.push(`Tag ${tag} is not vX.Y.Z`);
	} else {
		const { packageJson: version } = await readVersions(root);
		if (tag !== `v${version}`) {
			problems.push(`Tag ${tag} does not match package.json version ${version}`);
		}
	}
	return problems;
}

function compareVersions(left, right) {
	const leftParts = left.split(".").map(BigInt);
	const rightParts = right.split(".").map(BigInt);
	for (let index = 0; index < 3; index++) {
		if (leftParts[index] > rightParts[index]) return 1;
		if (leftParts[index] < rightParts[index]) return -1;
	}
	return 0;
}

function replaceVersion(source, pattern, version, location, versionGroup = 1) {
	const match = source.match(pattern);
	if (!match) throw new Error(`Missing version at ${location}`);
	const currentVersion = match[versionGroup];
	const versionOffset = match[0].indexOf(currentVersion);
	const start = match.index + versionOffset;
	return `${source.slice(0, start)}${version}${source.slice(start + currentVersion.length)}`;
}

function serializeJson(value) {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

function findUnreleasedSection(source) {
	const heading = /^## Unreleased[ \t]*\r?$/m.exec(source);
	if (!heading) return null;
	const lineEnd = source.indexOf("\n", heading.index);
	const afterHeading = lineEnd === -1 ? source.length : lineEnd + 1;
	const followingContent = source.slice(afterHeading);
	const nextHeading = /^## /m.exec(followingContent);
	const body = nextHeading ? followingContent.slice(0, nextHeading.index) : followingContent;
	return { heading, afterHeading, body };
}

export async function prepareRelease(root, version, { date } = {}) {
	if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
		throw new Error("Release version must use X.Y.Z (digits only, no prerelease).");
	}

	const versions = await readVersions(root);
	const currentVersion = versions.packageJson;
	if (currentVersion === null || !/^\d+\.\d+\.\d+$/.test(currentVersion)) {
		throw new Error("package.json is missing a valid X.Y.Z version.");
	}
	if (compareVersions(version, currentVersion) <= 0) {
		throw new Error(`Release version ${version} must be greater than current version ${currentVersion}.`);
	}

	const consistencyProblems = versionProblems(versions);
	if (consistencyProblems.length > 0) {
		throw new Error(`Cannot prepare release: ${consistencyProblems.join("; ")}`);
	}

	const changelogPath = path.join(root, "CHANGELOG.md");
	const changelog = await readFileIfPresent(changelogPath);
	if (changelog === null) throw new Error("CHANGELOG.md is missing; cannot prepare release.");
	const unreleased = findUnreleasedSection(changelog);
	if (unreleased === null) throw new Error("CHANGELOG.md is missing the ## Unreleased section.");
	if (!unreleased.body.split(/\r?\n/).some((line) => line.trim() !== "")) {
		throw new Error("CHANGELOG.md ## Unreleased section has no entries.");
	}

	const releaseDate = date ?? new Date().toISOString().slice(0, 10);
	if (typeof releaseDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
		throw new Error("Release date must use YYYY-MM-DD.");
	}

	const packagePath = path.join(root, "package.json");
	const lockPath = path.join(root, "package-lock.json");
	const pluginPath = path.join(root, "src", "plugin.mjs");
	const descriptorPath = path.join(root, "src", "index.d.mts");
	const [packageJson, packageLock, plugin, descriptor] = await Promise.all([
		readFile(packagePath, "utf8").then(JSON.parse),
		readFile(lockPath, "utf8").then(JSON.parse),
		readFile(pluginPath, "utf8"),
		readFile(descriptorPath, "utf8"),
	]);

	packageJson.version = version;
	packageLock.version = version;
	packageLock.packages[""].version = version;
	const updatedPlugin = replaceVersion(plugin, /^const version = "([^"]+)";\s*$/m, version, versionLocations.plugin);
	const updatedDescriptor = replaceVersion(
		descriptor,
		/(export interface EmdashImagesDescriptor\s*\{[\s\S]*?^\s*version: ")([^"]+)(";)/m,
		version,
		versionLocations.descriptor,
		2,
	);
	const newline = changelog.includes("\r\n") ? "\r\n" : "\n";
	const changelogRemainder = changelog.slice(unreleased.afterHeading).replace(/^\r?\n/, "");
	const updatedChangelog = `${changelog.slice(0, unreleased.heading.index)}## Unreleased${newline}${newline}## [${version}] - ${releaseDate}${newline}${newline}${changelogRemainder}`;
	const changedFiles = ["package.json", "package-lock.json", "src/plugin.mjs", "src/index.d.mts", "CHANGELOG.md"];

	await Promise.all([
		writeFile(packagePath, serializeJson(packageJson)),
		writeFile(lockPath, serializeJson(packageLock)),
		writeFile(pluginPath, updatedPlugin),
		writeFile(descriptorPath, updatedDescriptor),
		writeFile(changelogPath, updatedChangelog),
	]);
	return changedFiles;
}

function usage() {
	return [
		"Usage:",
		"  node scripts/release.mjs prepare <X.Y.Z>",
		"  node scripts/release.mjs verify",
		"  node scripts/release.mjs verify-tag <tag>",
	].join("\n");
}

async function main(args) {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	if (args.length === 2 && args[0] === "verify-tag") {
		const problems = await verifyReleaseTag(root, args[1]);
		if (problems.length > 0) {
			for (const problem of problems) console.error(problem);
			process.exitCode = 1;
			return;
		}
		const versions = await readVersions(root);
		console.log(`RELEASE TAG OK ${versions.packageJson}`);
		return;
	}
	if (args.length === 1 && args[0] === "verify") {
		const problems = await verifyRelease(root);
		if (problems.length > 0) {
			for (const problem of problems) console.error(problem);
			process.exitCode = 1;
			return;
		}
		const versions = await readVersions(root);
		console.log(`RELEASE OK ${versions.packageJson}`);
		return;
	}
	if (args.length === 2 && args[0] === "prepare") {
		try {
			for (const file of await prepareRelease(root, args[1])) console.log(file);
		} catch (error) {
			console.error(error.message);
			process.exitCode = 2;
		}
		return;
	}
	console.error(usage());
	process.exitCode = 2;
}

if (import.meta.main) await main(process.argv.slice(2));
