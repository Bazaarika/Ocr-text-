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

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = {
  role: "system",
  content: [{ type: "input_text", text: "You are Bazaarika virtual assistant. Answer queries about bazaarika.in products, pricing, shipping, returns, customer care. Use context from sitemap if needed." }]
};

// Fetch products from sitemap
async function fetchProducts() {
  try {
    const url = 'https://bazaarika.in/sitemap_products_1.xml?from=8242438733985&to=8262244335777';
    const res = await axios.get(url);
    const parsed = await parseStringPromise(res.data);
    return parsed.urlset.url.map(u => ({ loc: u.loc[0], lastmod: u.lastmod[0] }));
  } catch (err) {
    console.error("Sitemap fetch error:", err);
    return [];
  }
}

async function getContext(query) {
  const products = await fetchProducts();
  const matched = products.filter(p => p.loc.toLowerCase().includes(query.toLowerCase()));
  if (!matched.length) return "No product info found, answer generally.";
  return matched.map(p => `Product URL: ${p.loc} | Last Updated: ${p.lastmod}`).join("\n");
}

function formatMessages(messages = []) {
  return messages.map(m => ({
    role: m.role,
    content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }]
  }));
}

app.post("/api/chat", async (req, res) => {
  try {
    const { messages = [], model = "gpt-4o-mini" } = req.body;
    const lastMsg = messages[messages.length-1]?.content || "";
    const context = await getContext(lastMsg);

    const input = [
      SYSTEM_PROMPT,
      { role: "system", content: [{ type: "input_text", text: `Context: ${context}` }] },
      ...formatMessages(messages)
    ];

    const response = await client.responses.create({ model, input });
    res.json({ text: response.output_text || "" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

app.get("/health", (_req,res)=>res.json({ok:true}));

const PORT = process.env.PORT||3000;
app.listen(PORT, ()=>console.log(`🚀 Server running on port ${PORT}`));
