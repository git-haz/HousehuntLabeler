const PRICE_REGEX = /(?:£|GBP\s?)(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\b/gi;
const PRICE_K_REGEX = /(?:£|GBP\s?)(\d{2,4})k\b/gi;

const CHAIN_FREE_PATTERNS = [
  'chain free', 'chain-free', 'no chain', 'no onward chain',
  'chain free sale', 'sold with no chain',
];

const POSTCODE_TO_COUNTY = {
  'AB': 'Aberdeenshire', 'AL': 'Hertfordshire', 'B': 'West Midlands',
  'BA': 'Somerset', 'BB': 'Lancashire', 'BD': 'West Yorkshire',
  'BH': 'Dorset', 'BL': 'Greater Manchester', 'BN': 'East Sussex',
  'BR': 'Kent', 'BS': 'Somerset', 'BT': 'Northern Ireland',
  'CA': 'Cumbria', 'CB': 'Cambridgeshire', 'CF': 'South Glamorgan',
  'CH': 'Cheshire', 'CM': 'Essex', 'CO': 'Essex',
  'CR': 'Surrey', 'CT': 'Kent', 'CV': 'West Midlands',
  'CW': 'Cheshire', 'DA': 'Kent', 'DD': 'Angus',
  'DE': 'Derbyshire', 'DG': 'Dumfries and Galloway', 'DH': 'County Durham',
  'DL': 'County Durham', 'DN': 'South Yorkshire', 'DT': 'Dorset',
  'DY': 'West Midlands', 'E': 'London', 'EC': 'London',
  'EH': 'Edinburgh', 'EN': 'Hertfordshire', 'EX': 'Devon',
  'FK': 'Stirling', 'FY': 'Lancashire', 'G': 'Glasgow',
  'GL': 'Gloucestershire', 'GU': 'Surrey', 'HA': 'London',
  'HD': 'West Yorkshire', 'HG': 'North Yorkshire', 'HP': 'Buckinghamshire',
  'HR': 'Herefordshire', 'HS': 'Western Isles', 'HU': 'East Yorkshire',
  'HX': 'West Yorkshire', 'IG': 'London', 'IP': 'Suffolk',
  'IV': 'Highland', 'KA': 'Ayrshire', 'KT': 'Surrey',
  'KW': 'Highland', 'KY': 'Fife', 'L': 'Merseyside',
  'LA': 'Lancashire', 'LD': 'Powys', 'LE': 'Leicestershire',
  'LL': 'Gwynedd', 'LN': 'Lincolnshire', 'LS': 'West Yorkshire',
  'LU': 'Bedfordshire', 'M': 'Greater Manchester', 'ME': 'Kent',
  'MK': 'Buckinghamshire', 'ML': 'Lanarkshire', 'N': 'London',
  'NE': 'Tyne and Wear', 'NG': 'Nottinghamshire', 'NN': 'Northamptonshire',
  'NP': 'Gwent', 'NR': 'Norfolk', 'NW': 'London',
  'OL': 'Greater Manchester', 'OX': 'Oxfordshire', 'PA': 'Renfrewshire',
  'PE': 'Cambridgeshire', 'PH': 'Perthshire', 'PL': 'Devon',
  'PO': 'Hampshire', 'PR': 'Lancashire', 'RG': 'Berkshire',
  'RH': 'Surrey', 'RM': 'London', 'S': 'South Yorkshire',
  'SA': 'Ceredigion', 'SE': 'London', 'SG': 'Hertfordshire',
  'SK': 'Cheshire', 'SL': 'Berkshire', 'SM': 'Surrey',
  'SN': 'Wiltshire', 'SO': 'Hampshire', 'SP': 'Wiltshire',
  'SR': 'Tyne and Wear', 'SS': 'Essex', 'ST': 'Staffordshire',
  'SW': 'London', 'SY': 'Powys', 'TA': 'Somerset',
  'TD': 'Scottish Borders', 'TF': 'Shropshire', 'TN': 'Kent',
  'TQ': 'Devon', 'TR': 'Cornwall', 'TS': 'North Yorkshire',
  'TW': 'London', 'UB': 'London', 'W': 'London',
  'WA': 'Cheshire', 'WC': 'London', 'WD': 'Hertfordshire',
  'WF': 'West Yorkshire', 'WN': 'Greater Manchester', 'WR': 'Worcestershire',
  'WS': 'West Midlands', 'WV': 'West Midlands', 'YO': 'North Yorkshire',
};

const UK_TOWNS = [
  'Aberaeron', 'Aberystwyth', 'Aldeburgh', 'Ammanford', 'Beccles', 'Brecon',
  'Bridgend', 'Builth Wells', 'Bungay', 'Bury St Edmunds', 'Caernarfon',
  'Cardigan', 'Carmarthen', 'Ceredigion', 'Cilgerran', 'Cribyn', 'Cwmann',
  'Debenham', 'Diss', 'Eye', 'Felixstowe', 'Ffostrasol', 'Framlingham',
  'Hadleigh', 'Halesworth', 'Haverfordwest', 'Ipswich', 'Lampeter',
  'Lavenham', 'Leiston', 'Llandeilo', 'Llandovery', 'Llandysul',
  'Llanelli', 'Llanon', 'Llanybydder', 'Long Melford', 'Lowestoft',
  'Machynlleth', 'Mildenhall', 'Needham Market', 'New Quay', 'Newcastle Emlyn',
  'Newmarket', 'Newport', 'Pembroke', 'Saxmundham', 'Southwold',
  'Stowmarket', 'Stradmore', 'Sudbury', 'Swansea', 'Tregaron',
  'Tenby', 'Woodbridge',
];

const POSTCODE_REGEX = /\b([A-Z]{1,2})\d{1,2}\s?\d[A-Z]{2}\b/gi;
const POSTCODE_PREFIX_REGEX = /\b([A-Z]{1,2})\d{1,2}\b/gi;

export function extractPropertyInfo(text, subject) {
  const combined = `${subject}\n${text}`;
  const lower = combined.toLowerCase();

  const price = extractPrice(combined);
  const { town, county } = extractLocation(combined);
  const chainFree = CHAIN_FREE_PATTERNS.some(p => lower.includes(p));

  return { price, town, county, chainFree };
}

function extractPrice(text) {
  let prices = [];

  let match;
  const r1 = new RegExp(PRICE_REGEX.source, PRICE_REGEX.flags);
  while ((match = r1.exec(text)) !== null) {
    const val = parseInt(match[1].replace(/,/g, ''), 10);
    if (val >= 10000 && val <= 50000000) prices.push(val);
  }

  const r2 = new RegExp(PRICE_K_REGEX.source, PRICE_K_REGEX.flags);
  while ((match = r2.exec(text)) !== null) {
    const val = parseInt(match[1], 10) * 1000;
    if (val >= 10000 && val <= 50000000) prices.push(val);
  }

  if (prices.length === 0) return null;
  return prices[0];
}

function extractLocation(text) {
  let town = null;
  let county = null;

  for (const t of UK_TOWNS) {
    const regex = new RegExp(`\\b${t}\\b`, 'i');
    if (regex.test(text)) {
      town = t;
      break;
    }
  }

  const postcodeMatches = text.match(POSTCODE_REGEX) || [];
  const prefixMatches = text.match(POSTCODE_PREFIX_REGEX) || [];
  const allPrefixes = [...postcodeMatches, ...prefixMatches]
    .map(m => m.replace(/\d.*/g, '').toUpperCase())
    .filter(Boolean);

  for (const prefix of allPrefixes) {
    if (POSTCODE_TO_COUNTY[prefix]) {
      county = POSTCODE_TO_COUNTY[prefix];
      break;
    }
  }

  if (!county && town) {
    const townLower = town.toLowerCase();
    for (const [prefix, c] of Object.entries(POSTCODE_TO_COUNTY)) {
      const regex = new RegExp(`\\b${town}[,\\s]+${prefix}\\d`, 'i');
      if (regex.test(text)) {
        county = c;
        break;
      }
    }
  }

  return { town, county };
}
