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

// CORS setup
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

app.use(express.json({ limit: "10mb" })); // Important: allow large base64 audio

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Existing /api/ask for AI answers
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
    return res.status(500).json({ error: "HF_API_KEY not configured on server." });
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
      return res.status(hfResp.status).json({ error: text || "Hugging Face API error" });
    }

    const data = await hfResp.json();
    const answer = data?.choices?.[0]?.message?.content || "No answer generated.";
    return res.json({ answer });
  } catch (err) {
    console.error("Error calling Hugging Face API:", err);
    return res.status(500).json({ error: err?.message || "Upstream error" });
  }
});

// NEW: /api/transcribe for remote audio (tabCapture → Whisper)
app.post("/api/transcribe", async (req, res) => {
  const { audioBase64 } = req.body;

  if (!audioBase64 || typeof audioBase64 !== "string") {
    return res.status(400).json({ error: "No audioBase64 provided." });
  }

  if (!HF_API_KEY) {
    return res.status(500).json({ error: "HF_API_KEY not configured." });
  }

  try {
    // Using Whisper small – fast and accurate for English speech
    const hfUrl = "https://api-inference.huggingface.co/models/openai/whisper-small";

    const response = await fetch(hfUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: audioBase64, // Base64-encoded audio (webm/opus)
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("Whisper error:", response.status, errorText);
      return res.status(response.status).json({ error: "Transcription failed", details: errorText });
    }

    const data = await response.json();
    const transcript = data.text?.trim() || "";

    if (!transcript) {
      return res.json({ transcript: "" }); // Empty but valid
    }

    console.log("Transcribed from remote audio:", transcript);
    return res.json({ transcript });
  } catch (err) {
    console.error("Transcription server error:", err);
    return res.status(500).json({ error: "Internal transcription error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Endpoints: /api/ask (AI) and /api/transcribe (Whisper)`);
  if (EXTENSION_ID) {
    console.log(`Allowed origin: chrome-extension://${EXTENSION_ID}`);
  }
});