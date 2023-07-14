import {
	App,
	SuggestModal,
	Plugin,
	PluginSettingTab,
	Setting,
	MarkdownRenderer,
} from "obsidian";

import Typed from "typed.js";
import * as path from "path";

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Configuration, OpenAIApi } from "openai-edge";

// Local things
import { generateEmbeddings } from "./generate-embeddings";
import { generativeSearch, semanticSearch } from "./semantic-search";
import { truncateString, removeMarkdown } from "./utils";

interface ObsidianMagicSettings {
	supabaseUrl: string;
	supabaseKey: string;
	openaiKey: string;
	indexOnOpen: boolean;

	excludedDirs: string;
	excludedDirsList: string[];

	publicDirs: string;
	publicDirsList: string[];
}

const DEFAULT_SETTINGS: ObsidianMagicSettings = {
	supabaseUrl: "",
	supabaseKey: "",
	openaiKey: "",
	indexOnOpen: false,

	excludedDirs: "",
	excludedDirsList: [],

	publicDirs: "",
	publicDirsList: [],
};

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
		statusBarItemEl.setText("✨ [AI] Loaded");

		// Index any new files on startup
		if (this.settings.indexOnOpen) {
			this.app.workspace.onLayoutReady(() => {
				statusBarItemEl.setText("🔮 [AI] Indexing...");
				generateEmbeddings(
					this.supabaseClient,
					this.openai,
					this.settings.excludedDirsList,
					this.settings.publicDirsList
				)
					.then(() => {
						statusBarItemEl.setText("✨ [AI] Loaded");
					})
					.catch((err) => {
						console.log(err);
						statusBarItemEl.setText("😔 [AI] Error");
					});
			});
		}

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "magic-search",
			name: "Magic Search",
			callback: () => {
				new MagicSearchModal(
					this.app,
					this.supabaseClient,
					this.openai
				).open();
			},
		});

		this.addCommand({
			id: "refresh-embedding",
			name: "Refresh Index",
			callback: () => {
				statusBarItemEl.setText("🔮 [AI] Indexing...");
				generateEmbeddings(
					this.supabaseClient,
					this.openai,
					this.settings.excludedDirsList,
					this.settings.publicDirsList
				)
					.then(() => {
						statusBarItemEl.setText("✨ [AI] Loaded");
					})
					.catch((err) => {
						console.log(err);
						statusBarItemEl.setText("😔 [AI] Error");
					});
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
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
	private supabaseClient: SupabaseClient;
	private renderer: MarkdownRenderer;
	private typedInstance: Typed;
	private openai: OpenAIApi;

	constructor(app: App, supabaseClient: SupabaseClient, openai: OpenAIApi) {
		super(app);

		this.supabaseClient = supabaseClient;
		this.openai = openai;

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
		this.keyListener = async (event: KeyboardEvent) => {
			if (event.shiftKey && event.key === "Enter") {
				if (this.typedInstance) {
					this.typedInstance.destroy();
				}

				const answerHTML = document.querySelector("#answer")!;
				answerHTML.innerHTML = "Thinking...";

				// Get prompt input
				const inputEl = document.querySelector(
					".prompt-input"
				) as HTMLInputElement;

				const answer = await generativeSearch(
					this.supabaseClient,
					this.openai,
					inputEl.value
				);

				this.typedInstance = new Typed("#answer", {
					strings: [answer ?? "No answer"],
					typeSpeed: 50,
					showCursor: false,
				});
			}
		};

		document.addEventListener("keydown", this.keyListener);
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
		el.classList.add("prompt-suggestion-item");
		el.createEl("div", { cls: "prompt-suggestion-header", text: name });
		el.createEl("div", {
			cls: "prompt-suggestion-content",
			text: truncateString(removeMarkdown(result.content), 200),
		});
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

		new Setting(containerEl)
			.setName("Excluded Directories")
			.setDesc(
				"Enter a list of comma-seperated paths to exclude from indexing"
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("Enter paths")
					.setValue(this.plugin.settings.excludedDirs)
					.onChange(async (value) => {
						this.plugin.settings.excludedDirs = value;
						this.plugin.settings.excludedDirsList = value
							.split(",")
							.map((path) => path.trim());
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Public Directories")
			.setDesc(
				"Enter a list of comma-seperated paths to expose to the public"
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("Enter paths")
					.setValue(this.plugin.settings.publicDirs)
					.onChange(async (value) => {
						this.plugin.settings.publicDirs = value;
						this.plugin.settings.publicDirsList = value
							.split(",")
							.map((path) => path.trim());
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Index on start")
			.setDesc("Index documents automatically on start")
			.addToggle((component) =>
				component
					.setValue(this.plugin.settings.indexOnOpen)
					.onChange(async (value) => {
						this.plugin.settings.indexOnOpen = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("div", {
			cls: "setting-item setting-item-heading",
			text: "Secrets",
		});

		new Setting(containerEl).setName("Supabase URL").addText((text) =>
			text
				.setPlaceholder("Enter URL")
				.setValue(this.plugin.settings.supabaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.supabaseUrl = value;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl)
			.setName("Supabase Service Role Key")
			.addText((text) =>
				text
					.setPlaceholder("Enter Key")
					.setValue(this.plugin.settings.supabaseKey)
					.onChange(async (value) => {
						this.plugin.settings.supabaseKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("OpenAI API Key").addText((text) =>
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
