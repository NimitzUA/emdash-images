import { contentHashVersion } from "./layout.mjs";
import { DEFAULT_IMAGE_OPTIONS } from "./options.mjs";
import { publicResponsiveImageWidths } from "./service.mjs";

export async function pictureSources(
	{ src, width, height, contentHash, srcsetWidths },
	options = {},
) {
	const originalWidth = positiveDimension(width);
	const originalHeight = positiveDimension(height);
	const version = contentHashVersion(contentHash);
	if (!originalWidth || !originalHeight) return undefined;

	if (typeof options.getImage !== "function") {
		throw new TypeError("pictureSources requires a getImage function");
	}

	const publicWidths = options.publicWidths ?? DEFAULT_IMAGE_OPTIONS.publicWidths;
	const smallestPublicWidth = Math.min(...publicWidths);
	const availableWidths = publicResponsiveImageWidths(originalWidth, srcsetWidths, options);
	const sourceWidthVariant = srcsetWidths !== undefined && originalWidth < smallestPublicWidth
		? [originalWidth]
		: [];
	const requestedWidths = [...new Set([...availableWidths, ...sourceWidthVariant])]
		.sort((left, right) => left - right);
	const widths = originalWidth
		? requestedWidths.length > 0 ? requestedWidths : [Math.min(originalWidth, publicWidths[0])]
		: [];
	const transformWidth = widths.at(-1);
	if (!transformWidth) return undefined;

	const transformHeight = Math.round(transformWidth * originalHeight / originalWidth);
	const imageWidth = Math.min(transformWidth, originalWidth);
	const imageHeight = Math.round(imageWidth * originalHeight / originalWidth);
	const getImage = options.getImage;

	let probe;
	try {
		probe = await getImage({
			src,
			width: transformWidth,
			height: transformHeight,
			format: "webp",
		});
	} catch {
		return undefined;
	}
	if (!probe?.src || probe.src === src) return undefined;

	const transform = {
		src,
		width: imageWidth,
		height: imageHeight,
		widths,
		...(version === undefined ? {} : { mediaVersion: version }),
		fit: options.fit ?? "cover",
	};
	const [avifImage, webpImage] = await Promise.all([
		getImage({ ...transform, format: "avif" }),
		getImage({ ...transform, format: "webp" }),
	]);
	if (!avifImage?.srcSet?.attribute || !webpImage?.srcSet?.attribute || !webpImage.src) return undefined;

	return {
		avifSrcset: avifImage.srcSet.attribute,
		webpSrcset: webpImage.srcSet.attribute,
		src: webpImage.src,
		v: version,
		widths,
	};
}

function positiveDimension(value) {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	const rounded = Math.round(value);
	return rounded > 0 ? rounded : undefined;
}
