import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(bodyParser.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Non-streaming endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;

    // fix: assistant messages -> output_text, user/system -> input_text
    const input = messages.map(m => ({
      role: m.role || "user",
      content: [
        {
          type: m.role === "assistant" ? "output_text" : "input_text",
          text: String(m.content ?? "")
        }
      ]
    }));

    const r = await client.responses.create({ model, input });

    return res.json({ text: r.output_text || "" });
  } catch (e) {
    console.error("Chat error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

// ✅ Streaming endpoint (SSE)
app.post("/api/chat-stream", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    res.write(`event: ready\n`);
    res.write(`data: {"ok":true}\n\n`);

    const heart = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 15000);

    // fix: same mapping here
    const input = messages.map(m => ({
      role: m.role || "user",
      content: [
        {
          type: m.role === "assistant" ? "output_text" : "input_text",
          text: String(m.content ?? "")
        }
      ]
    }));

    const stream = await client.responses.stream({ model, input });

    let fullText = "";

    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        res.write(`data: ${JSON.stringify({ delta: event.delta })}\n\n`);
        fullText += event.delta;
      }
      if (event.type === "response.error") {
        res.write(`data: ${JSON.stringify({ error: event.error.message })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, text: fullText })}\n\n`);
    res.write(`event: close\ndata: {}\n\n`);

    clearInterval(heart);
    res.end();
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
app.listen(PORT, () => {
  console.log(`✅ Server ready on port ${PORT}`);
});
