/**
 * Busca as métricas do portal do cliente e salva em cts-data/data/.
 *
 * Roda no GitHub Actions (ver ../workflows/cts-data-snapshot.yml).
 * Sem dependências — Node 20+ tem fetch nativo.
 *
 * Estratégia (v5.64): UMA chamada ao endpoint batch, que devolve ALL + cada
 * país. Dentro do backend as leituras da RAW CTS são compartilhadas (cache
 * por-requisição), então isso é ~3-4x mais rápido que as 7 chamadas antigas.
 * Se o batch falhar (backend antigo, etc.), cai no modo país-por-país.
 *
 * ?nocache=1 fura o cache de 30min do servidor: aqui a gente QUER dado fresco.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzNgMr7RXi4d1rhF3xBJVUk0EvAgYgRXGNgW_QBEAp-eI2jqahRynmQPwd6Q4m5EsSv/exec';
const OUT_DIR = join('cts-data', 'data');
const TIMEOUT_MS = 300000;   // o batch faz o trabalho dos 7 numa requisição só

/** 'All LATAM' → 'all', 'México' → 'mexico' */
function slugify(country) {
  if (!country || country === 'ALL') return 'all';
  return country.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function getJson(url) {
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

/** Escreve os arquivos por país + o all.json + index.json. */
async function writeAll(all, byCountry) {
  await writeFile(join(OUT_DIR, 'all.json'), JSON.stringify(all));
  const results = [{ country: 'ALL', slug: 'all', drivers: all.drivers?.length ?? 0 }];
  for (const country of Object.keys(byCountry)) {
    const data = byCountry[country];
    const slug = slugify(country);
    if (!data || data.success === false) {
      console.error(`  FALHOU (${country}): ${data?.error || 'sem dados'}`);
      results.push({ country, slug, error: String(data?.error || 'sem dados') });
      continue;
    }
    await writeFile(join(OUT_DIR, `${slug}.json`), JSON.stringify(data));
    console.log(`  ok — ${country}: ${data.drivers?.length ?? 0} motoristas`);
    results.push({ country, slug, drivers: data.drivers?.length ?? 0 });
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
  if (failed.length === results.length) process.exit(1);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // --- caminho rápido: batch (1 requisição) ---
  try {
    console.log('→ batch (ALL + países numa chamada)');
    const batch = await getJson(`${SCRIPT_URL}?action=getClientMetricsBatch&nocache=1`);
    if (batch.all && batch.byCountry) {
      console.log(`  ok — ${batch.all.month}.${batch.all.year}`);
      await writeAll(batch.all, batch.byCountry);
      return;
    }
    throw new Error('batch sem all/byCountry');
  } catch (err) {
    console.error(`  batch falhou (${err.message}) — caindo no modo país-por-país`);
  }

  // --- fallback: país por país (backend antigo sem o batch) ---
  const all = await getJson(`${SCRIPT_URL}?action=getClientMetrics&country=ALL&nocache=1`);
  const byCountry = {};
  for (const country of (all.countries || [])) {
    try {
      console.log(`→ ${country}`);
      byCountry[country] = await getJson(
        `${SCRIPT_URL}?action=getClientMetrics&country=${encodeURIComponent(country)}&nocache=1`);
    } catch (err) {
      console.error(`  FALHOU (${country}): ${err.message}`);
      byCountry[country] = { success: false, error: String(err.message) };
    }
  }
  await writeAll(all, byCountry);
}

main().catch(err => { console.error(err); process.exit(1); });
