import { createHash } from 'node:crypto';
import { CCY_KEYWORDS, CURRENCIES, SOURCES } from './config.js';

const INVERTED = /unemployment|jobless|claims|paro|desempleo/i;
const BREAKING = /\b(breaking|última hora|flash|urgent|alert)\b/i;
const GEO = /\b(war|attack|missile|sanction|invasion|strike|iran|israel|hormuz|taiwan|nato|geopol)/i;
const CB = /\b(fed|fomc|ecb|bce|boe|boj|snb|rbnz|rba|boc|powell|lagarde|bailey|ueda|ocr|rate decision|monetary policy)\b/i;
const MARKET = /\b(auction|tender|bill|repo|issuance|syndication|bond programme|prefu)\b/i;
const ANALYSIS = /\b(preview|preview:|wrap|recap|what to watch|análisis|outlook)\b/i;
const MACRO = /\b(cpi|pce|ppi|gdp|pmi|payroll|retail|housing|employment|jobless|trade balance|current account|ipc|pib)\b/i;

export const OFFICIAL_NOISE = /museum|banknote|award|prize|subcommittee|recruitment|vacancy|commemorat|exhibition|coin issue|carl menger|visit dunedin|cyber and ai|independent report|tsb to commission|assistant governor|member appointed|appointed as|notice of vesting|more about/i;
export const OFFICIAL_KEEP = /monetary policy|interest rate|inflation|ocr|fomc|financial stability|gdp|cpi|labour|labor|employment|intervention|bills|repo|profit distribution|prefu|bond programme|balance of payments|assessment|outlook|forecast|unemployment|pmi|trade|fiscal|budget|remarks|speech|minutes|beige book|rate decision|press conference|liquidity|reserves|swap lines|ocr/i;

export function fingerprint(title, url = '') {
  return createHash('sha1').update(`${(title || '').trim().toLowerCase()}|${url}`).digest('hex');
}

export function parseNumber(v) {
  const m = /-?\d+(?:\.\d+)?/.exec(String(v ?? '').replace(/,/g, ''));
  return m ? Number(m[0]) : null;
}

export function parseMacro(text) {
  const t = String(text || '');
  const actual = /ACTUAL[:\s]+(-?[\d.,]+%?)/i.exec(t)?.[1]
    || /(\d+(?:\.\d+)?%?)\s+vs\s+/i.exec(t)?.[1]
    || null;
  const forecast = /FORECAST[:\s]+(-?[\d.,]+%?)/i.exec(t)?.[1]
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

export function parseRss(xml) {
  const items = [];
  const blocks = String(xml || '').split(/<item[\s>]/i).slice(1);
  const rdf = !blocks.length ? String(xml || '').split(/<item[\s>]/i) : blocks;
  const chunks = String(xml).match(/<item[\s\S]*?<\/item>/gi) || String(xml).match(/<rdf:li[\s\S]*?<\/rdf:li>/gi) || [];
  const use = chunks.length ? chunks : rdf;
  for (const block of use) {
    const title = decodeEntities(/<title[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/title>/i.exec(block)?.[1] || /<title[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/title>/i.exec(block)?.[2] || '');
    const url = (/<link[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/link>/i.exec(block)?.[1]
      || /<link[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/link>/i.exec(block)?.[2]
      || /<link[^>]*href="([^"]+)"/i.exec(block)?.[1]
      || '').trim();
    const dateRaw = /<pubDate[^>]*>([^<]+)/i.exec(block)?.[1]
      || /<dc:date[^>]*>([^<]+)/i.exec(block)?.[1]
      || /<updated[^>]*>([^<]+)/i.exec(block)?.[1]
      || '';
    const body = decodeEntities(/<description[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/description>/i.exec(block)?.[1]
      || /<description[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/description>/i.exec(block)?.[2]
      || '');
    if (!title) continue;
    const published = Date.parse(dateRaw);
    items.push({
      title: title.trim(),
      url,
      body,
      published_at: Number.isFinite(published) ? new Date(published).toISOString() : new Date().toISOString(),
    });
  }
  return items;
}

export function parseTelegram(html) {
  const items = [];
  const msgs = String(html || '').split('tgme_widget_message_wrap');
  for (const block of msgs.slice(1)) {
    const text = decodeEntities(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] || '');
    const when = /datetime="([^"]+)"/i.exec(block)?.[1];
    const url = /href="(https:\/\/t\.me\/[^"]+)"/i.exec(block)?.[1] || '';
    if (!text) continue;
    const title = text.split('\n')[0].slice(0, 280);
    const published = Date.parse(when);
    items.push({
      title,
      body: text.slice(title.length).trim(),
      url,
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
    items.push({ title, url, body: '', published_at: new Date(Date.now() - 6 * 3600_000).toISOString() });
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

export function enrichRaw(raw, source) {
  const text = `${raw.title} ${raw.body || ''}`;
  const macro = parseMacro(text);
  const currencies = detectCurrencies(text, source.currency || null);
  const item = {
    title: raw.title,
    body: raw.body || '',
    source: source.name.replace(/ ·.*/, '').replace(/ \/ NZDM/, ''),
    source_id: source.id,
    source_type: source.type,
    url: raw.url || source.url,
    published_at: raw.published_at,
    currencies,
    category: categorize(text),
    actual: macro.actual,
    forecast: macro.forecast,
    previous: macro.previous,
    calendar_title: null,
    fingerprint: fingerprint(raw.title, raw.url),
  };
  const z = surpriseZ(item);
  item.z = z.z;
  item.absZ = z.absZ;
  item.impact = impactOf(item);
  return item;
}

export function sourceById(id) {
  return SOURCES.find((s) => s.id === id);
}

export { INVERTED };
