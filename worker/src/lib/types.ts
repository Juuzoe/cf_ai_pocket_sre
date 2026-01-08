export type Role = "system" | "user" | "assistant";

export type ChatMessage = {
  role: Exclude<Role, "system">;
  content: string;
  ts: number;
};

export type UserProfile = {
  techStack: string[];
  domain: string;
  notes: string;
};

export type IncidentParse = {
  type: string;
  severity_guess: "low" | "medium" | "high" | "critical" | "unknown";
  timeframe: string;
  symptoms: string[];
  stack_hints: string[];
};

export type Decision =
  | { action: "clarify"; question: string }
  | { action: "final" };

export type StoredState = {
  messages: ChatMessage[];
  summary: string; // running summary of older conversation
  profile: UserProfile;
  lastIncidentSummary: string;
  clarifyingQuestionsAsked: number;
};

export type ChatRequest = {
  sessionId: string;
  message: string;
};

export type ChatResponse = {
  reply: string;
  profile: UserProfile;
};

export function defaultProfile(): UserProfile {
  return {
    techStack: [],
    domain: "",
    notes: "",
  };
}


