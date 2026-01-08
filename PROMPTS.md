# PROMPTS.md

## Prompt #1 (verbatim)

```
You are building an ORIGINAL mini-project for a Cloudflare intern application optional assignment.

NON-NEGOTIABLE TASK REQUIREMENTS (must comply):
- The repository name must be prefixed with: cf_ai_
- Must include a README.md with clear project documentation and step-by-step running instructions (local + deploy).
- Must include PROMPTS.md containing ALL AI prompts used to build the project (AI-assisted coding encouraged). Start PROMPTS.md by pasting this entire Cursor prompt as Prompt #1, then append additional prompts you “would have used” while coding (keep them realistic).
- The app must include:
  1) LLM: use Cloudflare Workers AI, recommend Llama 3.3 (use Workers AI binding).
  2) Workflow/coordination: use Durable Objects (required) to coordinate a multi-step flow.
  3) User input: chat UI via Cloudflare Pages.
  4) Memory/state: store chat history + a small “user profile” in Durable Object persistent storage.
- All work must be original. Do not copy from other submissions.

PROJECT IDEA (implement exactly):
Name: Pocket SRE (AI Incident Helper)
A chat web app that helps troubleshoot a website incident and remembers the user’s stack and past incidents.
Features:
- Chat UI in Pages (simple, clean).
- Backend Worker API endpoint: POST /api/chat
- Durable Object per session stores:
  - conversation messages (role/content)
  - user profile (tech stack, domain, notes)
  - last incident summary
- Multi-step flow coordinated by Durable Object:
  - Parse the user message into structured incident JSON (type, severity guess, timeframe, symptoms, stack hints).
  - Decide whether to ask a clarifying question (max 2) OR produce a final response.
  - Final response includes:
    1) a prioritized runbook checklist (3–7 steps)
    2) 3 likely root causes (with confidence)
    3) a short status update message (1–2 paragraphs)
  - After final response, store a compact summary into memory and update the user profile.
- Keep token usage small:
  - Summarize older conversation when it grows beyond ~12 messages (create a running summary string and keep last 6 turns).

TECH STACK / IMPLEMENTATION CONSTRAINTS:
- Use TypeScript.
- Minimal dependencies.
- Frontend can be plain HTML + vanilla JS (preferred for simplicity) built as a Pages static site.
- Use Wrangler for Worker + Durable Object.
- Workers AI: call Llama 3.3 via Cloudflare AI binding (use env.AI).
- Provide sensible error handling, input validation, and CORS so Pages can call the Worker.
- Provide a single command path to run locally (two terminals is fine).
- Include an obvious “session id” mechanism:
  - Generate a sessionId in the browser and store in localStorage.
  - Send sessionId with every request; Worker routes to the Durable Object instance for that sessionId.

DELIVERABLES:
Create the full repo structure and all files. Output the complete contents of every file you create/update.

REPO STRUCTURE (create exactly):
cf_ai_pocket_sre/
  README.md
  PROMPTS.md
  worker/
    package.json
    tsconfig.json
    wrangler.toml
    src/
      index.ts
      durable/
        SessionDO.ts
      lib/
        prompts.ts
        types.ts
  web/
    index.html
    app.js
    styles.css

DETAILED BUILD INSTRUCTIONS:
1) Build Worker:
- worker/package.json scripts:
  - dev: wrangler dev
  - deploy: wrangler deploy
- wrangler.toml must define:
  - name
  - main
  - compatibility_date
  - durable_objects bindings
  - AI binding (e.g., [ai] binding = "AI" if supported by wrangler format you choose)
2) Build Pages:
- web is static; no build step required.
- app.js calls the Worker endpoint URL.
- For local dev, app.js should default to http://localhost:8787/api/chat
- For production, instruct user to set WORKER_URL in app.js (or detect via a simple constant at top).
3) Memory/state:
- Durable Object uses this.storage (persistent).
- Store: messages[], profile{}, summary string.
4) LLM prompting:
- Put prompts in worker/src/lib/prompts.ts
- Use a system prompt that forces concise, actionable output.
- Use JSON extraction prompt for incident parsing.
- Ensure the LLM responses are safe and do not instruct illegal actions.

FUNCTIONAL REQUIREMENTS (acceptance checklist):
- Opening web/index.html shows a chat UI with input + send.
- Sending a message returns a response from the Worker.
- Refreshing the page keeps memory (same sessionId) and the assistant remembers prior context.
- After a few messages, older history is summarized (prove by storing and using summary).
- README includes:
  - What it is
  - Architecture (Pages + Worker + Durable Object + Workers AI)
  - Local run instructions
  - Deployment instructions
  - Example prompts to try
- PROMPTS.md includes Prompt #1 (this entire prompt) + additional prompts that reflect iterative development.

NOW DO THE WORK:
- Create every file listed.
- Implement Worker routes:
  - POST /api/chat: { sessionId, message }
  - Return { reply, profile }.
- Implement Durable Object that:
  - loads state
  - appends user message
  - decides askQuestion vs finalAnswer
  - calls Workers AI via env.AI
  - updates storage
- Implement simple frontend (HTML/CSS/JS):
  - message list
  - typing indicator
  - stores sessionId in localStorage
- In README, include clear “copy/paste” commands and any Cloudflare prerequisites (Workers AI enabled).
- Output all code and docs in full.
```

## Prompt #2

```
Create a Cloudflare Worker in TypeScript with a POST /api/chat endpoint and CORS handling. Route each request to a Durable Object instance chosen by sessionId (idFromName), and return JSON errors for invalid input.
```

## Prompt #3

```
Design the Durable Object state schema for a per-session chat assistant:
- Persist messages (role/content), a compact user profile (techStack/domain/notes), a running summary string, and a lastIncidentSummary string.
- Implement a token-saving summarization strategy: if messages exceed ~12 entries, summarize older messages into summary and keep only the last 6.
```

## Prompt #4

```
Implement a multi-step incident flow in the Durable Object:
1) Parse user message into strict JSON (incident type, severity guess, timeframe, symptoms, stack hints).
2) Decide whether to ask a clarifying question (max 2) or produce a final answer.
3) If final: return a prioritized runbook checklist (3–7), 3 likely root causes with confidence, and a short status update message.
4) After final: update stored summary/profile/lastIncidentSummary.
```

## Prompt #5

```
Write minimal, safe prompts for Workers AI (Llama 3.3) that:
- Force concise, actionable troubleshooting output
- Enforce strict JSON output for incident parsing and profile updates
- Avoid unsafe/illegal instructions
```

## Prompt #6

```
Build a clean static chat UI with HTML/CSS/vanilla JS:
- Generate a sessionId in the browser and store it in localStorage
- Send {sessionId, message} to the Worker endpoint
- Show a typing indicator while waiting
- Render assistant replies with readable formatting
```


