/**
 * latamace.com/api* — camada de borda na frente do Apps Script.
 *
 * Faz duas coisas independentes:
 *
 * 1) LEITURA (GET) — cache em KV com stale-while-revalidate.
 *    O Apps Script lê a mastersheet com getDataRange() (aba inteira na memória
 *    a cada request): getClientMetrics ALL = 44-57s, getClientWeeks = 56s.
 *    Com cópia no KV a resposta sai em ~100ms, e mesmo vencida ela é servida na
 *    hora enquanto a atualização roda no waitUntil, depois da resposta.
 *
 * 2) ESCRITA (POST de check-in) — fila em D1.
 *    O motorista era quem esperava o Apps Script gravar na planilha, e no pico
 *    da manhã simplesmente não conseguia. Agora o check-in é aceito aqui em
 *    ~50ms, vai pro D1, e um dreno em segundo plano empurra pra planilha um de
 *    cada vez. 70 motoristas simultâneos é irrelevante pro Worker, e o check-in
 *    continua funcionando mesmo com o Apps Script fora do ar.
 *
 * Princípio dos dois: nunca ficar pior que antes. Qualquer falha (KV, D1,
 * upstream) cai no proxy direto pro Apps Script, que é o que as páginas
 * faziam originalmente.
 */

/** Vai no header X-Worker-Build de toda resposta. Serve pra saber, olhando o
 *  curl, qual versão está realmente no ar — a API de deploy já disse "ok" pra
 *  uma versão que não era a que estava respondendo. */
const BUILD = '9';

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
 * Leituras que NÃO podem ser cacheadas: são por motorista e mudam quando ele
 * mesmo salva algo. Cachear a base por 30min faria o motorista atualizar a
 * base e continuar vendo a antiga na tela do check-in.
 */
const SEM_CACHE = ['getbase', 'getlastarea', 'getdriverssds', 'getdashboarddata'];

/**
 * ⚠ O QUE PODE SER REAQUECIDO E QUANDO — leia antes de mexer.
 *
 * Até a v5.72 o saveCheckin e o getTkmReport_ usavam o MESMO
 * LockService.getScriptLock(), que no Apps Script é um lock único pro script
 * inteiro — qualquer acesso ao portal travava o check-in de todos os motoristas
 * por ~45s. A v5.73 tirou o lock do saveCheckin (virou appendRow), mas o
 * getTkmReport_ continua segurando esse lock, então ainda vale não sair
 * chamando getClientMetrics no pico.
 *
 *   LEVE   — getClientWeeks lê a RAW CTS direto, NÃO pega lock. De hora em hora.
 *   PESADO — getClientMetrics passa pelo getTkmReport_. 1×/dia, 02:30 BRT.
 *            No resto do dia essas chaves se resolvem pelo stale-while-
 *            revalidate, ou seja, só quando alguém abre o portal de verdade.
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

const CRON_DRENO  = '*/2 * * * *';
const CRON_LEVE   = '0 * * * *';
const CRON_PESADO = '30 5 * * *';

/** Quantos check-ins o dreno tenta por rodada. Sequencial de propósito. */
const DRENO_LOTE = 10;

/** Depois disso a linha vira 'failed' e para de tentar sozinha. */
const MAX_TENTATIVAS = 5;

/**
 * Teto pra UMA tentativa de gravar na planilha. Sem isso o fetch fica pendurado
 * esperando o Apps Script (que pode passar de 90s quando o getTkmReport_ está
 * segurando o lock), o waitUntil do Worker é cortado no meio, e a linha fica
 * marcada 'sending' PARA SEMPRE — o dreno só busca 'pending'.
 * Aconteceu em produção: 2 check-ins reais ficaram 42 min presos assim.
 */
const ENVIO_TIMEOUT_MS = 45000;

/**
 * Linha em 'sending' há mais que isso é considerada abandonada (o Worker que a
 * reivindicou morreu antes de terminar) e volta pra fila. É a rede de segurança
 * do ENVIO_TIMEOUT_MS: mesmo que o Worker seja morto sem executar o catch,
 * a próxima rodada do cron recupera.
 */
const SENDING_ABANDONADO_MS = 5 * 60 * 1000;

/**
 * Janela pra considerar dois envios do MESMO motorista como toque repetido.
 *
 * O submission_id UNIQUE só pega o retry do postWithRetry, que reusa o mesmo id.
 * Não pega o motorista batendo no botão várias vezes: cada toque monta um
 * payload novo, com submissionId novo. Visto em produção no primeiro dia:
 * Maximiliano mandou 2 em 0,21s e Ronaldo mandou 4 dentro de 1 segundo — antes
 * da fila isso já gerava linhas repetidas na planilha, só que ninguém via.
 *
 * 90s é curto de propósito: pega toque repetido (que acontece em segundos) sem
 * bloquear um check-in refeito de propósito minutos depois, que é legítimo.
 * O payload do repetido NÃO é descartado — fica no D1 com status 'duplicate'.
 */
