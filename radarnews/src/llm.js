import { CURRENCIES, GEMINI_MODEL, GEMINI_MODELS } from './config.js';
import { MOSLER_RULES, biasFor, isNoEvidence, attachRanks } from './classifyCurrencies.js';

export const GEMINI_JSON_INSTRUCTIONS = `Devuelve SOLO JSON:
{
  "regime_note": "frase corta en español o vacía",
  "rows": [
    {
      "currency": "USD",
      "score": 0,
      "drivers": ["..."],
      "rationale": "comentario propio del motor, citando el TITULAR literal (nunca el hash)",
      "citations": ["fingerprint"]
    }
  ]
}
Ocho divisas. Prohibido long/short/vía libre operativa/sesgo largo.
El campo citations lleva fingerprints. El rationale es para el usuario: cita titulares, no hashes.`;

export function buildPrompt(news) {
  const lines = news.slice(0, 80).map((n) => (
    `- [${n.fingerprint}] ${n.published_at} · ${n.source} · ${(n.currencies || []).join(',')} · ${n.title}${n.actual ? ` · Act ${n.actual} Est ${n.forecast || '—'} Prev ${n.previous || '—'}` : ''}`
  ));
  return `${MOSLER_RULES}

${GEMINI_JSON_INSTRUCTIONS}

TITULARES (fingerprint entre corchetes; es la ÚNICA evidencia permitida):
${lines.join('\n') || '(ninguno)'}`;
}

export function parseModelJson(text, news) {
  const start = String(text).indexOf('{');
  const end = String(text).lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Gemini no devolvió JSON');
  const raw = JSON.parse(String(text).slice(start, end + 1));
  const byFp = new Set((news || []).map((n) => n.fingerprint).filter(Boolean));
  const incoming = new Map((raw.rows || []).map((r) => [r.currency, r]));
  const rows = CURRENCIES.map((currency) => {
    const r = incoming.get(currency) || {};
    const citations = (r.citations || []).filter((c) => byFp.has(c));
    const hasCite = citations.length > 0;
    const drivers = hasCite
      ? (r.drivers || []).slice(0, 3).map((d) => String(d).slice(0, 59))
      : ['Sin catalizadores en el ciclo'];
    const score = hasCite ? Math.max(-100, Math.min(100, Math.round(Number(r.score) || 0))) : 0;
    return {
      currency,
      score,
      structural: score,
      impulse: hasCite ? Math.round(Number(r.impulse) || 0) : 0,
      setup: r.setup || '',
      bias: biasFor(score),
      drivers,
      rationale: hasCite
        ? String(r.rationale || '')
          .replace(/\[[0-9a-f]{7,40}\]/gi, '')
          .replace(/\b[0-9a-f]{32,40}\b/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim()
          .slice(0, 600)
        : 'Sin titulares directos para esta divisa en la ventana actual.',
      noEvidence: !hasCite || isNoEvidence({ drivers, score }),
      engine: 'gemini',
    };
  });
  return { regime_note: String(raw.regime_note || '').slice(0, 280), rows: attachRanks(rows) };
}

async function generate(key, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
}

export async function testGeminiKey(key) {
  let last = null;
  for (const model of GEMINI_MODELS) {
    try {
      await generate(key, model, 'Responde JSON {"ok":true}');
      return { ok: true, model };
    } catch (err) {
      last = err;
      if (err.status && err.status !== 404) break;
    }
  }
  throw last || new Error('Clave rechazada');
}

export async function classifyWithGemini(news, key, model = GEMINI_MODEL) {
  const prompt = buildPrompt(news);
  let last = null;
  const tryModels = [model, ...GEMINI_MODELS.filter((m) => m !== model)];
  for (const m of tryModels) {
    try {
      const text = await generate(key, m, prompt);
      const parsed = parseModelJson(text, news);
      return { ...parsed, model: m };
    } catch (err) {
      last = err;
      if (err.status && ![404, 429].includes(err.status)) break;
    }
  }
  throw last || new Error('Gemini no disponible');
}

export { GEMINI_MODEL };
