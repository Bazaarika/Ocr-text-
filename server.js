import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 * Non-streaming chat endpoint
 * Body: { messages: [{role:'user'|'system'|'assistant', content:'...'}], model?: string }
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;

    // Convert chat-style messages to Responses API input
    // Each message becomes { role, content: [{ type:'text', text: '...' }] }
    const input = messages.map(m => ({
      role: m.role || "user",
      content: [{ type: "text", text: String(m.content ?? "") }]
    }));

    const response = await client.responses.create({
      model,
      input
    });

    // Best-effort text extraction from Responses API
    const out =
      response.output_text ??
      (response.output?.map?.(p => p.content?.map?.(c => c.text)?.join("") || "").join("\n") ?? "");

    res.json({ text: out, raw: response });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || "Something went wrong" });
  }
});

/**
 * Streaming chat via Server-Sent Events (SSE)
 * POST body same as /api/chat. Client receives tokens incrementally.
 */
app.post("/api/chat-stream", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const input = messages.map(m => ({
      role: m.role || "user",
      content: [{ type: "text", text: String(m.content ?? "") }]
    }));

    const stream = await client.responses.stream({
      model,
      input
    });

    // Token events
    stream.on("response.output_text.delta", (delta) => {
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    });

    // When a full text segment is done
    stream.on("response.output_text.done", (text) => {
      res.write(`data: ${JSON.stringify({ done: true, text })}\n\n`);
    });

    // Any tool calls or other events will arrive here if you add tools later
    stream.on("event", (event) => {
      // Uncomment to debug: console.log("event:", event.type);
    });

    // End of stream
    stream.on("end", () => {
      res.write(`event: close\n`);
      res.write(`data: {}\n\n`);
      res.end();
    });

    // Start streaming
    await stream.consume();

  } catch (err) {
    console.error(err);
    // Send error over SSE if possible
    try {
      res.write(`data: ${JSON.stringify({ error: err?.message || "Stream error" })}\n\n`);
      res.end();
    } catch {
      // If headers not sent
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || "Something went wrong" });
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
