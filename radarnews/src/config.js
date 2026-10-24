// Keywords containing uppercase letters are matched case-sensitively ("US" vs "us").
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];

export const CURRENCY_INFO = {
  USD: { bank: 'Fed', keywords: ['dollar', 'fed', 'fomc', 'powell', 'treasury', 'treasuries', 'payrolls', 'nfp', 'US', 'U.S.', 'united states', 'american', 'white house', 'trump', 'bessent', 'usd'], cb: ['fed', 'fomc', 'powell', 'federal reserve'] },
  EUR: { bank: 'BCE', keywords: ['euro', 'ecb', 'lagarde', 'eurozone', 'euro area', 'euro zone', 'germany', 'german', 'france', 'french', 'italy', 'italian', 'spain', 'spanish', 'bund', 'bunds', 'eur'], cb: ['ecb', 'lagarde', 'governing council'] },
  GBP: { bank: 'BoE', keywords: ['pound', 'sterling', 'boe', 'bank of england', 'bailey', 'UK', 'U.K.', 'britain', 'british', 'gilt', 'gilts', 'gbp'], cb: ['boe', 'bank of england', 'bailey', 'mpc'] },
  JPY: { bank: 'BoJ', keywords: ['yen', 'boj', 'bank of japan', 'ueda', 'japan', 'japanese', 'jgb', 'jgbs', 'jpy'], cb: ['boj', 'bank of japan', 'ueda'] },
  CHF: { bank: 'SNB', keywords: ['franc', 'snb', 'swiss', 'switzerland', 'schlegel', 'chf'], cb: ['snb', 'swiss national bank', 'schlegel'] },
  CAD: { bank: 'BoC', keywords: ['loonie', 'boc', 'bank of canada', 'canada', 'canadian', 'macklem', 'cad'], cb: ['boc', 'bank of canada', 'macklem'] },
  AUD: { bank: 'RBA', keywords: ['aussie', 'rba', 'reserve bank of australia', 'australia', 'australian', 'bullock', 'aud'], cb: ['rba', 'reserve bank of australia', 'bullock'] },
  NZD: { bank: 'RBNZ', keywords: ['kiwi', 'rbnz', 'reserve bank of new zealand', 'new zealand', 'nzd'], cb: ['rbnz', 'reserve bank of new zealand'] },
};

const DAY = 24 * 3600 * 1000;

// FinancialJuice es el núcleo de breaking; las oficiales son feeds RSS públicos.
// RBNZ, SNB, BIS y FMI quedan para la Fase 2 (ver SPEC.md).
export const SOURCES = [
  { id: 'financialjuice', name: 'FinancialJuice', type: 'breaking', kind: 'telegram', url: 'https://t.me/s/FinancialJuice', freshnessMs: 3 * DAY },
  { id: 'fed', name: 'Fed', type: 'oficial', kind: 'rss', url: 'https://www.federalreserve.gov/feeds/press_all.xml', freshnessMs: 30 * DAY, currency: 'USD' },
  { id: 'ecb', name: 'BCE', type: 'oficial', kind: 'rss', url: 'https://www.ecb.europa.eu/rss/press.html', freshnessMs: 30 * DAY, currency: 'EUR' },
  { id: 'boe', name: 'BoE', type: 'oficial', kind: 'rss', url: 'https://www.bankofengland.co.uk/rss/news', freshnessMs: 30 * DAY, currency: 'GBP' },
  { id: 'boj', name: 'BoJ', type: 'oficial', kind: 'rss', url: 'https://www.boj.or.jp/en/rss/whatsnew.xml', freshnessMs: 30 * DAY, currency: 'JPY' },
  { id: 'boc', name: 'BoC', type: 'oficial', kind: 'rss', url: 'https://www.bankofcanada.ca/content_type/press-releases/feed/', freshnessMs: 30 * DAY, currency: 'CAD' },
  { id: 'rba', name: 'RBA', type: 'oficial', kind: 'rss', url: 'https://www.rba.gov.au/rss/rss-cb-media-releases.xml', freshnessMs: 30 * DAY, currency: 'AUD' },
  // investinglive.com blocks server requests (CloudFront 403); its public Telegram mirror is a delayed feed.
  { id: 'investinglive', name: 'InvestingLive', type: 'agencia', kind: 'telegram', url: 'https://t.me/s/InvestingLiveNews', freshnessMs: 3 * DAY },
  { id: 'ft-economy', name: 'FT', label: 'FT · Economía global', type: 'agencia', kind: 'rss', url: 'https://www.ft.com/global-economy?format=rss', freshnessMs: 3 * DAY },
  { id: 'ft-markets', name: 'FT', label: 'FT · Mercados', type: 'agencia', kind: 'rss', url: 'https://www.ft.com/markets?format=rss', freshnessMs: 3 * DAY },
  { id: 'ft-currencies', name: 'FT', label: 'FT · Divisas', type: 'agencia', kind: 'rss', url: 'https://www.ft.com/currencies?format=rss', freshnessMs: 3 * DAY },
];

