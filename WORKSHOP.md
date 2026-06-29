# Using Perception Agents to verify site design

## The Scenario

You're a frontend developer preparing to ship a landing page for a podcast. Yesterday you demoed the page to a few peers and they provided some feedback: the hero title feels too big, the accent color doesn't pop the way it should, some buttons are oversized, and a few small things are just slightly off. You are onboard with the feedback, and today you're coming in fresh, and are ready to incorporate those changes.

You have a few tools at your disposal:

| Tool                                                                                        | Description                                            |
| ---------------------------------------------------------------------------------------------| --------------------------------------------------------|
| [Nova Act Chrome Extension](https://github.com/amazon-agi-labs/nova-act-browser-extensions) | Annotate live UI elements in Chrome                    |
| [UI Verification skills](https://github.com/amazon-agi-labs/nova-act-agent-skills)          | Automated CSS rule checking                            |
| [Nova Act SDK](https://github.com/aws/nova-act/tree/main/src/nova_act)                      | Browser automation to run verification flows           |
| [Nova Act MCP Server](https://github.com/amazon-agi-labs/amazon-nova-act-mcp)               | Give your agent easy access to Nova Act's capabilities |

And you have an AI coding agent: [**Kiro CLI**](https://kiro.dev/) or **Claude Code**. **Make sure you have them running before you start this workshop!!**

---

## The Perception Agent Primitives

You will start the workshop by learning about the two perception agent primitives, Annotation and Verification. The Annotation primitive lets you annotate a webpage by selecting elements or drawing on it, and adding your own comments. This produces a set of artifacts including a json representation of your annotations, as well as a prompt you can provide your agent to make those edits.

The Verification primitive verifies that the live website adheres to the design specifications that are in your code repository. It also creates user workflows to verify common workflows that are carried out on the site.

## The Challenge

Currently these primitives are independent of each other. The challenge we will solve in this workshop is wiring these tools together into an automated pipeline that finds discrepancies, fixes them, and verifies the UI changes, all triggered from the browser with a single action. Rather than manually taking the output of the Annotation primitive and feeding that to your coding agent, we will add an 'Apply Changes' button that will trigger the entire pipeline.

## By the end of the workshop...

You will have built an automated pipeline that:
1. Add an "Apply Changes" button to the extension that sends your annotations to a local endpoint
2. An endpoint running locally receives these annotations and invokes your AI coding agent to fix any CSS issues
3. After the coding agent finishes, verification is automatically triggered
4. The verification report shows **0 failures** (Bonus Challenge)

The pipeline should be repeatable: annotate, apply, verify, iterate until clean.

Before we start building that, let's make sure we've got all of our prerequisites installed.

---

## Prerequisites

Make sure you have the following installed **before** the workshop begins.

| Requirement             | Version                  | Notes                                                                                                 |
| -------------------------| --------------------------| -------------------------------------------------------------------------------------------------------|
| **OS**                  | macOS or Linux           | Required for Nova Act MCP server                                                                      |
| **Node.js**             | v18+                     | Needed for the sample app and agent bridge                                                            |
| **npm**                 | Latest (ships with Node) |                                                                                                       |
| **Python**              | 3.10+                    | For the Nova Act SDK and verification scripts                                                         |
| **Git**                 | Any recent version       | To clone the repo                                                                                     |
| **Chrome**              | Latest stable            | For the annotator extension and viewing the app                                                       |
| **AI Coding Agent CLI** | Latest                   | **Kiro CLI** (`kiro-cli`) or **Claude Code** (`claude`). Install and authenticate before the workshop |
| **uv**                  | Latest                   | For `uvx` installs; alternatively use `pip` directly                                                  |

### Verify your prerequisites before you kick off

```bash
node --version      # v18+
python3 --version   # 3.10+
git --version
which kiro-cli || which claude   # at least one AI CLI available
```

---

## Workshop setup (5-7 mins)

Get your local environment ready: app running, extension loaded, dependencies installed. 


### 1. Clone the repo

```bash
git clone https://github.com/amazon-agi-labs/perception-agents-workshop.git
cd perception-agents-workshop
```

### 2. Install requirements

The Nova Act Python SDK powers the headless browser verification. Set up a virtual environment and install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r tools/agent-bridge/requirements.txt
```


### 3. Install Nova Act MCP server and UI Verification skills

This step installs the [Nova Act MCP](https://github.com/amazon-agi-labs/amazon-nova-act-mcp) server (which gives your agent browser automation tools) and the [UI Verification skills](https://github.com/amazon-agi-labs/nova-act-agent-skills) (which teach your agent how to check CSS rules and run flows).


```bash
npx skills@latest add amazon-agi-labs/nova-act-agent-skills
```

The installer will walk you through several prompts. Here's what to select at each step:

**1. "Select skills to install"**: press Space to select **both**, then Enter:
```
◆  Select skills to install (space to toggle)
│  ◼ nova-act
│  ◼ ui-verification
```

**2. "Which agents do you want to install to?"**: select **Kiro CLI** and/or **Claude Code** (whichever you're using):
```
◆  Which agents do you want to install to? (space to toggle)
│  ◼ Kiro CLI
│  ◼ Claude Code
```

**3. "Installation scope"**: select **Project**:
```
◆  Installation scope
│  ○ Global (available in all projects)
│  ● Project (only this project)
```

**4. "Installation method"**: select **Symlink (Recommended)**:
```
◆  Installation method
│  ● Symlink (Recommended)
│  ○ Copy to all agents
```

**5. "Proceed with installation?"**: type `Y`

The skills should be installed in:
- Kiro CLI: `./.kiro/skills/nova-act/` and `./.kiro/skills/ui-verification/`
- Claude Code: `./.claude/skills/nova-act/` and `./.claude/skills/ui-verification/`

Note: there is a [known issue](https://github.com/vercel-labs/skills/issues/744) with creating the symlinks. Until that is resolved, you will need to manually copy the skills into your coding agent using this command:

```bash
# For Kiro
mkdir -p .kiro/skills
ln -s ../../.agents/skills/nova-act .kiro/skills/nova-act
ln -s ../../.agents/skills/ui-verification .kiro/skills/ui-verification

# For Claude
mkdir -p .claude/skills
ln -s ../../.agents/skills/nova-act .claude/skills/nova-act
ln -s ../../.agents/skills/ui-verification .claude/skills/ui-verification
```

#### 4. Verify the installation

**Restart any open Kiro CLI or Claude Code CLI sessions** for the Nova Act MCP server and perception skills to be picked up.

After restarting, try the following prompt in a new session:

```
Do you have the ui-verification and nova-act skills and print their location                                              
```

You should see output like:
```
  Yes, I have both skills available. Here are their locations:
  
  - nova-act:
   <parent-directory>/perception-agents-workshop/.kiro/skills/nov
  a-act/SKILL.md 
  - ui-verification:
  <parent-directory>/perception-agents-workshop/.kiro/skills/ui-
  verification/SKILL.md 
  
```

#### 5. Configure the Nova Act MCP server

By default, the Nova Act MCP server doesn't enable the UI verification tool set, so we need to enable those ourselves. To do this, you need to add `--toolsets ui-verification` to the MCP server args.

We also need to add the **Nova Act API key** which you set in the `NOVA_ACT_API_KEY` environment variable.

To make these edits:
1. Open either `~/.kiro/settings/mcp.json` (for Kiro CLI) or `~/.claude.json` (for Claude Code)
2. Find the json object for `nova-act-mcp`
3. In the args array, add ```"--toolsets", "ui-verification"```
4. For `NOVA_ACT_API_KEY`, enter your Nova Act API key
5. Save the file and exit

Your config should look like this:

```json
"nova-act-mcp": {
  "command": "uvx",
  "args": [
    "amazon-nova-act-mcp",
    "--toolsets",
    "ui-verification"
  ],
  "env": {
    "NOVA_ACT_API_KEY": "<your-api-key>"
  }
}
```

After editing, **restart any active Kiro CLI or Claude Code sessions** for the changes to take effect.

Congratulations! You have completed setting up your environment and are ready to start the workshop!

> **Stuck?** If something isn't working as expected, check the [Troubleshooting](#troubleshooting) section at the bottom of this page.

---
## Try the Perception Agent primitives (12-15 mins)
Let's start by exploring the primitives that are available to you in this workshop.
### 1. Start the app server
Get the podcast app (the workshop sample app) running locally so you have a live page to annotate and verify against.

```Bash
cd some-podcast-app
npm install && npm run dev
```

Open http://localhost:5173 in Chrome.

### 2. Run UI Verification

The `ui-verification` skill lets the agent check its own work. It spins up the rendered app, runs deterministic CSS checks directly against the live DOM to catch visual deviations, then walks user flows end-to-end via Nova Act to catch functional regressions. Generation and validation become one continuous loop without requiring repeated manual intervention.

#### What happens when you run it?
You can invoke the skill in three ways:

| Command                                                 | What runs                                                 |
| ---------------------------------------------------------| -----------------------------------------------------------|
| `Verify http://localhost:5173/ matches the design spec` | Visual checks only                                        |
| `Run flows on http://localhost:5173/`                   | Flow checks only                                          |
| `Verify http://localhost:5173/`                         | Both (visual first, then flows, into one combined report) |

**Visual verification** reads spec files from `.ui-verification/specs/`, translates each claim into a deterministic `getComputedStyle()` check against the live DOM, and reports pass/fail per rule.

**Flow verification** reads `.feature` files from `.ui-verification/flows/`, executes each Gherkin scenario step-by-step via Nova Act's `act()` (actions) and `act_get()` (assertions), and writes a per-flow report.

If no `design.md` exists yet (cold start), the skill generates one by observing the live site: opening a headless browser, extracting computed CSS values, reading your source files to discover tokens and selectors, and compiling everything into specs and flows. This cold start takes **7-8 minutes**; subsequent runs are fast because the specs already exist. To learn more about how the `specs` and `flows` are generated, checkout [this](https://github.com/amazon-agi-labs/nova-act-agent-skills/tree/main/skills/ui-verification/references) link.

#### What it produces

Each run writes to `.ui-verification/reports/<run-timestamp>/`:

```
reports/<run-timestamp>/
├── report.md                          ← combined visual + flow report
├── flow-reports/<flow-name>.report.md ← per-flow detail
├── screenshots/<category>.png         ← annotated visual failures
└── sessions.json                      ← manifest of session IDs
```

#### Pre-generated files (to skip the cold start)

To save time during the workshop, the repo already includes pre-generated verification artifacts. You do **not** need to run this step; it's here so you understand what the files are and how they were created.

The pre-generated files:
- `some-podcast-app/visual/design.md`: the design spec (source of truth)
- `some-podcast-app/.ui-verification/specs/`: CSS rules (visual-style, components, accessibility, project-rules, platform-conventions)
- `some-podcast-app/.ui-verification/flows/`: Gherkin scenarios for functional testing

If you want to regenerate from scratch, first delete the `.ui-verification` and `visual` folders and run the following command (this is optional for this workshop.):
```bash
# In your Kiro CLI or Claude Code session, invoke the skill:
/ui-verification http://localhost:5173 in some-podcast-app directory
```

That's the **verification** primitive: it tells you *what's wrong*, automatically. Next, let's move on to the UI Annotator, a Chrome extension that lets you visually mark up elements and describe desired changes directly on the page.

### 3. Load the Chrome extension

The annotator extension is how you'll point at elements and describe what needs to change.

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select: `perception-agents-workshop/tools/extension`

#### Try it out: annotate the app
Before you wire both primitives together, let's get hands-on with the Annotator primitive. You'll use it to annotate the homepage of the podcast landing page. In the steps below, you will use the annotator to point at elements and describe what you want changed. 

1. Open http://localhost:5173 in Chrome
2. Click the extension icon → **"Annotate Current Page"**
3. Switch to **Element** mode
4. Click the hero heading ("Some Podcast")
5. Type: `Change this font to a serif font`
6. Click **Save**
7. Add a few more annotations (e.g. click a play button → `Make this smaller`)
8. **Click Save & export**
9. Download the annotations JSON and copy the prompt

> #### Some other ideas of changes you could make
>
> * Change the font of "Some Podcast" heading to a serif font
> * The published date should be "July 3, 2026"
> * Make the play buttons green 

After you save, the extension generates a prompt that you can pass to your coding agent to make the changes you requested. Let's do that:

```bash
# Copy the prompt from the extension's "Copy Prompt" button, then:
# With Kiro:
kiro-cli chat -a --no-interactive --effort max "$(cat <<'EOF'
   Use this annotation to update the src code for some-podcast-app: <paste prompt here>
EOF)"

# With Claude:
claude --dangerously-skip-permissions -p 'Use this annotation to update the src code for some-podcast-app: <paste prompt here>'

```

Once you've done that, go back to the landing page [localhost:5173](http://localhost:5173) in the browser and you should see all the changes have been applied. If you wanted to verify the updates you made still align with your design, the next step would be to run the /ui-verification skill to see if anything fails.
```
cd some-podcast-app # if not already in this directory
/ui-verification http://localhost:5173 
```

### 4. Explore what's available
Before you dive into the wiring up the two primitives, take a look at the project layout so you know where source files, specs, and tools live.

```
some-podcast-app/
├── src/App.css              <- Component styles (annotation fixes go here)
├── src/index.css            <- CSS variables
├── visual/design.md         <- Design spec (source of truth)
├── .ui-verification/
│   ├── specs/               <- CSS rules to check against
│   │   ├── visual-style.md
│   │   └── component-rules.md
│   ├── flows/               <- Gherkin scenarios
│   └── reports/             <- Where reports land

tools/
├── extension/               <- Chrome extension source (you will modify this)
└── agent-bridge/            <- Agent bridge server + verification script
```

---
## Choose Your Path (15 - 30 mins)

The two primitives are valuable on their own. But put yourself in the shoes of a frontend engineer iterating on a design. You annotate a few elements, copy the prompt, paste it into your agent, wait for the fix, then run verification. That's one cycle. Now imagine doing that ten times as feedback trickles in from design review. Ten copy-pastes, ten agent invocations, ten verification runs: forty manual steps keeping you chained to your terminal.

In this next step you will level up these two primitives by wiring them together behind a single "Apply Changes" button. Click it, walk away for coffee, and come back to a verification report (green or red), no hand-holding required.

Pick a difficulty level based on how much guidance you want. Both paths reach the same end goal.

| Level                            | What you get                                             | Time   |
| ----------------------------------| ----------------------------------------------------------| --------|
| [**EASY**](WORKSHOP-EASY.md)     | Full step-by-step walkthrough with all code provided.    | 15 min |
| [**MEDIUM**](WORKSHOP-MEDIUM.md) | Two code-level hints showing what to build.              | 30 min |


---
## Bonus Challenge (10 mins)

Finished the main challenge? Pick one of these three options, or do all three if you're feeling ambitious.
---

### Option 1: Let Bee do the pointing

What if you didn't need to click and type to annotate at all? [Bee](https://bee.computer/) is an AI wearable that listens to your conversations and understands context. Instead of clicking elements in a Chrome extension, you just _talk_ about what needs to change, and Bee captures it as structured design feedback that flows directly into the coding agent pipeline. Bee listens, the coding agent fixes, verification confirms. Full perception agent loop by simply taking to the Bee device.

#### Architecture

```
┌──────────────┐         ┌──────────────────────────────────────┐
│  Bee Device  │         │       proxy-worker.js (:9997)        │
│  (wearable)  │         │                                      │
└──────┬───────┘         │  Spawns subprocess:                  │
       │                 │  bee stream --types                  │
       │  Bee Cloud      │    update-conversation --json        │
       ▼                 │         │                            │
┌──────────────┐         │         ▼                            │
│   Bee CLI    │         │  Fetches full context:               │
│              │         │  bee conversations get <id> --json   │
│ bee stream ──┼────────▶│  bee conversations transcript <id>   │
│              │         │    --json                            │
│ bee          │         │         │                            │
│ conversations│◀────────│         ▼                            │
│ get <id>     │         │  Injects sidebar into proxied page   │
│ --json       │         │                                      │
│              │         └──────────┬───────────────────────────┘
│ bee          │                    │
│ conversations│                    ▼
│ transcript   │
│ <id> --json  │
└──────────────┘
                         ┌──────────────────────────────────────┐
                         │         Browser (:9997)              │
                         │                                      │
                         │  ┌──────────────┐  ┌─────────────┐   │
                         │  │ Podcast App  │  │ Sidebar UI  │   │
                         │  │ (proxied)    │  │(inspector.js│   │
                         │  │              │  │  injected)  │   │
                         │  └──────────────┘  └──────┬──────┘   │
                         └───────────────────────────┼──────────┘
                                                     │
                                           "Apply" click
                                           POST /api/bee/apply
                                                     │
                                                     ▼
                                   ┌─────────────────────────────┐
                                   │   proxy-worker invokes CLI  │
                                   │                             │
                                   │   claude -p "..." or        │
                                   │   kiro-cli chat ...         │
                                   │                             │
                                   │   → Edits src/App.css       │
                                   │                             │
                                   │   → Polls dev server        │
                                   │   → Runs verification       │
                                   │     (verify-with-nova-act)  │
                                   │   → Report viewable in UI   │
                                   └─────────────────────────────┘
```

#### Prerequisites

1. **Install Bee CLI** from [https://github.com/bee-computer/bee-cli](https://github.com/bee-computer/bee-cli)
2. **Authenticate**: run `bee login` and follow the prompts
3. **Verify**: run `bee status` (should show your account connected)
4. Ensure `claude` or `kiro-cli` is on your PATH (same as main challenge)

#### How it works

The Bee annotator is a reverse proxy that:

1. Proxies your dev server (`:5173`) on a separate port (`:9997`)
2. Spawns `bee stream --types update-conversation --json` as a subprocess
3. When a conversation you have near your Bee device finishes processing, it checks whether the conversation is about design (keywords: color, font, layout, CSS, etc.)
4. If it's design-related, it fetches the full conversation summary and transcript via `bee conversations get <id> --json`
5. Injects a sidebar into the proxied page showing conversation cards with title, summary, and key takeaways
6. Clicking **Apply** on a card builds a prompt from the conversation context and invokes your AI CLI to make the code changes
7. After the code changes are applied, the proxy polls the dev server until it's responsive, then automatically runs **UI verification** via `verify-with-nova-act.py`
8. The sidebar shows real-time progress (Applying → Verifying → Done) and provides a **"View Report"** link when verification completes

#### Step-by-step

**1. Start the app** (if not already running):

```bash
cd some-podcast-app
npm run dev
```

**2. Export your Nova Act API key** (required for verification):

```bash
export NOVA_ACT_API_KEY="<your-api-key>"
```

**3. Start the Bee proxy** (from the repo root):

```bash
node tools/bee-annotator-solution/proxy-worker.js \
  --target http://localhost:5173 \
  --port 9997 \
  --feedback some-podcast-app/.tmp/bee-conv-feedback.json \
  --inspector-script tools/bee-annotator-solution/inspector.js \
  --app-dir some-podcast-app
```

To use Kiro CLI instead of Claude (the default), add `--cli kiro-cli`:
```bash
node tools/bee-annotator-solution/proxy-worker.js \
  --target http://localhost:5173 \
  --port 9997 \
  --feedback some-podcast-app/.tmp/bee-conv-feedback.json \
  --inspector-script tools/bee-annotator-solution/inspector.js \
  --app-dir some-podcast-app \
  --cli kiro-cli
```

**4. Open the proxied app** at [http://localhost:9997](http://localhost:9997). You'll see the app with a dark sidebar on the right saying "Waiting for design conversations..."

**5. Have a design conversation** near your Bee device. For example, say out loud:

> "The hero title font should be a serif font. The play buttons are too big, make them smaller. And the footer link color should match the badge color."

**6. Wait for the conversation to complete.** Bee processes it (typically 10-30 seconds after you stop speaking). A card will appear in the sidebar with the conversation title, summary, and key takeaways extracted by Bee.

**7. Click "Apply".** The proxy builds a prompt from the conversation's key takeaways and feeds it to your AI CLI. The sidebar shows real-time status:
- **"Applying..."** — the AI agent is editing source files
- **"Verifying..."** — Nova Act is running CSS checks and flow assertions
- **"✓ Verification complete"** — done, with a **"View Report"** link

```bash
# In your AI CLI
/ui-verification verify http://localhost:5173 
```

#### Tips

- The sidebar shows a connection status dot: green for connected to Bee stream, yellow for connecting, red for disconnected
- Click **Details** on a card to see the full conversation summary, key takeaways, and transcript
- Click **Dismiss** to remove a conversation card you don't want to act on
- The `--filter` flag lets you customize which keywords trigger design detection
- Set `BEE_CLI_PATH` env var if your `bee` binary is in a non-standard location
- You can check the pipeline status at any time: `curl -s http://localhost:9997/api/bee/apply/status | python3 -m json.tool`

#### Reference solution

The full working code is in `tools/bee-annotator-solution/`. If you get stuck, peek at the README there for detailed documentation.

---

### Option 2: Build something for your own use case

You now have two primitive tools that compose into anything:

| Primitive | What it gives you |
|-----------|-------------------|
| **Visual Annotator** | Structured feedback pinned to live DOM elements: selectors, computed styles, and human (or agent) intent, captured in one click |
| **UI Verification** | Deterministic CSS checks + behavioral flow assertions that run headlessly and produce a pass/fail report |

These are Lego bricks. The workshop wired them into "annotate → fix → verify." But that's just one shape. What else could you build that you'd use every day?

Some ideas to spark thinking:
- A **design review bot** that runs verification on every PR deploy and comments with failures
- A **regression guard** that screenshots before/after and flags visual drift
- A **design system enforcer** that checks every page against your component library rules on CI

### Option 3: Auto-fix loop

Close the loop without human intervention. Feed the verification report directly back to the agent and let it self-correct.

1. **Feed the report to the agent.** Open the latest verification report at `some-podcast-app/.ui-verification/reports/<timestamp>/report.md`. Pass the failures directly to your AI CLI and have it fix them:
   ```bash
   # Kiro CLI
   kiro-cli chat -a --no-interactive --effort max "Read the latest report in some-podcast-app/.ui-verification/reports/ and fix all CSS failures to match some-podcast-app/visual/design.md"

   # Claude Code
   claude -p "Read some-podcast-app/.ui-verification/reports/$(ls -t some-podcast-app/.ui-verification/reports | head -1)/report.md. Fix all failing CSS rules to match expected values. Design spec: some-podcast-app/visual/design.md."
   ```

2. **Run verification again** to confirm the agent fixed things correctly. Did new failures appear?

3. **Wire it to run automatically.** How would you modify the agent bridge so that when verification finishes with failures, it automatically feeds the report back to the agent and re-runs, looping until 0 failures or a max-retry limit? Think about: Where does the loop live? How do you prevent infinite retries? How does the extension know the difference between "first pass" and "retry #3"?

#### Show your demo, win a Bee!

If you're feeling brave, come demo your creation to the group. The best demo wins a **Bee Pioneer device**. Show us something creative, useful, or delightfully weird. Bonus points if it's something you'd actually ship to your team on Monday.

---

## Key Takeaways

The mental models to walk away with. These ideas apply far beyond the scope of this workshop.

1. **Human-agent collaboration is becoming visual.** The fundamental shift: instead of describing what's wrong in a ticket or chat message, you *show* the agent by pointing at the rendered output. This is what we mean by a "perception agent," an agent that shares the same visual surface as the human and acts on what it sees. The communication channel is the UI itself.

2. **Shared Perception.** The annotator extension creates this shared surface. You're not writing prose explaining where the problem is. You're clicking the exact rendered element and saying "this." The agent receives the DOM selector, the computed styles, and your plain-language feedback: everything it needs to act, with zero ambiguity about which element you mean.

3. **Annotation as a Primitive.** Natural gestures like clicking, circling, and typing "too big" replace lengthy text descriptions. This is the annotation primitive: structured feedback captured directly on the visual surface, with DOM selectors and computed styles attached automatically. It's faster and more precise than describing problems in prose.

4. **Verification as a Primitive.** The verification primitive automates the *mechanical* checking (comparing CSS values against a spec, running Gherkin flows that simulate user interactions) so the human doesn't have to eyeball every change. The human stays for the judgment calls: Is the spec itself right? Does the flow cover the right scenarios? Should we accept this tradeoff? Verification handles the tedious; the human handles the taste.

5. **The Harness Collapses the Mechanical Loop.** Traditional workflow: the agent writes code, the human manually inspects image-by-image, files a new request, and the cycle repeats slowly. The harness eliminates the mechanical half of that loop (the checking, the re-filing, the waiting). Annotate, generate, and verify happen in one click. The human still decides what's right; they just don't have to be the one clicking through every state to confirm it.

6. **Composing Primitives into Loops.** Neither annotation nor verification is powerful alone. The perception agent pattern is the composition: annotation captures intent precisely, the agent acts on it, verification confirms the result, and any remaining gap feeds the next annotation cycle. The human stays in the judgment loop, deciding what to fix and whether the fix is acceptable, while the grunt work (editing, checking, re-running) disappears.

---


## Troubleshooting

Common issues and quick fixes if something isn't working.

| Symptom                                | Fix                                                                    |
| ----------------------------------------| ------------------------------------------------------------------------|
| Extension not appearing                | Reload at chrome://extensions, check for console errors                |
| "Apply changes" → "Bridge not running" | Start your agent bridge on port 9999                                   |
| AI agent not found                     | Ensure `claude` or `kiro-cli` is in PATH and authenticated             |
| Verification auth error                | `export NOVA_ACT_API_KEY="..."`                                        |
| Hot-reload not working                 | Confirm `npm run dev` is still running                                 |
| Extension changes not showing          | Reload extension at chrome://extensions after editing content.js       |
| CORS errors                            | Your agent bridge must return `Access-Control-Allow-Origin: *` headers |

---
