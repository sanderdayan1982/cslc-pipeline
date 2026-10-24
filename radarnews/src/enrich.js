import { createHash } from 'node:crypto';
import { CCY_KEYWORDS, CURRENCIES, SOURCES } from './config.js';

const INVERTED = /unemployment|jobless|claims|paro|desempleo/i;
const BREAKING = /\b(breaking|última hora|flash|urgent|alert)\b/i;
const GEO = /\b(war|attack|missile|sanction|invasion|strike|iran|israel|hormuz|taiwan|nato|geopol|tanker|naval mine|drone|civil defense|riyadh|jeddah|saudi|togliatti|oil hits|hostilit)/i;
const CB = /\b(fed|fomc|ecb|bce|boe|boj|snb|rbnz|rba|boc|powell|lagarde|bailey|ueda|ocr|rate decision|monetary policy)\b/i;
const MARKET = /\b(auction|tender|bill|repo|issuance|syndication|bond programme|prefu)\b/i;
const ANALYSIS = /\b(preview|preview:|wrap|recap|what to watch|análisis|outlook)\b/i;
const MACRO = /\b(cpi|pce|ppi|gdp|pmi|payroll|retail|housing|employment|jobless|trade balance|current account|ipc|pib)\b/i;

export const OFFICIAL_NOISE = /museum|banknote|award|prize|subcommittee|recruitment|vacancy|commemorat|exhibition|coin issue|carl menger|visit dunedin|cyber and ai|independent report|tsb to commission|assistant governor|member appointed|appointed as|notice of vesting|more about/i;
export const OFFICIAL_KEEP = /monetary policy|interest rate|inflation|ocr|fomc|financial stability|gdp|cpi|labour|labor|employment|intervention|bills|repo|profit distribution|prefu|bond programme|balance of payments|assessment|outlook|forecast|unemployment|pmi|trade|fiscal|budget|remarks|speech|minutes|beige book|rate decision|press conference|liquidity|reserves|swap lines|ocr/i;

