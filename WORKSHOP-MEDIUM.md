# Challenge: MEDIUM | Two Code Hints

> [← Back to main workshop](WORKSHOP.md#ai-powered-ui-verification-challenge)

---

You have decided to take up the challenge! That's awesome!

Let's walk through what is available to you. You get two high-level hints to point you in the right direction, plus detailed code if you get stuck. You build the same automation pipeline as the [Easy](WORKSHOP-EASY.md#challenge-easy--full-walkthrough) path, but with less hand-holding.

To help you get started, here is the architecture of the full solution:
## Architecture (what the full solution looks like)
Here's how all the pieces connect end-to-end. This is the target architecture you're working toward.

```
┌─────────────────────┐     POST /api/apply       ┌──────────────────┐
│  Chrome Extension   │ ────────────────────────▶ │   Agent Bridge   │
│  + Apply Changes    │                           │  (port 9999)     │
│button(you add this) |                           |                  |
|                     │◀──poll /api/apply/status──│                  │
└─────────────────────┘                           └────────┬─────────┘
                                                           │
                                              ┌────────────┴────────────┐
                                              │                         │
                                    ┌─────────▼───────────┐   ┌─────────▼──────────┐
                                    │   AI Coding Agent   │   │   Verification     │
                                    │ (claude / kiro-cli) │   │ verify-with-nova-  │
                                    │                     │   │ act.py             │
                                    │  Edits src/*.css    │   │  CSS checks +      │
                                    │                     │   │  Flow assertions   │
                                    └─────────────────────┘   └────────────────────┘
```

You just annotate a webpage, hit "Apply Changes," and the extension handles the rest: posting annotations to the bridge, which invokes the AI agent, then automatically runs verification. The button polls for status so you can watch it progress or just ignore it until it's done.

---
## The two things you need to build

| # | What | Where | Key idea |
|---|------|-------|----------|
| 1 | **"Apply Changes" button** | `tools/extension/content.js` | Collect the annotations array, POST them to `http://localhost:9999/api/apply`, then poll `/api/apply/status` every 3 seconds until it returns `"done"` or `"error"`. |
| 2 | **Status polling + feedback** | Same file, defined before the button | Show the user what's happening (applying → verifying → done/failed) and surface the verification report link when it's ready. |

The agent bridge (`tools/agent-bridge/agent-bridge.js`) is already built; you don't need to write the server. You just need to wire the extension to talk to it.

**Quick checklist before you start:**
- Add `"host_permissions": ["http://localhost:*/*"]` to `tools/extension/manifest.json`
- Find the line `state.sidebarEl.appendChild(exportBtn);` in `content.js` (around line 244). That's where your code goes
- After editing, reload the extension at `chrome://extensions`

---

## Detailed hints (open when stuck)

<details>
<summary><strong>Hint 1: The Apply button</strong></summary>

In `tools/extension/content.js`, the sidebar is built around line 261. After `state.sidebarEl.appendChild(exportBtn);`, add a button that POSTs annotations to the agent bridge.

```javascript
// Add this after: state.sidebarEl.appendChild(exportBtn);
var applyBtn = document.createElement("button");
    applyBtn.className = "annot-sidebar-export";
    applyBtn.textContent = "Apply changes";
    applyBtn.style.cssText = "background:#5A969E;color:#fff;margin-top:6px;";
    applyBtn.addEventListener("click", function () {
      // Don't do anything if there are no annotations yet
      if (state.annotations.length === 0) return;

      // Safety check: only allow on localhost (not on live websites)
      if (!window.location.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
        applyBtn.textContent = "Local apps only";
        applyBtn.style.background = "#8B3A3A";
        setTimeout(function () { applyBtn.textContent = "Apply changes"; applyBtn.style.background = "#5A969E"; }, 3000);
        return;
      }

      // Disable button and show loading state
      applyBtn.disabled = true; applyBtn.innerHTML = "<span class='annot-spinner'>⏳</span> Applying...";
      applyBtn.style.background = "#3A6778";

      // POST annotations to the agent bridge which invokes the AI agent
      fetch("http://localhost:9999/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotations: state.annotations, url: window.location.href })
      }).then(function (r) { return r.json(); }).then(function (data) {
        if (!data.ok) {
          applyBtn.textContent = "Error";
          applyBtn.style.background = "#8B3A3A";
          setTimeout(function () { applyBtn.textContent = "Apply changes"; applyBtn.style.background = "#5A969E"; applyBtn.disabled = false; }, 3000);
          return;
        }
        // Job accepted — start polling for status
        pollApplyStatus(applyBtn);
      }).catch(function () {
        applyBtn.textContent = "Bridge not running";
        applyBtn.style.background = "#8B3A3A";
        setTimeout(function () { applyBtn.textContent = "Apply changes"; applyBtn.style.background = "#5A969E"; applyBtn.disabled = false; }, 4000);
      });
    });
    state.sidebarEl.appendChild(applyBtn);

```

</details>

<details>
<summary><strong>Hint 2: Status polling</strong></summary>

The agent bridge progresses through statuses: `"running"` → `"verifying"` → `"done"` (or `"error"`). You need a function that polls every 3 seconds and updates the button.

Add this **before** the Apply button code (the function must be defined before it's called):

```javascript
// ── Poll the agent bridge for apply job status ──
    // Called after successfully POSTing annotations to /api/apply.
    // Checks every 3 seconds until the job completes or fails.
    function pollApplyStatus(btn) {
      var pollInterval = setInterval(function () {
        fetch("http://localhost:9999/api/apply/status").then(function (r) { return r.json(); }).then(function (s) {

          // Agent is still editing source files
          if (s.status === "running") {
            btn.innerHTML = "<span class='annot-spinner'>⏳</span> Applying...";

          // Agent finished edits; Nova Act verification is running
          } else if (s.status === "verifying") {
            btn.innerHTML = "<span class='annot-spinner'>⏳</span> Running verification...";

          // Everything succeeded — show results
          } else if (s.status === "done") {
            clearInterval(pollInterval);
            btn.textContent = "✓ Changes applied";
            btn.style.background = "#2E7D32";
            btn.disabled = false;

            // Add a "View Report" button if the agent bridge returned a report path
            if (s.reportPath && !state.sidebarEl.querySelector("[data-role='view-report']")) {
              var vrBtn = document.createElement("button");
              vrBtn.className = "annot-sidebar-export";
              vrBtn.dataset.role = "view-report";
              vrBtn.dataset.reportPath = s.reportPath;
              vrBtn.textContent = "View Report";
              vrBtn.style.cssText = "background:#2E7D32;color:#fff;margin-top:6px;";
              vrBtn.addEventListener("click", function () { window.open("http://localhost:9999/api/report/view"); });
              if (btn.parentNode) btn.parentNode.insertBefore(vrBtn, btn.nextSibling);
            }
            // Update existing report button if re-running
            var existingReport = state.sidebarEl.querySelector("[data-role='view-report']");
            if (existingReport && s.reportPath) {
              existingReport.style.display = "block";
              existingReport.dataset.reportPath = s.reportPath;
            }

            // Add a "Reset" button to clear annotations and start fresh
            if (!state.sidebarEl.querySelector("[data-role='reset-btn']")) {
              var rstBtn = document.createElement("button");
              rstBtn.className = "annot-sidebar-export";
              rstBtn.dataset.role = "reset-btn";
              rstBtn.textContent = "Reset";
              rstBtn.style.cssText = "background:#4A4A4A;color:#ccc;margin-top:6px;font-size:12px;";
              rstBtn.addEventListener("click", function () {
                state.annotations.length = 0;
                fetch("http://localhost:9999/api/feedback", { method: "DELETE" }).catch(function () {});
                I.rebuildSidebar(state);
              });
              state.sidebarEl.appendChild(rstBtn);
            }

            // Show a toast notification in the bottom-right corner
            var notification = document.createElement("div");
            notification.style.cssText = "position:fixed;bottom:20px;right:20px;background:#1A1A1A;border:1px solid #5A969E;border-radius:8px;padding:12px 16px;color:#E8E8E8;font-family:-apple-system,sans-serif;font-size:13px;z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,0.4);";
            notification.innerHTML = "<div style='font-weight:600;margin-bottom:6px;'>✓ Changes applied & verified</div>" +
              (s.reportPath ? "<a href='http://localhost:9999/api/report/view' style='color:#5A969E;text-decoration:underline;font-size:12px;' target='_blank'>View verification report</a>" : "<span style='font-size:12px;color:#6C7778;'>No report generated</span>");
            var closeNotif = document.createElement("span");
            closeNotif.textContent = "×"; closeNotif.style.cssText = "position:absolute;top:8px;right:10px;cursor:pointer;color:#6C7778;font-size:16px;";
            closeNotif.addEventListener("click", function () { notification.remove(); });
            notification.appendChild(closeNotif);
            document.body.appendChild(notification);
            setTimeout(function () { notification.remove(); }, 15000);

          // Agent or verification failed
          } else if (s.status === "error") {
            clearInterval(pollInterval);
            btn.textContent = "Failed";
            btn.style.background = "#8B3A3A";
            setTimeout(function () { btn.textContent = "Apply changes"; btn.style.background = "#5A969E"; btn.disabled = false; }, 4000);

          // Job was never started (shouldn't normally happen)
          } else if (s.status === "idle") {
            clearInterval(pollInterval);
            btn.textContent = "Not started";
            btn.style.background = "#8B3A3A";
            setTimeout(function () { btn.textContent = "Apply changes"; btn.style.background = "#5A969E"; btn.disabled = false; }, 4000);
          }
        }).catch(function () {});
      }, 3000);
    }
```

</details>


---

## Running the pipeline

1. The extension's content script runs on the page you're annotating (e.g., `http://localhost:5173`), but the `Apply Changes` button needs to `fetch()` the agent bridge at `http://localhost:9999`. That's a cross-origin request. Chrome's Manifest V3 blocks it unless you explicitly declare `host_permissions` for the target origin — without this, the Apply button silently fails and can never talk to the bridge.
Open `tools/extension/manifest.json`. Find the closing section:
```json
  "background": {
    "service_worker": "background.js"
  }
}
```
Add `host_permissions` **after** the `background` block (before the final `}`):

```json
  "background": {
    "service_worker": "background.js"
  },
  "host_permissions": ["http://localhost:*/*"]
}
```
2. Reload the extension at `chrome://extensions`
3. Start the agent bridge:
```bash
node tools/agent-bridge/agent-bridge.js \
  --port 9999 \
  --feedback .tmp/feedback.json \
  --app-dir thinking-cap-podcast-app
```
The parameters that passed in the above command are:
| Flag | What it does |
|------|--------------|
| `--port 9999` | Port the bridge listens on. The extension POSTs annotations here. |
| `--feedback .tmp/feedback.json` | Where the bridge writes the annotations JSON so the AI CLI can read them. |
| `--app-dir thinking-cap-podcast-app` | Your app's workspace root. The bridge runs the AI CLI and verification inside this directory. |

To use Claude Code instead of the default (Kiro):
```bash
node tools/agent-bridge/agent-bridge.js ... --cli claude
```
You should see:
```
[agent-bridge] Using CLI: kiro-cli  # or claude
[agent-bridge] Listening on http://localhost:9999
```

5. Annotate elements on the browser and click "Apply Changes"

### Sample changes to make

| #   | Element to click                   | What to type                                                 |
| -----| ------------------------------------| --------------------------------------------------------------|
| 1   | "The Thinking Cap Podcast" heading | "Change this font to a serif font"                           |
| 2   | The published date                 | "The published date should be July 3, 2026"                  |
| 3   | A play button on any episode       | "Make the play buttons slightly smaller"                     |
| 4   | A footer link                      | "Change the footer link color to match the hero badge color" |


### What happens next

The agent bridge will:
- Invoke the AI agent with your annotations + the design spec
- Agent edits source files (`src/App.css`, `src/index.css`, `src/App.jsx`)
- Dev server hot-reloads the page
- Verification runs automatically
- Button shows "✓ Changes applied" when done

All activity is logged to the `logs/` folder inside your app directory:

```
thinking-cap-podcast-app/logs/
├── cli/                    ← AI agent invocation logs
│   └── 2026-06-25_14-30-00_abc123.log
└── nova_act/               ← Nova Act SDK verification logs
    └── ...
```

| Directory        | What's logged                                                                                                                                  |
| ------------------| ------------------------------------------------------------------------------------------------------------------------------------------------|
| `logs/cli/`      | Full stdout/stderr from the AI CLI (kiro-cli or claude). Shows what the agent did, files it edited, and any errors. One log per apply session. |
| `logs/nova_act/` | Nova Act SDK traces from the verification step. Shows browser actions, page navigations, and assertion evaluations during flow checks.         |

If something goes wrong, check `logs/cli/` first — the most recent file will show whether the agent succeeded or hit an error.

### Check the report

Once the button turns green, open the generated verification report:

```
thinking-cap-podcast-app/.ui-verification/reports/<timestamp>/report.md
```

You can also click **"View Report"** in the extension sidebar. The report shows a summary table like this:


| Category             | Rules   | Passed  | Failed | Pass Rate |
| ----------------------| ---------| ---------| --------| -----------|
| Component Rules      | 23      | 23      | 0      | 100.0%    |
| Visual Style         | 51      | 48      | 3      | 94.1%     |
| Project Rules        | 21      | 20      | 1      | 95.2%     |
| Platform Conventions | 16      | 16      | 0      | 100.0%    |
| **Total**            | **121** | **107** | **14** | **88.4%** |


Each failure includes the rule name, selector, expected value, actual value, and a brief analysis, so you know exactly what's still off.

The report also includes **flow verification**: Gherkin scenarios that test interactive behavior (navigation, scrolling, content assertions):

| Flow            | Scenarios | Status   |
| -----------------| -----------| ----------|
| podcast-landing | 18 steps  | ✅ Passed |


---
## Expected Time to Complete this Hands-on Exercise

Most people complete this in about **30 minutes**. If you're flying through it, check out the [Bonus Challenge](WORKSHOP.md#bonus-challenge-10-mins).

> [← Back to main workshop](WORKSHOP.md#ai-powered-ui-verification-challenge)
