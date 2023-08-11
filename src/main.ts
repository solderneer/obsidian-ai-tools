import { App, SuggestModal, Plugin, PluginSettingTab, Setting, Notice } from "obsidian";

import Typed from "typed.js";
import * as path from "path";

import { oneLine } from "common-tags";

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
	Configuration,
	OpenAIApi,
	CreateModerationResponse,
} from "openai-edge";

// Local things
import { generateEmbeddings } from "./generate-embeddings";
import { generativeSearch, semanticSearch } from "./search";
import { truncateString, removeMarkdown } from "./utils";

interface SearchSettings {
	matchThreshold: number;
	matchCount: number;
	minContentLength: number;
}

interface ObsidianAISettings {
	supabaseUrl: string;
	supabaseKey: string;
	openaiKey: string;
	indexOnOpen: boolean;

	// Directory settings
	excludedDirs: string;
	excludedDirsList: string[];
	publicDirs: string;
	publicDirsList: string[];

	// Prompt injection
	prompt: string;

	semanticSearch: SearchSettings;
	generativeSearch: SearchSettings;
}

const DEFAULT_SETTINGS: ObsidianAISettings = {
	supabaseUrl: "",
	supabaseKey: "",
	openaiKey: "",
	indexOnOpen: false,

	excludedDirs: "",
	excludedDirsList: [],

	publicDirs: "",
	publicDirsList: [],

	prompt: oneLine`Your name is Obsidian, you are a 22-year-old university student who studies
		Electronics and Electrical Engineering at University College London. Given
		the following sections from your notes, answer the question with the provided information. If
		you are unsure, and the notes don't include relevant information, you may also say
		"Sorry, I don't know the answer to this question :("`,

	semanticSearch: {
		matchThreshold: 0.78,
		matchCount: 10,
		minContentLength: 50,
	},

	generativeSearch: {
		matchThreshold: 0.78,
		matchCount: 10,
		minContentLength: 50,
	},
};

export default class ObsidianAIPlugin extends Plugin {
	settings: ObsidianAISettings;
	supabaseClient: SupabaseClient | null;
	openai: OpenAIApi | null;
	statusBarItemEl: HTMLElement;

	setupSupabase() {
		this.supabaseClient = null;
		if (
			!(
				this.settings.supabaseUrl === "" ||
				this.settings.supabaseKey === ""
			)
		) {
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
		}

		if (!(this.supabaseClient && this.openai)) {
			this.statusBarItemEl.setText("❓[AI] Missing API variables");
		} else {
			this.statusBarItemEl.setText("✨ [AI] Ready");
		}
	}

	setupOpenai() {
		this.openai = null;
		if (!(this.settings.openaiKey === "")) {
			const configuration = new Configuration({
				apiKey: this.settings.openaiKey,
			});
			this.openai = new OpenAIApi(configuration);
		}

		if (!(this.supabaseClient && this.openai)) {
			this.statusBarItemEl.setText("❓[AI] Missing API variables");
		} else {
			this.statusBarItemEl.setText("✨ [AI] Ready");
		}
	}

