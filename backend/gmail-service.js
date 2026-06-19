import { google } from 'googleapis';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:5173'
  );
}

export function buildGmailClient(tokens) {
  const auth = getOAuth2Client();
  auth.setCredentials(tokens);
  return google.gmail({ version: 'v1', auth });
}

export async function exchangeCodeForTokens(code) {
  const auth = getOAuth2Client();
  const { tokens } = await auth.getToken(code);
  return tokens;
}

async function ensureLabel(gmail, name) {
  const { data } = await gmail.users.labels.list({ userId: 'me' });
  const existing = data.labels.find(l => l.name === name);
  if (existing) return existing.id;
  const { data: created } = await gmail.users.labels.create({
    userId: 'me',
    requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  });
  return created.id;
}

function decodeBody(payload) {
  const parts = payload.parts || [];
  let body = payload.body?.data || '';

  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body = part.body.data;
      break;
    }
    if (part.mimeType === 'text/html' && part.body?.data && !body) {
      body = part.body.data;
    }
    if (part.parts) {
      const nested = decodeBody(part);
      if (nested) body = body || nested;
    }
  }

  if (!body) return '';
  return Buffer.from(body, 'base64url').toString('utf8');
}

function hasPdfAttachment(payload) {
  const check = (part) => {
    if (part.mimeType === 'application/pdf') return true;
    if (part.parts) return part.parts.some(check);
    return false;
  };
  return check(payload);
}

const REJECT_KEYWORDS = ['terraced', 'link-attached', 'end-terraced'];

export async function processEmails(gmail) {
  const labelToReviewId = await ensureLabel(gmail, 'to review');
  const labelAttachmentId = await ensureLabel(gmail, 'attachment');
  const labelRejectId = await ensureLabel(gmail, 'reject');
  const labelNotDetachedId = await ensureLabel(gmail, 'not detached');

  const listRes = await gmail.users.messages.list({ userId: 'me', maxResults: 10 });
  const messageIds = (listRes.data.messages || []).map(m => m.id);

  const results = [];

  for (const id of messageIds) {
    const { data: msg } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const subject = (msg.payload.headers || []).find(h => h.name.toLowerCase() === 'subject')?.value || '(no subject)';
    const labelsToAdd = [labelToReviewId];
    const appliedNames = ['to review'];

    const hasPdf = hasPdfAttachment(msg.payload);
    if (hasPdf) {
      labelsToAdd.push(labelAttachmentId);
      appliedNames.push('attachment');
    }

    const bodyText = decodeBody(msg.payload).toLowerCase();
    const matchedKeywords = REJECT_KEYWORDS.filter(kw => bodyText.includes(kw));
    if (matchedKeywords.length > 0) {
      labelsToAdd.push(labelRejectId, labelNotDetachedId);
      appliedNames.push('reject', 'not detached');
    }

    await gmail.users.messages.modify({
      userId: 'me',
      id,
      requestBody: { addLabelIds: labelsToAdd },
    });

    results.push({ id, subject, labels: appliedNames, hasPdf, matchedKeywords });
  }

  return results;
}
