import { SupabaseClient } from "@supabase/supabase-js";
import {
	OpenAIApi,
	CreateModerationResponse,
	CreateEmbeddingResponse,
} from "openai";

export async function semanticSearch(
	supabaseClient: SupabaseClient,
	openai: OpenAIApi,
	query: string
) {
	// Moderate the content to comply with OpenAI T&C
	const sanitizedQuery = query.trim();
	const moderationResponse: CreateModerationResponse = await openai
		.createModeration({ input: sanitizedQuery })
		.then((res) => res.data);

	const [results] = moderationResponse.results;

	if (results.flagged) {
		throw new Error("Flagged content");
	}

	// Create embedding from query
	const embeddingResponse = await openai.createEmbedding({
		model: "text-embedding-ada-002",
		input: sanitizedQuery.split("\n").join(" "),
	});

	if (embeddingResponse.status !== 200) {
		throw new Error("Failed to create embedding for question");
	}

	const {
		data: [{ embedding }],
	}: CreateEmbeddingResponse = embeddingResponse.data;

	const { error: matchError, data: documentSections } =
		await supabaseClient.rpc("match_document_sections", {
			embedding,
			match_threshold: 0.78,
			match_count: 10,
			min_content_length: 50,
		});

	if (matchError) {
		throw new Error("Failed to match document sections");
	}

	console.log(documentSections);

	for (const section of documentSections) {
		const { error: fetchDocumentError, data: document } =
			await supabaseClient
				.from("document")
				.select("id, path")
				.eq("id", section.document_id)
				.single();
		if (fetchDocumentError) {
			throw fetchDocumentError;
		}

		section["document"] = document;
	}

	return documentSections;
}