	async onload() {
		await this.loadSettings();

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		this.statusBarItemEl = this.addStatusBarItem();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));

		this.setupSupabase();
		this.setupOpenai();

		// Index any new files on startup
		if (
			this.settings.indexOnOpen &&
			this.supabaseClient !== null &&
			this.openai !== null
		) {
			this.app.workspace.onLayoutReady(() => {
				if (this.supabaseClient !== null && this.openai !== null) {
					this.statusBarItemEl.setText("🔮 [AI] Indexing...");
					generateEmbeddings(
						this.supabaseClient,
						this.openai,
						this.settings.excludedDirsList,
						this.settings.publicDirsList
					)
						.then((result) => {
							if (result.errorCount == 0) {
								this.statusBarItemEl.setText("✨ [AI] Loaded");
								new Notice(`Successfully indexed ${result.successCount} documents with ${result.updatedCount} updates! Removed ${result.deleteCount} deleted documents.`);
							} else {
								this.statusBarItemEl.setText("😔 [AI] Error");
								new Notice(`There were ${result.errorCount} errors! View developer console for more information.`);
							}
						});
				}
			});
		}

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "ai-search",
			name: "AI Search",
			checkCallback: (checking: boolean) => {
				if (this.supabaseClient !== null && this.openai !== null) {
					if (!checking) {
						new AISearchModal(
							this.app,
							this.supabaseClient,
							this.openai,
							this.settings.prompt,
							this.settings.semanticSearch,
							this.settings.generativeSearch
						).open();
					}

					return true;
				}

				return false;
			},
		});

		this.addCommand({
			id: "refresh-embedding",
			name: "Refresh Index",
			checkCallback: (checking: boolean) => {
				if (this.supabaseClient !== null && this.openai !== null) {
					if (!checking) {
						this.statusBarItemEl.setText("🔮 [AI] Indexing...");
						generateEmbeddings(
							this.supabaseClient,
							this.openai,
							this.settings.excludedDirsList,
							this.settings.publicDirsList
						)
						.then((result) => {
							if (result.errorCount == 0) {
								this.statusBarItemEl.setText("✨ [AI] Loaded");
								new Notice(`Successfully indexed ${result.successCount} documents with ${result.updatedCount} updates! Removed ${result.deleteCount} deleted documents.`);
							} else {
								this.statusBarItemEl.setText("😔 [AI] Error");
								new Notice(`There were ${result.errorCount} errors! View developer console for more information.`);
							}
						});
					}

					return true;
				}

				return false;
			},
		});
	}

	onunload() { }

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

type KeyListener = (event: KeyboardEvent) => void;

class AISearchModal extends SuggestModal<SearchResult> {
	private triggerChatListener: KeyListener;
	private chatSendListener: KeyListener;
	private prompt: string;
	private mode = "search";

	// APIs
	private supabaseClient: SupabaseClient;
	private openai: OpenAIApi;

	// Settings
	private semanticSearchSettings: SearchSettings;
	private generativeSearchSettings: SearchSettings;

