import { createHash } from 'node:crypto';
import {
  CURRENCIES, CURRENCY_INFO, OFFICIAL_RELEVANT, OFFICIAL_NOISE, MACRO_TERMS,
  CENTRAL_BANK_TERMS, GEO_TERMS, MARKET_TERMS, ANALYSIS_TERMS,
} from './config.js';

const regexCache = new Map();

function termRegex(term) {
  let re = regexCache.get(term);
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const flags = /[A-Z]/.test(term) ? '' : 'i';
    re = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, flags);
    regexCache.set(term, re);
  }
  return re;
}

export function hasTerm(text, term) {
  return termRegex(term).test(text);
}

export function hasAny(text, terms) {
  return terms.some((t) => hasTerm(text, t));
}

export function detectCurrencies(text, sourceCurrency) {
  const found = CURRENCIES.filter((c) => hasAny(text, CURRENCY_INFO[c].keywords));
  if (sourceCurrency && !found.includes(sourceCurrency)) found.unshift(sourceCurrency);
  return found;
}

const MACRO_RE = /ACTUAL\s+([^\s(]+)\s*\(\s*FORECAST\s+([^,]*?)\s*,\s*PREVIOUS\s+([^)]*?)\s*\)/i;

const NUM = '(-?\\d+(?:\\.\\d+)?%?)';
const PROSE_MACRO = [
  { re: new RegExp(`${NUM}\\s*(?:[yqm]/[yqm])?\\s*\\(\\s*expected\\s+${NUM}`, 'i'), second: 'forecast' },
  { re: new RegExp(`\\bat\\s+${NUM}\\s+vs\\.?\\s+${NUM}`, 'i'), second: 'previous' },
  { re: new RegExp(`\\b(?:to|at)\\s+${NUM}(?![\\d.]).*?\\bfrom\\s+${NUM}`, 'i'), second: 'previous' },
];

export function extractMacro(text) {
  const m = MACRO_RE.exec(text);
  if (m) {
    const clean = (v) => (v && v.trim() !== '-' && v.trim() !== '' ? v.trim() : null);
    return { actual: clean(m[1]), forecast: clean(m[2]), previous: clean(m[3]) };
  }
  // Prose data headlines ("PMI at 47.7 vs 51.3 in September") carry actual vs previous.
  if (hasAny(text, MACRO_TERMS)) {
    for (const { re, second } of PROSE_MACRO) {
      const p = re.exec(text);
      if (p) return { actual: p[1], forecast: null, previous: null, [second]: p[2] };
    }
  }
  return { actual: null, forecast: null, previous: null };
}

export function parseNumber(v) {
  if (v == null) return null;
  const m = /-?\d+(?:\.\d+)?/.exec(String(v).replace(/,/g, ''));
  return m ? Number(m[0]) : null;
}

const INVERTED_INDICATORS = ['unemployment', 'jobless', 'claims', 'continuing claims'];

// +1 when the print beats the reference (forecast, or previous if no forecast), -1 when it misses.
// Inverted indicators (unemployment, claims) flip the sign: a higher print is bad news.
export function macroSurprise(title, macro) {
  const actual = parseNumber(macro.actual);
  const ref = parseNumber(macro.forecast) ?? parseNumber(macro.previous);
  if (actual == null || ref == null || actual === ref) return { direction: 0, magnitude: 0 };
  let direction = actual > ref ? 1 : -1;
  if (hasAny(title, INVERTED_INDICATORS)) direction = -direction;
  const magnitude = Math.abs(actual - ref) / Math.max(Math.abs(ref), 0.1);
  return { direction, magnitude };
}

export function isBreakingFlag(text) {
  return /^\s*(breaking|urgent|alert)\b/i.test(text) || /[\u{1F6A8}\u{1F534}]/u.test(text);
}

// FinancialJuice marks highlighted headlines with ❗, including equity-desk items
// ("❗ MOC IMBALANCE"), so the marker only counts when an FX-universe currency is involved.
export function isHighlightFlag(text) {
  return /[\u2757\u203C]/u.test(text);
}

const AUCTION_TERMS = ['auction', 'bid-to-cover', 'high yield'];

