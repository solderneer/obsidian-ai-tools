import { App, SuggestModal, Plugin, PluginSettingTab, Setting } from "obsidian";

import * as path from "path";
import Typed from "typed.js";

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Configuration, OpenAIApi } from "openai";

// Local things
import { generateEmbeddings } from "./generate-embeddings";
import { semanticSearch } from "./semantic-search";

interface ObsidianMagicSettings {
	supabaseUrl: string;
	supabaseKey: string;
	openaiKey: string;
}

export default class ObsidianMagicPlugin extends Plugin {
	settings: ObsidianMagicSettings;
	supabaseClient: SupabaseClient;
	openai: OpenAIApi;

	async onload() {
		await this.loadSettings();

		// Setting up supabase and openai
		this.supabaseClient = createClient(
			this.settings.supabaseUrl,
			this.settings.supabaseKey,
			{
				auth: {
					persistSession: false,
					autoRefreshToken: false,
				},
			}
		);

		const configuration = new Configuration({
			apiKey: this.settings.openaiKey,
		});
		this.openai = new OpenAIApi(configuration);

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("🔮 Indexing Memex...");
		generateEmbeddings(this.supabaseClient, this.openai)
			.then(() => {
				console.log("hi");
				statusBarItemEl.setText("✨ Memex Indexed");
			})
			.catch((err) => {
				console.log(err);
				statusBarItemEl.setText("😔 Memex Error");
			});

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "magic-search",
			name: "Magic Search",
			callback: () => {
				new MagicSearchModal(
					this.app,
					this.settings.supabaseUrl,
					this.settings.supabaseKey,
					this.settings.openaiKey
				).open();
			},
		});

		this.addCommand({
			id: "test-embedding",
			name: "Test Embedding",
			callback: async () => {
				await generateEmbeddings(this.supabaseClient, this.openai);
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

interface SearchResult {
	id: string;
	document_id: string;
	content: string;
	document: {
		id: string;
		path: string;
	};
	similarity: string;
}

class MagicSearchModal extends SuggestModal<SearchResult> {
	private keyListener: any;
	private typedInstance: Typed;
	private supabaseClient: SupabaseClient;
	private openai: OpenAIApi;

	constructor(
		app: App,
		supabaseUrl: string,
		supabaseKey: string,
		openaiKey: string
	) {
		super(app);

		// Setting up supabase and openai
		this.supabaseClient = createClient(supabaseUrl, supabaseKey, {
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
		});

		const configuration = new Configuration({
			apiKey: openaiKey,
		});
		this.openai = new OpenAIApi(configuration);

		const modalInstruction = `
		<div class="prompt-instructions">
			<div class="prompt-instruction"><span class="prompt-instruction-command">↑↓</span><span>to navigate</span></div>
			<div class="prompt-instruction"><span class="prompt-instruction-command">↵</span><span>to open</span></div>
			<div class="prompt-instruction"><span class="prompt-instruction-command">shift ↵</span><span>to ask</span></div>
			<div class="prompt-instruction"><span class="prompt-instruction-command">esc</span><span>to dismiss</span></div>
		</div>`;

		// Adding the instructions
		const modalInstructionsHTML = document.createElement("div");
		modalInstructionsHTML.addClass("prompt-instructions");
		modalInstructionsHTML.innerHTML = modalInstruction;
		this.modalEl.append(modalInstructionsHTML);

		// Adding the generative answer section
		const leadingPromptHTML = document.createElement("div");
		const leadingTemplate = `
		<div class="prompt-subheading">
			Answer box
		</div>
		<div class="prompt-answer">
			<span id="answer">press shift ↵ to generate answer</span>
		</div>
		<div class="prompt-subheading">
			Search results
		</div>
		`;
		leadingPromptHTML.addClass("prompt-leading");
		leadingPromptHTML.innerHTML = leadingTemplate;
		this.resultContainerEl.before(leadingPromptHTML);

		// Setting the placeholder
		this.setPlaceholder("Enter query to ✨magic✨ search...");
	}

	onOpen(): void {
		this.keyListener = document.addEventListener(
			"keydown",
			async (event) => {
				if (event.shiftKey && event.key === "Enter") {
					// Kill old typed instance if any
					if (this.typedInstance) {
						this.typedInstance.destroy();
					}

					const answerHTML = document.querySelector("#answer")!;
					answerHTML.innerHTML = "Thinking...";

					// Get prompt input
					const inputEl = document.querySelector(
						".prompt-input"
					) as HTMLInputElement;

					const answer = inputEl.getText();

					this.typedInstance = new Typed("#answer", {
						strings: [answer],
						typeSpeed: 50,
						showCursor: false,
					});
				}
			}
		);
	}

	onClose(): void {
		// Kill old typed instance if any
		if (this.typedInstance) {
			this.typedInstance.destroy();
		}
		document.removeEventListener("keydown", this.keyListener);
	}

	// Returns all available suggestions.
	async getSuggestions(query: string): Promise<SearchResult[]> {
		const results: SearchResult[] = await semanticSearch(
			this.supabaseClient,
			this.openai,
			query
		);
		return results;
	}

	// Renders each suggestion item.
	renderSuggestion(result: SearchResult, el: HTMLElement) {
		const name = path.parse(result.document.path).name;
		el.createEl("div", { text: name });
	}

	// Perform action on the selected suggestion.
	onChooseSuggestion(result: SearchResult, evt: MouseEvent | KeyboardEvent) {
		const leaf = this.app.workspace.getLeaf();
		const files = this.app.vault.getMarkdownFiles();
		const selected = files.find(
			(file) =>
				path.resolve(file.path) === path.resolve(result.document.path)
		);
		if (selected) leaf.openFile(selected);
	}
}

class SettingTab extends PluginSettingTab {
	plugin: ObsidianMagicPlugin;

	constructor(app: App, plugin: ObsidianMagicPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Settings for my awesome plugin." });

		new Setting(containerEl)
			.setName("Supabase URL")
			.setDesc("The Supabase server URL")
			.addText((text) =>
				text
					.setPlaceholder("Enter URL")
					.setValue(this.plugin.settings.supabaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.supabaseUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Supabase Key")
			.setDesc("The Supabase API key")
			.addText((text) =>
				text
					.setPlaceholder("Enter Key")
					.setValue(this.plugin.settings.supabaseKey)
					.onChange(async (value) => {
						this.plugin.settings.supabaseKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OpenAI Key")
			.setDesc("The OpenAI API key")
			.addText((text) =>
				text
					.setPlaceholder("Enter Key")
					.setValue(this.plugin.settings.openaiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiKey = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
