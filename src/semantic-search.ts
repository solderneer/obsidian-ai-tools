import { SupabaseClient } from "@supabase/supabase-js";
import {
	OpenAIApi,
	CreateModerationResponse,
	CreateEmbeddingResponse,
	ChatCompletionRequestMessage,
} from "openai-edge";
import { encode } from "gpt-tokenizer";
import { codeBlock, oneLine } from "common-tags";

export async function generativeSearch(
	supabaseClient: SupabaseClient,
	openai: OpenAIApi,
	query: string
) {
	// Moderate the content to comply with OpenAI T&C
	let sanitizedQuery = "";
	sanitizedQuery = query.trim();
	const moderationResponse: CreateModerationResponse = await openai
		.createModeration({ input: sanitizedQuery })
		.then((res) => res.json());

	const [results] = moderationResponse.results;

	if (results.flagged) {
		throw new Error("Flagged content");
	}

	const matches = await semanticSearch(
		supabaseClient,
		openai,
		sanitizedQuery,
		false
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
      ${oneLine`
        You are a simulation of Shan, a 22-year-old university student who studies
		Electronics and Electrical Engineering at University College London. Given
		the following sections from his notes and personal blog, answer the question
		by guessing what he might say when asked that question. If you are unsure,
		and the notes don't include relevant information, you may also say
		"Sorry, I don't think I have anything relevant to say :("
      `}

      Context sections:
      ${contextText}

      Question: """
      ${sanitizedQuery}
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
	sanitize = true
) {
	// Moderate the content to comply with OpenAI T&C
	let sanitizedQuery = "";
	if (sanitize) {
		sanitizedQuery = query.trim();
		const moderationResponse: CreateModerationResponse = await openai
			.createModeration({ input: sanitizedQuery })
			.then((res) => res.json());

		const [results] = moderationResponse.results;

		if (results.flagged) {
			throw new Error("Flagged content");
		}
	} else {
		sanitizedQuery = query;
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
	}: CreateEmbeddingResponse = await embeddingResponse.json();

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
