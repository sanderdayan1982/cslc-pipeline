import { openDb } from './db.js';
import { refreshFeed } from './refreshFeed.js';
import { refreshCalendar } from './calendar.js';
import { classifyCurrencies, ENGINE_LABEL } from './classifyCurrencies.js';

const db = openDb();
try {
  console.log(`Calendario: ${await refreshCalendar(db)} eventos de la semana`);
} catch (err) {
  console.warn(`Calendario no disponible: ${err.message}`);
}
const report = await refreshFeed(db);
console.table(report.health.map(({ source, type, ok, fetched, relevant, inserted, error }) => ({ source, type, ok, fetched, relevant, inserted, error })));
console.log(`Insertados: ${report.inserted} · Alertas: ${report.alerts}`);

const out = await classifyCurrencies(db);
for (const r of out?.results ?? []) {
  console.log(`\nRanking ${ENGINE_LABEL[r.engine] || r.engine} (${out.headlines} titulares)`);
  console.table(r.currencies.map((c) => ({ rank: c.rank, divisa: c.currency, score: c.score, sesgo: c.bias, catalizador: c.drivers[0] || '' })));
  if (r.regime_note) console.log(`Régimen: ${r.regime_note}`);
}
if (out?.llm_error) console.warn(`LLM: ${out.llm_error}`);
db.close();
