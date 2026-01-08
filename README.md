# Pocket SRE (AI Incident Helper)

Pocket SRE is a simple chat web app that helps you troubleshoot a website incident and **remembers your stack and past incidents** per session. It’s built with:

- **Cloudflare Pages**: static chat UI (`web/`)
- **Cloudflare Worker**: API endpoint (`POST /api/chat`) (`worker/`)
- **Durable Objects**: per-session coordination + persistent memory (`worker/src/durable/SessionDO.ts`)
- **Workers AI**: LLM calls via `env.AI` (recommended: Llama 3.3)

## What it does

- Chat UI in the browser.
- Each browser gets a **sessionId** (stored in `localStorage`), sent with every request.
- A **Durable Object per session** stores:
  - `messages[]` (chat history)
  - `profile` (tech stack, domain, notes)
  - `lastIncidentSummary`
  - `summary` (running conversation summary)
- Multi-step flow inside the Durable Object:
  - Parse the user message into structured incident JSON
  - Decide whether to ask a clarifying question (**max 2**) or produce a final answer
  - Final answer includes:
    - prioritized runbook checklist (3–7 steps)
    - 3 likely root causes (with confidence)
    - a short status update message (1–2 paragraphs)
  - After final answer: store compact summary + update profile
- Token usage kept small by summarizing older conversation when history grows beyond ~12 messages.

## Repo layout

```
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
```

## Prerequisites

- A Cloudflare account with:
  - **Workers** enabled
  - **Durable Objects** enabled
  - **Workers AI** enabled (for the `AI` binding)
- Node.js 18+ (or newer)
- Wrangler installed via the project `devDependencies` (no global install required)

## Local development (copy/paste)

### Terminal 1 — Worker API

```bash
cd worker
npm install
npx wrangler login
npm run dev
```

Wrangler will print a local URL (typically `http://127.0.0.1:8787`).

**Important (Workers AI + dev):** because `env.AI` is a **remote** binding, Wrangler will start a remote proxy session during `npm run dev`. If you see an error about registering a `workers.dev` subdomain, complete the one-time onboarding link Wrangler prints (Cloudflare dashboard), then re-run `npm run dev`.

### Terminal 2 — Static web UI

No build step required. Use any static server:

```bash
cd web
npx --yes http-server -p 8788 .
```

Then open:

- `http://localhost:8788`

The frontend defaults to calling:

- `http://localhost:8787/api/chat`

## Deploy

### 1) Deploy the Worker

```bash
cd worker
npm install
npm run deploy
```

### 2) Deploy the Pages site

This repo’s `web/` folder is static and can be deployed to Cloudflare Pages:

- **Build command**: (none)
- **Output directory**: `web`

After deploying Pages, update the Worker URL in `web/app.js` (see `WORKER_ORIGIN` constant).

## Configuration notes

### Workers AI model

Workers AI model IDs can change over time. This project:

- **Defaults** to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (as shown in Cloudflare Agents examples)
- Lets you override it by setting an environment variable:
  - `LLM_MODEL` in `worker/wrangler.toml` under `[vars]`

### CORS

The Worker includes CORS handling so the Pages frontend can call it.

### Workers AI local auth (important)

Even in local development, **Workers AI calls your Cloudflare account** (and can incur charges), so you must be authenticated for `wrangler dev` to call `env.AI`.

You can do either:

- **Browser login**: run `npx wrangler login`, then restart `npm run dev`
- **API token** (non-browser): set `CLOUDFLARE_API_TOKEN` in your shell, then run `npm run dev`

## References

- Cloudflare Agents docs: [Agents · Cloudflare docs](https://developers.cloudflare.com/agents/?utm_content=agents.cloudflare.com)
- Overview site: `https://agents.cloudflare.com/`

## API

### `POST /api/chat`

Request body:

```json
{ "sessionId": "string", "message": "string" }
```

Response body:

```json
{ "reply": "string", "profile": { "techStack": [], "domain": "", "notes": "" } }
```

## Example prompts to try

- “Users are seeing 502s from Cloudflare for my site. Started 10 minutes ago.”
- “My checkout endpoint is slow; p95 is 8s. We’re on Next.js + Postgres.”
- “We deployed 30 mins ago and now login intermittently fails.”


