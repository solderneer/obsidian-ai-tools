import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.26.0";
import {
	OpenAIApi,
	CreateEmbeddingResponse,
	ChatCompletionRequestMessage,
} from "https://esm.sh/openai-edge@1.2.0";
import { encode } from "https://esm.sh/gpt-tokenizer@2.1.1";
import { codeBlock } from "https://esm.sh/common-tags@1.8.2";

export async function generativeSearch(
	supabaseClient: SupabaseClient,
	openai: OpenAIApi,
	query: string,
	promptIntro: string,
	match_threshold = 0.78,
	match_count = 10,
	min_content_length = 50
) {

	const matches = await semanticSearch(
		supabaseClient,
		openai,
		query,
		match_threshold,
		match_count,
		min_content_length
	);

	// Only send 1500 tokens maximum
	let tokenCount = 0;
	let contextText = "";

	for (let i = 0; i < matches.length; i++) {
		const section = matches[i];
		const content = section.content;
		const encoded = encode(content);
		tokenCount += encoded.length;

		if (tokenCount >= 1500) {
			break;
		}

		contextText += `${content.trim()}\n---\n`;
	}

	const prompt = codeBlock`
      ${promptIntro}

      Context sections:
      ${contextText}

      Question: """
      ${query}
      """

      Answer:`;

	const chatMessage: ChatCompletionRequestMessage = {
		role: "user",
		content: prompt,
	};

	const response = await openai.createChatCompletion({
		model: "gpt-3.5-turbo",
		messages: [chatMessage],
	});

	const responseJson = await response.json();
	return responseJson.choices[0].message?.content;
}

export async function semanticSearch(
	supabaseClient: SupabaseClient,
	openai: OpenAIApi,
	query: string,
	match_threshold = 0.78,
	match_count = 10,
	min_content_length = 50
) {

	// Create embedding from query
	const embeddingResponse = await openai.createEmbedding({
		model: "text-embedding-ada-002",
		input: query.split("\n").join(" "),
	});

	if (embeddingResponse.status !== 200) {
		throw new Error("Failed to create embedding for question");
	}

	const {
		data: [{ embedding }],
	}: CreateEmbeddingResponse = await embeddingResponse.json();

	const { error: matchError, data: documentSections } =
		await supabaseClient.rpc("match_document_sections", {
			embedding,
			match_threshold,
			match_count,
			min_content_length,
		});

	if (matchError) {
		throw new Error("Failed to match document sections");
	}

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
