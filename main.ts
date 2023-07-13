import {
	App,
	SuggestModal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

import * as path from "path";
import Typed from "typed.js";

import { generateEmbeddings } from "./generate-embeddings";

// Remember to rename these classes and interfaces!

interface ObsidianMagicSettings {
	supabaseUrl: string;
	supabaseKey: string;
	openaiKey: string;
}

interface RefreshResponse {
	total: number;
	skipped: number;
	error: string[];
}

export default class ObsidianMagicPlugin extends Plugin {
	settings: ObsidianMagicSettings;

	async onload() {
		await this.loadSettings();

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("🔮 Indexing Magic...");
		fetch(this.settings.apiEndpoint + "/refresh")
			.then((response) => response.json())
			.then((data: RefreshResponse) => {
				statusBarItemEl.setText(
					`✨ Magic Indexed | ${data.total} indexed`
				);
			})
			.catch((error) => {
				console.log(error);
				statusBarItemEl.setText(`😔 Magic Error`);
			});

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "magic-search",
			name: "Magic Search",
			callback: () => {
				new MagicSearchModal(this.app).open();
			},
		});

		this.addCommand({
			id: "test-embedding",
			name: "Test Embedding",
			callback: async () => {
				await generateEmbeddings(
					this.plugin.settings.supabaseUrl,
					this.plugin.settings.supabaseKey,
					this.plugin.settings.openaiKey
				);
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		);
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
	score: string;
}

class MagicSearchModal extends SuggestModal<SearchResult> {
	private keyListener: any;
	private typedInstance: Typed;

	constructor(app: App) {
		super(app);

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

					const answer = await fetch(
						"http://127.0.0.1:5000/answer?" +
							new URLSearchParams({
								query: inputEl.value,
							})
					);

					this.typedInstance = new Typed("#answer", {
						strings: [await answer.text()],
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
		const results = await fetch(
			"http://127.0.0.1:5000/search?" +
				new URLSearchParams({
					query: query,
					limit: "20",
				})
		);

		const matches: SearchResult[] = await results.json();
		return matches;
	}

	// Renders each suggestion item.
	renderSuggestion(result: SearchResult, el: HTMLElement) {
		const name = path.parse(result.id).name;
		el.createEl("div", { text: name });
	}

	// Perform action on the selected suggestion.
	onChooseSuggestion(result: SearchResult, evt: MouseEvent | KeyboardEvent) {
		new Notice(`Selected ${result.id}`);
		const leaf = this.app.workspace.getLeaf();
		const files = this.app.vault.getMarkdownFiles();
		const selected = files.find(
			(file) => path.resolve(file.path) === path.resolve(result.id)
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
					.setValue(this.plugin.settings.apiEndpoint)
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
					.setValue(this.plugin.settings.apiEndpoint)
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
					.setValue(this.plugin.settings.apiEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.openaiKey = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
