import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import axios from "axios";
import { parseStringPromise } from "xml2js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ==================== FETCH PRODUCTS FROM SITEMAP ====================
async function fetchProductsFromSitemap() {
  try {
    const url = 'https://bazaarika.in/sitemap_products_1.xml?from=8242438733985&to=8262244335777';
    const response = await axios.get(url);
    const xmlData = response.data;

    const parsedData = await parseStringPromise(xmlData);
    const products = parsedData.urlset.url.map(item => ({
      loc: item.loc[0],
      lastmod: item.lastmod[0],
      // Add other fields if needed
    }));

    return products;
  } catch (err) {
    console.error("Error fetching sitemap:", err);
    return [];
  }
}

// ==================== HELPER: FORMAT MESSAGES ====================
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

// ==================== SYSTEM PROMPT ====================
const SYSTEM_PROMPT = {
  role: "system",
  content: [
    {
      type: "input_text",
      text: `
You are "Bazaarika Virtual Assistant", a professional human-like assistant for bazaarika.in.
Rules:
- Answer customer queries professionally and helpfully.
- Provide info about products, pricing, shipping, customer care, returns, payment methods, and trading.
- Use latest Bazaarika data provided in context.
- If unrelated questions asked, politely redirect: "Sorry, main sirf Bazaarika ke baare mein hi help kar sakta hoon."
- Reply in Hindi + English mix (Hinglish).
- Keep tone friendly, natural, and accurate.
`
    }
  ]
};

// ==================== HELPER: GET CONTEXT FROM SITEMAP ====================
async function getSitemapContext(query) {
  const products = await fetchProductsFromSitemap();
  const lowerQuery = query.toLowerCase();

  // Match products containing query in URL (simple example)
  const matched = products.filter(p => p.loc.toLowerCase().includes(lowerQuery));

  if (matched.length === 0) return "No specific product info found, answer generally about Bazaarika.";
  return matched.map(p => `Product URL: ${p.loc} | Last Updated: ${p.lastmod}`).join("\n");
}

// ==================== NON-STREAMING CHAT ====================
app.post("/api/chat", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;
    const lastUserMsg = messages[messages.length - 1]?.content ?? "";
    const contextText = await getSitemapContext(lastUserMsg);

    const input = [
      SYSTEM_PROMPT,
      {
        role: "system",
        content: [{ type: "input_text", text: `Sitemap / Product Data Context: ${contextText}` }]
      },
      ...formatMessages(messages)
    ];

    const response = await client.responses.create({ model, input });
    const text = response.output_text || "";

    return res.json({ text });
  } catch (e) {
    console.error("Error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
});

// ==================== STREAMING CHAT ====================
app.post("/api/chat-stream", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    res.write(`event: ready\n`);
    res.write(`data: {"ok":true}\n\n`);

    const heart = setInterval(() => res.write(`: ping\n\n`), 15000);

    const lastUserMsg = messages[messages.length - 1]?.content ?? "";
    const contextText = await getSitemapContext(lastUserMsg);

    const input = [
      SYSTEM_PROMPT,
      {
        role: "system",
        content: [{ type: "input_text", text: `Sitemap / Product Data Context: ${contextText}` }]
      },
      ...formatMessages(messages)
    ];

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

// ==================== HEALTH CHECK ====================
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
