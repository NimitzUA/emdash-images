const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_COLOR = /^rgba?\(\s*[0-9.]+%?\s*(?:,\s*[0-9.]+%?\s*){2,3}\)$/i;

export async function placeholderStyle(media) {
	const blurhash = media?.blurhash ?? media?.meta?.blurhash;
	if (typeof blurhash === "string" && blurhash.length > 0) {
		try {
			const { blurhashToImageCssObject } = await import("@unpic/placeholder");
			const { backgroundImage, backgroundSize } = blurhashToImageCssObject(blurhash);
			return {
				"background-image": backgroundImage,
				"background-size": backgroundSize,
			};
		} catch {
			// An invalid blurhash can still fall back to its dominant colour.
		}
	}

	const dominantColor = media?.dominantColor ?? media?.meta?.dominantColor;
	if (
		typeof dominantColor === "string" &&
		(HEX_COLOR.test(dominantColor) || RGB_COLOR.test(dominantColor))
	) {
		return { "background-color": dominantColor };
	}

	return undefined;
}
