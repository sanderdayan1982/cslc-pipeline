import { CURRENCIES } from './config.js';

const TIMEOUT_MS = 60_000;

// Gemini first: its free tier (Google AI Studio key) is the default for personal use.
export function llmProvider() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

export const llmAvailable = () => llmProvider() !== null;

export const SYSTEM_PROMPT = `Eres el agente de clasificación de RadarNews. Puntúas la FUERZA NARRATIVA de 8 divisas (${CURRENCIES.join(', ')}) de -100 a +100 a partir EXCLUSIVAMENTE de los titulares que se te dan.

Escala:
- -100 = narrativa claramente destructiva (recortes agresivos, datos muy débiles, riesgo político, intervención para debilitar).
- 0 = sin catalizadores.
- +100 = narrativa claramente constructiva (subidas de tipos, inflación pegajosa, datos fuertes, flujos de refugio).

Reglas:
1. Usa solo los titulares listados; nada de precios ni inventar datos.
2. Prohibido devolver 0 a todas o puntuaciones idénticas: diferencia por contexto.
3. Con evidencia débil, usa el rango -40 a +40 y valores distintos para contextos distintos.
4. Regla monetaria: hawkish o dato fuerte = positivo; dovish o dato débil = negativo.
5. Máximo 3 catalizadores por divisa, frases de menos de 60 caracteres, en español.
6. regime_note: frase corta si algún régimen cambia (p. ej. un banco central pasando de hawkish a dovish), o cadena vacía.

Responde SOLO con JSON con esta forma:
{"regime_note": "", "currencies": [{"currency": "USD", "score": 0, "drivers": ["..."], "rationale": "..."}]}
Incluye las 8 divisas, sin excepción.`;

export function buildUserPrompt(headlines) {
  const lines = headlines.map((h, i) => {
    const macro = h.actual ? ` [ACT ${h.actual} | EST ${h.forecast ?? '-'} | PREV ${h.previous ?? '-'}]` : '';
    const excerpt = h.body ? ` — ${h.body.slice(0, 160)}` : '';
    return `${i + 1}. ${h.published_at} | ${h.source} | impacto ${h.impact} | ${h.category} | divisas: ${h.currencies.join(',') || '-'}${macro}\n   ${h.title}${excerpt}`;
  });
  return `Titulares (ordenados por impacto):\n\n${lines.join('\n')}`;
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('respuesta sin JSON');
  return JSON.parse(text.slice(start, end + 1));
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const geminiBase = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

// Model metadata lookup: validates the key without spending generation quota.
export async function testGeminiKey(key) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    const res = await fetch(`${geminiBase()}/models/${model}`, {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true, model };
    const text = await res.text();
    let detail = text.slice(0, 140);
    try { detail = JSON.parse(text).error?.message || detail; } catch { /* non-JSON error body */ }
    const reason = res.status === 400 || res.status === 401 || res.status === 403 ? 'Clave rechazada por Google' : `Google respondió HTTP ${res.status}`;
    return { ok: false, error: `${reason}. ${detail}`.trim() };
  } catch (err) {
    return { ok: false, error: `Sin conexión con Google: ${err.message}` };
  }
}

export async function classifyWithLlm(headlines, provider = llmProvider()) {
  const user = buildUserPrompt(headlines);

  if (provider === 'gemini') {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const data = await postJson(`${geminiBase()}/models/${model}:generateContent`, {
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    }, {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    });
    return extractJson((data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
  }

  if (provider === 'openai') {
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const data = await postJson(`${base}/chat/completions`, { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }],
    });
    return extractJson(data.choices?.[0]?.message?.content || '');
  }

  if (provider === 'anthropic') {
    const data = await postJson('https://api.anthropic.com/v1/messages', {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    }, {
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      max_tokens: 2000,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }],
    });
    return extractJson((data.content || []).map((b) => b.text || '').join(''));
  }

  throw new Error('sin proveedor LLM configurado');
}
