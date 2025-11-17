require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();

const EXTENSION_ID = process.env.EXTENSION_ID || "";
const NODE_ENV = process.env.NODE_ENV || "development";
const HF_API_KEY = process.env.HF_API_KEY;
const HF_ROUTER_URL = "https://router.huggingface.co/hf-inference";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "";

if (!HF_API_KEY) {
  console.warn("[WARN] HF_API_KEY is not set. Requests will fail.");
}

// Build allowed origins from ENV
const allowedOrigins = new Set();
if (EXTENSION_ID) allowedOrigins.add(`chrome-extension://${EXTENSION_ID}`);
if (ALLOW_ORIGIN) {
  for (const o of ALLOW_ORIGIN.split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    allowedOrigins.add(o);
  }
}

// Use cors() primarily; also handle OPTIONS early
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (NODE_ENV !== "production" || ALLOW_ORIGIN === "*") {
    // Permissive in dev or when explicitly allowed by env
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Interview Helper backend running",
    routes: ["/health", "/api/ask", "/ask"],
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

async function handleAsk(req, res) {
  const {
    question,
    model = "meta-llama/Llama-2-7b-chat-hf",
    promptTemplate,
  } = req.body || {};

  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "No question provided." });
  }

  const prompt = promptTemplate
    ? String(promptTemplate).replace("{question}", question)
    : `Answer the following interview question very concisely:\n${question}`;

  if (!HF_API_KEY) {
    return res
      .status(500)
      .json({ error: "HF_API_KEY not configured on server." });
  }

  try {
    const requestBody = {
      model: model,
      inputs: prompt,
    };
    const hfResp = await fetch(HF_ROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!hfResp.ok) {
      const text = await hfResp.text().catch(() => "");
      return res
        .status(hfResp.status)
        .json({ error: text || "Hugging Face router API error" });
    }

    const data = await hfResp.json();

    // Router response varies by model; adapt extracting text accordingly
    let answer = null;
    if (typeof data === "string") {
      answer = data;
    } else if (Array.isArray(data)) {
      // Some models return an array of objects with generated_text
      answer = data[0]?.generated_text || data[0]?.text || JSON.stringify(data);
    } else if (data && typeof data === "object") {
      answer =
        data.generated_text ||
        data.text ||
        data.result ||
        data.answer ||
        JSON.stringify(data);
    } else {
      answer = JSON.stringify(data);
    }

    return res.json({ answer });
  } catch (err) {
    console.error("Error calling Hugging Face router API:", err);
    return res.status(500).json({ error: err?.message || "Upstream error" });
  }
}

app.post("/api/ask", handleAsk);
app.post("/ask", handleAsk);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
  if (EXTENSION_ID) {
    console.log(`Allowed extension origin: chrome-extension://${EXTENSION_ID}`);
  } else {
    console.log(
      "No EXTENSION_ID set; using permissive CORS in non-production."
    );
  }
  if (ALLOW_ORIGIN) {
    console.log(`Additional allowed origins: ${ALLOW_ORIGIN}`);
  }
});