export const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
export const CALENDAR_REFRESH_MS = 60 * 60 * 1000;
export const CALENDAR_PREALERT_MIN = 15;

export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_INSERT_PER_CYCLE = 60;
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;
export const CLASSIFIER_HEADLINES = 70;

export const OFFICIAL_RELEVANT = [
  'rate', 'rates', 'interest', 'monetary policy', 'policy decision', 'inflation', 'cpi', 'hicp', 'gdp',
  'employment', 'unemployment', 'labour market', 'labor market', 'jobs', 'wage', 'intervention',
  'speech', 'remarks', 'testimony', 'statement', 'minutes', 'press conference', 'outlook', 'forecast',
  'projections', 'financial stability', 'balance sheet', 'quantitative', 'tightening', 'easing',
  'fomc', 'mpc', 'governing council', 'policy board', 'yield', 'bond', 'liquidity', 'currency', 'exchange rate',
  'economic', 'economy', 'monetary', 'tankan', 'outlook report', 'interview',
];

export const OFFICIAL_NOISE = [
  'museum', 'banknote', 'banknotes', 'coin', 'coins', 'award', 'prize', 'competition', 'artwork', 'exhibition',
  'appointment', 'appoints', 'appointed', 'vacancy', 'recruitment', 'procurement', 'tender', 'committee member',
  'advisory group', 'board of directors', 'annual report on', 'accessibility', 'charity', 'volunteer',
  'school', 'student', 'education', 'heritage', 'enforcement action', 'termination of enforcement', 'agreement with',
  'cyber', 'it system', 'website', 'holiday', 'closure', 'gender', 'diversity', 'sustainability report',
  'sub-committee', 'sub committee', 'fxjsc', 'court of directors', 'deputy governor position', 'schedule for',
  'bank note', 'educators', 'survey of consumer finances', 'bis project', 'payments system', 'coordination exercise',
];

export const MACRO_TERMS = [
  'cpi', 'ppi', 'pce', 'gdp', 'pmi', 'payrolls', 'nfp', 'unemployment', 'jobless', 'claims', 'retail sales',
  'inflation', 'trade balance', 'current account', 'industrial production', 'housing starts', 'ism',
  'consumer confidence', 'sentiment', 'wage', 'earnings', 'employment change', 'rate decision', 'interest rate',
];

export const CENTRAL_BANK_TERMS = [
  'fed', 'fomc', 'powell', 'ecb', 'lagarde', 'boe', 'bailey', 'boj', 'ueda', 'snb', 'boc', 'rba', 'rbnz',
  'central bank', 'rate cut', 'rate hike', 'rate decision', 'hawkish', 'dovish', 'monetary policy', 'mpc',
  'governing council', 'macklem', 'bullock', 'schlegel', 'waller', 'williams', 'schnabel', 'lane',
];

export const GEO_TERMS = [
  'war', 'missile', 'strike', 'attack', 'invasion', 'ceasefire', 'sanction', 'sanctions', 'tariff', 'tariffs',
  'nato', 'iran', 'israel', 'russia', 'ukraine', 'china', 'taiwan', 'north korea', 'military', 'troops',
  'election', 'defense', 'nuclear', 'gaza', 'houthi', 'opec', 'coup', 'embargo',
];

export const MARKET_TERMS = [
  'stocks', 'equities', 'yields', 'bond', 'bonds', 'oil', 'crude', 'gold', 'futures', 's&p', 'nasdaq',
  'dow', 'treasury yields', 'fx', 'forex', 'dollar index', 'dxy', 'brent', 'wti',
];

export const ANALYSIS_TERMS = ['analysts', 'expects', 'sees', 'forecasts', 'strategist', 'strategists', 'note', 'research', 'survey', 'poll'];