export function canonicalUrl(url = '') {
  try {
    const u = new URL(String(url));
    u.hash = '';
    u.protocol = 'https:';
    u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase();
    u.pathname = (u.pathname.replace(/\/+$/, '') || '/');
    u.search = '';
    return u.href;
  } catch {
    return String(url || '').replace(/^http:\/\//i, 'https://').replace(/\/+$/, '');
  }
}

export function canonicalPath(url = '') {
  try {
    const u = new URL(canonicalUrl(url));
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

export function fingerprint(title, url = '') {
  return createHash('sha1').update(`${(title || '').trim().toLowerCase()}|${canonicalPath(url)}`).digest('hex');
}

export function headlineFromUrl(url = '') {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    let s = decodeURIComponent(path).replace(/\.[a-z0-9]+$/i, '');
    s = s.replace(/-vs-/gi, ' vs ');
    s = s.replace(/(\d+)-(\d+)(?=$|[^0-9])/g, '$1.$2');
    s = s.replace(/[-_]+/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

export function publishedAtFromUrl(url = '') {
  const m = /(?:20)(\d{2})(\d{2})(\d{2})/.exec(String(url));
  if (!m) return null;
  const iso = `20${m[1]}-${m[2]}-${m[3]}T12:00:00Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Prefer the date encoded in the URL when the feed stamps scrape-time as pubDate. */
export function preferPublishedAt(url = '', feedIso = null) {
  const fromUrl = publishedAtFromUrl(url);
  const feed = feedIso ? Date.parse(feedIso) : NaN;
  if (fromUrl && Number.isFinite(feed) && feed - Date.parse(fromUrl) > 12 * 3600_000) return fromUrl;
  if (Number.isFinite(feed)) return new Date(feed).toISOString();
  return fromUrl;
}

const DELAYED_FEED = /this is a delayed news feed[\s\S]*$/i;
const FJ_TAIL = /\s*\|\s*FJ\s*$/i;

export function cleanHeadline(title = '', url = '', source = '') {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  t = t.replace(DELAYED_FEED, '').trim();
  t = t.replace(FJ_TAIL, '').trim();
  const urlInTitle = t.match(/https?:\/\/[^\s]+/i)?.[0];
  if (urlInTitle) {
    const fromSlug = headlineFromUrl(urlInTitle);
    if (fromSlug) t = fromSlug;
    else t = t.replace(urlInTitle, '').trim();
  }
  if (/^https?:\/\//i.test(t)) {
    const fromSlug = headlineFromUrl(t);
    if (fromSlug) t = fromSlug;
  }
  if ((!t || t.length < 8) && /^https?:\/\//i.test(url) && /investinglive\.com/i.test(url)) {
    t = headlineFromUrl(url) || t;
  }
  if (/investinglive/i.test(source) && /^https?:\/\//i.test(t)) t = headlineFromUrl(t) || t;
  t = t.replace(/\s+/g, ' ').trim();
  if (t) t = t[0].toUpperCase() + t.slice(1);
  return t.slice(0, 280);
}

export function articleUrlFromText(text = '', fallback = '') {
  const urls = String(text || '').match(/https?:\/\/[^\s<>"]+/gi) || [];
  const article = urls.find((u) => /investinglive\.com\//i.test(u) && !/t\.me\//i.test(u));
  if (article) return article.replace(/[),.;]+$/, '');
  const msg = urls.find((u) => /t\.me\/(?:s\/)?[^/]+\/\d+/i.test(u));
  if (msg) return msg;
  return fallback;
}

export function parseNumber(v) {
  const m = /-?\d+(?:\.\d+)?/.exec(String(v ?? '').replace(/,/g, ''));
  return m ? Number(m[0]) : null;
}

export function parseMacro(text) {
  const t = String(text || '');
  const vsExpected = /(\-?[\d.,]+%?)\s+vs\s+(\-?[\d.,]+%?)\s+expected/i.exec(t);
  const actual = /ACTUAL[:\s]+(-?[\d.,]+%?)/i.exec(t)?.[1]
    || vsExpected?.[1]
    || /(\-?[\d.,]+%?)\s+vs\s+/i.exec(t)?.[1]
    || null;
  const forecast = /FORECAST[:\s]+(-?[\d.,]+%?)/i.exec(t)?.[1]
    || vsExpected?.[2]
    || /expected\s+(-?[\d.,]+%?)/i.exec(t)?.[1]
    || /vs\s+(-?[\d.,]+%?)/i.exec(t)?.[1]
    || null;
  const previous = /PREVIOUS[:\s]+(-?[\d.,]+%?)/i.exec(t)?.[1]
    || /\(previous\s+(-?[\d.,]+%?)\)/i.exec(t)?.[1]
    || null;
  return { actual, forecast, previous };
}

export function surpriseZ(item) {
  const a = parseNumber(item.actual);
  const f = parseNumber(item.forecast);
  if (a == null || f == null) return { z: null, absZ: null };
  const sigma = Math.max(0.15, Math.abs(f) * 0.04 || 0.2);
  let z = (a - f) / sigma;
  if (INVERTED.test(item.title || '')) z = -z;
  return { z: Math.round(z * 10) / 10, absZ: Math.abs(z) };
}

export function detectCurrencies(text, sourceCurrency = null) {
  const blob = String(text || '');
  const found = CURRENCIES.filter((c) => CCY_KEYWORDS[c].test(blob));
  if (sourceCurrency && !found.includes(sourceCurrency)) found.push(sourceCurrency);
  return [...new Set(found)];
}

export function categorize(text) {
  const t = String(text || '');
  if (GEO.test(t)) return 'geopolitica';
  if (CB.test(t)) return 'banco_central';
  if (MACRO.test(t)) return 'dato_macro';
  if (MARKET.test(t)) return 'mercado';
  if (ANALYSIS.test(t)) return 'analisis';
  return 'otro';
}

export function impactOf(item) {
  const t = `${item.title || ''} ${item.body || ''}`;
  if (item.calendar_impact === 'High' || (BREAKING.test(t) && item.currencies?.length)) return item.category === 'geopolitica' ? 5 : 4;
  if (item.category === 'dato_macro' && item.actual) return 4;
  if (item.category === 'banco_central') return 3;
  if (item.category === 'geopolitica') return 3;
  if (item.source_type === 'oficial') return 2;
  return 1;
}

export function isOfficialNoise(title) {
  const t = String(title || '');
  if (OFFICIAL_KEEP.test(t)) return false;
  return OFFICIAL_NOISE.test(t);
}

export function isRelevant(item) {
  if (item.source_type === 'oficial') {
    if (isOfficialNoise(item.title)) return false;
    return OFFICIAL_KEEP.test(item.title);
  }
  const t = `${item.title || ''} ${item.body || ''}`;
  if (item.id?.startsWith?.('negociostv') || /negocios tv/i.test(item.source || '')) {
    if (!item.currencies?.length && !MACRO.test(t) && !CB.test(t) && !GEO.test(t)) return false;
    if (/\b(psoe|vox|sánchez|abascal|feijóo|españa(?!ola))\b/i.test(t) && !item.currencies?.length) return false;
  }
  return item.currencies?.length > 0 || MACRO.test(t) || BREAKING.test(t) || GEO.test(t) || CB.test(t);
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`, 'i');
  const m = re.exec(block);
  return decodeEntities((m?.[1] || m?.[2] || '').trim());
}

export function parseRss(xml) {
  const items = [];
  const chunks = String(xml).match(/<item[\s\S]*?<\/item>/gi) || String(xml).match(/<rdf:li[\s\S]*?<\/rdf:li>/gi) || [];
  for (const block of chunks) {
    const title = tagText(block, 'title');
    const url = (tagText(block, 'link')
      || /<link[^>]*href="([^"]+)"/i.exec(block)?.[1]
      || tagText(block, 'guid')
      || '').trim();
    const dateRaw = tagText(block, 'pubDate') || tagText(block, 'dc:date') || tagText(block, 'updated');
    const body = tagText(block, 'description');
    if (!title) continue;
    const published = Date.parse(dateRaw);
    const feedIso = Number.isFinite(published) ? new Date(published).toISOString() : null;
    const published_at = preferPublishedAt(url, feedIso);
    if (!published_at) continue;
    items.push({ title: title.trim(), url, body, published_at });
  }
  return items;
}

export function parseTelegram(html) {
  const items = [];
  const msgs = String(html || '').split('tgme_widget_message_wrap');
  for (const block of msgs.slice(1)) {
    const text = decodeEntities(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] || '');
    const when = /datetime="([^"]+)"/i.exec(block)?.[1];
    const hrefs = [...block.matchAll(/href="(https:\/\/t\.me\/[^"]+)"/gi)].map((m) => m[1]);
    const msgUrl = hrefs.find((u) => /t\.me\/(?:s\/)?[^/]+\/\d+/i.test(u)) || '';
    const article = articleUrlFromText(text, msgUrl);
    if (!text) continue;
    const rawLine = text.split('\n')[0].slice(0, 400);
    const title = cleanHeadline(rawLine, article, '');
    const published = Date.parse(when);
    items.push({
      title,
      body: text.slice(rawLine.length).trim(),
      url: article || msgUrl,
      published_at: Number.isFinite(published) ? new Date(published).toISOString() : new Date().toISOString(),
    });
  }
  return items;
}

