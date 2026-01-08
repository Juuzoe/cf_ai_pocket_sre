export const SYSTEM_PROMPT = `You are Pocket SRE, an incident helper for websites.
You must be concise, practical, and safe.

Safety rules:
- Do not provide instructions for wrongdoing or abuse (hacking, malware, credential theft).
- When user asks for anything unsafe/illegal, refuse and offer safe alternatives.
- For operational advice, prefer reversible, low-risk steps and clearly label risky steps.

Output rules:
- Use short bullet points.
- Ask at most 2 clarifying questions total across the whole incident.
- If you have enough info, produce the final answer immediately.`;

export function incidentParsePrompt(userMessage: string): string {
  return `Extract a STRICT JSON object describing the incident.

Return ONLY valid JSON (no markdown, no code fences).
If the user message is NOT an incident report, still return valid JSON with:
- type: "other"
- severity_guess: "unknown"
Do not ask clarifying questions in this step.
Schema:
{
  "type": string,                       // e.g. "5xx_errors", "latency", "dns", "deploy_regression", "auth"
  "severity_guess": "low"|"medium"|"high"|"critical"|"unknown",
  "timeframe": string,                  // short text; empty string if unknown
  "symptoms": string[],                 // short symptom bullets; empty if unknown
  "stack_hints": string[]               // any detected stack hints; empty if none
}

User message:
${userMessage}`;
}

export function decisionPrompt(args: {
  userMessage: string;
  incidentJson: unknown;
  profile: unknown;
  summary: string;
  clarifyingQuestionsAsked: number;
}): string {
  const { userMessage, incidentJson, profile, summary, clarifyingQuestionsAsked } = args;
  return `Decide whether to ask ONE clarifying question or provide the final answer now.

Constraints:
- You may ask a clarifying question only if it would materially change the runbook.
- Never ask more than 2 clarifying questions total.
- If clarifyingQuestionsAsked >= 2, you MUST choose "final".

Return ONLY valid JSON:
{ "action": "clarify", "question": string } OR { "action": "final" }

Context:
- clarifyingQuestionsAsked: ${clarifyingQuestionsAsked}
- summary (older chat): ${summary ? summary : "(empty)"}
- profile: ${JSON.stringify(profile)}
- incident: ${JSON.stringify(incidentJson)}

Latest user message:
${userMessage}`;
}

export function finalAnswerPrompt(args: {
  incidentJson: unknown;
  profile: unknown;
  summary: string;
  recentMessages: { role: "user" | "assistant"; content: string }[];
}): string {
  const { incidentJson, profile, summary, recentMessages } = args;
  return `You are Pocket SRE. Produce a concise, actionable incident response.

Return ONLY plain text (no JSON).

Must include exactly these sections, in this order:
RUNBOOK (3-7 steps)
LIKELY ROOT CAUSES (3 items, each with confidence like 0.55)
STATUS UPDATE (1-2 paragraphs)

Guidance:
- Prefer checks that work for most stacks (DNS, TLS, origin health, deploys, logs, DB).
- Be specific about what to look for and what "good" vs "bad" looks like.
- Mention Cloudflare-specific checks only when relevant (e.g. 52x, WAF, cache).
- Keep it short; no long explanations.

Context:
summary (older chat): ${summary ? summary : "(empty)"}
profile: ${JSON.stringify(profile)}
incident: ${JSON.stringify(incidentJson)}
recentMessages: ${JSON.stringify(recentMessages)}`;
}

export function summarizePrompt(args: {
  previousSummary: string;
  messagesToSummarize: { role: "user" | "assistant"; content: string }[];
}): string {
  const { previousSummary, messagesToSummarize } = args;
  return `Create/extend a running summary of this troubleshooting chat.

Return ONLY plain text.
Keep it compact (max ~1200 chars).
Include:
- What the site is
- Stack hints
- Incident symptoms + timeframe
- What was already tried / results
- Any decisions or next steps

Previous summary:
${previousSummary ? previousSummary : "(empty)"}

Messages to summarize:
${JSON.stringify(messagesToSummarize)}`;
}

export function memoryUpdatePrompt(args: {
  profile: unknown;
  incidentJson: unknown;
  finalAnswer: string;
  summary: string;
}): string {
  const { profile, incidentJson, finalAnswer, summary } = args;
  return `Update long-term memory for this user session.

Return ONLY valid JSON (no markdown):
{
  "profile": {
    "techStack": string[],
    "domain": string,
    "notes": string
  },
  "lastIncidentSummary": string
}

Rules:
- techStack: keep a deduped list of short items (e.g. "Next.js", "Postgres", "Cloudflare", "Kubernetes").
- domain: keep as provided; empty string if unknown.
- notes: 1-3 short sentences with stable facts; avoid repeating ephemeral metrics.
- lastIncidentSummary: 1-3 sentences summarizing the incident + next actions.

Existing profile:
${JSON.stringify(profile)}

Running summary:
${summary ? summary : "(empty)"}

Incident JSON:
${JSON.stringify(incidentJson)}

Final answer that was given:
${finalAnswer}`;
}


