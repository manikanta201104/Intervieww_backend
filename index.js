const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();

const allowedOrigins = [
  'chrome-extension://ajjmepcekhdackpjobdgodpknmalabck', // Change to your extension ID
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());

const HF_API_URL = 'https://api-inference.huggingface.co/models/'; // base endpoint
const HF_API_KEY = process.env.HF_API_KEY; // Set this on your server env securely

app.post('/api/ask', async (req, res) => {
  const { question, model = 'meta-llama/Llama-2-7b-chat-hf', promptTemplate } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'No question provided.' });
  }

  const prompt = promptTemplate
    ? promptTemplate.replace('{question}', question)
    : `Answer the following interview question very concisely:\n${question}`;

  try {
    const response = await fetch(HF_API_URL + model, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: prompt }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();
    const answer = Array.isArray(data)
      ? data[0]?.generated_text || JSON.stringify(data)
      : data.generated_text || data.answer || JSON.stringify(data);

    res.json({ answer });
  } catch (error) {
    console.error('Error calling Hugging Face:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy server listening on port ${PORT}`);
});
