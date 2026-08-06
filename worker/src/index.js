/**
 * api.latamace.com — cache na frente do Apps Script.
 *
 * O PROBLEMA QUE ISSO RESOLVE
 * O backend é Apps Script lendo a mastersheet com getDataRange() (aba inteira
 * na memória a cada request). Medido: getClientMetrics ALL = 44-57s,
 * getClientWeeks = 56s. Some a isso o teto de 6 min, cold start e o
 * LockService serializando o relatório TKM. Quem pagava essa conta era o
 * visitante da página.
 *
 * COMO
 * Stale-while-revalidate. Se tem cópia no KV, ela é servida NA HORA — mesmo
 * vencida — e a atualização acontece depois da resposta, no waitUntil. O
 * usuário só espera na primeiríssima vez que uma chave é pedida, e nem isso
 * na prática, porque o cron pré-aquece as chaves quentes de 15 em 15 min.
 *
 * Nunca fica pior que hoje: qualquer erro (KV, upstream, timeout) cai no
 * proxy direto pro Apps Script, que é exatamente o que as páginas fazem hoje.
 *
 * NÃO cacheia POST — os check-ins dos motoristas passam direto.
 */

/** Vai no header X-Worker-Build de toda resposta. Serve pra saber, olhando o
 *  curl, qual versão está realmente no ar — a API de deploy já disse "ok" pra
 *  uma versão que não era a que estava respondendo. */
const BUILD = '6';

const UPSTREAM = 'https://script.google.com/macros/s/AKfycbzNgMr7RXi4d1rhF3xBJVUk0EvAgYgRXGNgW_QBEAp-eI2jqahRynmQPwd6Q4m5EsSv/exec';

/** Depois disso a cópia é servida mas revalidada em background.
 *  30 min de propósito: é exatamente o cache que o Apps Script mantém do lado
 *  dele (CacheService, 1800s). Revalidar mais rápido que isso só devolveria os
 *  mesmos bytes e gastaria execução à toa. O botão Refresh das páginas manda
 *  nocache=1 e fura os dois caches, então edição de curadoria continua imediata. */
const FRESH_SECONDS = 30 * 60;

/** Teto de permanência no KV. Bem maior que o TTL: é o que segura a página de
 *  pé se o Apps Script estiver fora do ar. Melhor dado de 1h atrás que erro. */
const KV_TTL_SECONDS = 24 * 60 * 60;

/**
 * ⚠ O QUE PODE SER REAQUECIDO E QUANDO — leia antes de mexer.
 *
 * O saveCheckin e o getTkmReport_ usam o MESMO LockService.getScriptLock(),
 * que no Apps Script é um lock único pro script inteiro. Enquanto o relatório
 * é montado (~45s), NENHUM motorista consegue bater ponto: o waitLock(30000)
 * deles estoura e devolve "Sistema ocupado".
 *
 * Ou seja: toda chamada de getClientMetrics trava o check-in por ~45s.
 *
 * Por isso o warm é dividido:
 *   LEVE  — getClientWeeks lê a RAW CTS direto, NÃO pega lock. Pode rodar
 *           de hora em hora sem incomodar ninguém.
 *   PESADO— getClientMetrics passa pelo getTkmReport_ e trava check-in.
 *           Roda 1×/dia de madrugada (05:30 UTC = 02:30 BRT), fora do pico.
 *           No resto do dia essas chaves se resolvem pelo stale-while-
 *           revalidate, ou seja, só quando alguém abre o portal de verdade.
 */
const WARM_LEVE = [
  'action=getClientWeeks&weeks=10',
];

const WARM_PESADO = [
  'action=getClientMetrics&country=ALL',
  'action=getClientMetrics&country=Argentina',
  'action=getClientMetrics&country=Brazil',
  'action=getClientMetrics&country=Chile',
  'action=getClientMetrics&country=Colombia',
  'action=getClientMetrics&country=M%C3%A9xico',
  'action=getClientMetrics&country=Peru',
];

const CRON_PESADO = '30 5 * * *';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** Chave do KV = a query normalizada (params ordenados), sem os de controle. */
function cacheKey(url) {
  const p = new URLSearchParams(url.search);
  p.delete('nocache');
  p.delete('cb');
  p.delete('_');
  const pairs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b));
  return 'v1:' + pairs.map(([k, v]) => k + '=' + v).join('&');
}

function upstreamUrl(search) {
  return UPSTREAM + (search.startsWith('?') ? search : '?' + search);
}

