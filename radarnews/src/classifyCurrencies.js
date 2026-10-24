import { randomUUID } from 'node:crypto';
import { CURRENCIES, CURRENCY_INFO, CLASSIFIER_HEADLINES } from './config.js';
import { hasAny, macroSurprise } from './enrich.js';
import { llmProvider, classifyWithLlm } from './llm.js';

export const biasFor = (score) => (score > 20 ? 'alcista' : score < -20 ? 'bajista' : 'neutral');

export function clipPhrase(s, max = 59) {
  const t = String(s || '').replace(/[\u2757\u203C\u{1F300}-\u{1FAFF}]/gu, '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

const HAWKISH = ['hike', 'hikes', 'hiking', 'raise rates', 'raises rates', 'hawkish', 'tighten', 'tightening', 'sticky inflation', 'inflation pressures', 'higher for longer', 'no rush to cut', 'premature to cut', 'restrictive'];
const DOVISH = ['cut', 'cuts', 'cutting', 'rate cut', 'dovish', 'easing', 'ease', 'lower rates', 'lowers rates', 'accommodative', 'stimulus', 'qe', 'pause'];
const STRONG = ['beats', 'beat', 'stronger', 'strong', 'robust', 'surge', 'surges', 'jumps', 'accelerates', 'upgrade', 'upgrades', 'above expectations', 'hotter', 'resilient', 'expands', 'rebounds', 'rises', 'rose', 'climbs', 'highest'];
const WEAK = ['weak', 'weaker', 'slows', 'slowdown', 'contraction', 'contracts', 'recession', 'plunge', 'plunges', 'misses', 'below expectations', 'downgrade', 'downgrades', 'cools', 'stagnation', 'shrinks', 'falls', 'drops', 'declines', 'lowest', 'slumps'];
const POLITICAL = ['resign', 'resigns', 'shutdown', 'default', 'impeach', 'political crisis', 'no confidence', 'fiscal crisis', 'debt ceiling', 'snap election', 'downgrade'];
const WEAKEN_INTERVENTION = ['weaken', 'weaker currency', 'sell francs', 'sell yen', 'cap the'];
const SEVERE_GEO = ['war', 'missile', 'attack', 'invasion', 'nuclear', 'airstrike', 'strikes on', 'escalation', 'martial law'];
const INVERTED = ['unemployment', 'jobless', 'claims'];
const PAIR_RE = /\b(?:usd|eur|gbp|jpy|chf|cad|aud|nzd|dollar|euro|sterling|pound|yen|franc|loonie|aussie|kiwi|cable)\s*\/\s*(?:usd|eur|gbp|jpy|chf|cad|aud|nzd|dollar|euro|sterling|pound|yen|franc|loonie|aussie|kiwi)\b/i;
const NEGATED_HIKE = /\b(no|not|doesn't|don't|won't|no longer|without)\b[^.]{0,40}\bhik(e|es|ing)\b/i;
const SAFE_HAVEN = { JPY: 0.8, CHF: 0.8, USD: 0.4, AUD: -0.5, NZD: -0.5, CAD: -0.2 };

function weight(item, now) {
  const ageH = Math.max(0, (now - Date.parse(item.published_at)) / 3600_000);
  const halfLife = item.source_type === 'oficial' ? 240 : 36;
  return item.impact ** 1.3 * 0.5 ** (ageH / halfLife);
}

function shortSubject(title) {
  return title.split(/\s+ACTUAL\s+/i)[0].replace(/\s+/g, ' ').trim();
}

// Returns [{currency, value, phrase}] signed contributions for a single headline.
export function headlineSignals(item, now = Date.now()) {
  const text = item.source_type === 'oficial' ? `${item.title} ${item.body || ''}` : item.title;
  const priceMove = PAIR_RE.test(text) || item.category === 'mercado';
  const w = weight(item, now);
  const out = [];
  const push = (currency, dir, phrase) => out.push({ currency, value: dir * w, phrase: clipPhrase(phrase), item });

  const banksNamed = item.currencies.filter((c) => hasAny(text, CURRENCY_INFO[c].cb));
  const negatedHike = NEGATED_HIKE.test(text);

  for (const c of item.currencies) {
    if (item.category === 'dato_macro' && item.actual != null) {
      const s = macroSurprise(item.title, item);
      if (s.direction) {
        const scale = Math.min(1.5, 0.5 + s.magnitude * 3);
        push(c, s.direction * scale, `${s.direction > 0 ? 'Dato fuerte' : 'Dato débil'}: ${shortSubject(item.title)}`);
      }
      continue;
    }
    const bank = CURRENCY_INFO[c].bank;
    if (hasAny(text, ['intervention', 'intervene', 'intervened']) && hasAny(text, WEAKEN_INTERVENTION)) {
      push(c, -1.2, `Intervención para debilitar (${bank})`);
      continue;
    }
    const hawk = hasAny(text, HAWKISH) && !negatedHike;
    const dove = hasAny(text, DOVISH) || negatedHike;
    if (hawk !== dove) {
      // "ECB preview… EUR/USD": the tone belongs to the bank named, not to every currency mentioned.
      if (banksNamed.length && !banksNamed.includes(c)) continue;
      push(c, hawk ? 1 : -1, `${hawk ? 'Tono hawkish' : 'Tono dovish'} ${bank}: ${item.title}`);
      continue;
    }
    if (hasAny(text, POLITICAL)) {
      push(c, -0.7, `Riesgo político/fiscal: ${item.title}`);
      continue;
    }
    // "Dollar/yen falls to three-week low" is a price move, not narrative.
    // Corporate stories ("SK hynix drops US IPO plan") say nothing about the currency.
    if (priceMove || !['dato_macro', 'banco_central'].includes(item.category)) continue;
    let strong = hasAny(text, STRONG);
    let weak = hasAny(text, WEAK);
    if (strong !== weak) {
      if (hasAny(text, INVERTED)) [strong, weak] = [weak, strong];
      push(c, strong ? 0.6 : -0.6, `${strong ? 'Titular constructivo' : 'Titular negativo'}: ${item.title}`);
    }
  }

  if (item.category === 'geopolitica' && hasAny(text, SEVERE_GEO)) {
    for (const [c, k] of Object.entries(SAFE_HAVEN)) {
      push(c, k, k > 0 ? 'Flujos de refugio por riesgo geopolítico' : 'Aversión al riesgo penaliza divisas cíclicas');
    }
  }
  return out;
}

export function classifyHeuristic(headlines, now = Date.now()) {
  const acc = Object.fromEntries(CURRENCIES.map((c) => [c, { sum: 0, abs: 0, mentions: 0, signals: [] }]));
  for (const item of headlines) {
    for (const c of item.currencies) if (acc[c]) acc[c].mentions += 1;
    for (const s of headlineSignals(item, now)) {
      const a = acc[s.currency];
      a.sum += s.value;
      a.abs += Math.abs(s.value);
      a.signals.push(s);
    }
  }
  return {
    regime_note: '',
    currencies: CURRENCIES.map((c) => {
      const a = acc[c];
      const strongEvidence = a.abs >= 25 && a.signals.length >= 3;
      const cap = strongEvidence ? 100 : 40;
      const score = Math.max(-cap, Math.min(cap, Math.round(100 * Math.tanh(a.sum / 20))));
      const sorted = [...a.signals].sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
      const drivers = [];
      for (const s of sorted) {
        if (!drivers.includes(s.phrase)) drivers.push(s.phrase);
        if (drivers.length === 3) break;
      }
      const rationale = a.signals.length
        ? `${a.signals.length} señales en ${a.mentions} titulares; evidencia ${strongEvidence ? 'sólida' : 'débil'}.`
        : `Sin catalizadores claros en ${a.mentions} titulares recientes.`;
      return { currency: c, score, drivers, rationale, _tiebreak: a.sum + a.mentions * 1e-3 };
    }),
  };
}

// Applies the spec's hard rules regardless of which engine produced the raw output:
// all 8 currencies, clamp to ±100, ≤3 drivers under 60 chars, bias from score,
// no identical scores, rank 1–8 by score.
export function normalizeBatch(raw) {
  const byCode = new Map((raw.currencies || []).map((c) => [String(c.currency).toUpperCase(), c]));
  const rows = CURRENCIES.map((code) => {
    const c = byCode.get(code) || {};
    const score = Math.max(-100, Math.min(100, Math.round(Number(c.score) || 0)));
    const drivers = (Array.isArray(c.drivers) ? c.drivers : []).filter(Boolean).slice(0, 3).map((d) => clipPhrase(d));
    return { currency: code, score, drivers, rationale: clipPhrase(c.rationale || '', 400), _tiebreak: c._tiebreak ?? score };
  });

  rows.sort((a, b) => b.score - a.score || b._tiebreak - a._tiebreak);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].score >= rows[i - 1].score) rows[i].score = Math.max(-100, rows[i - 1].score - 1);
  }
  for (let i = rows.length - 2; i >= 0; i--) {
    if (rows[i].score <= rows[i + 1].score) rows[i].score = rows[i + 1].score + 1;
  }
  rows.sort((a, b) => b.score - a.score);

  return {
    regime_note: clipPhrase(raw.regime_note || '', 120),
    currencies: rows.map((r, i) => ({
      currency: r.currency, score: r.score, bias: biasFor(r.score), drivers: r.drivers, rationale: r.rationale, rank: i + 1,
    })),
  };
}

