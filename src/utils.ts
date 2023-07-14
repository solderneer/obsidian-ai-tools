export function truncateString(str: string, maxLength: number): string {
	if (str.length <= maxLength) {
		return str;
	}

	return str.slice(0, maxLength) + "...";
}
export function removeMarkdown(text: string): string {
	// Remove emphasis (e.g., *text*, _text_)
	text = text.replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1");

	// Remove headers (e.g., # Header)
	text = text.replace(/#{1,6}\s*(.*)/g, "$1");

	// Remove links (e.g., [Link](url))
	text = text.replace(/\[([^[\]]+)\]\([^()]+\)/g, "$1");

	// Remove images (e.g., ![Alt Text](url))
	text = text.replace(/!\[([^[\]]+)\]\([^()]+\)/g, "");

	// Remove code blocks (e.g., ```code```)
	text = text.replace(/`{3}([^`]+)`{3}/g, "");

	// Remove inline code (e.g., `code`)
	text = text.replace(/`([^`]+)`/g, "$1");

	// Remove lists (e.g., * List Item)
	text = text.replace(/^[\s]*[\-*+]\s+(.*)/gm, "$1");

	// Remove blockquotes (e.g., > Quote)
	text = text.replace(/^>\s+(.*)/gm, "$1");

	// Remove horizontal rules (e.g., ---)
	text = text.replace(/^-{3,}/gm, "");

	// Remove strikethrough (e.g., ~~text~~)
	text = text.replace(/~~([^~]+)~~/g, "$1");

	// Remove wikilinks (e.g., [[Link]])
	text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");

	return text;
}
