import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTelegram, parseFeed } from '../src/fetchers.js';

const tg = `
<div class="tgme_widget_message" data-post="FinancialJuice/100">
  <div class="tgme_widget_message_text js-message_text">AUSTRALIAN SERVICES PMI FLASH ACTUAL 47.8 (FORECAST -, PREVIOUS 51.9) &#036;MACRO|<a href="https://t.me/FinancialJuice">FJ</a></div>
  <time datetime="2026-10-22T22:00:00+00:00" class="time"></time>
</div>
<div class="tgme_widget_message" data-post="InvestingLiveNews/7">
  <div class="tgme_widget_message_text js-message_text"><a href="https://investinglive.com/x">https://investinglive.com/x</a><br/>This is a delayed news feed.</div>
  <a class="tgme_widget_message_link_preview" href="https://investinglive.com/x"><div class="link_preview_title">Japan CPI 2.1% y/y (expected 2.1%)</div><div class="link_preview_description">Just the data.</div></a>
  <time datetime="2026-10-22T23:45:39+00:00" class="time"></time>
</div>`;

test('telegram: strips the |FJ tag and $MACRO, reads link previews', () => {
  const { items, minId } = parseTelegram(tg, 'https://t.me/s/x');
  assert.equal(minId, 7);
  assert.equal(items[0].title, 'AUSTRALIAN SERVICES PMI FLASH ACTUAL 47.8 (FORECAST -, PREVIOUS 51.9)');
  assert.equal(items[0].url, 'https://t.me/FinancialJuice/100');
  assert.equal(items[0].published_at, '2026-10-22T22:00:00.000Z');
  assert.equal(items[1].title, 'Japan CPI 2.1% y/y (expected 2.1%)');
  assert.equal(items[1].url, 'https://investinglive.com/x');
  assert.equal(items[1].body, 'Just the data.');
});

test('feeds: RSS 2.0 with CDATA, RDF (RSS 1.0) and Atom', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><item><title><![CDATA[Fed holds rates]]></title><link>https://fed/1</link><pubDate>Wed, 21 Oct 2026 10:00:00 +0200</pubDate></item></channel></rss>`;
  const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://purl.org/rss/1.0/"><item rdf:about="x"><title>RBA cash rate</title><link>https://rba/1</link><dc:date>2026-10-14T14:00:00+11:00</dc:date></item></rdf:RDF>`;
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>SNB statement</title><link rel="alternate" href="https://snb/1"/><updated>2026-10-01T08:00:00Z</updated></entry></feed>`;
  assert.deepEqual(parseFeed(rss).map((i) => [i.title, i.url, i.published_at]), [['Fed holds rates', 'https://fed/1', '2026-10-21T08:00:00.000Z']]);
  assert.deepEqual(parseFeed(rdf).map((i) => [i.title, i.published_at]), [['RBA cash rate', '2026-10-14T03:00:00.000Z']]);
  assert.deepEqual(parseFeed(atom).map((i) => [i.title, i.url]), [['SNB statement', 'https://snb/1']]);
});