export const ENGINE_LABEL = { agente: 'Agente', gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude' };

const MIN_RANK_MOVE = 2;
const MIN_SCORE_MOVE = 10;
const MIN_LEADER_SCORE = 15;

// Ranking changes worth an alert: a new leader or laggard with real conviction,
// or a currency jumping ≥2 places with a ≥10-point score move. Reshuffles inside
// the neutral cluster are ignored.
export function rankingChanges(prevRows, nextRows) {
  if (!prevRows.length) return null;
  const prev = new Map(prevRows.map((s) => [s.currency, s]));
  const leader = nextRows[0];
  const laggard = nextRows[nextRows.length - 1];
  const oldLeader = prevRows.find((s) => s.rank === 1);
  const oldLaggard = prevRows.find((s) => s.rank === prevRows.length);
  const newLeader = oldLeader && leader.currency !== oldLeader.currency && Math.abs(leader.score) >= MIN_LEADER_SCORE ? leader : null;
  const newLaggard = oldLaggard && laggard.currency !== oldLaggard.currency && Math.abs(laggard.score) >= MIN_LEADER_SCORE ? laggard : null;
  const moves = nextRows
    .map((s) => ({ currency: s.currency, from: prev.get(s.currency)?.rank, to: s.rank, delta: s.score - (prev.get(s.currency)?.score ?? s.score) }))
    .filter((m) => m.from && Math.abs(m.from - m.to) >= MIN_RANK_MOVE && Math.abs(m.delta) >= MIN_SCORE_MOVE);
  if (!newLeader && !newLaggard && !moves.length) return null;
  return { newLeader, newLaggard, moves };
}

function rankingAlert(engine, change, snapshotAt) {
  const label = ENGINE_LABEL[engine] || engine;
  const head = [];
  if (change.newLeader) head.push(`nuevo líder ${change.newLeader.currency}`);
  if (change.newLaggard) head.push(`nuevo farolillo ${change.newLaggard.currency}`);
  const moves = change.moves.map((m) => `${m.currency} ${m.from}→${m.to}`);
  return {
    title: `Ranking ${label}: ${head.length ? head.join(' · ') : moves.slice(0, 3).join(', ')}`,
    body: moves.length ? `Movimientos: ${moves.join(', ')}` : 'Cambio en los extremos del ranking.',
    level: head.length ? 'alto' : 'medio',
    alert_type: 'cambio_ranking',
    currency: change.newLeader?.currency ?? change.newLaggard?.currency ?? change.moves[0]?.currency ?? null,
    occurred_at: snapshotAt,
  };
}

function persistBatch(db, engine, raw, snapshotAt) {
  const batch = normalizeBatch(raw);
  const prevRows = db.latestBatch(engine);
  const previous = new Map(prevRows.map((s) => [s.currency, s]));
  const batchId = randomUUID();
  const label = ENGINE_LABEL[engine] || engine;

  const regimeChanges = [];
  for (const s of batch.currencies) {
    const prev = previous.get(s.currency);
    if (prev && prev.bias !== s.bias) regimeChanges.push({ currency: s.currency, from: prev.bias, to: s.bias, score: s.score });
  }
  const regimeNote = batch.regime_note
    || (regimeChanges.length ? clipPhrase(regimeChanges.map((c) => `${c.currency}: ${c.from} → ${c.to}`).join(' · '), 120) : '');

  db.insertBatch(batch.currencies.map((s) => ({ ...s, batch_id: batchId, regime_note: regimeNote, engine, snapshot_at: snapshotAt })));

  for (const c of regimeChanges) {
    db.insertAlert({
      title: `Cambio de régimen ${c.currency} (${label}): ${c.from} → ${c.to}`,
      body: `Score narrativo ${c.score > 0 ? '+' : ''}${c.score}. ${batch.currencies.find((s) => s.currency === c.currency).drivers[0] || ''}`.trim(),
      level: 'alto',
      alert_type: 'cambio_regimen',
      currency: c.currency,
      occurred_at: snapshotAt,
    });
  }
  const ranking = rankingChanges(prevRows, batch.currencies);
  if (ranking) db.insertAlert(rankingAlert(engine, ranking, snapshotAt));

  return { engine, batch_id: batchId, regime_note: regimeNote, regime_changes: regimeChanges, ranking_change: ranking, currencies: batch.currencies };
}

// Runs the rule-based agent always and the LLM (Gemini by default) when a key is configured.
// Each engine keeps its own history, so ranking/regime alerts fire per engine.
export async function classifyCurrencies(db, { now = Date.now(), provider = llmProvider(), llm = classifyWithLlm } = {}) {
  const headlines = db.headlinesForClassifier(CLASSIFIER_HEADLINES);
  if (!headlines.length) return null;
  const snapshotAt = new Date(now).toISOString();

  const results = [persistBatch(db, 'agente', classifyHeuristic(headlines, now), snapshotAt)];
  let llmError = null;
  if (provider) {
    try {
      results.push(persistBatch(db, provider, await llm(headlines, provider), snapshotAt));
    } catch (err) {
      llmError = err.message;
      console.warn(`[clasificador] ${provider} falló: ${err.message}`);
    }
  }
  db.setMeta('llm_status', { provider, ok: provider ? !llmError : null, error: llmError, at: snapshotAt });
  return { headlines: headlines.length, results, llm_error: llmError };
}
