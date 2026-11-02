import { contentHashVersion } from "./layout.mjs";
import { DEFAULT_IMAGE_OPTIONS } from "./options.mjs";
import { publicResponsiveImageWidths } from "./service.mjs";

const PACKAGE_IMAGE_OPTION_KEYS = new Set([
	"src",
	"width",
	"height",
	"widths",
	"densities",
	"format",
	"mediaVersion",
]);

export async function pictureSources(
	{ src, width, height, contentHash, srcsetWidths, attributes },
	options = {},
) {
	const originalWidth = positiveDimension(width);
	const originalHeight = positiveDimension(height);
	const version = contentHashVersion(contentHash);
	if (!originalWidth || !originalHeight) return undefined;

	let astroGetImage;
	let astroImageConfig;
	if (options.getImage == null || options.imageConfig == null) {
		try {
			const astroAssets = await import("astro:assets");
			astroGetImage = astroAssets.getImage;
			astroImageConfig = astroAssets.imageConfig;
		} catch {
			// `astro:assets` is provided by Astro and is unavailable in plain Node tests.
		}
	}
	const getImage = options.getImage ?? astroGetImage;
	const imageConfig = options.imageConfig ?? astroImageConfig;
	if (typeof getImage !== "function") {
		throw new TypeError("pictureSources requires a getImage function");
	}

	const serviceConfig = imageConfig?.service?.config;
	const publicWidths = options.publicWidths
		?? (Array.isArray(serviceConfig?.publicWidths)
			? serviceConfig.publicWidths
			: DEFAULT_IMAGE_OPTIONS.publicWidths);
	const smallWidths = options.smallWidths
		?? (Array.isArray(serviceConfig?.smallWidths)
			? serviceConfig.smallWidths
			: DEFAULT_IMAGE_OPTIONS.smallWidths);
	const widthOptions = { publicWidths, smallWidths };
	const smallestPublicWidth = Math.min(...publicWidths);
	const availableWidths = publicResponsiveImageWidths(originalWidth, srcsetWidths, widthOptions);
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

	const forwardedAttributes = Object.fromEntries(
		Object.entries(attributes ?? {}).filter(([key]) => !PACKAGE_IMAGE_OPTION_KEYS.has(key)),
	);
	const transform = {
		...forwardedAttributes,
		src,
		width: imageWidth,
		height: imageHeight,
		widths,
		...(version === undefined ? {} : { mediaVersion: version }),
		fit: options.fit ?? attributes?.fit ?? "cover",
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
		attributes: webpImage.attributes ?? {},
		v: version,
		widths,
	};
}

function positiveDimension(value) {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	const rounded = Math.round(value);
	return rounded > 0 ? rounded : undefined;
}
