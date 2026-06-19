import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { saveCredentials, loadCredentials } from './crypto-store.js';
import { retrieveEmails, processSelectedEmails, fetchLabels, downloadPdfAttachments } from './gmail-service.js';
import { extractImagesFromPdf } from './pdf-images.js';
import { analyzeImagesWithVision } from './vision-analyzer.js';

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

let accessToken = null;
let cachedEmails = [];

app.post('/auth/token', async (req, res) => {
  try {
    const { access_token } = req.body;

    if (access_token) {
      accessToken = access_token;
      saveCredentials({ access_token });
      return res.json({ ok: true, message: 'Access token stored.' });
    }

    return res.status(400).json({ error: 'Provide access_token.' });
  } catch (err) {
    console.error('Auth error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/labels', async (_req, res) => {
  try {
    const stored = loadCredentials();
    const token = accessToken || stored?.access_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated.' });

    const data = await fetchLabels(token);
    res.json({ ok: true, labels: data });
  } catch (err) {
    console.error('Labels error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/retrieve', async (req, res) => {
  try {
    const stored = loadCredentials();
    const token = accessToken || stored?.access_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated.' });

    const { afterDate, beforeDate, includeLabels, excludeLabels, unreadOnly } = req.body;
    cachedEmails = await retrieveEmails(token, { afterDate, beforeDate, includeLabels, excludeLabels, unreadOnly });
    res.json({ ok: true, emails: cachedEmails });
  } catch (err) {
    console.error('Retrieve error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/process', async (req, res) => {
  try {
    const { emailIds } = req.body;
    if (!emailIds?.length) return res.status(400).json({ error: 'No emails selected.' });

    const stored = loadCredentials();
    const token = accessToken || stored?.access_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated.' });

    const results = await processSelectedEmails(token, emailIds, cachedEmails);
    res.json({ ok: true, results });
  } catch (err) {
    console.error('Process error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/vision-analyze', async (req, res) => {
  try {
    const { emailIds, anthropicApiKey } = req.body;
    if (!anthropicApiKey) return res.status(400).json({ error: 'Anthropic API key required.' });
    if (!emailIds?.length) return res.status(400).json({ error: 'No emails selected.' });

    const stored = loadCredentials();
    const token = accessToken || stored?.access_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated.' });

    const results = [];
    for (const id of emailIds) {
      const meta = cachedEmails.find(e => e.id === id);
      if (!meta?.hasPdf) {
        results.push({ id, subject: meta?.subject || id, error: 'No PDF attachment.' });
        continue;
      }

      try {
        const pdfs = await downloadPdfAttachments(token, id);
        let allImages = [];
        for (const pdf of pdfs) {
          const images = await extractImagesFromPdf(pdf.buffer);
          allImages.push(...images);
        }

        if (allImages.length === 0) {
          results.push({ id, subject: meta?.subject || id, error: 'No images found in PDF.' });
          continue;
        }

        const analysis = await analyzeImagesWithVision(anthropicApiKey, allImages);
        results.push({ id, subject: meta?.subject || id, analysis });
      } catch (err) {
        results.push({ id, subject: meta?.subject || id, error: err.message });
      }
    }

    res.json({ ok: true, results });
  } catch (err) {
    console.error('Vision analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(4000, () => console.log('Backend running on http://localhost:4000'));
