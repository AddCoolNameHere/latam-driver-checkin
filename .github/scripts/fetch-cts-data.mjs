/**
 * Busca as métricas do portal do cliente e salva em cts-data/data/.
 *
 * Roda no GitHub Actions (ver ../workflows/cts-data-snapshot.yml).
 * Sem dependências — Node 20+ tem fetch nativo.
 *
 * Estratégia:
 *   1. pede ALL (sem month/year → o backend usa o período corrente da aba)
 *   2. usa a lista `countries` que voltou pra pedir cada país
 *   3. grava um arquivo por país + um index.json com o resumo
 *
 * Usa ?nocache=1 pra furar o cache de 30min do servidor: aqui a gente QUER
 * o dado fresco, o custo de ~45s não incomoda num job agendado.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzNgMr7RXi4d1rhF3xBJVUk0EvAgYgRXGNgW_QBEAp-eI2jqahRynmQPwd6Q4m5EsSv/exec';
const OUT_DIR = join('cts-data', 'data');
const TIMEOUT_MS = 240000;

/** 'All LATAM' → 'all', 'México' → 'mexico' */
function slugify(country) {
  if (!country || country === 'ALL') return 'all';
  return country.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function fetchCountry(country) {
  const url = `${SCRIPT_URL}?action=getClientMetrics&country=${encodeURIComponent(country)}&nocache=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || json.success === false) throw new Error(json?.error || 'resposta sem success');
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log('→ ALL');
  const all = await fetchCountry('ALL');
  await writeFile(join(OUT_DIR, 'all.json'), JSON.stringify(all));
  console.log(`  ok — ${all.month}.${all.year}, ${all.drivers?.length ?? 0} motoristas`);

  const countries = all.countries || [];
  const results = [{ country: 'ALL', slug: 'all', drivers: all.drivers?.length ?? 0 }];

  // Sequencial de propósito: o getTkmReport_ usa LockService, então em
  // paralelo um esperaria o outro de qualquer jeito.
  for (const country of countries) {
    const slug = slugify(country);
    try {
      console.log(`→ ${country}`);
      const data = await fetchCountry(country);
      await writeFile(join(OUT_DIR, `${slug}.json`), JSON.stringify(data));
      console.log(`  ok — ${data.drivers?.length ?? 0} motoristas`);
      results.push({ country, slug, drivers: data.drivers?.length ?? 0 });
    } catch (err) {
      // Um país que falha não derruba o resto — o arquivo antigo dele fica
      // no lugar e a página cai no Apps Script se estiver velho demais.
      console.error(`  FALHOU (${country}): ${err.message}`);
      results.push({ country, slug, error: String(err.message) });
    }
  }

  const index = {
    generatedAt: new Date().toISOString(),
    month: all.month,
    year: all.year,
    countries: results,
  };
  await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

  const failed = results.filter(r => r.error);
  console.log(`\nPronto: ${results.length - failed.length}/${results.length} ok`);
  if (failed.length === results.length) process.exit(1);   // tudo falhou → job vermelho
}

main().catch(err => { console.error(err); process.exit(1); });
