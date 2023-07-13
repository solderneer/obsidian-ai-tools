import * as yaml from "yaml";

import { SupabaseClient } from "@supabase/supabase-js";
import { OpenAIApi } from "openai";
import { createHash } from "crypto";

export async function generateEmbeddings(
	supabaseClient: SupabaseClient,
	openai: OpenAIApi
) {
	// Retrieve all the markdown files
	const files = this.app.vault.getMarkdownFiles(); // Retrieve the list of markdown files in the current vault
	console.log(files);

	for (const file of files) {
		try {
			// Retrieve if the file already exists
			const { error: fetchDocumentError, data: existingDocument } =
				await supabaseClient
					.from("document")
					.select("id, path, checksum")
					.filter("path", "eq", file.path)
					.limit(1)
					.maybeSingle();

			if (fetchDocumentError) {
				throw fetchDocumentError;
			}

			// Calculate checksum to see if it has changed
			const markdown = await this.app.vault.cachedRead(file); // Read the markdown content of the file
			const checksum = createHash("sha256")
				.update(markdown)
				.digest("base64");
			if (existingDocument?.checksum === checksum) continue;

			// If existing page exists but has changed, then delete existing sections and reindex file
			if (existingDocument) {
				console.log(`Reindexing file: ${file.path}`);

				const { error: deleteDocumentSectionError } =
					await supabaseClient
						.from("document_section")
						.delete()
						.filter("document_id", "eq", existingDocument.id);

				if (deleteDocumentSectionError) {
					throw deleteDocumentSectionError;
				}
			}

			// Parse frontmatter and split content into paragraphs
			const { content, frontmatter } = parseMarkdown(markdown); // Parse the frontmatter
			const sections = splitIntoParagraphs(content);

			// Create/update page record. Intentionally clear checksum until we
			// have successfully generated all page sections.

			const { error: upsertPageError, data: document } =
				await supabaseClient
					.from("document")
					.upsert(
						{
							checksum: null,
							path: file.path,
							meta: JSON.stringify(frontmatter),
							public: false,
						},
						{ onConflict: "path" }
					)
					.select()
					.limit(1)
					.single();

			if (upsertPageError) {
				throw upsertPageError;
			}

			console.log(
				`[${file.path}] Adding ${sections.length} page sections (with embeddings)`
			);
			for (const section of sections) {
				// OpenAI recommends replacing newlines with spaces for best results (specific to embeddings)
				const input = section.replace(/\n/g, " ");
				try {
					const embeddingResponse = await openai.createEmbedding({
						model: "text-embedding-ada-002",
						input,
					});

					if (embeddingResponse.status !== 200) {
						throw new Error("Embedding failed");
					}

					const [responseData] = embeddingResponse.data.data;

					const { error: insertDocumentSectionError } =
						await supabaseClient
							.from("document_section")
							.insert({
								document_id: document.id,
								content: section,
								token_count:
									embeddingResponse.data.usage.total_tokens,
								embedding: responseData.embedding,
							})
							.select()
							.limit(1)
							.single();

					if (insertDocumentSectionError) {
						throw insertDocumentSectionError;
					}
				} catch (err) {
					// TODO: decide how to better handle failed embeddings
					console.error(
						`Failed to generate embeddings for '${
							file.path
						}' page section starting with '${input.slice(
							0,
							40
						)}...'`
					);

					throw err;
				}
			}

			// Set page checksum so that we know this page was stored successfully
			const { error: updatePageError } = await supabaseClient
				.from("document")
				.update({ checksum })
				.filter("id", "eq", document.id);

			if (updatePageError) {
				throw updatePageError;
			}
		} catch (err) {
			console.error(
				`Page '${file.path}' or one/multiple of its page sections failed to store properly. Page has been marked with null checksum to indicate that it needs to be re-generated.`
			);
			console.error(err);
			throw err;
		}
	}
}

function parseMarkdown(markdown: string): {
	content: string;
	// eslint-disable-next-line
	frontmatter: Record<string, any>;
} {
	const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/; // Regular expression to match frontmatter
	const match = markdown.match(frontmatterRegex);

	let content = markdown;
	// eslint-disable-next-line
	let frontmatter: Record<string, any> = {};

	if (match && match[1]) {
		const frontmatterString = match[1];
		try {
			frontmatter = yaml.parse(frontmatterString); // Use yaml.parse() to parse YAML frontmatter
			content = content.replace(match[0], ""); // Remove frontmatter from content
		} catch (error) {
			console.error(`Error parsing frontmatter: ${error}`);
		}
	}

	return { content, frontmatter };
}

function splitIntoParagraphs(text: string): string[] {
	const paragraphs = text.split(/\r?\n\s*\r?\n/); // Split text by empty lines

	// Trim whitespace from each paragraph
	const trimmedParagraphs = paragraphs.map((paragraph) => paragraph.trim());

	return trimmedParagraphs;
}
