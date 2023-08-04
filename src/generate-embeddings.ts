import * as path from "path";

import { TFile, parseYaml } from "obsidian";
import { SupabaseClient } from "@supabase/supabase-js";
import { OpenAIApi } from "openai-edge";
import { createHash } from "crypto";

interface EmbeddingResult {
	successCount: number
	updatedCount: number
	errorCount: number
	deleteCount: number
}

export async function generateEmbeddings(
	supabaseClient: SupabaseClient,
	openai: OpenAIApi,
	excludeDirs: string[],
	publicDirs: string[],
	debug?: boolean
): Promise<EmbeddingResult> {
	// Retrieve non-excluded markdown files
	const files: TFile[] = this.app.vault
		.getMarkdownFiles()
		.filter((file: TFile) => !isFileInDirectories(file.path, excludeDirs));


	if (debug)
		console.log(files);

	const embeddingResult: EmbeddingResult = {
		successCount: 0,
		updatedCount: 0,
		errorCount: 0,
		deleteCount: 0
	};

	for (const file of files) {
		try {
			// Retrieve if the file already exists
			const { error: fetchDocumentError, data: existingDocument } =
				await supabaseClient
					.from("document")
					.select("id, path, checksum, public")
					.filter("path", "eq", file.path)
					.limit(1)
					.maybeSingle();

			if (fetchDocumentError) {
				console.error(fetchDocumentError);
				throw fetchDocumentError;
			}

			// Calculate checksum to see if it has changed
			const markdown = await this.app.vault.cachedRead(file); // Read the markdown content of the file
			const checksum = createHash("sha256")
				.update(markdown)
				.digest("base64");

			// Get whether this is a public file
			const isPublic = isFileInDirectories(file.path, publicDirs);

			if (existingDocument?.checksum === checksum) {
				// Check if the document access is correct
				if (existingDocument.public === isPublic) {
					embeddingResult.successCount += 1;
					continue;
				} else {
					// Update document access
					if (debug)
						console.log(`Updating file access: ${file.path}, setting public to ${isPublic}`);

					const { error: updateDocumentError } = await supabaseClient
						.from("document")
						.update({ public: isPublic })
						.filter("id", "eq", existingDocument.id);
					if (updateDocumentError) {
						console.error(updateDocumentError);
						throw updateDocumentError;
					}

					embeddingResult.successCount += 1;
					embeddingResult.updatedCount += 1;
					continue;
				}
			}

			// If existing page exists but has changed, then delete existing sections and reindex file
			if (existingDocument) {

				if (debug)
					console.log(`Reindexing file: ${file.path}`);

				const { error: deleteDocumentSectionError } =
					await supabaseClient
						.from("document_section")
						.delete()
						.filter("document_id", "eq", existingDocument.id);

				if (deleteDocumentSectionError) {
					console.error(deleteDocumentSectionError);
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
							public: isPublic,
						},
						{ onConflict: "path" }
					)
					.select()
					.limit(1)
					.single();

			if (upsertPageError) {
				console.error(upsertPageError);
				throw upsertPageError;
			}

			if (debug)
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
						console.error("Embedding Failed!")
						throw new Error("Embedding failed");
					}

					const data = await embeddingResponse.json();

					const { error: insertDocumentSectionError } =
						await supabaseClient
							.from("document_section")
							.insert({
								document_id: document.id,
								content: section,
								token_count: data.usage.total_tokens,
								embedding: data.data[0].embedding,
							})
							.select()
							.limit(1)
							.single();

					if (insertDocumentSectionError) {
						console.error(insertDocumentSectionError);
						throw insertDocumentSectionError;
					}
				} catch (err) {
					// TODO: decide how to better handle failed embeddings
					console.error(
						`Failed to generate embeddings for '${file.path
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

			embeddingResult.successCount += 1;
			embeddingResult.updatedCount += 1;

		} catch (err) {
			console.error(
				`Page '${file.path}' or one/multiple of its page sections failed to store properly. Page has been marked with null checksum to indicate that it needs to be re-generated.`
			);
			embeddingResult.errorCount += 1;
		}
	}

	// Find and delete dangling files which have been deleted in obsidian.
	const { error: fetchDocumentError, data: existingDocuments } =
		await supabaseClient
			.from("document")
			.select("id, path, checksum, public");
	
			console.log(existingDocuments);
			console.log(files);

	if (fetchDocumentError) {
		embeddingResult.errorCount += 1;
		console.error(
			`Unable to retrieve all documents to find dangling documents!`
		);
		console.error(fetchDocumentError);
	} else {

		for (const document of existingDocuments) {
			console.log((files.find((file) => file.path === document.path)) !== undefined);
			if (files.find((file) => file.path === document.path)) {
				// Means that the file is found
				continue;
			}

			// Delete the extra file
			const { error: deleteDocumentError } = await supabaseClient
				.from("document")
				.delete()
				.eq('path', document.path);

			if (deleteDocumentError) {
				embeddingResult.errorCount += 1;
				console.error(
					`Unable to delete dangling documents at path ${document.path}`
				);
				console.error(deleteDocumentError);
			}

			embeddingResult.deleteCount += 1;
		}
	}
	return embeddingResult;
}

function isFileInDirectories(filePath: string, directories: string[]): boolean {
	const normalizedFilePath = path.normalize(filePath);
	const normalizedDirectories = directories.map((directory) =>
		path.normalize(directory)
	);

	for (const directory of normalizedDirectories) {
		if (normalizedFilePath.startsWith(directory)) {
			return true;
		}
	}

	return false;
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
			frontmatter = parseYaml(frontmatterString);
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
