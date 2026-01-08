require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();

const EXTENSION_ID = process.env.EXTENSION_ID || "";
const NODE_ENV = process.env.NODE_ENV || "development";
const HF_API_KEY = process.env.HF_API_KEY;

if (!HF_API_KEY) {
  console.warn("[WARN] HF_API_KEY is not set. Requests will fail.");
}

const allowedOrigins = new Set(
  EXTENSION_ID ? [`chrome-extension://${EXTENSION_ID}`] : []
);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (NODE_ENV !== "production") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: "25mb" }));

app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/routes", (req, res) => {
  res.json({ routes: ["/health", "/api/ask", "/api/transcribe"] });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/ask", async (req, res) => {
  const {
    question,
    model = "Qwen/Qwen2.5-7B-Instruct",
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
    const hfUrl = "https://router.huggingface.co/v1/chat/completions";
    const requestBody = {
      model: model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.1,
      stream: false,
    };
    const hfResp = await fetch(hfUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    if (!hfResp.ok) {
      const text = await hfResp.text().catch(() => "");
      console.error("HF API error details:", hfResp.status, text);
      return res
        .status(hfResp.status)
        .json({ error: text || "Hugging Face API error" });
    }
    const data = await hfResp.json();
    const answer = data?.choices?.[0]?.message?.content || JSON.stringify(data);
    return res.json({ answer });
  } catch (err) {
    console.error("Error calling Hugging Face API:", err);
    return res.status(500).json({ error: err?.message || "Upstream error" });
  }
});

// /api/transcribe for remote audio
app.post("/api/transcribe", async (req, res) => {
  const { audioBase64, mimeType } = req.body || {};
  if (!audioBase64 || typeof audioBase64 !== "string") {
    return res.status(400).json({ error: "No audioBase64 provided." });
  }
  if (!HF_API_KEY) {
    return res.status(500).json({ error: "HF_API_KEY not configured." });
  }
  try {
    const hfUrl =
      "https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3";
    const payload = Buffer.from(audioBase64, "base64");

    let hfResp = null;
    let lastText = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      hfResp = await fetch(hfUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_API_KEY}`,
          "Content-Type": mimeType || "application/octet-stream",
          Accept: "application/json",
        },
        body: payload,
      });

      if (hfResp.ok) break;

      lastText = await hfResp.text().catch(() => "");
      const status = hfResp.status;

      // HF sometimes returns model-loading errors as 503 or 504.
      if ((status === 503 || status === 504) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      break;
    }

    if (!hfResp || !hfResp.ok) {
      const status = hfResp?.status || 500;
      console.error("Whisper error details:", status, lastText);
      return res
        .status(status)
        .json({ error: lastText || "Whisper API error" });
    }

    const data = await hfResp.json();
    const transcript = data.text || "No transcript generated.";
    return res.json({ transcript });
  } catch (err) {
    console.error("Error calling Whisper API:", err);
    return res.status(500).json({ error: err?.message || "Upstream error" });
  }
});

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
});