/** Busca no Apps Script e grava no KV. Só grava resposta que parece boa. */
async function refresh(env, key, search) {
  const res = await fetch(upstreamUrl(search), {
    cf: { cacheTtl: 0 },
    headers: { 'User-Agent': 'latamace-api-cache' },
  });
  if (!res.ok) throw new Error('upstream HTTP ' + res.status);

  const body = await res.text();
  // O Apps Script devolve 200 com {success:false} quando quebra por dentro.
  // Cachear isso congelaria o erro por 24h.
  let ok = true;
  try {
    const j = JSON.parse(body);
    if (j && j.success === false) ok = false;
  } catch (e) {
    ok = false;                       // não é JSON → provavelmente página de erro
  }
  if (!ok) throw new Error('upstream devolveu payload inválido');

  await env.CACHE.put(key, body, {
    expirationTtl: KV_TTL_SECONDS,
    metadata: { at: Date.now() },
  });
  return body;
}

function json(body, extra) {
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',   // quem cacheia é o KV, não o browser
      'X-Worker-Build': BUILD,
      ...CORS,
      ...extra,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Não há endpoint /health de propósito: tentei um e ele nunca disparou
    // atrás da rota latamace.com/api*, mesmo com o código comprovadamente
    // deployado (conferido pelo X-Worker-Build). Em vez de deixar um health
    // check que mente, o diagnóstico é o header X-Worker-Build, que vai em
    // TODA resposta, mais o `build` no corpo do erro de chamada inválida.

    // Escrita (check-in, saves) passa direto — nada de cache no caminho.
    if (request.method !== 'GET') {
      return fetch(upstreamUrl(url.search), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: 'follow',
      });
    }

    // Exige `action`. Sem isso qualquer query solta (?x=1) era proxiada pro
    // Apps Script e o que voltasse ia parar no KV por 24h — lixo cacheado
    // ocupando espaço e mascarando erro de chamada.
    const search = url.search.replace(/^\?/, '');
    if (!url.searchParams.get('action')) {
      return json(
        JSON.stringify({ error: 'faltou o parâmetro action (ex: /api?action=getClientWeeks)', build: BUILD }),
        { 'X-Cache': 'NONE' }
      );
    }

    const key = cacheKey(url);
    const bypass = url.searchParams.get('nocache') === '1';

    if (!bypass) {
      try {
        const hit = await env.CACHE.getWithMetadata(key, { type: 'text' });
        if (hit && hit.value) {
          const at = (hit.metadata && hit.metadata.at) || 0;
          const ageSec = Math.round((Date.now() - at) / 1000);
          const stale = ageSec > FRESH_SECONDS;
          // Vencido: devolve mesmo assim e revalida DEPOIS da resposta.
          // É isso que tira o usuário da fila do Apps Script.
          if (stale) {
            ctx.waitUntil(refresh(env, key, search).catch(() => {}));
          }
          return json(hit.value, {
            'X-Cache': stale ? 'STALE' : 'HIT',
            'X-Cache-Age': String(ageSec),
          });
        }
      } catch (e) {
        // KV com problema não pode derrubar a página — segue pro upstream.
      }
    }

    // MISS (ou nocache=1): paga o custo do Apps Script desta vez.
    try {
      const body = await refresh(env, key, search);
      return json(body, { 'X-Cache': bypass ? 'BYPASS' : 'MISS' });
    } catch (e) {
      // Última tentativa: proxy cru, igual ao que as páginas fazem hoje.
      const res = await fetch(upstreamUrl(search), { redirect: 'follow' });
      return new Response(res.body, {
        status: res.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, 'X-Cache': 'PASSTHRU' },
      });
    }
  },

  /**
   * Cron: reaquece as chaves caras, UMA POR VEZ.
   *
   * Sequencial não é preguiça — em paralelo não funciona. O getTkmReport_ usa
   * LockService, então as chamadas se serializam do lado do Apps Script de
   * qualquer jeito, e o excesso de execuções simultâneas faz o Apps Script
   * devolver erro/HTML em vez de JSON. Medido: as 8 em paralelo deram PASSTHRU
   * nas 8 (nenhuma cacheou). É a mesma conclusão que o
   * .github/scripts/fetch-cts-data.mjs já tinha documentado.
   *
   * Custo: ~5-7 min de relógio por execução, dentro do teto de 15 min do cron,
   * e sem ninguém esperando por isso.
   */
  async scheduled(event, env, ctx) {
    // O cron da madrugada faz leve + pesado; os de hora em hora só o leve,
    // pra não travar o check-in dos motoristas (ver comentário do WARM_*).
    const pesado = event.cron === CRON_PESADO;
    const lista = pesado ? WARM_LEVE.concat(WARM_PESADO) : WARM_LEVE;

    let ok = 0;
    for (const search of lista) {
      try {
        await refresh(env, cacheKey(new URL('https://x/?' + search)), search);
        ok++;
      } catch (e) {
        console.log('[warm] FALHOU ' + search + ': ' + e);
      }
    }
    console.log('[warm] ' + (pesado ? 'completo' : 'leve') + ' — ' + ok + '/' + lista.length + ' chaves');
  },
};