const JANELA_TOQUE_REPETIDO_MS = 90 * 1000;

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

// ---------------------------------------------------------------------------
// FILA DE CHECK-IN (D1)
// ---------------------------------------------------------------------------

/**
 * Empurra check-ins pendentes pra planilha, UM DE CADA VEZ.
 *
 * Sequencial não é preguiça: o Apps Script tem teto de 30 execuções simultâneas
 * e o getTkmReport_ ainda segura o lock global. Mandar em paralelo recria
 * exatamente o congestionamento que essa fila existe pra evitar.
 *
 * O UPDATE ... WHERE status='pending' é o que impede dois drenos concorrentes
 * (cron + waitUntil de um POST) de mandarem a mesma linha duas vezes.
 */
async function drenar(env, limite) {
  let enviados = 0;

  // Resgata linhas abandonadas ANTES de escolher o que enviar: se o Worker que
  // reivindicou uma linha morreu no meio (Apps Script lento + waitUntil cortado),
  // ela ficaria 'sending' pra sempre e o check-in do motorista nunca chegaria
  // na planilha. Aconteceu de verdade — ver comentário do SENDING_ABANDONADO_MS.
  try {
    await env.DB.prepare(
      `UPDATE checkin_queue SET status='pending'
        WHERE status='sending' AND received_at < ?1`
    ).bind(Date.now() - SENDING_ABANDONADO_MS).run();
  } catch (e) {
    console.log('[fila] resgate de abandonados falhou: ' + e);
  }

  const pend = await env.DB.prepare(
    `SELECT id, payload, attempts FROM checkin_queue
      WHERE status = 'pending' ORDER BY id LIMIT ?1`
  ).bind(limite).all();

  for (const row of (pend.results || [])) {
    const claim = await env.DB.prepare(
      `UPDATE checkin_queue SET status='sending', attempts=attempts+1
        WHERE id=?1 AND status='pending'`
    ).bind(row.id).run();
    if (!claim.meta || claim.meta.changes === 0) continue;   // outro dreno pegou

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ENVIO_TIMEOUT_MS);
    try {
      const res = await fetch(UPSTREAM, {
        method: 'POST',
        body: row.payload,
        redirect: 'follow',
        signal: ctrl.signal,
      });
      const txt = await res.text();
      let ok = res.ok;
      try { ok = ok && JSON.parse(txt).success === true; } catch (e) { ok = false; }
      if (!ok) throw new Error(txt.slice(0, 300));

      // AND status='sending' é essencial: sem isso, uma linha reclassificada à
      // mão (ex.: marcada 'duplicate' pelo time enquanto o envio estava em voo)
      // era silenciosamente revertida pra 'written' quando o fetch terminava.
      // Aconteceu no primeiro dia — o registro do estado ficava mentindo.
      await env.DB.prepare(
        `UPDATE checkin_queue SET status='written', written_at=?1, last_error=NULL
          WHERE id=?2 AND status='sending'`
      ).bind(Date.now(), row.id).run();
      enviados++;
    } catch (e) {
      // Esgotou as tentativas: para de tentar sozinho e fica visível no
      // ?action=filaCheckin pra alguém olhar. O dado NÃO se perde.
      const desiste = (row.attempts + 1) >= MAX_TENTATIVAS;
      await env.DB.prepare(
        `UPDATE checkin_queue SET status=?1, last_error=?2
          WHERE id=?3 AND status='sending'`
      ).bind(desiste ? 'failed' : 'pending', String(e).slice(0, 500), row.id).run();
    } finally {
      clearTimeout(timer);
    }
  }
  return enviados;
}

