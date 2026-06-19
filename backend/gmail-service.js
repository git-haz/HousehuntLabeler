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

const SUFFOLK_INDICATORS = [
  'suffolk', 'ipswich', 'bury st edmunds', 'lowestoft', 'felixstowe',
  'woodbridge', 'aldeburgh', 'southwold', 'stowmarket', 'sudbury',
  'hadleigh', 'framlingham', 'leiston', 'saxmundham', 'eye',
  'needham market', 'mildenhall', 'newmarket', 'haverhill', 'beccles',
  'bungay', 'halesworth', 'debenham', 'lavenham', 'long melford',
];

function isInSuffolk(emailText, properties) {
  const text = emailText.toLowerCase();
  if (SUFFOLK_INDICATORS.some(s => text.includes(s))) return true;
  for (const p of properties) {
    const addr = (p.address || '').toLowerCase();
    const desc = (p.description || '').toLowerCase();
    if (SUFFOLK_INDICATORS.some(s => addr.includes(s) || desc.includes(s))) return true;
  }
  return false;
}

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

export async function fetchLabels(accessToken) {
  const data = await gmailFetch('/labels', accessToken);
  return (data.labels || [])
    .filter(l => l.type === 'user' || ['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'CATEGORY_PRIMARY', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'].includes(l.id))
    .map(l => ({ id: l.id, name: l.name, type: l.type }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function retrieveEmails(accessToken, opts = {}) {
  const { afterDate, beforeDate, includeLabels, excludeLabels, unreadOnly = true } = opts;
  let q = 'in:inbox -label:processed';
  if (unreadOnly) q += ' is:unread';
  if (includeLabels?.length) q += includeLabels.map(l => ` label:${l.replace(/\s+/g, '-')}`).join('');
  if (excludeLabels?.length) q += excludeLabels.map(l => ` -label:${l.replace(/\s+/g, '-')}`).join('');
  if (afterDate) q += ` after:${afterDate}`;
  if (beforeDate) q += ` before:${beforeDate}`;
  const listData = await gmailFetch(`/messages?maxResults=50&q=${encodeURIComponent(q)}`, accessToken);
  const messageIds = (listData.messages || []).map(m => m.id);

  const emails = [];
  for (const id of messageIds) {
    const msg = await gmailFetch(`/messages/${id}?format=full`, accessToken);

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

    const inSuffolk = isInSuffolk(rawBody, properties);
    emails.push({ id, subject, from, date, snippet, hasPdf, matchedKeywords, properties, inSuffolk, _bodyText: rawBody });
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
    const labelsToRemove = [];
    const appliedNames = ['processed'];
    const reasoning = ['Added "processed" — applied to all processed emails.'];

    const suffolk = isInSuffolk(meta?._bodyText || '', meta?.properties || []);
    if (suffolk) {
      reasoning.push('Kept as unread — property is in Suffolk.');
    } else {
      labelsToRemove.push('UNREAD');
      reasoning.push('Marked as read.');
    }

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

    const modifyBody = { addLabelIds: labelsToAdd };
    if (labelsToRemove.length > 0) modifyBody.removeLabelIds = labelsToRemove;

    await gmailFetch(`/messages/${id}/modify`, accessToken, {
      method: 'POST',
      body: JSON.stringify(modifyBody),
    });

    results.push({ id, subject: meta?.subject || id, labels: appliedNames, hasPdf: meta?.hasPdf, matchedKeywords: meta?.matchedKeywords || [], reasoning });
  }

  return results;
}
