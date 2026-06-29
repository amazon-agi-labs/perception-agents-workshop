# Challenge: EASY | Full Walkthrough

> [← Back to main workshop](WORKSHOP.md#ai-powered-ui-verification-challenge)

## Let's understand what we need to build first and why?

The UI annotator Chrome extension runs in the browser. The AI coding agent (Kiro CLI / Claude Code) runs in a terminal. There's no direct connection between them because a Chrome extension can't spawn shell processes, execute Python scripts, or edit files on disk. It can only make HTTP requests.

This is why, you need something like an **agent bridge** that is a local HTTP server that connects the two:

```
┌─────────────────────┐       HTTP       ┌-──────────────────┐       shell      ┌─────────────────-─┐
│ Chrome Extension    │ ───────────────▶ │  Agent Bridge     │ ───────────────▶ │  AI CLI + Verify  │
│                     │                  │                   │                  │                   │
│ + code for applying │                  │   (port 9999)     │                  │   (terminal)      │
│   annotations with  │                  │                   │                  │                   │
│   the 'Apply changes│ ◀─── poll status │                   │                  │                   │
│   button'           │                  │                   │                  │                   │
└─────────────────────┘                  └───────────────────┘                  └───────────────────┘
```
The agent bridge is already built for you at `tools/agent-bridge/agent-bridge.js`. Your job is to connect the extension to it by adding an "Apply Changes" button that kicks off the full pipeline: the bridge receives the annotations, invokes the AI CLI to edit the code, then runs verification via `tools/verify-with-nova-act.py`. We use a standalone verification script here rather than the chat based UI verification skills because the AI CLI session is too short-lived to run the full verification loop and report results back to the bridge.

### What each file does

| File | Role |
|------|------|
| `agent-bridge.js` | HTTP server. Receives annotations via `POST /api/apply`, invokes the AI CLI, waits for hot-reload, runs verification, reports status via `GET /api/apply/status`. |
| `verify-with-nova-act.py` | Loads CSS rules from `.ui-verification/specs/`, opens a headless browser via Nova Act SDK, checks computed styles against expected values, runs Gherkin flow assertions, writes a markdown report. |

### The flow when you click "Apply Changes"

1. Extension POSTs annotations to the bridge at `/api/apply`
2. Bridge builds a prompt and shells out to the AI CLI:
  ```bash
  # DON'T RUN THIS! THIS IS JUST ILLUSTRATIVE SAMPLE CODE
  # Kiro
   kiro-cli chat -a --no-interactive --effort max "$(cat .tmp/apply-prompt.txt)"
  # Claude
   claude --dangerously-skip-permissions -p "$(cat /absolute/path/to/.tmp/apply-prompt.txt)"
   ```
3. CLI edits source files → Vite hot-reloads the page
4. Bridge polls the dev server to confirm it's responding
5. Bridge runs verification:
   ```bash
   # DON'T RUN THIS! THIS IS JUST ILLUSTRATIVE SAMPLE CODE
   python3 tools/agent-bridge/verify-with-nova-act.py --app-dir some-podcast-app --url http://localhost:5173
   ```
6. Bridge writes `{status: "done", reportPath: "..."}` to a status file
7. Extension polls `/api/apply/status`, sees `"done"`, shows success + report link

### Key endpoints

| Endpoint | Method | What it does |
|----------|--------|--------------|
| `/api/apply` | POST | Extension sends annotations here. Body: `{ annotations: [...], url: "http://localhost:5173" }`. Returns `{ ok: true }`. |
| `/api/apply/status` | GET | Extension polls this every 3 seconds. Returns `{ status: "running" | "verifying" | "done" | "error", reportPath?: "..." }`. |

Without the bridge, you'd have to manually copy annotations from the extension, paste them into a terminal, wait for the agent to finish, then run the verification script or invoke the UI verification skills from the IDE yourself. The bridge automates that entire loop into a single button click.

---

## Let's wire it up

### Step 1: Add localhost permission to the extension

The extension's content script runs on the page you're annotating (e.g., `http://localhost:5173`), but the `Apply Changes` button needs to `fetch()` the agent bridge at `http://localhost:9999`. That's a cross-origin request. Chrome's Manifest V3 blocks it unless you explicitly declare `host_permissions` for the target origin — without this, the Apply button silently fails and can never talk to the bridge.

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

### Step 2: Add the Apply button to the extension

Open `tools/extension/content.js`. Find the line (around line 261):

```javascript
    state.sidebarEl.appendChild(exportBtn);
    document.body.appendChild(state.sidebarEl);
```

Add this code **between** those two lines (after `appendChild(exportBtn)`, before `appendChild(state.sidebarEl)`):

**NOTE**: if you are using `vi`, you may run into issues pasting in the code below due to its size. You can either paste it in smaller chunks, or use a different editor like `nano` or using an IDE.

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

    // ── Create the "Apply changes" button ──
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

**Reload the extension** at `chrome://extensions` (click the refresh icon on the extension card in the `My Extensions` page). You might need to close and open the extension again if you already have it open for the changes to be reflected.

---

## Start the pipeline

Now that the extension can talk to localhost, start the agent bridge and use it.

### Step 3: Start the agent bridge

```bash
node tools/agent-bridge/agent-bridge.js \
  --port 9999 \
  --feedback .tmp/feedback.json \
  --app-dir some-podcast-app
```
The parameters that passed in the above command are:
| Flag | What it does |
|------|--------------|
| `--port 9999` | Port the bridge listens on. The extension POSTs annotations here. |
| `--feedback .tmp/feedback.json` | Where the bridge writes the annotations JSON so the AI CLI can read them. |
| `--app-dir some-podcast-app` | Your app's workspace root. The bridge runs the AI CLI and verification inside this directory. |
---
Default AI CLI is Kiro and if you are using Claude Code add the `--cli claude` at the end:
```bash
node tools/agent-bridge/agent-bridge.js ... --cli claude
```

You should see:
```
[agent-bridge] Using CLI: kiro # or claude
[agent-bridge] Listening on http://localhost:9999
```

### Step 4: Annotate and apply

Open http://localhost:5173 in Chrome.

Note, if you need to restart your local server, you can do so with this:
```javascript
cd some-podcast-app
npm install && npm run dev
```

Use the extension to annotate elements that need changes. Point at each element and describe what you want in plain language. The AI agent figures out the rest using the design spec.

### Sample changes to make

| # | Element to click | What to type |
|---|-----------------|--------------|
| 1 | "Some Podcast" heading | "Change this font to a serif font" |
| 2 | The published date | "The published date should be July 3, 2026" |
| 3 | A play button on any episode | "Make the play buttons slightly smaller" |
| 4 | A footer link | "Change the footer link color to match the hero badge color" |

### How to annotate

1. Click the extension icon → "Annotate Current Page"
2. Switch to **Element** mode
3. Click the element you want to change
4. Type your feedback (see table above)
5. Click **Save**
6. Repeat for each change
7. Click **Apply Changes**

### What happens next

The agent bridge will:
- Invoke the AI agent with your annotations + the design spec
- The agent will edit the source files (`src/App.css`, `src/index.css`, `src/App.jsx`)
- Reload the dev server and reload the podcast landing page
- Run the verification checks
- Button shows "✓ Changes applied" when done

The entire flow takes ~5 minutes to complete so hang tight while it is doing all of the work!

### Step 5: Check the report

Once the `Apply Changes` button turns green, the work is done. Open the generated verification report:

```
some-podcast-app/.ui-verification/reports/<timestamp>/report.md
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

| Flow | Scenarios | Status |
|------|-----------|--------|
| podcast-landing | 18 steps | ✅ Passed |


---

## Optional: Add a spinner animation

For a polished loading indicator on the Apply button, open `tools/extension/content.css` and add this at the very end:

```css
/* Hourglass spinning animation for loading states */
@keyframes annot-hourglass-spin {
  0% { transform: rotate(0deg); }
  50% { transform: rotate(180deg); }
  100% { transform: rotate(360deg); }
}
.annot-sidebar-export .annot-spinner {
  display: inline-block;
  animation: annot-hourglass-spin 1.5s ease-in-out infinite;
}
```

This makes the hourglass emoji spin while the agent bridge is processing.

---

## Expected Time to Complete this Hands-on Exercise

Most people complete this in about **15 minutes**. If you're flying through it, check out the [Bonus Challenge](WORKSHOP.md#bonus-challenge-10-mins).


> [← Back to main workshop](WORKSHOP.md#ai-powered-ui-verification-challenge)