/** Diagnóstico da fila, pro time saber se algo ficou preso. */
async function statusFila(env) {
  const contagem = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM checkin_queue GROUP BY status`
  ).all();
  const presos = await env.DB.prepare(
    `SELECT id, driver_email, received_at, attempts, last_error
       FROM checkin_queue WHERE status='failed' ORDER BY id DESC LIMIT 20`
  ).all();
  const antigo = await env.DB.prepare(
    `SELECT MIN(received_at) AS t FROM checkin_queue WHERE status='pending'`
  ).all();

  const porStatus = {};
  (contagem.results || []).forEach((r) => { porStatus[r.status] = r.n; });
  const maisAntigo = antigo.results && antigo.results[0] && antigo.results[0].t;

  return {
    success: true,
    build: BUILD,
    porStatus: porStatus,
    pendenteMaisAntigoSeg: maisAntigo ? Math.round((Date.now() - maisAntigo) / 1000) : null,
    falhados: presos.results || [],
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Não há endpoint /health: tentei um e ele nunca disparou atrás da rota
    // latamace.com/api*, mesmo com o código comprovadamente deployado
    // (conferido pelo X-Worker-Build). Em vez de um health check que mente, o
    // diagnóstico é o X-Worker-Build (em toda resposta) e o ?action=filaCheckin.

    // ---- ESCRITA ----
    if (request.method === 'POST') {
      const raw = await request.text();
      let data = null;
      try { data = JSON.parse(raw); } catch (e) { /* segue pro passthrough */ }

      if (data && data.type === 'checkin') {
        try {
          const email = data.driverEmail || '';

          // Duas proteções contra linha repetida na planilha:
          //  1) submission_id UNIQUE + INSERT OR IGNORE → pega o retry do
          //     postWithRetry, que reusa o mesmo id.
          //  2) janela por motorista → pega o toque repetido no botão, que
          //     gera submissionId novo a cada vez (ver JANELA_TOQUE_REPETIDO_MS).
          let repetido = false;
          if (email) {
            const recente = await env.DB.prepare(
              `SELECT id FROM checkin_queue
                WHERE driver_email = ?1 AND received_at > ?2
                  AND status IN ('pending','sending','written')
                LIMIT 1`
            ).bind(email, Date.now() - JANELA_TOQUE_REPETIDO_MS).all();
            repetido = (recente.results || []).length > 0;
          }

          await env.DB.prepare(
            `INSERT OR IGNORE INTO checkin_queue
               (submission_id, tipo, payload, driver_email, received_at, status, last_error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
          ).bind(
            data.submissionId || null,
            'checkin',
            raw,
            email || null,
            Date.now(),
            repetido ? 'duplicate' : 'pending',
            repetido ? 'toque repetido: ja havia check-in desse motorista na janela' : null
          ).run();

          // Tenta escoar já, mas DEPOIS de responder — o motorista não espera.
          ctx.waitUntil(drenar(env, DRENO_LOTE).catch(() => {}));

          return json(JSON.stringify({
            success: true,
            message: 'Check-in recebido',
            queued: true,
          }), { 'X-Checkin': 'QUEUED' });
        } catch (e) {
          // D1 fora do ar → manda direto pro Apps Script, como era antes.
          console.log('[fila] D1 falhou, caindo pro upstream: ' + e);
        }
      }

      // checkout, base e qualquer outro POST seguem direto.
      return fetch(upstreamUrl(url.search), {
        method: 'POST',
        body: raw,
        headers: { 'Content-Type': request.headers.get('Content-Type') || 'text/plain' },
        redirect: 'follow',
      });
    }

    // ---- LEITURA ----
    const search = url.search.replace(/^\?/, '');
    const action = url.searchParams.get('action');
    if (!action) {
      return json(
        JSON.stringify({ error: 'faltou o parâmetro action (ex: /api?action=getClientWeeks)', build: BUILD }),
        { 'X-Cache': 'NONE' }
      );
    }

    // Diagnóstico da fila — respondido aqui, não vai pro Apps Script.
    if (action === 'filaCheckin') {
      try {
        return json(JSON.stringify(await statusFila(env)), { 'X-Cache': 'NONE' });
      } catch (e) {
        return json(JSON.stringify({ success: false, error: String(e) }), { 'X-Cache': 'NONE' });
      }
    }

    // Leitura por motorista: sempre fresca (ver SEM_CACHE).
    if (SEM_CACHE.indexOf(action.toLowerCase()) >= 0) {
      const res = await fetch(upstreamUrl(search), { redirect: 'follow' });
      return new Response(res.body, {
        status: res.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Worker-Build': BUILD, ...CORS, 'X-Cache': 'SEM-CACHE',
        },
      });
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
      // Última tentativa: proxy cru, igual ao que as páginas faziam antes.
      const res = await fetch(upstreamUrl(search), { redirect: 'follow' });
      return new Response(res.body, {
        status: res.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, 'X-Cache': 'PASSTHRU' },
      });
    }
  },

  /**
   * Três crons, com pesos diferentes (ver comentário do WARM_*):
   *   CRON_DRENO  (2 em 2 min) — só drena a fila de check-in. É a rede de
   *                              segurança pro caso do waitUntil do POST ter
   *                              falhado (Apps Script fora, por exemplo).
   *   CRON_LEVE   (de hora em hora) — drena + reaquece o que não pega lock.
   *   CRON_PESADO (02:30 BRT) — drena + reaquece tudo, longe do pico.
   */
  async scheduled(event, env, ctx) {
    // O dreno roda SEMPRE, em qualquer cron: é o que não pode atrasar.
    let enviados = 0;
    try {
      enviados = await drenar(env, DRENO_LOTE * 3);
    } catch (e) {
      console.log('[fila] dreno falhou: ' + e);
    }
    if (enviados) console.log('[fila] ' + enviados + ' check-ins gravados na planilha');

    if (event.cron === CRON_DRENO) return;

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
