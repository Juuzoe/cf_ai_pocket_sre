// Local setup:
// - Worker: http://127.0.0.1:8787
// - Static site: http://127.0.0.1:8788
//
// FYI: on some Windows machines, `localhost` can go to IPv6 (::1) and fetch fails if the server only listens on 127.0.0.1.
const WORKER_ORIGIN = "http://127.0.0.1:8787";
const CHAT_ENDPOINT = WORKER_ORIGIN + "/api/chat";

function getOrCreateSessionId() {
  const key = "pocketSreSessionId";
  let v = localStorage.getItem(key);
  if (!v) {
    // Just a stable ID so we keep the same Durable Object session after refresh.
    // Not a secret, not crypto — good enough for a demo.
    v = `sess_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    localStorage.setItem(key, v);
  }
  return v;
}

const sessionId = getOrCreateSessionId();
document.getElementById("sessionId").textContent = sessionId;

function byId(id) {
  return document.getElementById(id);
}

const messagesEl = byId("messages");
const typingEl = byId("typing");
const formEl = byId("composer");
const inputEl = byId("input");
const sendBtn = byId("send");
const navChat = byId("navChat");
const navAbout = byId("navAbout");
const chatSection = byId("chatSection");
const aboutSection = byId("aboutSection");

function setTyping(on) {
  typingEl.classList.toggle("hidden", !on);
}

function setView(view) {
  const isChat = view === "chat";
  chatSection.classList.toggle("hidden", !isChat);
  aboutSection.classList.toggle("hidden", isChat);
  navChat.classList.toggle("isActive", isChat);
  navAbout.classList.toggle("isActive", !isChat);
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  scrollToBottom();
}

function renderProfile(profile) {
  if (!profile) return;
  const domain = profile.domain || "—";
  const stack =
    Array.isArray(profile.techStack) && profile.techStack.length ? profile.techStack.join(", ") : "—";
  const notes = profile.notes || "—";
  byId("profileDomain").textContent = domain;
  byId("profileStack").textContent = stack;
  byId("profileNotes").textContent = notes;
}

async function sendChat(message) {
  const res = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

addMessage(
  "assistant",
  "This chat keeps a sessionId in your browser and uses it to store history + a small profile on the server. Describe the incident (symptoms, when it started, and what changed). I’ll ask up to 2 clarifying questions, then produce a runbook + likely root causes + a status update."
);

navChat.addEventListener("click", () => setView("chat"));
navAbout.addEventListener("click", () => setView("about"));


formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = inputEl.value.trim();
  if (!msg) return;

  addMessage("user", msg);
  inputEl.value = "";
  inputEl.focus();

  setTyping(true);
  sendBtn.disabled = true;
  try {
    const data = await sendChat(msg);
    addMessage("assistant", data.reply || "(empty reply)");
    renderProfile(data.profile);
  } catch (err) {
    addMessage("assistant", `Error: ${err.message || err}`);
  } finally {
    setTyping(false);
    sendBtn.disabled = false;
  }
});