	constructor(
		app: App,
		supabaseClient: SupabaseClient,
		openai: OpenAIApi,
		prompt: string,
		semanticSearchSettings: SearchSettings,
		generativeSearchSettings: SearchSettings
	) {
		super(app);

		this.supabaseClient = supabaseClient;
		this.openai = openai;
		this.prompt = prompt;
		this.semanticSearchSettings = semanticSearchSettings;
		this.generativeSearchSettings = generativeSearchSettings;

		// Adding the instructions
		const instructions = [
			["↑↓", "to navigate"],
			["↵", "to open"],
			["shift ↵", "to ask"],
			["esc", "to dismiss"],
		];
		const modalInstructionsHTML = this.modalEl.createEl("div", {
			cls: "prompt-instructions",
		});
		for (const instruction of instructions) {
			const modalInstructionHTML = modalInstructionsHTML.createDiv({
				cls: "prompt-instruction",
			});
			modalInstructionHTML.createSpan({
				cls: "prompt-instruction-command",
				text: instruction[0],
			});
			modalInstructionHTML.createSpan({ text: instruction[1] });
		}

		// Adding the generative answer section
		const leadingPromptHTML = document.createElement("div");
		leadingPromptHTML.addClass("prompt-leading");
		leadingPromptHTML.createDiv({
			cls: "prompt-subheading",
			text: "Answer box",
		});
		const promptAnswerHTML = leadingPromptHTML.createDiv({
			cls: "prompt-answer",
		});
		promptAnswerHTML.createSpan({
			cls: "obsidian-ai-tools-answer",
			text: "press shift ↵ to generate answer",
		});
		leadingPromptHTML.createDiv({
			cls: "prompt-subheading",
			text: "Search Results",
		});
		this.resultContainerEl.before(leadingPromptHTML);

		// Programmatically build the AI chat interface
		const chatContainerHTML = document.createElement("div");
		chatContainerHTML.addClass("chat-container");
		chatContainerHTML.style.display = "none";

		const backButton = chatContainerHTML.createEl("button", {cls: "chat-back-button", text: "←"});
		const messageContainer = chatContainerHTML.createDiv({cls: "chat-messages"});
		const chatInputContainer = chatContainerHTML.createDiv({cls: "chat-input-container"});
		const chatInput = chatInputContainer.createEl("input", {type: "search", cls: "chat-input", placeholder: "Type your message..."});
		this.resultContainerEl.before(chatContainerHTML);

		const backButtonListener = async (_: MouseEvent) => {
			// Register AI chat handlers
			const promptInput = document.querySelector(".prompt-input-container") as HTMLElement;
			const promptLeading = document.querySelector(".prompt-leading") as HTMLElement;
			const promptResults = document.querySelector(".prompt-results") as HTMLElement;

			promptInput.style.display = "block";
			promptLeading.style.display = "block";
			promptResults.style.display = "block";
			chatContainerHTML.style.display = "none";

			document.removeEventListener("click", backButtonListener);
			document.removeEventListener("keydown", this.chatSendListener);
			document.addEventListener("keydown", this.triggerChatListener);
		};

		backButton.addEventListener("click", backButtonListener);

		const addMessage = (sender: string, text: string) => {
			const messageDiv = document.createElement("div");
			messageDiv.className = "message"

			const messageSender = document.createElement("div");
			messageSender.className = "message-sender";
			messageSender.textContent = sender;
		
			const messageText = document.createElement("div");
			messageText.className = "message-text";
			messageText.textContent = text;
		
			messageDiv.appendChild(messageSender);
			messageDiv.appendChild(messageText);
		
			messageContainer.appendChild(messageDiv);
		}

		this.chatSendListener = (event: KeyboardEvent) => {
			if (event.shiftKey && event.key === "Enter") {
				const message = chatInput.value.trim();
				if (message !== "") {
				addMessage("You:", message);
				chatInput.value = "";
				}
			}
		};

		// Setting the placeholder
		this.setPlaceholder("Enter query to ✨ AI ✨ search...");
	}

	onOpen(): void {
		this.triggerChatListener = async (event: KeyboardEvent) => {
			if (event.shiftKey && event.key === "Enter") {
				console.log("Hello!");
				// Mode switch to AI mode
				this.mode = "ai";

				// Disable answer boxes
				const promptInput = document.querySelector(".prompt-input-container") as HTMLElement;
				const promptLeading = document.querySelector(".prompt-leading") as HTMLElement;
				const promptResults = document.querySelector(".prompt-results") as HTMLElement;

				promptInput.style.display = "none";
				promptLeading.style.display = "none";
				promptResults.style.display = "none";

				// Enable chat boxes
				const chatContainer = document.querySelector(".chat-container") as HTMLElement;
				chatContainer.style.display = "block";

				document.removeEventListener("keydown", this.triggerChatListener);
				document.addEventListener("keydown", this.chatSendListener);
			}
		};

		document.addEventListener("keydown", this.triggerChatListener);
	}

	onClose(): void {
		document.removeEventListener("keydown", this.chatSendListener);
		document.removeEventListener("keydown", this.triggerChatListener);
	}

