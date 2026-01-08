import type { Env } from "../index";
import {
  decisionPrompt,
  finalAnswerPrompt,
  incidentParsePrompt,
  memoryUpdatePrompt,
  summarizePrompt,
  SYSTEM_PROMPT,
} from "../lib/prompts";
import {
  defaultProfile,
  type ChatMessage,
  type Decision,
  type IncidentParse,
  type StoredState,
  type UserProfile,
} from "../lib/types";

type AiChatMessage = { role: "system" | "user" | "assistant"; content: string };

const STORAGE_KEY = "state";

const MAX_MESSAGES_BEFORE_SUMMARY = 12;
const KEEP_LAST_MESSAGES = 6; // keep last 6 messages (user+assistant turns)
const MAX_CLARIFYING_QUESTIONS = 2;

function now(): number {
  return Date.now();
}

function safeString(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function safeStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => safeString(v)).filter(Boolean);
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  // Common failure mode: markdown fences
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  // First try: full-string JSON
  try {
    return JSON.parse(unfenced);
  } catch {
    // Best-effort fallback: find the first {...} region.
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object found");
    const slice = unfenced.slice(start, end + 1);
    return JSON.parse(slice);
  }
}

function asIncidentParse(x: unknown): IncidentParse {
  const obj = (x ?? {}) as Record<string, unknown>;
  const severity = safeString(obj.severity_guess);
  const allowed = new Set(["low", "medium", "high", "critical", "unknown"]);
  return {
    type: safeString(obj.type) || "unknown",
    severity_guess: (allowed.has(severity) ? severity : "unknown") as IncidentParse["severity_guess"],
    timeframe: safeString(obj.timeframe),
    symptoms: safeStringArray(obj.symptoms),
    stack_hints: safeStringArray(obj.stack_hints),
  };
}

function asDecision(x: unknown): Decision {
  const obj = (x ?? {}) as Record<string, unknown>;
  const action = safeString(obj.action);
  if (action === "clarify") {
    const q = safeString(obj.question).trim();
    if (!q) throw new Error("Clarify decision missing question");
    return { action: "clarify", question: q };
  }
  return { action: "final" };
}

function asProfile(x: unknown): UserProfile {
  const obj = (x ?? {}) as Record<string, unknown>;
  const base = defaultProfile();
  const techStack = safeStringArray(obj.techStack);
  const domain = safeString(obj.domain);
  const notes = safeString(obj.notes);
  return {
    techStack: Array.from(new Set([...base.techStack, ...techStack])).slice(0, 24),
    domain: domain.slice(0, 256),
    notes: notes.slice(0, 800),
  };
}

