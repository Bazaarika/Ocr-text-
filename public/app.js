const $ = (s) => document.querySelector(s);
const chatEl = $("#chat");
const inputEl = $("#input");
const modelEl = $("#model");
const sendBtn = $("#send");
const streamEl = $("#useStream");

let history = [
  { role: "system", content: "You are a helpful, concise assistant for Bazaarika." }
];

function addMsg(role, text) {
  const box = document.createElement("div");
  box.className = `msg ${role === "user" ? "user" : "ai"}`;
  box.innerHTML = `<div class="meta">${role.toUpperCase()}</div>${escapeHtml(text)}`;
  chatEl.appendChild(box);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  addMsg("user", text);
  history.push({ role: "user", content: text });
  sendBtn.disabled = true;

  const model = modelEl.value;

  if (streamEl.checked) {
    // Streaming via SSE endpoint
    const resp = await fetch("/api/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, model })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let aiText = "";
    const aiBox = document.createElement("div");
    aiBox.className = "msg ai";
    aiBox.innerHTML = `<div class="meta">ASSISTANT (streaming)</div>`;
    chatEl.appendChild(aiBox);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // SSE frames are separated by double newlines
      const events = chunk.split("\n\n").filter(Boolean);
      for (const ev of events) {
        if (!ev.startsWith("data:")) continue;
        const data = JSON.parse(ev.slice(5).trim());
        if (data.delta) {
          aiText += data.delta;
          aiBox.innerHTML = `<div class="meta">ASSISTANT (streaming)</div>${escapeHtml(aiText)}`;
          chatEl.scrollTop = chatEl.scrollHeight;
        }
        if (data.done) {
          aiText = data.text || aiText;
        }
      }
    }
    history.push({ role: "assistant", content: aiText });
  } else {
    // Non-streaming
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, model })
    });
    const data = await resp.json();
    addMsg("assistant", data.text || "(no text)");
    history.push({ role: "assistant", content: data.text || "" });
  }

  sendBtn.disabled = false;
}

sendBtn.addEventListener("click", send);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
