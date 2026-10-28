import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

const sharpVersion = sharp.versions.sharp;
const variantNamePattern = /^([a-f\d]{16})-(\d+)\.(avif|webp)$/i;
const mediaIdPattern = /^[A-Za-z0-9_-]+$/;

export function imageVariantCachePath(cacheDirectory, mediaId, hash16, width, format, imageConfig) {
	return path.join(cacheDirectory, `v2-${imageCacheSettings8(imageConfig)}`, mediaId, `${hash16}-${width}.${format}`);
}

export function imageCacheSettings8(imageConfig) {
	const settings = {
		avif: canonicalize(imageConfig?.service?.config?.avif ?? {}),
		webp: canonicalize(imageConfig?.service?.config?.webp ?? {}),
		sharp: sharpVersion,
	};
	return createHash("sha256").update(JSON.stringify(settings)).digest("hex").slice(0, 8);
}

export function contentHashVersion(contentHash) {
	if (typeof contentHash !== "string") return undefined;
	return /^sha1:([0-9a-f]{40})$/i.exec(contentHash.trim())?.[1].slice(0, 16).toLowerCase();
}

export function imageCacheNamespaceFromPath(cacheDirectory, candidatePath) {
	const relativePath = relativeCachePath(cacheDirectory, candidatePath);
	if (!relativePath) return undefined;
	const namespace = relativePath.split(path.sep, 1)[0];
	return namespace.startsWith("v2-") ? namespace : undefined;
}

export function parseImageVariantCachePath(cacheDirectory, candidatePath) {
	const relativePath = relativeCachePath(cacheDirectory, candidatePath);
	if (!relativePath) return undefined;
	const segments = relativePath.split(path.sep);
	if (segments.length !== 3) return undefined;
	const [namespace, mediaId, filename] = segments;
	if (!/^v2-[a-f\d]{8}$/i.test(namespace) || !mediaIdPattern.test(mediaId)) return undefined;
	const match = variantNamePattern.exec(filename);
	if (!match) return undefined;
	const width = Number(match[2]);
	if (!Number.isSafeInteger(width) || width <= 0) return undefined;
	return {
		namespace,
		settings8: namespace.slice(3).toLowerCase(),
		mediaId,
		hash16: match[1].toLowerCase(),
		width,
		format: match[3].toLowerCase(),
	};
}

function relativeCachePath(cacheDirectory, candidatePath) {
	const root = path.resolve(cacheDirectory);
	const candidate = path.resolve(candidatePath);
	const relativePath = path.relative(root, candidate);
	if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
		return undefined;
	}
	return relativePath;
}

function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
	}
	return value;
}
