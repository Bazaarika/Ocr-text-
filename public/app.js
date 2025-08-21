const $ = s => document.querySelector(s);
const chatEl = $("#chat");
const inputEl = $("#input");
const sendBtn = $("#send");
const statusDot = $("#statusDot");
const statusText = $("#statusText");
const modelEl = $("#model");
const streamEl = $("#useStream");

let history = [
  { role: "system", content: "You are a helpful, concise assistant for Bazaarika. Reply briefly unless asked for detail." }
];

// status helpers
function setStatus(ok, msg) {
  statusDot.classList.toggle("ok", !!ok);
  statusText.textContent = msg || (ok ? "Connected" : "Disconnected");
}

// message bubble
function addMsg(role, text, isTyping=false) {
  const box = document.createElement("div");
  box.className = `msg ${role === "user" ? "user" : "ai"}`;
  box.innerHTML = `<div class="meta">${role.toUpperCase()}</div>${isTyping ? typingDots() : escapeHtml(text)}`;
  chatEl.appendChild(box);
  chatEl.scrollTop = chatEl.scrollHeight;
  return box;
}

function typingDots() {
  return `<span class="typing"><span class="b"></span><span class="b"></span><span class="b"></span></span>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// connection check
async function ping() {
  try {
    const r = await fetch("/health", { cache: "no-store" });
    if (!r.ok) throw new Error("bad");
    setStatus(true, "Server ready");
  } catch {
    setStatus(false, "Server unreachable");
  }
}
ping();

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;

  // show user bubble
  inputEl.value = "";
  addMsg("user", text);
  history.push({ role: "user", content: text });

  sendBtn.disabled = true;

  const model = modelEl.value;

  try {
    if (streamEl.checked) {
      const aiBox = addMsg("assistant", "", true);

      const resp = await fetch("/api/chat-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, model })
      });

      if (!resp.ok || !resp.body) throw new Error("Stream failed");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let aiText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // SSE frames separated by \n\n; preserve partials safely
        const frames = chunk.split("\n\n").filter(Boolean);
        for (const f of frames) {
          if (f.startsWith(":")) continue; // heartbeat
          const line = f.split("\n").find(l => l.startsWith("data:"));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let data;
          try { data = JSON.parse(payload); } catch { continue; }

          if (data.delta) {
            aiText += data.delta;
            aiBox.innerHTML = `<div class="meta">ASSISTANT (streaming)</div>${escapeHtml(aiText)}`;
            chatEl.scrollTop = chatEl.scrollHeight;
          }
          if (data.done) {
            aiText = data.text || aiText;
          }
          if (data.error) {
            throw new Error(data.error);
          }
        }
      }

      // final set
      aiBox.innerHTML = `<div class="meta">ASSISTANT</div>${escapeHtml(aiText || "(no text)")}`;
      history.push({ role: "assistant", content: aiText || "" });
      setStatus(true, "AI connected");
    } else {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, model })
      });
      if (!r.ok) throw new Error("Request failed");
      const data = await r.json();
      addMsg("assistant", data.text || "(no text)");
      history.push({ role: "assistant", content: data.text || "" });
      setStatus(true, "AI connected");
    }
  } catch (err) {
    console.error(err);
    setStatus(false, "Error");
    addMsg("assistant", `⚠️ Error: ${err.message || err}`, false);
  } finally {
    sendBtn.disabled = false;
    chatEl.scrollTop = chatEl.scrollHeight;
  }
}

sendBtn.addEventListener("click", send);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
