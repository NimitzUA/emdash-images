import { pictureModel } from "./picture.mjs";
import { portableTextMedia } from "./portable-text-image.mjs";

export async function portableTextGalleryModel(props, context) {
	const node = props?.node;
	const columns = Number.isInteger(node?.columns) && node.columns > 0 ? node.columns : 3;
	const sizes = typeof props?.sizes === "string" && props.sizes.length > 0
		? props.sizes
		: `(max-width: 640px) ${galleryCell(2)}, ${galleryCell(columns)}`;
	const images = Array.isArray(node?.images) ? node.images : [];
	const items = [];

	for (const entry of images) {
		const image = portableTextMedia(entry);
		if (!image) continue;

		const picture = await pictureModel({
			image,
			layout: "constrained",
			sizes,
			contentHash: contentHashFor(props?.contentHashes, image.id),
			placeholder: props?.placeholder,
		}, context);
		if (!picture?.variants?.length) continue;

		items.push({
			...(typeof entry.caption === "string" && entry.caption.length > 0
				? { caption: entry.caption }
				: {}),
			variants: picture.variants,
		});
	}

	return items.length > 0 ? { style: `--columns: ${columns}`, items } : undefined;
}

function galleryCell(columns) {
	return columns === 1 ? "100vw" : `calc((100vw - ${columns - 1}rem) / ${columns})`;
}

function contentHashFor(contentHashes, id) {
	if (typeof id !== "string" || id.length === 0) return undefined;
	if (contentHashes instanceof Map) return contentHashes.get(id);
	if (
		contentHashes !== null && typeof contentHashes === "object" &&
		Object.hasOwn(contentHashes, id)
	) {
		return contentHashes[id];
	}
	return undefined;
}
