export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];

export const BANK = {
  USD: 'Fed',
  EUR: 'BCE',
  GBP: 'BoE',
  JPY: 'BoJ',
  CHF: 'SNB',
  CAD: 'BoC',
  AUD: 'RBA',
  NZD: 'RBNZ',
};

export const PAIR_PRIORITY = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

export const BIAS_LABEL = {
  alcista: 'Soporte',
  bajista: 'Presión',
  neutral: 'Neutral',
};

export const CHANNEL_LABEL = {
  DATA_REAL: 'Dato real',
  RELATIVE_PRICE: 'Precio relativo',
  POLICY_PRICE: 'Precio del dinero',
  FISCAL_NFA: 'NFA / fiscal',
  RISK_GEO: 'Riesgo',
  TRADE_EXTERNAL: 'Sector exterior',
  OPERATIONAL: 'Operacional',
};

export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];
export const GEMINI_MODEL = GEMINI_MODELS[0];

export const WINDOWS = {
  breakingMs: 3 * 86400_000,
  agenciaMs: 3 * 86400_000,
  oficialMs: 30 * 86400_000,
  structuralMs: 72 * 3600_000,
  impulseMs: 3 * 3600_000,
  halfLifeBreakingH: 36,
  halfLifeOficialH: 240,
  fetchTimeoutMs: 15_000,
  refreshMs: 5 * 60_000,
  turboMs: 15_000,
  staleMs: 15 * 60_000,
  insertCap: 60,
};

export const UA = 'RadarNews/2.0 (institutional G8 terminal; +https://radarnews.local)';

const BURBUJA = process.env.RADARNEWS_BURBUJA_CHANNEL || 'BurbujaDeMercados';

/** Existing production sources are preserved. NZD/CHF official + requested Telegram are added. */
export const SOURCES = [
  { id: 'financialjuice', name: 'FinancialJuice', type: 'breaking', kind: 'telegram', url: 'https://t.me/s/FinancialJuice' },
  { id: 'fed', name: 'Fed', type: 'oficial', kind: 'rss', url: 'https://www.federalreserve.gov/feeds/press_all.xml', currency: 'USD' },
  { id: 'ecb', name: 'BCE', type: 'oficial', kind: 'rss', url: 'https://www.ecb.europa.eu/rss/press.html', currency: 'EUR' },
  { id: 'boe', name: 'BoE', type: 'oficial', kind: 'rss', url: 'https://www.bankofengland.co.uk/rss/news', currency: 'GBP' },
  { id: 'boj', name: 'BoJ', type: 'oficial', kind: 'rss', url: 'https://www.boj.or.jp/en/rss/whatsnew.xml', currency: 'JPY' },
  { id: 'boc', name: 'BoC', type: 'oficial', kind: 'rss', url: 'https://www.bankofcanada.ca/content_type/press-releases/feed/', currency: 'CAD' },
  { id: 'rba', name: 'RBA', type: 'oficial', kind: 'rss', url: 'https://www.rba.gov.au/rss/rss-cb-media-releases.xml', currency: 'AUD' },
  { id: 'rbnz', name: 'RBNZ', type: 'oficial', kind: 'rss', url: 'https://www.rbnz.govt.nz/feeds/news', currency: 'NZD' },
  { id: 'nz-treasury', name: 'NZ Treasury / NZDM', type: 'oficial', kind: 'rss', url: 'https://www.treasury.govt.nz/feeds/news', currency: 'NZD' },
  { id: 'stats-nz', name: 'Stats NZ', type: 'oficial', kind: 'html', url: 'https://www.stats.govt.nz/news/', currency: 'NZD' },
  { id: 'snb-press', name: 'SNB · Comunicados', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/pressrel', currency: 'CHF' },
  { id: 'snb-mopo', name: 'SNB · Política monetaria', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/mopo', currency: 'CHF' },
  { id: 'snb-speeches', name: 'SNB · Discursos', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/speeches', currency: 'CHF' },
  { id: 'snb-adhoc', name: 'SNB · Ad hoc', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/adhoc', currency: 'CHF' },
  { id: 'snb-bills', name: 'SNB · Bills', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/snbbbills', currency: 'CHF' },
  { id: 'snb-cycle', name: 'SNB · Ciclo', type: 'oficial', kind: 'rss', url: 'https://www.snb.ch/public/rss/en/buscycletrends', currency: 'CHF' },
  { id: 'seco', name: 'SECO', type: 'oficial', kind: 'html', url: 'https://www.seco.admin.ch/en/press-releases', currency: 'CHF' },
  { id: 'bis', name: 'BIS', type: 'oficial', kind: 'rss', url: 'https://www.bis.org/doclist/all_pressrels.rss' },
  { id: 'bis-speeches', name: 'BIS · Discursos', type: 'oficial', kind: 'rss', url: 'https://www.bis.org/doclist/cbspeeches.rss' },
  { id: 'investinglive', name: 'InvestingLive', type: 'agencia', kind: 'telegram', url: 'https://t.me/s/InvestingLiveNews' },
  { id: 'ft-economy', name: 'FT · Economía global', type: 'agencia', kind: 'rss', url: 'https://www.ft.com/global-economy?format=rss' },
  { id: 'ft-markets', name: 'FT · Mercados', type: 'agencia', kind: 'rss', url: 'https://www.ft.com/markets?format=rss' },
  { id: 'ft-currencies', name: 'FT · Divisas', type: 'agencia', kind: 'rss', url: 'https://www.ft.com/currencies?format=rss' },
  { id: 'negociostv', name: 'Negocios TV', type: 'agencia', kind: 'telegram', url: 'https://t.me/s/negociostv' },
  { id: 'burbuja-mercados', name: 'Burbuja de Mercados', type: 'agencia', kind: 'telegram', url: `https://t.me/s/${BURBUJA}` },
];

export const PRESERVED_SOURCE_IDS = [
  'financialjuice', 'fed', 'ecb', 'boe', 'boj', 'boc', 'rba',
  'investinglive', 'ft-economy', 'ft-markets', 'ft-currencies',
];

export const CCY_KEYWORDS = {
  USD: /\b(usd|u\.s\.a?|united states|dollar|greenback|fed\b|fomc|powell|treasury|payrolls?|nonfarm|cpi|pce|ism|jackson hole)\b/i,
  EUR: /\b(eur\b|euro\b|eurozone|euro area|ecb|bce|lagarde|germany|bund|france|italy)\b/i,
  GBP: /\b(gbp|sterling|pound|boe|bank of england|bailey|uk\b|britain|gilt)\b/i,
  JPY: /\b(jpy|yen\b|boj|bank of japan|ueda|japan(?!ese knot))\b/i,
  CHF: /\b(chf|franc|snb|swiss|switzerland|seco|bfs|zurich|bern)\b/i,
  CAD: /\b(cad|loonie|boc|bank of canada|canada|macklem|oil sands)\b/i,
  AUD: /\b(aud|aussie|rba|australia|bullock)\b/i,
  NZD: /\b(nzd|kiwi|rbnz|new zealand|ocr|wellington|stats nz)\b/i,
};

export const DATA_DIR = process.env.RADARNEWS_DATA_DIR || new URL('../data/', import.meta.url).pathname;
export const PORT = Number(process.env.PORT || process.env.RADARNEWS_PORT || 4700);
export const HOST = process.env.RADARNEWS_BIND || '127.0.0.1';
