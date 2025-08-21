import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// health
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// simple non-stream endpoint (fallback)
app.post("/api/chat", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;

    const input = messages.map(m => ({
      role: m.role || "user",
      content: [{ type: "text", text: String(m.content ?? "") }]
    }));

    const r = await client.responses.create({ model, input });

    const text =
      r.output_text ??
      (r.output?.map?.(p => p.content?.map?.(c => c.text)?.join("") || "").join("\n") ?? "");

    return res.json({ text: text || "" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

// robust SSE streaming (works on Render)
app.post("/api/chat-stream", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;

    // ---- SSE headers (anti-buffering) ----
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx/proxy hint

    // send initial "connected" ping
    res.write(`event: ready\n`);
    res.write(`data: {"ok":true}\n\n`);

    // heartbeat to keep connection alive (Render friendly)
    const heart = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 15000);

    const input = messages.map(m => ({
      role: m.role || "user",
      content: [{ type: "text", text: String(m.content ?? "") }]
    }));

    const stream = await client.responses.stream({ model, input });

    stream.on("response.output_text.delta", (delta) => {
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    });

    stream.on("response.output_text.done", (full) => {
      res.write(`data: ${JSON.stringify({ done: true, text: full })}\n\n`);
    });

    stream.on("end", () => {
      clearInterval(heart);
      res.write(`event: close\ndata: {}\n\n`);
      res.end();
    });

    stream.on("error", (err) => {
      clearInterval(heart);
      try {
        res.write(`data: ${JSON.stringify({ error: err?.message || "Stream error" })}\n\n`);
      } finally {
        res.end();
      }
    });

    await stream.consume();
  } catch (e) {
    console.error("SSE error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: e?.message || "Server error" });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ error: e?.message || "Server error" })}\n\n`);
      } finally {
        res.end();
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`→ http://localhost:${PORT}`));
