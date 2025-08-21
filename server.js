import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { GoogleSearch } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 🟢 Helper: format messages correctly
function formatMessages(messages = []) {
  return messages.map(m => {
    if (m.role === "user") {
      return {
        role: "user",
        content: [{ type: "input_text", text: String(m.content ?? "") }]
      };
    }
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: [{ type: "output_text", text: String(m.content ?? "") }]
      };
    }
    return {
      role: m.role || "user",
      content: [{ type: "input_text", text: String(m.content ?? "") }]
    };
  });
}

// 🟢 Helper: Google Search API integration
async function googleSearchAndFormat(query) {
  try {
    const searchClient = new GoogleSearch({ apiKey: process.env.GOOGLE_SEARCH_API_KEY });
    const response = await searchClient.run(query, { numResults: 3, site: "bazaarika.in" });
    const formattedResults = response.results.map(result => ({
      title: result.title,
      snippet: result.snippet,
      url: result.url
    }));
    return JSON.stringify(formattedResults);
  } catch (error) {
    console.error("Google Search error:", error);
    return "No relevant information found on Bazaarika.in.";
  }
}

// 🟢 System instruction (Bazaarika custom training)
const SYSTEM_PROMPT = {
  role: "system",
  content: [
    {
      type: "input_text",
      text: `
You are **Bazaarika Assistant**, an AI chatbot trained to provide information only about Bazaarika (https://bazaarika.in).
Rules:
- Always introduce yourself as "Bazaarika Assistant".
- Explain clearly how Bazaarika works: it is an online marketplace where sellers can upload products, and buyers can order them.
- If a user asks a question, first check for related information on Bazaarika.in using the search function.
- Answer questions about shipping rates, customer care number, trending products, and specific product details by searching the website.
- If someone asks unrelated things (like math, general knowledge, or politics), politely say: "Sorry, I can only answer questions about Bazaarika. If you have any questions about our products or services, please let me know."
- Keep answers short, clear, and helpful for new users and sellers.
- Respond in **Hindi + English mix** (Hinglish) so that Indian customers easily understand.
`
    }
  ]
};

// 🟢 Chat API (non-streaming)
app.post("/api/chat", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;
    const userMessage = messages[messages.length - 1]?.content;

    let searchData = "";
    if (userMessage) {
      searchData = await googleSearchAndFormat(userMessage);
    }
    
    const contextPrompt = {
      role: "user",
      content: [{ type: "input_text", text: `User query: "${userMessage}". Bazaarika.in search results: ${searchData}` }]
    };

    const input = [SYSTEM_PROMPT, contextPrompt, ...formatMessages(messages)];

    const r = await client.responses.create({ model, input });
    const text = r.output_text || "";

    return res.json({ text });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

// 🟢 Streaming API (SSE)
app.post("/api/chat-stream", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;
    const userMessage = messages[messages.length - 1]?.content;

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    res.write(`event: ready\n`);
    res.write(`data: {"ok":true}\n\n`);

    const heart = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 15000);

    let searchData = "";
    if (userMessage) {
      searchData = await googleSearchAndFormat(userMessage);
    }

    const contextPrompt = {
      role: "user",
      content: [{ type: "input_text", text: `User query: "${userMessage}". Bazaarika.in search results: ${searchData}` }]
    };

    const input = [SYSTEM_PROMPT, contextPrompt, ...formatMessages(messages)];

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
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