function skipHtmlTitle(title) {
  return !title || title.length < 24 || title.length > 220
    || /^(home|menu|skip|subscribe|contact|rss|linkedin|twitter|facebook|more about)/i.test(title)
    || /notice of vesting/i.test(title);
}

export function parseHtmlList(html, baseUrl) {
  const items = [];
  const seen = new Set();
  const origin = new URL(baseUrl).origin;
  const push = (title, href) => {
    title = decodeEntities(title);
    if (skipHtmlTitle(title) || seen.has(title)) return;
    let url = baseUrl;
    if (href) {
      try { url = new URL(href, baseUrl).href; } catch { return; }
      if (!url.startsWith(origin)) return;
    }
    seen.add(title);
    items.push({
      title,
      url,
      body: '',
      published_at: preferPublishedAt(url, new Date(Date.now() - 6 * 3600_000).toISOString()),
    });
  };
  const heads = String(html || '').matchAll(/<h[1-4][^>]*>\s*(?:<a[^>]+href="([^"]+)"[^>]*>)?([^<]{20,180})/gi);
  for (const m of heads) push(m[2], m[1]);
  if (items.length < 4) {
    const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      push(m[2], m[1]);
      if (items.length >= 40) break;
    }
  }
  return items.slice(0, 40);
}

function geoCurrencies(text, found) {
  if (found.length) return found;
  if (!GEO.test(text)) return found;
  const out = ['USD', 'JPY', 'CHF'];
  if (/\b(oil|crude|hormuz|tanker|iran)\b/i.test(text)) out.push('CAD');
  return out;
}

export function enrichRaw(raw, source) {
  const sourceName = source.name.replace(/ ·.*/, '').replace(/ \/ NZDM/, '');
  const article = articleUrlFromText(`${raw.title} ${raw.body || ''}`, raw.url || source.url);
  const title = cleanHeadline(raw.title, article, sourceName);
  const text = `${title} ${raw.body || ''}`;
  const macro = parseMacro(text);
  let currencies = detectCurrencies(text, source.currency || null);
  const category = categorize(text);
  if (category === 'geopolitica') currencies = geoCurrencies(text, currencies);
  const published_at = preferPublishedAt(article, raw.published_at) || new Date().toISOString();
  const item = {
    title,
    body: raw.body || '',
    source: sourceName,
    source_id: source.id,
    source_type: source.type,
    url: article,
    published_at,
    currencies,
    category,
    actual: macro.actual,
    forecast: macro.forecast,
    previous: macro.previous,
    calendar_title: null,
    fingerprint: fingerprint(title, article),
  };
  const z = surpriseZ(item);
  item.z = z.z;
  item.absZ = z.absZ;
  item.impact = impactOf(item);
  return item;
}

export function normalizeStoredNews(row) {
  const title = cleanHeadline(row.title, row.url, row.source);
  const url = articleUrlFromText(`${row.title} ${row.body || ''} ${row.url || ''}`, row.url);
  const text = `${title} ${row.body || ''}`;
  const macro = parseMacro(text);
  let currencies = Array.isArray(row.currencies) ? row.currencies : [];
  const category = row.category || categorize(text);
  if (category === 'geopolitica') currencies = geoCurrencies(text, currencies);
  const actual = row.actual || macro.actual;
  const forecast = row.forecast || macro.forecast;
  const previous = row.previous || macro.previous;
  const published_at = preferPublishedAt(url, row.published_at) || row.published_at;
  return {
    ...row,
    title,
    url,
    currencies,
    category,
    actual,
    forecast,
    previous,
    published_at,
  };
}

export function dedupeNews(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${(r.title || '').toLowerCase()}|${canonicalPath(r.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function sourceById(id) {
  return SOURCES.find((s) => s.id === id);
}

export { INVERTED };
