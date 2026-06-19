import { extractPropertyLinks, scrapePropertyDetails } from './property-scraper.js';
import { analyzePdfAttachment } from './pdf-analyzer.js';

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

function findPdfParts(payload) {
  const results = [];
  const scan = (part) => {
    if (part.mimeType === 'application/pdf' && part.body?.attachmentId) {
      results.push({ attachmentId: part.body.attachmentId, filename: part.filename || 'attachment.pdf' });
    }
    if (part.parts) part.parts.forEach(scan);
  };
  scan(payload);
  return results;
}

async function downloadAttachment(accessToken, messageId, attachmentId) {
  const data = await gmailFetch(`/messages/${messageId}/attachments/${attachmentId}`, accessToken);
  return Buffer.from(data.data, 'base64url');
}

export async function applyLabel(accessToken, messageId, labelName) {
  const data = await gmailFetch('/labels', accessToken);
  let label = data.labels.find(l => l.name === labelName);
  if (!label) {
    label = await gmailFetch('/labels', accessToken, {
      method: 'POST',
      body: JSON.stringify({ name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
  }
  await gmailFetch(`/messages/${messageId}/modify`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: [label.id] }),
  });
  return label.name;
}

export async function downloadPdfAttachments(accessToken, messageId) {
  const msg = await gmailFetch(`/messages/${messageId}?format=full`, accessToken);
  const pdfParts = findPdfParts(msg.payload);
  const pdfs = [];
  for (const part of pdfParts) {
    const buffer = await downloadAttachment(accessToken, messageId, part.attachmentId);
    pdfs.push({ buffer, filename: part.filename });
  }
  return pdfs;
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
  const { afterDate, beforeDate, searchSubject, searchBody, searchFrom, unreadOnly = true } = opts;
  let q = 'in:inbox -label:processed';
  if (unreadOnly) q += ' is:unread';
  if (searchSubject) searchSubject.split(/\s+/).filter(Boolean).forEach(w => { q += ` subject:${w}`; });
  if (searchBody) searchBody.split(/\s+/).filter(Boolean).forEach(w => { q += ` ${w}`; });
  if (searchFrom) searchFrom.split(/\s+/).filter(Boolean).forEach(w => { q += ` from:${w}`; });
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
  const labelDetachedId = await ensureLabel(accessToken, 'detached');
  const labelRejectHousetypeId = await ensureLabel(accessToken, 'reject-housetype');
  const labelReviewId = await ensureLabel(accessToken, 'review');

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

      const msg = await gmailFetch(`/messages/${id}?format=full`, accessToken);
      const pdfParts = findPdfParts(msg.payload);
      const pdfAnalyses = [];

      for (let pi = 0; pi < pdfParts.length; pi++) {
        const part = pdfParts[pi];
        try {
          const pdfBuffer = await downloadAttachment(accessToken, id, part.attachmentId);
          const analysis = await analyzePdfAttachment(pdfBuffer);
          pdfAnalyses.push({ filename: part.filename, index: pi + 1, ...analysis });
          reasoning.push(`PDF #${pi + 1} "${part.filename}": ${analysis.classification} (confidence: ${analysis.confidence}%). ${analysis.reasoning}`);
          reasoning.push(`  ${analysis.imageNote}`);
        } catch (err) {
          pdfAnalyses.push({ filename: part.filename, index: pi + 1, classification: 'unknown', label: 'review', confidence: 0, reasoning: `Error: ${err.message}` });
          reasoning.push(`PDF #${pi + 1} "${part.filename}": Error reading PDF — ${err.message}`);
        }
      }

      if (pdfAnalyses.length > 0) {
        const detachedResults = pdfAnalyses.filter(a => a.label === 'detached');
        const rejectResults = pdfAnalyses.filter(a => a.label === 'reject-housetype');
        const reviewResults = pdfAnalyses.filter(a => a.label === 'review');

        if (detachedResults.length > 0 && rejectResults.length === 0 && reviewResults.length === 0) {
          labelsToAdd.push(labelDetachedId);
          appliedNames.push('detached');
          reasoning.push(`Added "detached" — PDF analysis confirms detached/bungalow with high confidence.`);
        } else if (rejectResults.length > 0) {
          labelsToAdd.push(labelRejectHousetypeId);
          appliedNames.push('reject-housetype');
          reasoning.push(`Added "reject-housetype" — PDF analysis indicates non-detached property type.`);
        } else {
          labelsToAdd.push(labelReviewId);
          appliedNames.push('review');
          reasoning.push(`Added "review" — PDF analysis inconclusive, manual review needed.`);
        }
      }
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
