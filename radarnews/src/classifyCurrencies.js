import { CURRENCIES, WINDOWS } from './config.js';

const INVERTED = /unemployment|jobless|claims|paro|desempleo/i;
const CPI = /\b(cpi|inflation|ipc|pce|ppi|lkh|teuerung|preisstabilität)\b/i;
const WEAK = /\b(stagflation|unsustainable|recession|contraction|slowdown|deteriorat|weak economy|economía débil|poco sostenible|pmi (?:falls|drops|contracts)|below 50|retail (?:sales )?(?:miss|fall|drop)|jobless (?:rise|jump)|unemployment (?:rise|up))\b/i;
const STRONG = /\b(expansion|beat|hot (?:economy|labor)|tight labour|capacity|overheating|pmi (?:jumps|rises)|above 52|payrolls beat|strong growth)\b/i;
const HIKE = /\b(hike|tighten|hawkish|raises rates|rate rise|higher for longer|restrictive)\b/i;
const CUT = /\b(cut rates|dovish|easing|lowers rates|rate cut|accommodative)\b/i;
const NO_HIKE = /\b(doesn['’]?t hike|won't hike|no hike|holds rates|on hold|pausa(?:rá)?)\b/i;
const FISCAL_SCARE = /\b(deficit|debt ceiling|downgrade|cannot afford|austerity|unfunded)\b/i;
const FISCAL_DRAIN = /\b(tax (?:hike|increase)|austerity|spending cut|surplus)\b/i;
const NFA_ADD = /\b(deficit spending|fiscal impulse|profit distribution|bond programme increased|untaxed)\b/i;
const GEO_SEVERE = /\b(war|missile|invasion|strike on|nuclear|hormuz closed|attack)\b/i;
const TRADE = /\b(trade balance|current account|exports?|imports?|terms of trade|dairy)\b/i;
const SAFE = new Set(['USD', 'JPY', 'CHF']);
const BETA = new Set(['AUD', 'NZD', 'CAD']);

export function biasFor(score) {
  if (score > 20) return 'alcista';
  if (score < -20) return 'bajista';
  return 'neutral';
}

export function isNoEvidence(row) {
  const noDrv = !row.drivers?.length || /^sin catalizadores/i.test(row.drivers[0] || '');
  return noDrv && Math.abs(row.score || 0) <= 3;
}

export function clamp(n, lo = -100, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

export function parseNum(v) {
  const m = /-?\d+(?:\.\d+)?/.exec(String(v ?? '').replace(/,/g, ''));
  return m ? Number(m[0]) : null;
}

export function surpriseSigned(item) {
  const a = parseNum(item.actual);
  const f = parseNum(item.forecast) ?? parseNum(item.previous);
  if (a == null || f == null || a === f) return 0;
  let dir = a > f ? 1 : -1;
  if (INVERTED.test(item.title || '')) dir = -dir;
  const mag = Math.min(18, 6 + (item.absZ ? item.absZ * 4 : 4));
  return dir * mag;
}

export function detectRealRegime(items, ccy) {
  const mine = items.filter((n) => (n.currencies || []).includes(ccy));
  const blob = mine.map((n) => n.title).join(' · ');
  const weakHits = mine.filter((n) => WEAK.test(n.title) || (parseNum(n.actual) != null && surpriseSigned(n) < 0 && /\b(pmi|gdp|retail|payroll|employment)\b/i.test(n.title))).length;
  const strongHits = mine.filter((n) => STRONG.test(n.title) || (surpriseSigned(n) > 0 && /\b(pmi|gdp|payroll|employment)\b/i.test(n.title) && !INVERTED.test(n.title))).length;
  if (WEAK.test(blob) || weakHits >= 2 && weakHits > strongHits) return 'weak';
  if (strongHits >= 2 && strongHits > weakHits) return 'strong';
  return 'mixed';
}

export const MOSLER_RULES = `Clasificación FX según Soft Currency Economics (Warren Mosler / MMT), no textbook hawkish=long.

INVARIANTES
1. Solo titulares aportados. Prohibido inventar hechos, precios o arrastre regional (un dato de Francia no puntúa NZD).
2. Cada catalizador debe citar el fingerprint o el titular literal.
3. CPI/inflación ALTO con economía DÉBIL, en contracción o poco sostenible NO es soporte de la moneda (canal precio relativo / cost-push). Techo 0 en ese catalizador.
4. El tipo overnight es el PRECIO del dinero (añadir/drenar reservas), no la cantidad. Un hike NO convierte automáticamente la divisa en soporte. En cost-push el hike no suma.
5. El déficit no "financia" gasto; la emisión drena reservas (IRMA). Un titular de déficit/deuda/downgrade NO es presión automática.
6. Interés pagado sobre pasivos públicos es ingreso del no-gobierno (canal NFA). Tratarlo como operacional, no como tightness real.
7. Divisa sin titulares propios: score 0, drivers ["Sin catalizadores en el ciclo"], rationale de evidencia nula. Prohibido rellenar con narrativa de otra región.
8. Lenguaje de mesa, no de ejecución: Soporte / Presión / Neutral / N/D. Prohibido "long", "short", "vía libre operativa", "sesgo largo/corto".
9. Máximo 3 drivers, < 60 caracteres, en español. Score −100..+100. bias interno: alcista>20, bajista<-20, si no neutral.
10. Evidencia débil ⇒ rango −40…+40. No devolver puntuaciones idénticas entre divisas que SÍ tienen evidencia.`;

function channelAndRaw(item, ccy, regime) {
  const text = `${item.title} ${item.body || ''}`;
  const surprise = surpriseSigned(item);
  const w = item.source_type === 'oficial' ? 1.25 : item.impact >= 4 ? 1.15 : 1;
  let raw = 0;
  let channel = 'DATA_REAL';
  let driver = item.title.slice(0, 52);

  if (CPI.test(text) || (/\binflation\b/i.test(text) && surprise)) {
    if (regime === 'weak' || WEAK.test(text)) {
      channel = 'RELATIVE_PRICE';
      raw = Math.min(0, surprise) * w;
      driver = 'CPI escasez relativa, no NFA';
    } else if (regime === 'strong') {
      channel = 'DATA_REAL';
      raw = clamp(surprise * 0.45, -8, 8) * w;
      driver = 'CPI con economía en capacidad';
    } else {
      channel = 'DATA_REAL';
      raw = clamp(surprise * 0.6, -12, 12) * w;
      driver = 'CPI vs consenso';
    }
    return { raw, channel, driver };
  }

  if (NO_HIKE.test(text)) {
    channel = 'POLICY_PRICE';
    raw = regime === 'weak' ? 0 : -6 * w;
    driver = 'Pausa: precio del dinero, no NFA';
    return { raw, channel, driver };
  }
  if (HIKE.test(text)) {
    channel = 'POLICY_PRICE';
    raw = regime === 'weak' ? 0 : clamp(7 * w, 0, 10);
    driver = regime === 'weak' ? 'Hike en cost-push: no soporte' : 'Precio del dinero al alza';
    return { raw, channel, driver };
  }
  if (CUT.test(text)) {
    channel = 'POLICY_PRICE';
    raw = regime === 'weak' ? -8 * w : -5 * w;
    driver = 'Recorte: menos ingreso por reservas';
    return { raw, channel, driver };
  }

  if (NFA_ADD.test(text)) {
    channel = 'FISCAL_NFA';
    raw = 4 * w;
    driver = 'Inyección NFA / distribución';
    return { raw, channel, driver };
  }
  if (FISCAL_DRAIN.test(text) && !/cannot afford/i.test(text)) {
    channel = 'FISCAL_NFA';
    raw = -5 * w;
    driver = 'Drenaje fiscal / superávit';
    return { raw, channel, driver };
  }
  if (FISCAL_SCARE.test(text)) {
    channel = 'FISCAL_NFA';
    raw = 0;
    driver = 'Déficit no es restricción fiat';
    return { raw, channel, driver };
  }

  if (GEO_SEVERE.test(text)) {
    channel = 'RISK_GEO';
    if (SAFE.has(ccy)) { raw = 10 * w; driver = 'Demanda de refugio'; }
    else if (BETA.has(ccy)) { raw = -10 * w; driver = 'Beta: riesgo off'; }
    else { raw = -3 * w; driver = 'Riesgo geopolítico'; }
    return { raw, channel, driver };
  }

  if (TRADE.test(text) || item.category === 'mercado') {
    channel = item.category === 'mercado' ? 'OPERATIONAL' : 'TRADE_EXTERNAL';
    raw = clamp(surprise * 0.7, -12, 12) * w;
    if (!surprise && /increased to|programme decreased|tender/i.test(text)) raw = 0;
    driver = channel === 'OPERATIONAL' ? 'Operaciones / IRMA' : 'Sector exterior';
    return { raw, channel, driver };
  }

  if (item.actual != null || item.category === 'dato_macro') {
    channel = 'DATA_REAL';
    raw = surprise * w;
    driver = surprise > 0 ? `Dato fuerte: ${item.title.slice(0, 36)}` : surprise < 0 ? `Dato suave: ${item.title.slice(0, 36)}` : item.title.slice(0, 52);
    return { raw, channel, driver };
  }

  if (item.category === 'banco_central') {
    channel = 'POLICY_PRICE';
    raw = 2 * w * (/\b(restrictive|vigilant|inflation persistent)\b/i.test(text) ? 1 : /\b(patient|data-dependent|easing)\b/i.test(text) ? -1 : 0);
    driver = `${item.title.slice(0, 52)}`;
    return { raw, channel, driver };
  }

  raw = 0;
  channel = 'DATA_REAL';
  driver = item.title.slice(0, 52);
  return { raw, channel, driver };
}

function decay(item, now, halfLifeH) {
  const ageH = Math.max(0, (now - Date.parse(item.published_at)) / 3600_000);
  return 2 ** (-ageH / halfLifeH);
}

function windowWeight(item, now, maxMs) {
  const age = now - Date.parse(item.published_at);
  if (!Number.isFinite(age) || age < 0) return 1;
  if (age > maxMs) return 0;
  return 1;
}

export function scoreSignals(items, now = Date.now()) {
  const regimes = Object.fromEntries(CURRENCIES.map((c) => [c, detectRealRegime(items, c)]));
  const by = Object.fromEntries(CURRENCIES.map((c) => [c, []]));
  for (const item of items) {
    for (const ccy of item.currencies || []) {
      if (!by[ccy]) continue;
      const { raw, channel, driver } = channelAndRaw(item, ccy, regimes[ccy]);
      const hl = item.source_type === 'oficial' ? WINDOWS.halfLifeOficialH : WINDOWS.halfLifeBreakingH;
      const d = decay(item, now, hl);
      by[ccy].push({
        raw,
        contrib: raw * d,
        channel,
        driver,
        title: item.title,
        fingerprint: item.fingerprint,
        at: Date.parse(item.published_at),
        item,
      });
    }
  }
  return { by, regimes };
}

function topDrivers(sigs) {
  const scored = [...sigs]
    .filter((s) => Math.abs(s.contrib) >= 0.4 || s.channel === 'RELATIVE_PRICE' || s.channel === 'FISCAL_NFA')
    .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
    .map((s) => s.driver.replace(/\s+/g, ' ').trim().slice(0, 59))
    .filter((d, i, arr) => d && !/^https?:/i.test(d) && arr.indexOf(d) === i)
    .slice(0, 3);
  if (scored.length) return scored;
  return [...sigs]
    .map((s) => (s.driver || s.title || '').replace(/\s+/g, ' ').trim().slice(0, 59))
    .filter((d, i, arr) => d && !/^https?:/i.test(d) && arr.indexOf(d) === i)
    .slice(0, 3);
}

function calcSetup(structural, impulse) {
  if (Math.abs(structural) >= 18 && Math.abs(impulse) >= 12 && Math.sign(structural) === Math.sign(impulse)) return 'confluencia';
  if (Math.abs(structural) >= 18 && Math.abs(impulse) >= 15 && Math.sign(structural) !== Math.sign(impulse)) return 'giro';
  if (Math.abs(structural) < 18 && Math.abs(impulse) >= 18) return 'impulso';
  return '';
}

export function classifyAgent(items, now = Date.now()) {
  const { by, regimes } = scoreSignals(items, now);
  return CURRENCIES.map((currency) => {
    const sigs = by[currency] || [];
    const recent = sigs.filter((s) => {
      const age = now - s.at;
      if (!Number.isFinite(age)) return false;
      if (s.item.source_type === 'oficial') return age <= WINDOWS.oficialMs;
      return age <= WINDOWS.structuralMs;
    });
    if (!recent.length) {
      return {
        currency,
        score: 0,
        structural: 0,
        impulse: 0,
        setup: '',
        bias: 'neutral',
        drivers: ['Sin catalizadores en el ciclo'],
        rationale: `Sin catalizadores claros en 0 titulares recientes.`,
        regime_note: '',
        noEvidence: true,
        channel: null,
        engine: 'agente',
      };
    }
    const structural = clamp(Math.round(recent.reduce((s, x) => s + x.contrib * windowWeight(x.item, now, WINDOWS.structuralMs) * (x.item.source_type === 'oficial' ? 1 : windowWeight(x.item, now, WINDOWS.structuralMs)), 0)));
    const impulse = clamp(Math.round(sigs.filter((x) => now - x.at <= WINDOWS.impulseMs).reduce((s, x) => s + x.raw * decay(x.item, now, 1.5), 0)));
    let score = structural;
    const weak = recent.length < 3 || Math.abs(score) <= 40;
    if (weak) score = clamp(score, -40, 40);
    const drivers = topDrivers(recent);
    if (!drivers.length) {
      return {
        currency, score: 0, structural: 0, impulse: 0, setup: '', bias: 'neutral',
        drivers: recent.slice(0, 3).map((s) => (s.title || '').slice(0, 59)).filter(Boolean).concat(['Sin catalizadores en el ciclo']).slice(0, 3),
        rationale: `${recent.length} titulares oficiales sin canal cuantificable · Neutral.`,
        regime_note: '', noEvidence: false, channel: null, engine: 'agente',
      };
    }
    const mainCh = recent.slice().sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))[0]?.channel;
    const rationale = `${recent.length} señales en ${recent.length} titulares · Est ${score >= 0 ? '+' : ''}${score} | Imp 3h ${impulse >= 0 ? '+' : ''}${impulse}${weak ? ' · evidencia débil' : ''}. Régimen real ${regimes[currency]}. Canal ${mainCh}.`;
    return {
      currency,
      score,
      structural: score,
      impulse,
      setup: calcSetup(score, impulse),
      bias: biasFor(score),
      drivers,
      rationale,
      regime_note: '',
      noEvidence: false,
      channel: mainCh,
      engine: 'agente',
    };
  });
}

