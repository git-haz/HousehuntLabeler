import * as cheerio from 'cheerio';

const PROPERTY_DOMAINS = [
  'rightmove.co.uk',
  'zoopla.co.uk',
  'onthemarket.com',
  'purplebricks.co.uk',
  'openrent.com',
  'spareroom.co.uk',
];

const PORTAL_SELECTORS = {
  'rightmove.co.uk': {
    price: '[itemprop="price"], .property-header-price, ._1gfnqJ3Vtd1z40MlC0MzXu',
    address: '[itemprop="streetAddress"], .property-header-bedroom-and-price address, ._2uQQ3SV0eMHL1P6t5ZDo2q',
    bedrooms: '.bedroom-icon + span, [data-testid="beds-label"]',
    type: '[itemprop="category"], .property-header-bedroom-and-price, ._3ZGPwl2N1mHAJH6mGBz5xn',
  },
  'zoopla.co.uk': {
    price: '[data-testid="price"], .css-18tfumg, .listing-details-price',
    address: '[data-testid="address-label"], .css-1kx8akd, .listing-details-address',
    bedrooms: '[data-testid="beds-label"], .css-1rzfk9a',
    type: '[data-testid="property-type"], .listing-details-attr',
  },
  'onthemarket.com': {
    price: '.price, .price-text, [class*="price"]',
    address: '.address, .property-address, [class*="address"]',
    bedrooms: '.bedrooms, [class*="bedroom"]',
    type: '.property-type, [class*="property-type"]',
  },
};

const LINK_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const PROPERTY_PATH_PATTERNS = ['/property/', '/properties/'];
const IGNORED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.pdf'];

export function extractPropertyLinks(text) {
  const matches = text.match(LINK_REGEX) || [];
  const seen = new Set();
  return matches.filter(url => {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      const pathname = parsed.pathname.toLowerCase();

      if (IGNORED_EXTENSIONS.some(ext => pathname.endsWith(ext))) return false;
      if (seen.has(parsed.origin + parsed.pathname)) return false;

      const domainMatch = PROPERTY_DOMAINS.some(d => hostname.includes(d));
      const pathMatch = PROPERTY_PATH_PATTERNS.some(p => pathname.includes(p));

      if (domainMatch || pathMatch) {
        seen.add(parsed.origin + parsed.pathname);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  });
}

function extractWithSelectors($, selectors) {
  const result = {};
  for (const [field, selector] of Object.entries(selectors)) {
    const el = $(selector).first();
    const text = el.text().trim();
    if (text) result[field] = text;
  }
  return result;
}

function extractOgTags($) {
  const og = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr('property')?.replace('og:', '');
    const content = $(el).attr('content');
    if (prop && content) og[prop] = content;
  });
  return og;
}

function extractJsonLd($) {
  const result = {};
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product' || item['@type'] === 'RealEstateListing' || item['@type'] === 'Residence' || item['@type'] === 'Apartment' || item['@type'] === 'House') {
          if (item.name) result.title = item.name;
          if (item.description) result.description = item.description;
          if (item.offers?.price) result.price = `£${item.offers.price}`;
          if (item.address?.streetAddress) result.address = item.address.streetAddress;
        }
      }
    } catch {}
  });
  return result;
}

export async function scrapePropertyDetails(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return { url, error: `HTTP ${res.status}` };

    const html = await res.text();
    const $ = cheerio.load(html);
    const hostname = new URL(url).hostname;

    const jsonLd = extractJsonLd($);
    const og = extractOgTags($);

    let details = {};
    for (const [domain, selectors] of Object.entries(PORTAL_SELECTORS)) {
      if (hostname.includes(domain)) {
        details = extractWithSelectors($, selectors);
        break;
      }
    }

    const title = $('title').text().trim();

    return {
      url,
      price: details.price || jsonLd.price || null,
      address: details.address || jsonLd.address || og.title || title || null,
      bedrooms: details.bedrooms || null,
      type: details.type || jsonLd.title || null,
      description: og.description || jsonLd.description || null,
      image: og.image || null,
    };
  } catch (err) {
    return { url, error: err.message };
  }
}