function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export class SessionDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  private async load(): Promise<StoredState> {
    const stored = (await this.state.storage.get<StoredState>(STORAGE_KEY)) ?? null;
    if (stored) return stored;
    return {
      messages: [],
      summary: "",
      profile: defaultProfile(),
      lastIncidentSummary: "",
      clarifyingQuestionsAsked: 0,
    };
  }

  private async save(s: StoredState): Promise<void> {
    await this.state.storage.put(STORAGE_KEY, s);
  }

  private model(): string {
    return this.env.LLM_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  }

  private isDebug(): boolean {
    return (this.env.DEBUG || "").toLowerCase() === "true";
  }

  private async aiText(messages: AiChatMessage[]): Promise<string> {
    const model = this.model();
    try {
      const timeoutMs = 25_000;
      const out = await Promise.race([
        this.env.AI.run(model, { messages }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`AI timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      // Agents docs show { response }, but other models sometimes return { result } etc.
      const anyOut = out as unknown as { response?: unknown; result?: unknown; text?: unknown };
      const payload = anyOut.response ?? anyOut.result ?? anyOut.text;

      // Some Workers AI responses return structured objects (already-parsed JSON).
      if (typeof payload === "string") {
        if (!payload.trim()) {
          console.error("[SessionDO] Unexpected AI output shape:", model, out);
          throw new Error("Empty/invalid AI response shape");
        }
        return payload.trim();
      }
      if (payload && typeof payload === "object") {
        return JSON.stringify(payload);
      }

      console.error("[SessionDO] Unexpected AI output shape:", model, out);
      throw new Error("Empty/invalid AI response shape");
    } catch (err) {
      console.error("[SessionDO] AI.run failed:", model, `${err}`);
      throw err;
    }
  }

  private async aiJson(messages: AiChatMessage[]): Promise<unknown> {
    const first = await this.aiText(messages);
    try {
      return extractJsonObject(first);
    } catch (err) {
      // Retry once with a hard correction prompt.
      console.error("[SessionDO] JSON parse failed, retrying once:", `${err}`, clampText(first, 500));
      const retry = await this.aiText([
        messages[0] ?? { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Your previous response was invalid. Return ONLY valid JSON matching the requested schema. No markdown.\n\nPrevious response:\n" +
            first,
        },
      ]);
      return extractJsonObject(retry);
    }
  }

  private toRecentMessages(messages: ChatMessage[]): { role: "user" | "assistant"; content: string }[] {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }

  private async maybeSummarize(s: StoredState): Promise<StoredState> {
    if (s.messages.length <= MAX_MESSAGES_BEFORE_SUMMARY) return s;

    const keep = s.messages.slice(-KEEP_LAST_MESSAGES);
    const summarizeThese = s.messages.slice(0, Math.max(0, s.messages.length - KEEP_LAST_MESSAGES));

    try {
      const summaryText = await this.aiText([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: summarizePrompt({
            previousSummary: s.summary,
            messagesToSummarize: this.toRecentMessages(summarizeThese),
          }),
        },
      ]);

      return {
        ...s,
        summary: clampText(summaryText, 1400),
        messages: keep,
      };
    } catch {
      // Fallback: keep only last messages and a crude summary note.
      const fallback = s.summary
        ? s.summary
        : "Earlier conversation summarized due to length. (AI summarization unavailable.)";
      return { ...s, summary: clampText(fallback, 1400), messages: keep };
    }
  }

  private async parseIncident(userMessage: string): Promise<IncidentParse> {
    const parsed = await this.aiJson([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: incidentParsePrompt(userMessage) },
    ]);
    return asIncidentParse(parsed);
  }

  private async decideNext(args: {
    userMessage: string;
    incident: IncidentParse;
    profile: UserProfile;
    summary: string;
    clarifyingQuestionsAsked: number;
  }): Promise<Decision> {
    const { userMessage, incident, profile, summary, clarifyingQuestionsAsked } = args;
    const parsed = await this.aiJson([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: decisionPrompt({
          userMessage,
          incidentJson: incident,
          profile,
          summary,
          clarifyingQuestionsAsked,
        }),
      },
    ]);
    return asDecision(parsed);
  }

  private async buildFinalAnswer(args: {
    incident: IncidentParse;
    profile: UserProfile;
    summary: string;
    messages: ChatMessage[];
  }): Promise<string> {
    const { incident, profile, summary, messages } = args;
    return await this.aiText([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: finalAnswerPrompt({
          incidentJson: incident,
          profile,
          summary,
          recentMessages: this.toRecentMessages(messages.slice(-KEEP_LAST_MESSAGES)),
        }),
      },
    ]);
  }

  private async updateMemory(args: {
    profile: UserProfile;
    incident: IncidentParse;
    finalAnswer: string;
    summary: string;
  }): Promise<{ profile: UserProfile; lastIncidentSummary: string }> {
    const { profile, incident, finalAnswer, summary } = args;
    const parsed = (await this.aiJson([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: memoryUpdatePrompt({
          profile,
          incidentJson: incident,
          finalAnswer,
          summary,
        }),
      },
    ])) as Record<string, unknown>;
    const nextProfile = asProfile(parsed.profile);
    const lastIncidentSummary = clampText(safeString(parsed.lastIncidentSummary), 1200);
    return { profile: nextProfile, lastIncidentSummary };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/api/chat") {
      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    const msg = safeString((body as Record<string, unknown>)?.message).trim();
    if (!msg) {
      return new Response(JSON.stringify({ error: "Missing message" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // Load state, append user message, and summarize if needed.
    let s = await this.load();
    s.messages.push({ role: "user", content: clampText(msg, 4000), ts: now() });
    s = await this.maybeSummarize(s);

    // Parse + decide.
    let incident: IncidentParse;
    try {
      incident = await this.parseIncident(msg);
    } catch (err) {
      console.error("[SessionDO] parseIncident failed:", `${err}`);
      const extra = this.isDebug() ? `\n\n(debug) ${String(err)}` : "";
      const reply =
        "RUNBOOK (3-7 steps)\n" +
        "- Confirm the exact error and scope (URLs, regions, % of traffic)\n" +
        "- Check recent deploys/config changes (last 60 minutes)\n" +
        "- Check origin health (CPU/mem, error logs, upstream timeouts)\n" +
        "LIKELY ROOT CAUSES (3 items, each with confidence like 0.55)\n" +
        "- LLM parsing failed; treat as unknown incident (0.50)\n" +
        "- Transient upstream outage (0.30)\n" +
        "- Misconfiguration or deploy regression (0.20)\n" +
        "STATUS UPDATE (1-2 paragraphs)\n" +
        "I hit an internal parsing error, so I’m falling back to a generic incident checklist. " +
        "If you share the error code (e.g., 502/520) and timeframe, I can tailor the runbook.\n" +
        extra;
      s.messages.push({ role: "assistant", content: reply, ts: now() });
      await this.save(s);
      return new Response(JSON.stringify({ reply, profile: s.profile }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    let decision: Decision;
    try {
      decision = await this.decideNext({
        userMessage: msg,
        incident,
        profile: s.profile,
        summary: s.summary,
        clarifyingQuestionsAsked: s.clarifyingQuestionsAsked,
      });
    } catch {
      decision = { action: "final" };
    }

    // Enforce max clarifying questions.
    if (s.clarifyingQuestionsAsked >= MAX_CLARIFYING_QUESTIONS) {
      decision = { action: "final" };
    }

    if (decision.action === "clarify") {
      const question = clampText(decision.question, 600);
      s.messages.push({ role: "assistant", content: question, ts: now() });
      s.clarifyingQuestionsAsked = Math.min(
        MAX_CLARIFYING_QUESTIONS,
        s.clarifyingQuestionsAsked + 1
      );
      await this.save(s);
      return new Response(JSON.stringify({ reply: question, profile: s.profile }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // Final answer.
    let finalAnswer: string;
    try {
      finalAnswer = await this.buildFinalAnswer({
        incident,
        profile: s.profile,
        summary: s.summary,
        messages: s.messages,
      });
    } catch (err) {
      finalAnswer =
        "RUNBOOK (3-7 steps)\n" +
        "- Identify the primary symptom (5xx, latency, DNS, auth) and scope (all users vs subset)\n" +
        "- Check recent changes: deploys, config, DNS, certificates\n" +
        "- Validate origin health: error logs, saturation, upstream timeouts\n" +
        "- Validate dependencies: DB, cache, third-party APIs\n" +
        "LIKELY ROOT CAUSES (3 items, each with confidence like 0.55)\n" +
        "- Deploy/config regression (0.45)\n" +
        "- Upstream dependency failure (0.30)\n" +
        "- Traffic spike / resource exhaustion (0.25)\n" +
        "STATUS UPDATE (1-2 paragraphs)\n" +
        "I’m currently unable to generate a tailored response, so I’m providing a generic incident checklist. " +
        "If you share the error code, affected endpoints, and when it started, I can narrow this down.\n";
    }

    s.messages.push({ role: "assistant", content: finalAnswer, ts: now() });

    // Update long-term memory after final response; reset clarifying counter for next incident.
    try {
      const updated = await this.updateMemory({
        profile: s.profile,
        incident,
        finalAnswer,
        summary: s.summary,
      });
      s.profile = updated.profile;
      s.lastIncidentSummary = updated.lastIncidentSummary;
    } catch {
      // keep previous profile; no-op
    }
    s.clarifyingQuestionsAsked = 0;

    await this.save(s);
    return new Response(JSON.stringify({ reply: finalAnswer, profile: s.profile }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}


