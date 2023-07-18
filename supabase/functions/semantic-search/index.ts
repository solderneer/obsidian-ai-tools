// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
	createClient,
	SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.26.0";
import { Configuration, OpenAIApi, CreateModerationResponse } from "https://esm.sh/openai-edge@1.2.0";

import { semanticSearch } from "shared/search.ts";

serve(async (req) => {
	let supabaseClient: SupabaseClient;
	let openai: OpenAIApi;

	const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
	const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
	const OPENAI_KEY = Deno.env.get("OPENAI_KEY");

	// Semantic Search Settings
	const SEMANTIC_MATCH_THRESHOLD = parseFloat(Deno.env.get("MATCH_THRESHOLD") ?? "0.78");
	const SEMANTIC_MATCH_COUNT = parseInt(Deno.env.get("MATCH_COUNT") ?? "10");
	const SEMANTIC_MIN_CONTENT_LENGTH = parseInt(Deno.env.get("MATCH_COUNT") ?? "50");

	const { query } = await req.json();

	if (SUPABASE_URL && SUPABASE_ANON_KEY) {
		supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
		});
	} else {
		// TODO: Throw a proper error here
		throw new Error("Missing Supabase Key!");
	}

	if (OPENAI_KEY) {
		const configuration = new Configuration({
			apiKey: OPENAI_KEY,
		});
		openai = new OpenAIApi(configuration);
	} else {
		throw new Error("Missing OpenAI Key!");
	}

	// Sanitize input query
	// Moderate the content to comply with OpenAI T&C
	const moderationResponse: CreateModerationResponse = await openai
		.createModeration({ input: query.trim() })
		.then((res) => res.json());

	const [results] = moderationResponse.results;

	if (results.flagged) {
		throw new Error("Flagged content");
	}

	console.log(query)

	const documentSections = await semanticSearch(
		supabaseClient,
		openai,
		query,
		SEMANTIC_MATCH_THRESHOLD,
		SEMANTIC_MATCH_COUNT,
		SEMANTIC_MIN_CONTENT_LENGTH
	);

	console.log(documentSections)

	return new Response(JSON.stringify(documentSections), {
		headers: { "Content-Type": "application/json" },
	});
});