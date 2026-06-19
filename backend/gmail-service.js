import { extractPropertyLinks, scrapePropertyDetails } from './property-scraper.js';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function gmailFetch(path, accessToken, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${res.status}: ${text}`);
  }
  return res.json();
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

async function ensureLabel(accessToken, name) {
  const data = await gmailFetch('/labels', accessToken);
  const existing = data.labels.find(l => l.name === name);
  if (existing) return existing.id;
  const created = await gmailFetch('/labels', accessToken, {
    method: 'POST',
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  });
  return created.id;
}

export async function retrieveEmails(accessToken) {
  const listData = await gmailFetch('/messages?maxResults=10&q=is%3Aunread+in%3Ainbox', accessToken);
  const messageIds = (listData.messages || []).map(m => m.id);

  const emails = [];
  for (const id of messageIds) {
    const msg = await gmailFetch(`/messages/${id}?format=full`, accessToken);
    const allowedLabels = new Set(['INBOX', 'UNREAD', 'CATEGORY_PRIMARY', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']);
    const msgLabels = msg.labelIds || [];
    if (msgLabels.some(l => !allowedLabels.has(l))) continue;

    const headers = msg.payload.headers || [];
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '(no subject)';
    const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
    const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || '';
    const snippet = msg.snippet || '';
    const hasPdf = hasPdfAttachment(msg.payload);
    const rawBody = decodeBody(msg.payload);
    const bodyText = rawBody.toLowerCase();
    const matchedKeywords = REJECT_KEYWORDS.filter(kw => bodyText.includes(kw));

    const propertyLinks = extractPropertyLinks(rawBody);
    const properties = [];
    for (const link of propertyLinks) {
      const details = await scrapePropertyDetails(link);
      properties.push(details);
    }

    emails.push({ id, subject, from, date, snippet, hasPdf, matchedKeywords, properties });
  }
  return emails;
}

export async function processSelectedEmails(accessToken, emailIds, emailMeta) {
  const labelProcessedId = await ensureLabel(accessToken, 'processed');
  const labelAttachmentId = await ensureLabel(accessToken, 'attachment');
  const labelRejectId = await ensureLabel(accessToken, 'reject');

  const results = [];

  for (const id of emailIds) {
    const meta = emailMeta.find(e => e.id === id);
    const labelsToAdd = [labelProcessedId];
    const labelsToRemove = ['UNREAD'];
    const appliedNames = ['processed'];
    const reasoning = ['Marked as read.', 'Added "processed" — applied to all processed emails.'];

    if (meta?.hasPdf) {
      labelsToAdd.push(labelAttachmentId);
      appliedNames.push('attachment');
      reasoning.push('Added "attachment" — email contains a PDF attachment.');
    }

    if (meta?.matchedKeywords?.length > 0) {
      labelsToAdd.push(labelRejectId);
      appliedNames.push('reject');
      reasoning.push(`Added "reject" — body contains: ${meta.matchedKeywords.join(', ')}.`);
    }

    await gmailFetch(`/messages/${id}/modify`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: labelsToAdd, removeLabelIds: labelsToRemove }),
    });

    results.push({ id, subject: meta?.subject || id, labels: appliedNames, hasPdf: meta?.hasPdf, matchedKeywords: meta?.matchedKeywords || [], reasoning });
  }

  return results;
}
