import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { saveCredentials, loadCredentials } from './crypto-store.js';
import { retrieveEmails, processSelectedEmails } from './gmail-service.js';

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

app.post('/retrieve', async (_req, res) => {
  try {
    const stored = loadCredentials();
    const token = accessToken || stored?.access_token;
    if (!token) return res.status(401).json({ error: 'Not authenticated.' });

    cachedEmails = await retrieveEmails(token);
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

app.listen(4000, () => console.log('Backend running on http://localhost:4000'));