export function attachRanks(rows) {
  const measured = rows.filter((r) => !isNoEvidence(r)).sort((a, b) => b.score - a.score);
  const unmeasured = rows.filter((r) => isNoEvidence(r));
  let rank = 1;
  return [
    ...measured.map((r) => ({ ...r, rank: rank++, noEvidence: false })),
    ...unmeasured.map((r) => ({ ...r, score: 0, structural: 0, impulse: 0, bias: 'neutral', rank: null, noEvidence: true })),
  ];
}

export function rankingAlerts(prevRows, nextRows, engineLabel) {
  const alerts = [];
  const prev = new Map((prevRows || []).map((r) => [r.currency, r]));
  for (const r of nextRows) {
    const p = prev.get(r.currency);
    if (!p) continue;
    if (isNoEvidence(r) || isNoEvidence(p)) continue;
    if (p.bias && r.bias && p.bias !== r.bias) {
      alerts.push({
        title: `Cambio de régimen ${r.currency} (${engineLabel}): ${p.bias} → ${r.bias}`,
        body: `Score narrativo ${p.score} → ${r.score}. ${r.drivers[0] || ''}`,
        level: 'alto',
        alert_type: 'cambio_regimen',
        currency: r.currency,
      });
    }
  }
  const prevM = (prevRows || []).filter((r) => !isNoEvidence(r) && r.rank);
  const nextM = nextRows.filter((r) => !isNoEvidence(r) && r.rank);
  const prevLeader = prevM.find((r) => r.rank === 1);
  const nextLeader = nextM.find((r) => r.rank === 1);
  if (prevLeader && nextLeader && prevLeader.currency !== nextLeader.currency && Math.abs(nextLeader.score) >= 15) {
    alerts.push({
      title: `Cambio de ranking (${engineLabel}): lidera ${nextLeader.currency}`,
      body: `${nextLeader.currency} ${nextLeader.score >= 0 ? '+' : ''}${nextLeader.score} releva a ${prevLeader.currency}.`,
      level: 'alto',
      alert_type: 'cambio_ranking',
      currency: nextLeader.currency,
    });
  }
  for (const r of nextM) {
    const p = prev.get(r.currency);
    if (!p?.rank || !r.rank) continue;
    if (Math.abs(p.rank - r.rank) >= 2 && Math.abs((r.score || 0) - (p.score || 0)) >= 10) {
      alerts.push({
        title: `Cambio de ranking ${r.currency} (${engineLabel})`,
        body: `#${p.rank} → #${r.rank} · ${p.score} → ${r.score}`,
        level: 'medio',
        alert_type: 'cambio_ranking',
        currency: r.currency,
      });
    }
  }
  return alerts;
}

export { calcSetup };
