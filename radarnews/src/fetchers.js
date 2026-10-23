import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { FETCH_TIMEOUT_MS } from './config.js';

const UA = 'Mozilla/5.0 (compatible; RadarNews/1.0; +https://github.com)';
const TELEGRAM_PAGES = 3;

export async function fetchText(url, signal) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,application/rss+xml,*/*' },
    signal,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(typeof value === 'object' ? value['#text'] ?? '' : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  return String(v['#text'] ?? v['@_href'] ?? '');
}

function stripHtml(html) {
  return cheerio.load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

export function parseTelegram(html, channelUrl) {
  const $ = cheerio.load(html);
  const items = [];
  let minId = null;
  $('.tgme_widget_message').each((_, el) => {
    const node = $(el);
    const post = node.attr('data-post') || '';
    const id = Number(post.split('/')[1]);
    if (Number.isFinite(id)) minId = minId == null ? id : Math.min(minId, id);
    const published = toIso(node.find('time[datetime]').last().attr('datetime'));
    const postUrl = post ? `https://t.me/${post}` : channelUrl;

    // Link-only posts (InvestingLive) carry the headline in the link preview.
    const previewTitle = node.find('.link_preview_title').first().text().trim();
    if (previewTitle) {
      items.push({
        title: previewTitle,
        body: node.find('.link_preview_description').first().text().replace(/\s+/g, ' ').trim().slice(0, 500),
        url: node.find('a.tgme_widget_message_link_preview').attr('href') || postUrl,
        published_at: published,
      });
      return;
    }

    const textEl = node.find('.tgme_widget_message_text').first();
    if (!textEl.length) return;
    textEl.find('br').replaceWith('\n');
    const lines = textEl.text().split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const title = lines[0].replace(/(\s*(\|\s*FJ|\$MACRO))+\s*$/i, '').trim();
    items.push({ title, body: lines.slice(1).join(' '), url: postUrl, published_at: published });
  });
  return { items, minId };
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', trimValues: true });

export function parseFeed(body) {
  const doc = xml.parse(body);
  const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  let rawItems = [];
  if (doc.rss) rawItems = asArray(doc.rss.channel?.item);
  else if (doc['rdf:RDF']) rawItems = asArray(doc['rdf:RDF'].item);
  else if (doc.feed) rawItems = asArray(doc.feed.entry);

  return rawItems
    .map((it) => {
      const link = Array.isArray(it.link)
        ? textOf(it.link.find((l) => l['@_rel'] !== 'self') ?? it.link[0])
        : textOf(it.link);
      const date = it.pubDate ?? it['dc:date'] ?? it.updated ?? it.published;
      return {
        title: stripHtml(textOf(it.title)),
        body: stripHtml(textOf(it.description ?? it.summary ?? '')).slice(0, 500),
        url: link.trim(),
        published_at: toIso(date),
      };
    })
    .filter((i) => i.title);
}

export async function fetchSource(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout 15s')), FETCH_TIMEOUT_MS);
  try {
    if (source.kind === 'telegram') {
      const all = [];
      let before = null;
      for (let page = 0; page < TELEGRAM_PAGES; page++) {
        const url = before ? `${source.url}?before=${before}` : source.url;
        let html;
        try {
          html = await fetchText(url, controller.signal);
        } catch (err) {
          if (page === 0) throw err;
          break;
        }
        const { items, minId } = parseTelegram(html, source.url);
        all.push(...items);
        if (!minId || minId === before) break;
        before = minId;
      }
      return all;
    }
    return parseFeed(await fetchText(source.url, controller.signal));
  } finally {
    clearTimeout(timer);
  }
}
