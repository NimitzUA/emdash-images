import { mkdir, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "astro";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const siteRoot = fileURLToPath(new URL("./site/", import.meta.url));
const packageLink = path.join(siteRoot, "node_modules", "@nimitzua", "emdash-images");

export async function buildSite() {
	await linkPackageIfNeeded();
	await build({ root: siteRoot });
}

async function linkPackageIfNeeded() {
	await mkdir(path.dirname(packageLink), { recursive: true });
	try {
		const linkedRoot = path.resolve(await realpath(packageLink));
		const expectedRoot = path.resolve(await realpath(packageRoot));
		if (linkedRoot === expectedRoot) return;
		throw new Error(`Fixture package link points to ${linkedRoot}, expected ${expectedRoot}`);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await symlink(packageRoot, packageLink, "dir");
}
