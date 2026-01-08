import { SessionDO } from "./durable/SessionDO";
import type { ChatRequest } from "./lib/types";

export type Env = {
  SESSION_DO: DurableObjectNamespace<SessionDO>;
  AI: Ai;
  LLM_MODEL?: string;
  DEBUG?: string;
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

function withCors(req: Request, res: Response): Response {
  const origin = req.headers.get("Origin") ?? "*";
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Credentials", "false");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function readJson<T>(req: Request): Promise<T> {
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error("Expected application/json");
  }
  return (await req.json()) as T;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return withCors(request, new Response(null, { status: 204 }));
    }

    if (url.pathname !== "/api/chat") {
      return withCors(request, jsonResponse({ error: "Not Found" }, { status: 404 }));
    }

    if (request.method !== "POST") {
      return withCors(
        request,
        jsonResponse({ error: "Method Not Allowed" }, { status: 405 })
      );
    }

    let payload: ChatRequest;
    try {
      payload = await readJson<ChatRequest>(request);
    } catch (err) {
      return withCors(
        request,
        jsonResponse(
          { error: "Invalid JSON request body", details: `${err}` },
          { status: 400 }
        )
      );
    }

    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
    const message = typeof payload.message === "string" ? payload.message.trim() : "";

    if (!sessionId || sessionId.length > 128) {
      return withCors(
        request,
        jsonResponse({ error: "Invalid sessionId" }, { status: 400 })
      );
    }
    if (!message || message.length > 4000) {
      return withCors(
        request,
        jsonResponse({ error: "Invalid message" }, { status: 400 })
      );
    }

    const id = env.SESSION_DO.idFromName(sessionId);
    const stub = env.SESSION_DO.get(id);

    // Recreate request for DO (body already consumed above).
    const doReq = new Request("https://session.do/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });

    let doRes: Response;
    try {
      doRes = await stub.fetch(doReq);
    } catch (err) {
      return withCors(
        request,
        jsonResponse({ error: "Durable Object error", details: `${err}` }, { status: 502 })
      );
    }

    // Pass through JSON body
    const text = await doRes.text();
    const res = new Response(text, {
      status: doRes.status,
      headers: { "content-type": doRes.headers.get("content-type") || "application/json" },
    });
    return withCors(request, res);
  },
} satisfies ExportedHandler<Env>;

export { SessionDO };


