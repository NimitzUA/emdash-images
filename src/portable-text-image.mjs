import { sanitizeHref } from "emdash";
import { pictureModel } from "./picture.mjs";

const ALIGNMENTS = new Set(["left", "center", "right", "wide", "full"]);

export async function portableTextImageModel(props, context) {
	const node = props?.node;
	const asset = node?.asset;
	if (!asset || typeof asset !== "object") return undefined;

	const meta = asset.meta;
	const media = {
		id: firstNonEmptyString(asset._ref, asset.id),
		src: firstNonEmptyString(asset.url, asset.src),
		meta,
		provider: asset.provider,
		alt: node.alt ?? asset.alt,
		width: node.width ?? asset.width,
		height: node.height ?? asset.height,
		blurhash: node.blurhash ?? meta?.blurhash,
		dominantColor: node.dominantColor ?? meta?.dominantColor,
	};
	const dimensions = renderDimensions(media, node);
	const picture = await pictureModel({
		image: media,
		layout: "constrained",
		contentHash: props.contentHash,
		placeholder: props.placeholder,
		title: node.title,
	}, context);
	if (!picture?.variants?.length) return undefined;

	const sizes = dimensions.displaySized && dimensions.width !== undefined
		? `(min-width: ${dimensions.width}px) ${dimensions.width}px, 100vw`
		: undefined;
	for (const variant of picture.variants) {
		if (dimensions.displaySized) {
			if (dimensions.width !== undefined) variant.img.width = dimensions.width;
			if (dimensions.height !== undefined) variant.img.height = dimensions.height;
		}
		if (sizes && variant.picture !== undefined) {
			variant.img.sizes = sizes;
			for (const source of variant.sources) source.sizes = sizes;
		}
	}

	const alignment = ALIGNMENTS.has(node.alignment) ? node.alignment : undefined;
	return {
		figureClass: alignment ? `emdash-image emdash-image--align-${alignment}` : "emdash-image",
		link: imageLink(node.link),
		caption: typeof node.caption === "string" && node.caption.length > 0 ? node.caption : undefined,
		variants: picture.variants,
	};
}

function firstNonEmptyString(...values) {
	return values.find((value) => typeof value === "string" && value.length > 0);
}

function renderDimensions(media, node) {
	const originalWidth = dimension(media.width);
	const originalHeight = dimension(media.height);
	const customWidth = dimension(node.displayWidth);
	const customHeight = dimension(node.displayHeight);
	const aspectRatio = originalWidth && originalHeight ? originalWidth / originalHeight : undefined;
	let width;
	let height;

	if (customWidth && customHeight) {
		width = customWidth;
		height = customHeight;
	} else if (customWidth && aspectRatio) {
		width = customWidth;
		height = Math.round(customWidth / aspectRatio);
	} else if (customHeight && aspectRatio) {
		width = Math.round(customHeight * aspectRatio);
		height = customHeight;
	} else {
		width = originalWidth;
		height = originalHeight;
	}

	return { width, height, displaySized: customWidth !== undefined || customHeight !== undefined };
}

function dimension(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function imageLink(value) {
	let href;
	let blank = false;
	if (typeof value === "string") {
		href = value.trim();
	} else if (value && typeof value.href === "string") {
		href = value.href.trim();
		blank = value.blank === true;
	}
	if (!href) return undefined;

	const safeHref = sanitizeHref(href);
	return {
		href: safeHref,
		...(blank && !safeHref.startsWith("#")
			? { target: "_blank", rel: "noopener noreferrer" }
			: {}),
	};
}