	// Returns all available suggestions.
	async getSuggestions(query: string): Promise<SearchResult[]> {
		// Sanitize input query
		// Moderate the content to comply with OpenAI T&C
		const moderationResponse: CreateModerationResponse = await this.openai
			.createModeration({ input: query.trim() })
			.then((res) => res.json());

		const [moderationRes] = moderationResponse.results;

		if (moderationRes.flagged) {
			throw new Error("Flagged content");
		}

		try {
			const results: SearchResult[] = await semanticSearch(
				this.supabaseClient,
				this.openai,
				query,
				this.semanticSearchSettings.matchThreshold,
				this.semanticSearchSettings.matchCount,
				this.semanticSearchSettings.minContentLength
			);
			return results;
		} catch(err) {
			new Notice(`Error: ${err.message}`);
			return [];
		}
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
	plugin: ObsidianAIPlugin;

	constructor(app: App, plugin: ObsidianAIPlugin) {
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
			.setName("Prompt")
			.setDesc(
				"Enter a prompt, you can customise the name and instructions"
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("Enter prompt")
					.setValue(this.plugin.settings.prompt)
					.onChange(async (value) => {
						this.plugin.settings.prompt = oneLine`${value}`;
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
					this.plugin.setupSupabase();
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
						this.plugin.setupSupabase();
					})
			);

		new Setting(containerEl).setName("OpenAI API Key").addText((text) =>
			text
				.setPlaceholder("Enter Key")
				.setValue(this.plugin.settings.openaiKey)
				.onChange(async (value) => {
					this.plugin.settings.openaiKey = value;
					await this.plugin.saveSettings();
					this.plugin.setupOpenai();
				})
		);

		containerEl.createEl("div", {
			cls: "setting-item setting-item-heading",
			text: "Semantic Search Settings",
		});

		new Setting(containerEl)
			.setName("Match Threshold")
			.setDesc(
				"The minimum similarity score to return a match (between 0 and 1)"
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter number")
					.setValue(
						this.plugin.settings.semanticSearch.matchThreshold.toString()
					)
					.onChange(async (value) => {
						if (!isNaN(parseInt(value))) {
							this.plugin.settings.semanticSearch.matchThreshold =
								parseFloat(value);
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Match Count")
			.setDesc("The maximum number of results to return")
			.addText((text) =>
				text
					.setPlaceholder("Enter integer")
					.setValue(
						this.plugin.settings.semanticSearch.matchCount.toString()
					)
					.onChange(async (value) => {
						if (!isNaN(parseInt(value))) {
							this.plugin.settings.semanticSearch.matchCount =
								parseInt(value);
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Min Content Length")
			.setDesc("The minimum length for valid result string")
			.addText((text) =>
				text
					.setPlaceholder("Enter integer")
					.setValue(
						this.plugin.settings.semanticSearch.minContentLength.toString()
					)
					.onChange(async (value) => {
						if (!isNaN(parseInt(value))) {
							this.plugin.settings.semanticSearch.minContentLength =
								parseInt(value);
							await this.plugin.saveSettings();
						}
					})
			);

		containerEl.createEl("div", {
			cls: "setting-item setting-item-heading",
			text: "Generative Search Settings",
		});

		new Setting(containerEl)
			.setName("Match Threshold")
			.setDesc(
				"The minimum similarity score to return a match (between 0 and 1)"
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter number")
					.setValue(
						this.plugin.settings.generativeSearch.matchThreshold.toString()
					)
					.onChange(async (value) => {
						if (!isNaN(parseInt(value))) {
							this.plugin.settings.generativeSearch.matchThreshold =
								parseFloat(value);
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Match Count")
			.setDesc("The maximum number of results to return")
			.addText((text) =>
				text
					.setPlaceholder("Enter integer")
					.setValue(
						this.plugin.settings.generativeSearch.matchCount.toString()
					)
					.onChange(async (value) => {
						if (!isNaN(parseInt(value))) {
							this.plugin.settings.generativeSearch.matchCount =
								parseInt(value);
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Min Content Length")
			.setDesc("The minimum length for valid result string")
			.addText((text) =>
				text
					.setPlaceholder("Enter integer")
					.setValue(
						this.plugin.settings.generativeSearch.minContentLength.toString()
					)
					.onChange(async (value) => {
						if (!isNaN(parseInt(value))) {
							this.plugin.settings.generativeSearch.minContentLength =
								parseInt(value);
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
