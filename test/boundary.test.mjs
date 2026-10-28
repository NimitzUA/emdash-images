import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(packageRoot, "src");
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const staticImport = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?(['"])([^'"\\]+)\1/g;
const dynamicImport = /\bimport\s*\(\s*(['"])([^'"\\]+)\1\s*\)/g;
const commonJsImport = /\brequire\s*\(\s*(['"])([^'"\\]+)\1\s*\)/g;

test("package source stays within its boundary and declared dependencies", async () => {
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	const dependencies = new Set([
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	]);
	const sourceFiles = await collectFiles(sourceRoot);
	const violations = [];

	for (const filePath of sourceFiles) {
		const source = await readFile(filePath, "utf8");
		const uncommentedSource = removeComments(source);
		const relativeFile = path.relative(packageRoot, filePath);

		if (quotedStrings(uncommentedSource).some((value) => /private-cases/i.test(value))) {
			violations.push(`${relativeFile}: contains a private storage-key literal`);
		}

		for (const specifier of importedSpecifiers(uncommentedSource)) {
			if (specifier.startsWith(".")) {
				const targetPath = path.resolve(path.dirname(filePath), specifier);
				if (!isWithin(packageRoot, targetPath)) {
					violations.push(`${relativeFile}: relative import leaves the package: ${specifier}`);
				}
				continue;
			}

			if (path.isAbsolute(specifier) || specifier.startsWith("file:")) {
				violations.push(`${relativeFile}: absolute or file import is outside the package boundary: ${specifier}`);
				continue;
			}

			if (builtins.has(specifier)) continue;

			const dependencyName = packageName(specifier);
			if (!dependencies.has(dependencyName)) {
				violations.push(`${relativeFile}: bare import is not a dependency, peer dependency, or Node built-in: ${specifier}`);
			}
		}
	}

	assert.deepEqual(violations, [], violations.join("\n"));
});

async function collectFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...await collectFiles(entryPath));
		else if (entry.isFile()) files.push(entryPath);
	}
	return files;
}

function importedSpecifiers(source) {
	const specifiers = [];
	for (const pattern of [staticImport, dynamicImport, commonJsImport]) {
		pattern.lastIndex = 0;
		for (const match of source.matchAll(pattern)) specifiers.push(match[2]);
	}
	return specifiers;
}

function quotedStrings(source) {
	const values = [];
	let quote;
	let start = 0;
	let escaped = false;
	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		if (quote === undefined) {
			if (character === "'" || character === '"' || character === "`") {
				quote = character;
				start = index + 1;
			}
			continue;
		}
		if (escaped) {
			escaped = false;
		} else if (character === "\\") {
			escaped = true;
		} else if (character === quote) {
			values.push(source.slice(start, index));
			quote = undefined;
		}
	}
	return values;
}

function removeComments(source) {
	let result = "";
	let quote;
	let escaped = false;
	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		if (quote !== undefined) {
			result += character;
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"' || character === "`") {
			quote = character;
			result += character;
		} else if (character === "/" && source[index + 1] === "/") {
			while (index + 1 < source.length && source[index + 1] !== "\n") index++;
		} else if (character === "/" && source[index + 1] === "*") {
			index += 2;
			while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
				if (source[index] === "\n") result += "\n";
				index++;
			}
			index++;
		} else {
			result += character;
		}
	}
	return result;
}

function packageName(specifier) {
	if (specifier.startsWith("astro:")) return "astro";
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isWithin(root, candidate) {
	const relative = path.relative(root, candidate);
	return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