const KEY_INDICATORS = ['cpi', 'core cpi', 'pce', 'payrolls', 'nfp', 'nonfarm', 'non-farm', 'gdp', 'unemployment rate', 'rate decision', 'interest rate decision', 'employment change'];
const RATE_ACTION = ['rate cut', 'rate hike', 'cuts rates', 'raises rates', 'hikes rates', 'lowers rates', 'rate decision', 'policy rate', 'bank rate', 'cash rate', 'federal funds', 'monetary policy decision', 'fomc statement', 'intervention', 'intervene', 'intervened'];
const CB_HEADS = ['powell', 'lagarde', 'bailey', 'ueda', 'schlegel', 'macklem', 'bullock', 'hawkesby', 'breman'];
const SEVERE_GEO = ['war', 'missile', 'attack', 'invasion', 'nuclear', 'airstrike', 'strikes on', 'martial law', 'coup'];
const KEY_CB_DOCS = ['minutes of the federal open market committee', 'fomc minutes', 'monetary policy statement', 'summary of opinions',
  'monetary policy report', 'outlook report', 'outlook for economic activity and prices', 'press conference', 'monetary policy summary',
  'account of the monetary policy meeting', 'semiannual monetary policy report', 'testimony'];

const PREVIEW_TERMS = ['preview', 'calendar', 'week ahead', 'wrap', 'what to watch', 'explainer', 'primer', 'recap'];

export function categorize(text, macro, sourceType) {
  if (hasAny(text, AUCTION_TERMS)) return 'mercado';
  if (sourceType !== 'oficial' && hasAny(text, PREVIEW_TERMS)) return 'analisis';
  if (macro.actual != null) return 'dato_macro';
  if (sourceType === 'oficial' || hasAny(text, CENTRAL_BANK_TERMS)) return 'banco_central';
  if (hasAny(text, MACRO_TERMS) && /\d/.test(text)) return 'dato_macro';
  if (hasAny(text, GEO_TERMS)) return 'geopolitica';
  if (hasAny(text, MARKET_TERMS)) return 'mercado';
  if (hasAny(text, ANALYSIS_TERMS)) return 'analisis';
  return 'otro';
}

export function estimateImpact({ text, category, macro, sourceType, breaking }) {
  let impact;
  switch (category) {
    case 'dato_macro': {
      impact = macro.actual != null ? 3 : 2;
      if (hasAny(text, KEY_INDICATORS)) impact += 1;
      const s = macroSurprise(text, macro);
      if (s.magnitude >= 0.1) impact += 1;
      break;
    }
    case 'banco_central':
      impact = hasAny(text, RATE_ACTION) ? 5 : hasAny(text, CB_HEADS) || hasAny(text, KEY_CB_DOCS) ? 4 : 3;
      if (sourceType === 'oficial' && impact === 3 && !hasAny(text, ['speech', 'remarks', 'interview', 'statement', 'minutes'])) impact = 2;
      break;
    case 'geopolitica':
      impact = hasAny(text, SEVERE_GEO) ? 4 : 2;
      break;
    case 'mercado':
    case 'analisis':
      impact = 2;
      break;
    default:
      impact = 1;
  }
  if (sourceType === 'oficial' && impact < 2) impact = 2;
  if (breaking) impact = Math.max(impact, 4);
  return Math.min(5, Math.max(1, impact));
}

export function isRelevantOfficial(text) {
  if (hasAny(text, OFFICIAL_NOISE)) return false;
  return hasAny(text, OFFICIAL_RELEVANT);
}

export function isRelevantBreaking(text, currencies, macro) {
  return currencies.length > 0 || macro.actual != null || isBreakingFlag(text);
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'has', 'have', 'its', 'into', 'over', 'says', 'said', 'will', 'macro', 'breaking']);

export function fingerprint(text) {
  const tokens = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9.%\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => (t.length > 2 || /\d/.test(t)) && !STOPWORDS.has(t));
  const key = [...new Set(tokens)].sort().join(' ');
  return createHash('sha1').update(key).digest('hex');
}

// Agency descriptions (InvestingLive, FT) mention many currencies and policy terms in passing,
// so only official releases use the body for detection and scoring.
export function enrich(raw, source) {
  const text = source.type === 'oficial' ? `${raw.title} ${raw.body || ''}`.trim() : raw.title;
  const macro = extractMacro(raw.title);
  const currencies = detectCurrencies(text, source.currency);
  const breaking = isBreakingFlag(raw.title) || (isHighlightFlag(raw.title) && currencies.length > 0);
  const category = categorize(text, macro, source.type);
  const impact = estimateImpact({ text, category, macro, sourceType: source.type, breaking });
  return {
    title: raw.title,
    body: raw.body || '',
    source: source.name,
    source_type: source.type,
    url: raw.url || '',
    published_at: raw.published_at,
    currencies,
    impact,
    category,
    actual: macro.actual,
    forecast: macro.forecast,
    previous: macro.previous,
    fingerprint: fingerprint(raw.title),
  };
}
