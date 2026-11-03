import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build } from "astro";
import { applySeed } from "emdash";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { Kysely } from "kysely";
import sharp from "sharp";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const siteRoot = fileURLToPath(new URL("./site/", import.meta.url));
const packageLink = path.join(siteRoot, "node_modules", "@nimitzua", "emdash-images");
const dataDirectory = path.join(siteRoot, ".data");
const uploadsDirectory = path.join(dataDirectory, "uploads");
const databasePath = path.join(dataDirectory, "emdash.sqlite");
const imageCacheDirectory = path.join(dataDirectory, "image-cache");
const serverEntry = path.join(siteRoot, "dist", "server", "entry.mjs");

export async function buildSite() {
	await linkPackageIfNeeded();
	await build({ root: siteRoot });
}

export async function prepareSiteData() {
	await rm(dataDirectory, { recursive: true, force: true });
	await mkdir(uploadsDirectory, { recursive: true });

	const images = [
		{ id: "fixture-hero", filename: "hero.png", storageKey: "hero.png", width: 1600, height: 1000, color: { r: 206, g: 83, b: 71 } },
		{ id: "fixture-inline", filename: "inline.png", storageKey: "inline.png", width: 1800, height: 1100, color: { r: 65, g: 145, b: 105 } },
		{ id: "fixture-gallery", filename: "gallery.png", storageKey: "gallery.png", width: 2000, height: 1200, color: { r: 64, g: 105, b: 183 } },
		{ id: "fixture-private", filename: "private.png", storageKey: "restricted/private.png", width: 2200, height: 1400, color: { r: 131, g: 87, b: 159 } },
	];
	for (const image of images) {
		const filePath = path.join(uploadsDirectory, image.storageKey);
		await mkdir(path.dirname(filePath), { recursive: true });
		const bytes = await sharp({
			create: {
				width: image.width,
				height: image.height,
				channels: 3,
				background: image.color,
			},
		}).png().toBuffer();
		await writeFile(filePath, bytes);
		image.size = bytes.length;
	}

	const [hero, inline, gallery] = images;
	const seed = {
		version: "1",
		collections: [{
			slug: "posts",
			label: "Posts",
			urlPattern: "/posts/{slug}",
			fields: [
				{ slug: "title", label: "Title", type: "string" },
				{ slug: "hero", label: "Hero", type: "image" },
				{ slug: "body", label: "Body", type: "portableText" },
			],
		}],
		content: {
			posts: [{
				id: "post-hello",
				slug: "hello",
				status: "published",
				data: {
					title: "Hello from the fixture",
					hero: mediaValue(hero, "Hero image"),
					body: [
						{
							_type: "block",
							_key: "intro",
							style: "normal",
							markDefs: [],
							children: [{ _type: "span", _key: "intro-text", text: "A fixture post with several images.", marks: [] }],
						},
						imageBlock(inline, "inline-image"),
						{
							_type: "gallery",
							_key: "gallery-block",
							columns: 2,
							images: [
								galleryImage(gallery, "gallery-image"),
								galleryImage(inline, "gallery-second"),
							],
						},
					],
				},
			}],
		},
	};

	const database = new Kysely({ dialect: createDialect({ url: databasePath }) });
	try {
		await runMigrations(database);
		await applySeed(database, seed, { includeContent: true });
		await database.insertInto("media").values(images.map((image) => ({
			id: image.id,
			filename: image.filename,
			mime_type: "image/png",
			size: image.size,
			width: image.width,
			height: image.height,
			storage_key: image.storageKey,
			status: "ready",
		}))).execute();
	} finally {
		await database.destroy();
	}
}

export async function startSite() {
	const port = await findFreePort();
	const origin = `http://127.0.0.1:${port}`;
	const output = [];
	let spawnError;
	let closeResult;
	let stopPromise;
	const child = spawn(process.execPath, [serverEntry], {
		cwd: siteRoot,
		env: {
			...process.env,
			HOST: "127.0.0.1",
			PORT: String(port),
			IMAGE_CACHE_DIR: imageCacheDirectory,
			NODE_ENV: "production",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	for (const stream of [child.stdout, child.stderr]) {
		stream.setEncoding("utf8");
		stream.on("data", (chunk) => output.push(chunk));
	}
	child.on("error", (error) => { spawnError = error; });
	const closed = new Promise((resolve) => {
		child.once("close", (code, signal) => {
			closeResult = { code, signal };
			resolve(closeResult);
		});
	});
	const stop = () => {
		if (stopPromise) return stopPromise;
		stopPromise = (async () => {
			if (!closeResult && child.pid !== undefined) {
				child.kill("SIGTERM");
				const forceKill = setTimeout(() => child.kill("SIGKILL"), 3000);
				forceKill.unref();
				await closed;
				clearTimeout(forceKill);
			} else if (!closeResult) {
				await closed;
			}
		})();
		return stopPromise;
	};

	try {
		const deadline = Date.now() + 30000;
		let lastResult = "no response";
		while (Date.now() < deadline) {
			if (spawnError) throw spawnError;
			if (closeResult) throw new Error(`site process exited (${closeResult.code ?? closeResult.signal})`);
			try {
				const response = await fetch(`${origin}/posts/hello`);
				lastResult = `HTTP ${response.status}`;
				await response.body?.cancel();
				if (response.status === 200) return { origin, stop };
			} catch (error) {
				lastResult = error.message;
			}
			await delay(100);
		}
		throw new Error(`site did not answer GET /posts/hello with 200 (${lastResult})`);
	} catch (error) {
		await stop();
		const details = output.join("").slice(-4000).trim();
		throw new Error(`${error.message}${details ? `\n${details}` : ""}`, { cause: error });
	}
}

function mediaValue(image, alt) {
	return {
		provider: "local",
		id: image.id,
		alt,
		width: image.width,
		height: image.height,
		mimeType: "image/png",
		filename: image.filename,
		meta: { storageKey: image.storageKey },
	};
}

function imageBlock(image, key) {
	return {
		_type: "image",
		_key: key,
		asset: imageAsset(image),
		alt: `Image ${key}`,
	};
}

function galleryImage(image, key) {
	return {
		_type: "image",
		_key: key,
		asset: imageAsset(image),
		alt: `Image ${key}`,
	};
}

function imageAsset(image) {
	return {
		_ref: image.id,
		url: `/_emdash/api/media/file/${image.storageKey}`,
		alt: image.filename,
		width: image.width,
		height: image.height,
	};
}

async function findFreePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const { port } = server.address();
	await new Promise((resolve, reject) => {
		server.close((error) => error ? reject(error) : resolve());
	});
	return port;
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
