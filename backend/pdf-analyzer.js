import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const DETACHED_KEYWORDS = ['detached house', 'detached property', 'detached home', 'fully detached'];
const BUNGALOW_KEYWORDS = ['detached bungalow', 'bungalow'];
const SEMI_KEYWORDS = ['semi-detached', 'semi detached', 'semidetached'];
const TERRACED_KEYWORDS = ['terraced', 'terrace house', 'mid-terrace', 'mid terrace'];
const END_TERRACE_KEYWORDS = ['end-terrace', 'end terrace', 'end of terrace'];
const FLAT_KEYWORDS = ['flat', 'apartment', 'maisonette', 'studio flat', 'penthouse', 'ground floor flat', 'first floor flat'];
const MULTI_UNIT_KEYWORDS = ['block of flats', 'apartment block', 'multi-unit', 'converted flat'];

function classifyFromText(text) {
  const lower = text.toLowerCase();
  const imageCount = (text.match(/\.(jpg|jpeg|png|gif|bmp|tiff)/gi) || []).length;
  const pageCount = text.split(/\f/).length;

  const checks = [
    { type: 'detached bungalow', keywords: BUNGALOW_KEYWORDS, label: 'detached' },
    { type: 'detached house', keywords: DETACHED_KEYWORDS, label: 'detached' },
    { type: 'semi-detached', keywords: SEMI_KEYWORDS, label: 'reject-housetype' },
    { type: 'end-terrace', keywords: END_TERRACE_KEYWORDS, label: 'reject-housetype' },
    { type: 'terraced', keywords: TERRACED_KEYWORDS, label: 'reject-housetype' },
    { type: 'flat', keywords: FLAT_KEYWORDS, label: 'reject-housetype' },
    { type: 'apartment block', keywords: MULTI_UNIT_KEYWORDS, label: 'reject-housetype' },
  ];

  const matches = [];
  for (const check of checks) {
    for (const kw of check.keywords) {
      const count = lower.split(kw).length - 1;
      if (count > 0) {
        matches.push({ ...check, keyword: kw, count });
      }
    }
  }

  if (matches.length === 0) {
    return {
      classification: 'unknown',
      label: 'review',
      confidence: 0,
      reasoning: 'No property type keywords found in PDF text. Cannot determine house type from text alone.',
      imageNote: `PDF has ~${pageCount} page(s). Text-based analysis only (no AI image analysis).`,
    };
  }

  // Bungalow is a subtype of detached — if "detached bungalow" matches, prioritize it
  const bungalowMatch = matches.find(m => m.type === 'detached bungalow');
  const detachedMatch = matches.find(m => m.type === 'detached house');
  const rejectMatches = matches.filter(m => m.label === 'reject-housetype');

  // If both detached and a reject type appear, the reject type likely describes neighbours or context
  // Prioritize the most-mentioned type
  let best;
  if (rejectMatches.length > 0 && (detachedMatch || bungalowMatch)) {
    const detachedCount = (bungalowMatch?.count || 0) + (detachedMatch?.count || 0);
    const rejectCount = rejectMatches.reduce((sum, m) => sum + m.count, 0);
    if (detachedCount >= rejectCount) {
      best = bungalowMatch || detachedMatch;
    } else {
      best = rejectMatches.sort((a, b) => b.count - a.count)[0];
    }
  } else if (bungalowMatch) {
    best = bungalowMatch;
  } else if (detachedMatch) {
    best = detachedMatch;
  } else {
    best = rejectMatches.sort((a, b) => b.count - a.count)[0];
  }

  // Confidence: based on keyword frequency and absence of conflicting types
  let confidence = 70;
  if (best.count >= 3) confidence += 15;
  else if (best.count >= 2) confidence += 10;
  const conflicting = matches.filter(m => m.label !== best.label);
  if (conflicting.length > 0) confidence -= 20;
  if (best.type === 'detached bungalow' && lower.includes('single storey')) confidence += 10;
  if (best.type === 'detached house' && !conflicting.length) confidence += 10;
  confidence = Math.min(100, Math.max(0, confidence));

  const allTypes = [...new Set(matches.map(m => `${m.keyword} (x${m.count})`))].join(', ');

  return {
    classification: best.type,
    label: confidence >= 96 ? best.label : (best.label === 'detached' ? 'review' : best.label),
    confidence,
    reasoning: `Keywords found: ${allTypes}. Primary classification: ${best.type}. ${conflicting.length ? `Conflicting terms present: ${conflicting.map(c => c.keyword).join(', ')}.` : 'No conflicting terms.'}`,
    imageNote: `PDF has ~${pageCount} page(s). Classification based on text extraction (no AI image analysis available without credits).`,
  };
}

export async function analyzePdfAttachment(pdfBuffer) {
  try {
    const data = await pdf(pdfBuffer);
    const text = data.text || '';

    if (!text.trim()) {
      return {
        classification: 'unknown',
        label: 'review',
        confidence: 0,
        reasoning: 'PDF contains no extractable text (may be image-only).',
        imageNote: `PDF has ${data.numpages} page(s). No text to analyze.`,
      };
    }

    return classifyFromText(text);
  } catch (err) {
    return {
      classification: 'unknown',
      label: 'review',
      confidence: 0,
      reasoning: `PDF parsing failed: ${err.message}`,
      imageNote: 'Could not read PDF.',
    };
  }
}
