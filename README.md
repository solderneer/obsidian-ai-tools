# Obsidian AI

> Talk to an LLM clone of yourself, or even host it for everyone else to talk to

This plugin aims to bring **every useful AI-powered** feature to Obsidian while maintaining the self-hosted ethos. Right now, it offers powerful semantic search and generative question answering over your notes. In the future, I plan to add features like note auto-tagging, faster hybrid search etc.

Powered by [Supabase Vector](https://supabase.com/vector) and the [OpenAI API](https://platform.openai.com/docs/introduction).

## Features
- ✅ Semantic search over your notes
- ✅ Talk to your notes
- ✅ Simple unified UI
- ✅ Public endpoint to allow others to talk to your notes
  
## Wishlist
- Suggest related notes to link to the active note
- Suggest tags for note
- Hybrid search with keyword and semantic matching
- Natural language querying of frontmatter with SQL translation
- (and I dream of more and more!)

If you have any requests, let me know by opening an issue :)

## Demo
![](demo.gif)

## Installation
This plugin uses Supabase, and you can choose if you prefer a remote project or a local one. I will provide instructions for setting it up either way. I recommend the remote approach just for the sake of convenience and reliability.

### Pre-requisites
1. A Supabase project. You can set up by going to the [Supabase Dashboard](https://supabase.com/dashboard/projects) and following the instructions.
3. An OpenAI Account and API Key. You can register for one on the [OpenAI website](https://platform.openai.com/docs/quickstart).

### Instructions

#### Set up the Supabase Project

_Using Supabase CLI_

1. Install Supabase CLI by following [these instructions](https://supabase.com/docs/guides/cli)
2. Login to Supabase CLI
   ```bash
   supabase login
   ```
3. Clone this repo
   ```bash
   git clone git@github.com:solderneer/obsidian-ai.git
   cd obsidian-ai
   ```
4. Link to remote project
   ```bash
   supabase link --project-ref <project-id>
   # You can get <project-id> from your project's dashboard URL: https://supabase.com/dashboard/project/<project-id>
5. Deploy database
   ```bash
   supabase db push
   ```
6. Deploy supabase functions if you want to create a public endpoint for the public documents.
   ```bash
   supabase functions deploy
   ```

_Manually_

1. Navigate to the **SQL Editor** inside the project dashboard.
2. In another tab, navigate to the SQL migrations in this repo and copy them into a new query.
3. Run the query and verify if the **Table Editor** now shows two tables, `document` and `document_section`.

#### Install the plugin

_From Community Plugins_
This plugin is now available directly from within the Obsidian Community Plugins. Navigate to Settings > Community Plugins > Browse, and then search `AI Tools` to find and install it. Alternatively, [click here](obsidian://show-plugin?id=ai-tools). You can then proceed on to the setup section below. 

_Manually_

1. Go to the [latest release](https://github.com/solderneer/obsidian-ai/releases), and download `main.js`, `manifest.json` and `styles.css`.
2. Copy them into your obsidian vault in a new folder, `VaultFolder/.obsidian/plugins/obsidian-id/`.
3. Restart Obsidian if it was already running.
4. Now, go to the **Obsidian Settings** and navigate to the **Community Plugins tab**.
5. You should see Obsidian AI in the list, click the toggle to enable.

#### Setup the plugin

1. Navigate to the **Obsidian AI Settings** under the **Obsidian Settings**.
2. Go to the previously set up Supabase Project, and under **Project Settings**, find the Supabase URL and the Supabase Service Role Key.
3. Copy the Supabase URL and Service Role Key into the appropriate inputs in the **Obsidian AI Settings**
4. Next, go to your OpenAI Account, retrieve your API Key and copy it into the appropriate input in the **Obsidian AI Settings**.
5. You should see a status indicator saying, `✨ [AI] Ready`. This means everything is working!
6. At this point, remember to configure the Excluded Directories, for any directories you don't want to index.
7. Press `Cmd/Ctrl + p` and search for `Obsidian AI: Refresh Index`. Executing that will calculate all the embeddings and index them in the Supabase database. _This can take a while, so please be patient._
8. When it's completed, the status indicator should switch back to `✨ [AI] Ready` and the Supabase Tables should be populated with entries!

#### Usage

1. Press `Cmd/Ctrl + p` and search for `Obsidian AI: AI Search`.
2. Select the command and the unified UI modal will appear!
3. I recommend configuring a hot key for the AI Search, I personally use `Cmd + a`.

---

### Using a local Supabase project instead

#### Pre-requisites
1. A local Supabase environment. Follow the instructions on [the Supabase website](https://supabase.com/docs/guides/getting-started/local-development)

#### Instructions

Instead of the Supabase instructions above, do the following instead.

1. Clone this repo and navigate to it
   ```bash
   git clone git@github.com:solderneer/obsidian-ai.git
   cd obsidian-ai
   ```

2. Start Supabase locally (you need docker as well)
   ```bash
   supabase start
   ```

3. Apply migrations to set up table
   ```bash
   supabase db reset
   ```


   



