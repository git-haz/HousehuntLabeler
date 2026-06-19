import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { saveCredentials, loadCredentials } from './crypto-store.js';
import { buildGmailClient, exchangeCodeForTokens, processEmails } from './gmail-service.js';

const app = express();
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

let accessToken = null;

app.post('/auth/token', async (req, res) => {
  try {
    const { access_token, code } = req.body;

    if (code) {
      const tokens = await exchangeCodeForTokens(code);
      saveCredentials(tokens);
      accessToken = tokens.access_token;
      return res.json({ ok: true, message: 'Tokens exchanged and stored.' });
    }

    if (access_token) {
      accessToken = access_token;
      saveCredentials({ access_token });
      return res.json({ ok: true, message: 'Access token stored.' });
    }

    return res.status(400).json({ error: 'Provide access_token or code.' });
  } catch (err) {
    console.error('Auth error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/process', async (_req, res) => {
  try {
    const stored = loadCredentials();
    const tokens = stored || {};
    if (accessToken) tokens.access_token = accessToken;

    if (!tokens.access_token) {
      return res.status(401).json({ error: 'Not authenticated. Send token first.' });
    }

    const gmail = buildGmailClient(tokens);
    const results = await processEmails(gmail);
    res.json({ ok: true, results });
  } catch (err) {
    console.error('Process error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(4000, () => console.log('Backend running on http://localhost:4000'));
