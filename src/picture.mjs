import { pictureSources } from "./sources.mjs";
import { placeholderStyle } from "./placeholder.mjs";

const EXCLUDED_ATTRIBUTES = new Set([
	"image", "darkVariant", "src", "width", "height", "contentHash", "darkContentHash",
	"srcsetWidths", "pictureAttributes", "class", "style", "id", "placeholder",
]);
const FALLBACK_EXCLUDED_ATTRIBUTES = new Set(["layout", "fit", "position", "priority"]);

export async function pictureModel(props, context) {
	const image = normalizeMedia(props.image);
	const darkImage = normalizeMedia(props.darkVariant ?? image?.darkVariant);
	const source = isUrl(props.src) ? props.src : mediaUrl(image, context.locals);
	if (!isUrl(source)) return { variants: [] };

	const alt = props.alt ?? image?.alt ?? "";
	const layout = props.layout ?? context.imageConfig?.layout ?? "none";
	const fit = layout === "none"
		? props.fit
		: props.fit ?? context.imageConfig?.objectFit ?? "cover";
	const position = layout === "none"
		? props.position
		: props.position ?? context.imageConfig?.objectPosition ?? "center";
	const attributes = sourceAttributes(props, { alt, layout, fit, position });
	const darkSource = mediaUrl(darkImage, context.locals);
	const hasDarkVariant = isUrl(darkSource);
	const scopedClass = typeof props.class === "string"
		? props.class.match(/\bastro-\w{8}\b/)?.[0]
		: undefined;
	const picture = pictureAttributes(props, scopedClass);
	const variantsToRender = [{
		media: image,
		source,
		width: props.width ?? image?.width,
		height: props.height ?? image?.height,
		contentHash: props.contentHash,
		className: variantClass(props.class, hasDarkVariant ? "emdash-image--light" : undefined),
		id: props.id,
	}];
	if (hasDarkVariant) {
		variantsToRender.push({
			media: darkImage,
			source: darkSource,
			width: props.width ?? darkImage?.width,
			height: props.height ?? darkImage?.height,
			contentHash: props.darkContentHash,
			className: variantClass(props.class, "emdash-image--dark"),
			id: darkId(props.id),
		});
	}

	const shared = { alt, style: props.style, attributes, picture, props, context };
	const variants = [];
	for (const variant of variantsToRender) variants.push(await renderVariant(variant, shared));
	return { variants };
}

async function renderVariant(variant, shared) {
	const { media, source, width, height, contentHash, className, id } = variant;
	const { alt, style, attributes, picture, props, context } = shared;
	const result = await pictureSources({
		src: new URL(source, context.url).href,
		width,
		height,
		contentHash,
		srcsetWidths: props.srcsetWidths,
		attributes,
	}, {
		getImage: context.getImage,
		imageConfig: context.imageConfig,
		fit: attributes.fit,
	});

	if (result === undefined) {
		return {
			picture: undefined,
			sources: [],
			img: fallbackAttributes({
				attributes,
				source,
				width,
				height,
				alt,
				id,
				className,
				style: await variantStyle(media, style, props.placeholder),
				props,
			}),
		};
	}

	const sizes = result.attributes?.sizes;
	return {
		picture,
		sources: [
			{
				type: "image/avif",
				srcset: result.avifSrcset,
				...(sizes === undefined ? {} : { sizes }),
			},
			{
				type: "image/webp",
				srcset: result.webpSrcset,
				...(sizes === undefined ? {} : { sizes }),
			},
		],
		img: {
			...result.attributes,
			src: result.src,
			alt,
			id,
			class: className,
			style: await variantStyle(media, style, props.placeholder),
		},
	};
}

function normalizeMedia(value) {
	return typeof value === "string" ? { src: value } : value && typeof value === "object" ? value : undefined;
}

function mediaUrl(media, locals) {
	if (!media) return undefined;
	if (isUrl(media.src)) return media.src;

	const storageKey = media.meta?.storageKey;
	const getPublicMediaUrl = locals?.emdash?.getPublicMediaUrl;
	if (
		typeof storageKey === "string" && storageKey.length > 0 &&
		typeof getPublicMediaUrl === "function"
	) {
		const publicUrl = getPublicMediaUrl.call(locals.emdash, storageKey);
		if (isUrl(publicUrl)) return publicUrl;
	}

	if (typeof media.id === "string" && media.id.length > 0) {
		return `/_emdash/api/media/file/${media.id}`;
	}
	return undefined;
}

function sourceAttributes(props, resolved) {
	const attributes = Object.fromEntries(
		Object.entries(props).filter(([key]) => !EXCLUDED_ATTRIBUTES.has(key)),
	);
	return { ...attributes, ...resolved };
}

function pictureAttributes(props, scopedClass) {
	const attributes = { ...(props.pictureAttributes ?? {}) };
	for (const [key, value] of Object.entries(props)) {
		if (key.startsWith("data-astro-cid")) attributes[key] = value;
	}
	if (scopedClass) {
		attributes.class = attributes.class
			? `${attributes.class} ${scopedClass}`
			: scopedClass;
	}
	return attributes;
}

function fallbackAttributes({
	attributes,
	source,
	width,
	height,
	alt,
	id,
	className,
	style,
	props,
}) {
	const forwarded = Object.fromEntries(
		Object.entries(attributes).filter(([key]) => !FALLBACK_EXCLUDED_ATTRIBUTES.has(key)),
	);
	return {
		...forwarded,
		src: source,
		alt,
		width,
		height,
		sizes: props.sizes,
		id,
		class: className,
		style,
		loading: props.priority ? "eager" : props.loading ?? "lazy",
		decoding: props.decoding ?? "async",
		...(props.priority ? { fetchpriority: "high" } : {}),
	};
}

async function variantStyle(media, style, placeholderEnabled) {
	const placeholder = placeholderEnabled === false ? undefined : await placeholderStyle(media);
	const position = focalPointToObjectPosition(media?.focalX, media?.focalY);
	if (style && typeof style === "object") {
		return {
			...placeholder,
			...(position === undefined ? {} : { "object-position": position }),
			...style,
		};
	}

	const siteStyle = typeof style === "string" && style.trim() ? styleDeclaration(style) : undefined;
	const declarations = [
		...Object.entries(placeholder ?? {}).map(([name, value]) => `${name}: ${value};`),
		...(position === undefined ? [] : [`object-position: ${position};`]),
		...(siteStyle ? [siteStyle] : []),
	];
	return declarations.length > 0 ? declarations.join(" ") : undefined;
}

function styleDeclaration(style) {
	const declaration = style.trim().replace(/;+$/, "");
	return declaration ? `${declaration};` : "";
}

function focalPointToObjectPosition(focalX, focalY) {
	if (!isFocalCoordinate(focalX) || !isFocalCoordinate(focalY)) return undefined;
	return `${Math.round(focalX * 10_000) / 100}% ${Math.round(focalY * 10_000) / 100}%`;
}

function isFocalCoordinate(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }

function variantClass(className, variant) {
	return variant ? [variant, className].filter(Boolean).join(" ") : className;
}

function darkId(id) { return id === undefined || id === null ? undefined : `${id}--dark`; }

function isUrl(value) { return typeof value === "string" && value.length > 0; }
