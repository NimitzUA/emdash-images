const defaultEncoder = Object.freeze({
	avif: Object.freeze({ quality: 55, effort: 4, chromaSubsampling: "4:4:4" }),
	webp: Object.freeze({ quality: 75, effort: 4, smartSubsample: true }),
});

export const DEFAULT_IMAGE_OPTIONS = Object.freeze({
	publicWidths: Object.freeze([640, 1080, 1600, 1920, 2400]),
	smallWidths: Object.freeze([320, 480]),
	privateWidths: Object.freeze([640, 960, 1600, 1920, 2560]),
	encoder: defaultEncoder,
	encodeLimit: 2,
	deniedStorageKeyPrefixes: Object.freeze([]),
	deniedPagePathPrefixes: Object.freeze([]),
});

export function imageService(options = {}) {
	const resolved = { ...DEFAULT_IMAGE_OPTIONS, ...options };
	const config = {
		...resolved.encoder,
		publicWidths: resolved.publicWidths,
		smallWidths: resolved.smallWidths,
		privateWidths: resolved.privateWidths,
		encodeLimit: resolved.encodeLimit,
		deniedStorageKeyPrefixes: resolved.deniedStorageKeyPrefixes,
	};
	if (typeof options.cacheDirectory === "string" && options.cacheDirectory.trim()) {
		config.cacheDirectory = options.cacheDirectory;
	}
	return {
		entrypoint: "@nimitzua/emdash-images/service",
		config,
	};
}
