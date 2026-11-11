/**
 * ================================================================
 * /cts-data — BACKEND PRÓPRIO (projeto Apps Script separado)
 * ================================================================
 *
 * Por que existe: o portal do cliente lia da Mastersheet (RAW CTS DATA +
 * TKM Monthly Drivers Report + CTS Goal Management + VID Monthly CALENDAR),
 * camadas manuais/derivadas que viviam quebrando. Este script lê DIRETO da
 * planilha da CTS ("SV Drive LATAM ACE Drive Performance Report - 2026"),
 * só as abas CRUAS, e calcula tudo aqui:
 *
 *   KMS      → 1 linha por VID/dia: TKM, km, horas, status, hotel, season
 *              (season_name termina em "Swarm" ou "Churn" = tipo de mapa)
 *   Targets  → meta diária por país (Overall/Swarm/Churn), só dias úteis;
 *              meses antigos têm 1 linha mensal só
 *   QC       → aceitas/rejeitadas por motorista/dia
 *
 * Da Mastersheet (nossa) lê só duas coisas que a CTS não tem:
 *   HR and Vendors Database → nome do motorista + contagem Active+Offboarding
 *   VID Status              → curadoria de VIDs (aba Admin do ops-map)
 * Se a Mastersheet falhar, cai pra contagem do próprio KMS (nunca quebra).
 *
 * ⚠ NUNCA escreve na planilha da CTS — ela é do Google/CTS. Só leitura.
 * ⚠ NÃO lê as abas de resumo da CTS (Metrics Performance Summary etc.):
 *   dependem de um seletor (C1) que muda conforme quem está usando.
 *
 * Contrato: devolve o MESMO JSON do Code udpt.gs (getClientMetrics_ /
 * getClientWeeks_), então o frontend só troca a URL.
 *
 * Deploy: projeto standalone em script.google.com → Implantar → App da Web
 *   Executar como: EU (usa o meu acesso às duas planilhas)
 *   Quem pode acessar: Qualquer pessoa
 * Logs: [CTS Backend]
 */

const CTS_VERSION = 'cts-1.4';

const CTS_CONFIG = {
  // ID da planilha que tem as abas KMS/Targets/QC. A conta que publica este
  // script (pessoal) não abre a da CTS (1EczaKGKiQXkgVVjXHJs3OVtCdpeQvlkPYPTdl4S5NeM),
  // então aponta pro ESPELHO "CTS Mirror", atualizado de hora em hora pelo
  // cts-mirror.gs rodando na conta aceolution. Mesmas abas, mesmo fuso.
  ctsSpreadsheetId: '18lTqa5I0bNcPiLCXUpid9dGT19x4r7vTlKZ7b23C_NM',
  masterSpreadsheetId: '1hwRnvbIKHWMRVY84lT6svbCg5BcMKkIJ7iaKpnNOGjg',
  kmsSheet: 'KMS',
  targetsSheet: 'Targets',
  qcSheet: 'QC',
  incidentsSheet: 'incidents',   // cts-1.4: acidentes/incidentes da CTS (copiada pelo espelho)
  adminLogSheet: '_admin_log',   // cts-1.4: pedidos de mudança "na raiz" (aba nossa, no espelho)
  adminEmailDefault: 'lucas.fuss@aceolution.com',   // Script Property ADMIN_EMAIL troca
  hrSheet: 'HR and Vendors Database',
  vidStatusSheet: 'VID Status',
  cacheSeconds: 1800,
  // Regra do "Fleet status per Google", copiada da aba Calc_Data_VID da CTS:
  // dia conta se o VID rodou > 30 km; no mês, ≥10 dias = active, 3–9 = half.
  activeDayKm: 30,
  fullActiveDays: 10,
  halfActiveDays: 3,
};

/** Ordem fixa dos países no portal. Só esses entram (KMS às vezes traz BO etc). */
const CTS_COUNTRIES = [
  { code: 'AR', name: 'Argentina' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'MX', name: 'Mexico' },
  { code: 'PE', name: 'Peru' },
];

// ================================================================
// HTTP
// ================================================================

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || '';
  try {
    if (action === 'ping') {
      return ctsJson_({ success: true, version: CTS_VERSION, time: new Date().toISOString() });
    }

    if (action === 'getClientMetrics') {
      const month = parseInt(p.month, 10) || null;
      const year = parseInt(p.year, 10) || null;
      const country = p.country || 'ALL';
      const key = 'cm_' + month + '_' + year + '_' + ctsNorm_(country);
      return ctsCached_(key, p.nocache === '1', function () {
        return getClientMetrics_(month, year, country);
      });
    }

    if (action === 'getClientWeeks') {
      const weeksBack = parseInt(p.weeks, 10) || 8;
      return ctsCached_('cw_' + weeksBack, p.nocache === '1', function () {
        return getClientWeeks_(weeksBack);
      });
    }

    // ALL + cada país numa requisição só. Barato agora (KMS é lido 1x por execução).
    if (action === 'getClientMetricsBatch') {
      const month = parseInt(p.month, 10) || null;
      const year = parseInt(p.year, 10) || null;
      const all = getClientMetrics_(month, year, 'ALL');
      const out = { success: !!(all && all.success), all: all, byCountry: {} };
      if (all && all.success) {
        all.countries.forEach(function (c) { out.byCountry[c] = getClientMetrics_(all.month, all.year, c); });
      } else {
        out.error = (all && all.error) || 'falha no ALL';
      }
      return ctsJson_(out);
    }

    return ctsJson_({ success: false, error: 'action desconhecida: ' + action });
  } catch (err) {
    Logger.log('[CTS Backend] doGet erro: ' + err + '\n' + (err && err.stack));
    return ctsJson_({ success: false, error: String(err) });
  }
}

/**
 * POST (cts-1.4) — só o modo admin do portal. Corpo = JSON em text/plain (sem
 * preflight de CORS). Vem DIRETO do navegador pra este Web App: o Worker
 * (/api) não repassa POST pra cá.
 */
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  try {
    if (body.action === 'adminCheck') return ctsJson_(ctsAdminCheck_(body));
    if (body.action === 'adminRootChange') return ctsJson_(ctsAdminRootChange_(body));
    return ctsJson_({ success: false, error: 'action desconhecida: ' + body.action });
  } catch (err) {
    Logger.log('[CTS Backend] doPost erro: ' + err + '\n' + (err && err.stack));
    return ctsJson_({ success: false, error: String(err) });
  }
}

function ctsJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Cache de servidor (30 min). O CacheService tem teto de 100KB por chave, e o
 * weekly passa disso — então fatia em pedaços de 90KB.
 */
function ctsCached_(key, force, build) {
  const cache = CacheService.getScriptCache();
  if (!force) {
    const hit = ctsCacheGet_(cache, key);
    if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  }
  const payload = build();
  const str = JSON.stringify(payload);
  if (payload && payload.success) {
    try {
      ctsCachePut_(cache, key, str);
      ctsCachePut_(cache, 'stale_' + key, str, 21600);   // reserva de 6h (teto do CacheService)
    } catch (e) { Logger.log('[CTS Backend] cache falhou: ' + e); }
  } else {
    // Espelho quebrado (ex.: KMS vazia em 13/10/2026): serve o último dado bom
    // em vez de derrubar o portal. stale:true deixa rastro no payload.
    const old = ctsCacheGet_(cache, 'stale_' + key);
    if (old) {
      Logger.log('[CTS Backend] ' + key + ' falhou (' + (payload && payload.error) + ') — servindo reserva');
      const o = JSON.parse(old);
      o.stale = true;
      o.staleReason = payload && payload.error;
      return ctsJson_(o);
    }
  }
  return ContentService.createTextOutput(str).setMimeType(ContentService.MimeType.JSON);
}

function ctsCachePut_(cache, key, str, ttl) {
  const CHUNK = 90000;
  const n = Math.ceil(str.length / CHUNK);
  const map = {};
  for (let i = 0; i < n; i++) map[key + '_' + i] = str.slice(i * CHUNK, (i + 1) * CHUNK);
  map[key + '_n'] = String(n);
  cache.putAll(map, ttl || CTS_CONFIG.cacheSeconds);
}

function ctsCacheGet_(cache, key) {
  const n = parseInt(cache.get(key + '_n'), 10);
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const got = cache.getAll(keys);
  let s = '';
  for (let i = 0; i < n; i++) {
    if (got[keys[i]] == null) return null;   // um pedaço expirou → recalcula
    s += got[keys[i]];
  }
  return s;
}

// ================================================================
// Helpers
// ================================================================

function ctsNum_(v) {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isFinite(n) ? n : 0;
}

function ctsNorm_(s) {
  s = String(s == null ? '' : s).toLowerCase().trim();
  return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
}

/** 'AR' | 'Argentina' | 'méxico' → { code, name } dos 6 países, ou null. */
function ctsCountry_(raw) {
  const k = ctsNorm_(raw);
  if (!k) return null;
  for (let i = 0; i < CTS_COUNTRIES.length; i++) {
    const c = CTS_COUNTRIES[i];
    if (k === c.code.toLowerCase() || k === ctsNorm_(c.name)) return c;
  }
  const alias = { arg: 'AR', bra: 'BR', brasil: 'BR', chl: 'CL', col: 'CO', mex: 'MX', per: 'PE' };
  if (alias[k]) return ctsCountry_(alias[k]);
  return null;
}

/** Acha coluna por nome de cabeçalho (exato, depois "contém"). -1 se não achar. */
function ctsCol_(headers, candidates) {
  const H = headers.map(function (h) { return ctsNorm_(h).replace(/\s+/g, ' '); });
  for (let j = 0; j < candidates.length; j++) {
    const i = H.indexOf(ctsNorm_(candidates[j]));
    if (i >= 0) return i;
  }
  for (let j = 0; j < candidates.length; j++) {
    const c = ctsNorm_(candidates[j]);
    for (let i = 0; i < H.length; i++) if (H[i] && H[i].indexOf(c) >= 0) return i;
  }
  return -1;
}

/**
 * Célula de data → 'yyyy-MM-dd'. Aceita Date, serial do Sheets e texto.
 * Date de célula é formatado no fuso DA PLANILHA DA CTS — formatar no fuso do
 * script já deu dia errado antes (quirk do fuso NY).
 */
function ctsYmd_(v, tz) {
  if (v == null || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);   // M/D/YYYY (locale en_US da planilha)
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return null;
}

/** Calendário puro em UTC (sem fuso): soma dias numa 'yyyy-MM-dd'. */
function ctsAddDays_(ymd, n) {
  const p = ymd.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.toISOString().slice(0, 10);
}

/** Semana ISO de uma 'yyyy-MM-dd' → { year, week, start(seg), end(dom) }. */
function ctsIsoWeek_(ymd) {
  const p = ymd.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  const dow = (d.getUTCDay() + 6) % 7;                 // 0 = segunda
  const thu = new Date(d.getTime() + (3 - dow) * 86400000);
  const year = thu.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = 1 + Math.floor((thu - jan1) / (7 * 86400000));
  const start = new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
  return { year: year, week: week, start: start, end: ctsAddDays_(start, 6) };
}

/** Coluna inteira como texto exibido (1 chamada). idx = índice 0-based. */
function ctsDisplayCol_(sheet, idx, n) {
  if (idx < 0 || !n) return [];
  return sheet.getRange(1, idx + 1, n, 1).getDisplayValues().map(function (r) { return r[0]; });
}

function ctsIsEmail_(s) { return /@/.test(String(s || '')); }

/** 'antonio.segadilha1@...' → 'Antonio Segadilha' (quem não está na HR). */
function ctsNameFromEmail_(email) {
  const local = String(email || '').split('@')[0];
  if (!local) return '(unknown)';
  return local.split(/[._-]+/).map(function (part) {
    const c = part.replace(/\d+$/, '');
    return c ? c.charAt(0).toUpperCase() + c.slice(1) : '';
  }).filter(function (x) { return x; }).join(' ');
}

/**
 * O status da CTS vem com seta: ⬆ = dia mapeado (inclusive '⬆*weather'),
 * ⬇ = não mapeou. Sem seta, decide pelo que a linha registrou.
 */
function ctsIsMappingDay_(status, hours, tkm) {
  const s = String(status == null ? '' : status);
  if (s.indexOf('⬆') >= 0) return true;
  if (s.indexOf('⬇') >= 0) return false;
  if (/mapping/i.test(s)) return true;
  return hours > 0 || tkm > 0;
}

// ================================================================
// Leitura das fontes (memoizada por execução)
// ================================================================

let _ctsSource = null;

/** Lê KMS + Targets + QC da CTS uma vez por execução. */
function ctsSource_() {
  if (_ctsSource) return _ctsSource;
  const ss = SpreadsheetApp.openById(CTS_CONFIG.ctsSpreadsheetId);
  const tz = ss.getSpreadsheetTimeZone() || 'America/Sao_Paulo';

  // ---- KMS ----
  const kmsSheet = ss.getSheetByName(CTS_CONFIG.kmsSheet);
  if (!kmsSheet || kmsSheet.getLastRow() < 2) throw new Error('aba KMS não encontrada ou vazia');
  const kv = kmsSheet.getDataRange().getValues();
  const h = kv[0];
  const ix = {
    season: ctsCol_(h, ['season_name']),
    country: ctsCol_(h, ['country_code']),
    vid: ctsCol_(h, ['vehicle_id']),
    date: ctsCol_(h, ['drive_date']),
    email: ctsCol_(h, ['email']),
    status: ctsCol_(h, ['status']),
    hotel: ctsCol_(h, ['hotel']),
    tkm: ctsCol_(h, ['TKM']),
    km: ctsCol_(h, ['total_kms', 'total_km']),
    hours: ctsCol_(h, ['mapping_hours']),
  };
  ['country', 'vid', 'date', 'email', 'tkm', 'km'].forEach(function (k) {
    if (ix[k] < 0) throw new Error('KMS sem a coluna ' + k + ' — o export mudou de schema?');
  });

  // Datas pelo texto exibido: o espelho grava data como série + formato
  // yyyy-mm-dd, e ler o Date cru (getValues) já devolveu o dia anterior.
  const kDates = ctsDisplayCol_(kmsSheet, ix.date, kv.length);

  const rows = [];
  const skipped = {};
  let maxDate = '';
  for (let i = 1; i < kv.length; i++) {
    const r = kv[i];
    const date = ctsYmd_(kDates[i], tz);
    if (!date || date < '2020-01-01') continue;   // o export tem linha-lixo com data de 1900
    const c = ctsCountry_(r[ix.country]);
    if (!c) { const k = String(r[ix.country]); skipped[k] = (skipped[k] || 0) + 1; continue; }
    const season = ix.season >= 0 ? String(r[ix.season] || '') : '';
    const rawEmail = String(r[ix.email] || '').trim();
    rows.push({
      date: date,
      month: date.slice(0, 7),
      cc: c.code,
      vid: String(r[ix.vid] == null ? '' : r[ix.vid]).trim(),
      email: ctsIsEmail_(rawEmail) ? rawEmail.toLowerCase() : '',
      status: ix.status >= 0 ? String(r[ix.status] || '') : '',
      hotel: ix.hotel >= 0 ? String(r[ix.hotel] || '').trim().toLowerCase() === 'yes' : false,
      type: /churn\s*$/i.test(season) ? 'churn' : (/swarm\s*$/i.test(season) ? 'swarm' : ''),
      tkm: ctsNum_(r[ix.tkm]),
      km: ctsNum_(r[ix.km]),
      hours: ix.hours >= 0 ? ctsNum_(r[ix.hours]) : 0,
    });
    if (date > maxDate) maxDate = date;
  }
  if (Object.keys(skipped).length) Logger.log('[CTS Backend] KMS: países fora do portal ignorados: ' + JSON.stringify(skipped));

  // ---- Targets ----
  // Meses com detalhe diário: 1 linha por dia (vazia em fim de semana/feriado).
  // Meses antigos: 1 linha só, com o total do mês. Os dois somam igual.
  const targets = {};      // 'yyyy-MM|CC' → { overall, swarm, churn, workdays: ['yyyy-MM-dd'] }
  const tSheet = ss.getSheetByName(CTS_CONFIG.targetsSheet);
  if (tSheet && tSheet.getLastRow() > 1) {
    const tv = tSheet.getRange(1, 1, tSheet.getLastRow(), 9).getValues();
    const tvd = tSheet.getRange(1, 1, tSheet.getLastRow(), 9).getDisplayValues();
    const th = tv[0];
    const tx = {
      country: ctsCol_(th, ['Country']), month: ctsCol_(th, ['Month']), date: ctsCol_(th, ['Date']),
      overall: ctsCol_(th, ['Overall']), swarm: ctsCol_(th, ['Swarm']), churn: ctsCol_(th, ['Churn']),
    };
    for (let i = 1; i < tv.length; i++) {
      const r = tv[i];
      const c = ctsCountry_(r[tx.country]);
      const month = ctsYmd_(tvd[i][tx.month], tz);
      if (!c || !month) continue;
      const key = month.slice(0, 7) + '|' + c.code;
      const t = targets[key] || (targets[key] = { overall: 0, swarm: 0, churn: 0, workdays: [], daily: false });
      const ov = ctsNum_(r[tx.overall]);
      t.overall += ov;
      t.swarm += ctsNum_(r[tx.swarm]);
      t.churn += ctsNum_(r[tx.churn]);
      const day = tx.date >= 0 ? ctsYmd_(tvd[i][tx.date], tz) : null;
      if (day) { t.daily = true; if (ov > 0) t.workdays.push(day); }
    }
  } else {
    Logger.log('[CTS Backend] aba Targets não encontrada — metas zeradas');
  }

  // ---- QC ----
  const qc = {};   // 'yyyy-MM|email' → { acc, rej }
  try {
    const qSheet = ss.getSheetByName(CTS_CONFIG.qcSheet);
    if (qSheet && qSheet.getLastRow() > 1) {
      const qv = qSheet.getDataRange().getValues();
      const qh = qv[0];
      const qx = {
        date: ctsCol_(qh, ['date']), email: ctsCol_(qh, ['user_email']),
        acc: ctsCol_(qh, ['Accepted_Count']), rej: ctsCol_(qh, ['Rejected_Count']),
      };
      const qDates = ctsDisplayCol_(qSheet, qx.date, qv.length);
      for (let i = 1; i < qv.length; i++) {
        const d = ctsYmd_(qDates[i], tz);
        const em = String(qv[i][qx.email] || '').trim().toLowerCase();
        if (!d || !em) continue;
        const k = d.slice(0, 7) + '|' + em;
        const q = qc[k] || (qc[k] = { acc: 0, rej: 0 });
        q.acc += ctsNum_(qv[i][qx.acc]);
        q.rej += ctsNum_(qv[i][qx.rej]);
      }
    }
  } catch (e) { Logger.log('[CTS Backend] QC falhou (segue sem): ' + e); }

  // ---- incidents (cts-1.4) ----
  // 1 linha por ticket: vehicle_id · vendor · country_code · type · program · ticket ·
  // ticket_creation_date · incident_date · week_start · incident_month · region ·
  // item (de quem é a culpa) · severity · email. Email/ticket NÃO saem no payload público.
  let incidents = null;
  try {
    const iSheet = ss.getSheetByName(CTS_CONFIG.incidentsSheet);
    if (iSheet && iSheet.getLastRow() > 1) {
      const iv = iSheet.getDataRange().getValues();
      const ih = iv[0];
      const ix2 = {
        date: ctsCol_(ih, ['incident_date']), cc: ctsCol_(ih, ['country_code']),
        type: ctsCol_(ih, ['type']), item: ctsCol_(ih, ['item']), sev: ctsCol_(ih, ['severity']),
        ticket: ctsCol_(ih, ['ticket']), vid: ctsCol_(ih, ['vehicle_id']),
      };
      if (ix2.date >= 0 && ix2.cc >= 0) {
        const iDates = ctsDisplayCol_(iSheet, ix2.date, iv.length);
        const seen = {};
        incidents = [];
        for (let i = 1; i < iv.length; i++) {
          const r = iv[i];
          const d = ctsYmd_(iDates[i], tz);
          const c = ctsCountry_(r[ix2.cc]);
          if (!d || !c) continue;
          const t = ix2.ticket >= 0 ? String(r[ix2.ticket] || '') : '';
          if (t && seen[t]) continue;   // ticket repetido = mesma ocorrência
          if (t) seen[t] = 1;
          incidents.push({
            date: d, month: d.slice(0, 7), cc: c.code,
            type: ix2.type >= 0 ? String(r[ix2.type] || '').trim() : '',
            liability: ix2.item >= 0 ? String(r[ix2.item] || '').trim() : '',
            severity: ix2.sev >= 0 ? String(r[ix2.sev] || '').trim() : '',
          });
        }
      }
    }
  } catch (e) { Logger.log('[CTS Backend] incidents falhou (segue sem): ' + e); incidents = null; }

  _ctsSource = { tz: tz, rows: rows, maxDate: maxDate, targets: targets, qc: qc, incidents: incidents };
  return _ctsSource;
}

/**
 * Card "Accidents & incidents" (cts-1.4). type 'Accident' = acidente; o resto
 * (Other, Lost an item, Robbery, Fines, PR incident...) = incidente.
 * "Days since last accident" é contado até HOJE (número vivo de segurança),
 * mesmo olhando um mês antigo.
 */
function ctsIncidentsSummary_(list, scopeCodes, mk) {
  if (!list) return { available: false };
  const inScope = {};
  scopeCodes.forEach(function (cc) { inScope[cc] = 1; });
  const rows = list.filter(function (r) { return inScope[r.cc]; });
  const year = mk.slice(0, 4);
  const isAcc = function (r) { return /^accident/i.test(r.type); };
  const blank = function () { return { total: 0, accidents: 0, incidents: 0, bySeverity: {}, byLiability: {}, byType: {} }; };
  const add = function (b, r) {
    b.total++;
    if (isAcc(r)) b.accidents++; else b.incidents++;
    const s = r.severity || 'Unknown', l = r.liability || 'Unknown', t = r.type || 'Other';
    b.bySeverity[s] = (b.bySeverity[s] || 0) + 1;
    b.byLiability[l] = (b.byLiability[l] || 0) + 1;
    b.byType[t] = (b.byType[t] || 0) + 1;
  };
  const month = blank(), ytd = blank();
  const byCC = {};
  let lastAcc = '', last = '';
  rows.forEach(function (r) {
    if (r.date > last) last = r.date;
    if (isAcc(r) && r.date > lastAcc) lastAcc = r.date;
    if (r.month === mk) {
      add(month, r);
      const b = byCC[r.cc] || (byCC[r.cc] = { month: 0, accidents: 0, ytd: 0 });
      b.month++; if (isAcc(r)) b.accidents++;
    }
    if (r.month.slice(0, 4) === year && r.month <= mk) {
      add(ytd, r);
      (byCC[r.cc] || (byCC[r.cc] = { month: 0, accidents: 0, ytd: 0 })).ytd++;
    }
  });
  const today = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  const days = function (a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); };
  return {
    available: true,
    month: month,
    ytd: ytd,
    year: +year,
    lastIncident: last || null,
    lastAccident: lastAcc || null,
    daysSinceLastAccident: lastAcc ? Math.max(0, days(lastAcc, today)) : null,
    dataThrough: list.reduce(function (m, r) { return r.date > m ? r.date : m; }, '') || null,
    byCountry: CTS_COUNTRIES.filter(function (c) { return byCC[c.code]; }).map(function (c) {
      return { country: c.name, month: byCC[c.code].month, accidents: byCC[c.code].accidents, ytd: byCC[c.code].ytd };
    }),
  };
}

let _ctsMaster = null;

/**
 * Da Mastersheet: nomes + contagem de motoristas (HR, Active+Offboarding) e
 * curadoria de VIDs (VID Status). Falha → objetos vazios e o chamador cai no
 * KMS. Mesmas regras do Code udpt.gs (getActiveDrivers / getVidStatus_).
 */
function ctsMaster_() {
  if (_ctsMaster) return _ctsMaster;
  const out = { nameByEmail: {}, driversByCC: null, vidsByCC: null };
  let ss = null;
  try { ss = SpreadsheetApp.openById(CTS_CONFIG.masterSpreadsheetId); }
  catch (e) { Logger.log('[CTS Backend] Mastersheet inacessível: ' + e); _ctsMaster = out; return out; }

  try {
    const sh = ss.getSheetByName(CTS_CONFIG.hrSheet);
    const v = sh.getDataRange().getValues();
    const h = v[0];
    const iName = h.indexOf('Beneficiary Full Name'), iEmail = h.indexOf('Corporate E-mail');
    const iCountry = h.indexOf('Country'), iSit = h.indexOf('Situation');
    if (iEmail < 0 || iSit < 0) throw new Error('HR sem Corporate E-mail/Situation');
    const counts = {};
    for (let i = 1; i < v.length; i++) {
      const email = String(v[i][iEmail] || '').trim().toLowerCase();
      if (!email) continue;
      const name = String(v[i][iName] || '').trim();
      if (name && !out.nameByEmail[email]) out.nameByEmail[email] = name;
      const sit = v[i][iSit];
      if (sit !== 'Active' && sit !== 'Offboarding') continue;
      const c = ctsCountry_(v[i][iCountry]);
      if (c) counts[c.code] = (counts[c.code] || 0) + 1;
      if (name) out.nameByEmail[email] = name;   // ativo vence homônimo antigo
    }
    out.driversByCC = counts;
  } catch (e) { Logger.log('[CTS Backend] HR falhou (cai pro KMS): ' + e); }

  try {
    const sh = ss.getSheetByName(CTS_CONFIG.vidStatusSheet);
    if (sh && sh.getLastRow() > 1) {
      const v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
      const last = {};   // dedupe (país + VID), última linha vence — igual v5.69
      v.forEach(function (r) {
        const c = ctsCountry_(r[0]);
        const vid = String(r[1] || '').trim();
        if (!c || !vid) return;
        const raw = String(r[2]).trim().toLowerCase();
        let st = 'active';
        if (['cancelled', 'canceled', 'cancelado', 'cancelada'].indexOf(raw) >= 0) st = 'cancelled';
        else if (['inactive', 'inativo', 'inactivo', 'no', 'false', '0'].indexOf(raw) >= 0) st = 'inactive';
        last[c.code + '|' + vid] = st;
      });
      const counts = {};
      Object.keys(last).forEach(function (k) {
        const cc = k.split('|')[0];
        const t = counts[cc] || (counts[cc] = { active: 0, inactive: 0, cancelled: 0 });
        t[last[k]]++;
      });
      out.vidsByCC = counts;
    }
  } catch (e) { Logger.log('[CTS Backend] VID Status falhou (cai pro KMS): ' + e); }

  _ctsMaster = out;
  return out;
}

// ================================================================
// Agregação por motorista (usada no mensal e no semanal)
// ================================================================

/**
 * Agrupa linhas do KMS por (email, país). Motorista que rodou em 2 países vira
 * 2 linhas — cada uma só com o que ele fez naquele país (lição da v5.61/v5.68).
 * Linhas sem email ("no driver", "winterized") contam no total do país mas não
 * viram motorista.
 */
/**
 * Motivo do dia parado (cts-1.4), direto do status da CTS: '⬇Weather' → 'Weather',
 * '⬇Mech.' → 'Mechanical'. Sem status e sem mapeamento → 'Not reported'.
 */
const CTS_IDLE_LABELS = {
  'weather': 'Weather', 'travelling': 'Travelling', 'traveling': 'Travelling',
  'mech.': 'Mechanical', 'mech': 'Mechanical', 'tech.': 'Technical', 'tech': 'Technical',
  'personal': 'Personal', 'holiday': 'Holiday', 'idle with driver': 'Idle with driver',
  'at in-field wh': 'At in-field WH', 'at google wh': 'At Google WH', 'training': 'Training',
  'disks': 'Disks', 'no drive day': 'No drive day', 'strike': 'Strike',
};
function ctsIdleReason_(status) {
  const s = String(status == null ? '' : status).replace(/[⬇⬆*]/g, '').trim();
  if (!s) return 'Not reported';
  return CTS_IDLE_LABELS[s.toLowerCase()] || s;
}

function ctsDriverRows_(rows, nameByEmail, monthKeyForQc, qc, opts) {
  opts = opts || {};
  const by = {};
  rows.forEach(function (r) {
    if (!r.email) return;
    const k = r.email + '|' + r.cc;
    let D = by[k];
    if (!D) {
      D = by[k] = {
        email: r.email, cc: r.cc,
        tkm: 0, km: 0, hours: 0,
        tkmSwarm: 0, kmSwarm: 0, tkmChurn: 0, kmChurn: 0,
        _days: {}, _onDays: {}, _swarmDays: {}, _churnDays: {}, _reason: {},
        _hotelDate: '', hotel: false, vids: [],
      };
    }
    D.tkm += r.tkm; D.km += r.km; D.hours += r.hours;
    if (r.type === 'churn') { D.tkmChurn += r.tkm; D.kmChurn += r.km; if (r.tkm > 0) D._churnDays[r.date] = 1; }
    else { D.tkmSwarm += r.tkm; D.kmSwarm += r.km; if (r.tkm > 0) D._swarmDays[r.date] = 1; }
    // um dia conta 1x mesmo com 2 linhas (troca de VID / swarm+churn no mesmo dia)
    const mapping = ctsIsMappingDay_(r.status, r.hours, r.tkm);
    D._days[r.date] = D._days[r.date] || mapping;
    if (!mapping && !D._reason[r.date]) D._reason[r.date] = ctsIdleReason_(r.status);
    if (r.hours > 0) D._onDays[r.date] = 1;
    if (r.date >= D._hotelDate) { D._hotelDate = r.date; D.hotel = r.hotel; }   // hotel do dia mais recente
    if (r.vid && D.vids.indexOf(r.vid) < 0) D.vids.push(r.vid);
  });

  return Object.keys(by).map(function (k) {
    const D = by[k];
    const days = Object.keys(D._days);
    const mappingDays = days.filter(function (d) { return D._days[d]; }).length;
    const onDays = Object.keys(D._onDays).length;
    const typed = D.tkmSwarm + D.tkmChurn;
    const q = qc && monthKeyForQc ? qc[monthKeyForQc + '|' + D.email] : null;
    // dias parados = dias com linha na CTS e sem mapeamento (mesma conta do idleDays)
    const idleByReason = {};
    const idleDates = [];
    days.sort().forEach(function (d) {
      if (D._days[d]) return;
      const why = D._reason[d] || 'Not reported';
      idleByReason[why] = (idleByReason[why] || 0) + 1;
      if (opts.idleDates) idleDates.push({ d: d, r: why });
    });
    const out = {
      email: D.email,
      name: nameByEmail[D.email] || ctsNameFromEmail_(D.email),
      country: ctsCountry_(D.cc).name,
      tkm: D.tkm,
      kmDriven: D.km,
      efficiency: D.km > 0 ? D.tkm / D.km : 0,
      systemOnHours: D.hours,
      avgSystemOnHours: onDays > 0 ? D.hours / onDays : 0,
      mappingDays: mappingDays,
      idleDays: days.length - mappingDays,
      tkmSwarm: D.tkmSwarm, kmSwarm: D.kmSwarm, swarmDays: Object.keys(D._swarmDays).length,
      tkmChurn: D.tkmChurn, kmChurn: D.kmChurn, churnDays: Object.keys(D._churnDays).length,
      swarmPct: typed > 0 ? D.tkmSwarm / typed : 0,
      churnPct: typed > 0 ? D.tkmChurn / typed : 0,
      qcScore: q && (q.acc + q.rej) > 0 ? q.acc / (q.acc + q.rej) : null,
      hotelMode: D.hotel,
      vids: D.vids,
      vidCount: D.vids.length,
      idleByReason: idleByReason,
    };
    if (opts.idleDates) out.idleDates = idleDates;
    return out;
  }).sort(function (a, b) { return b.tkm - a.tkm; });
}

/** Soma de dias parados por motivo (cts-1.4) de uma lista de motoristas. */
function ctsIdleSummary_(drivers) {
  const by = {};
  let idle = 0, mapping = 0, withIdle = 0;
  drivers.forEach(function (d) {
    idle += d.idleDays || 0;
    mapping += d.mappingDays || 0;
    if (d.idleDays > 0) withIdle++;
    Object.keys(d.idleByReason || {}).forEach(function (k) { by[k] = (by[k] || 0) + d.idleByReason[k]; });
  });
  const total = idle + mapping;
  return {
    idleDays: idle, mappingDays: mapping, driverDays: total,
    idlePct: total > 0 ? idle / total : 0,
    driversWithIdle: withIdle, drivers: drivers.length,
    byReason: by,
  };
}

/** Status de frota per Google (regra da Calc_Data_VID) das linhas de um mês. */
function ctsFleetBuckets_(rows) {
  const kmByVidDay = {};
  rows.forEach(function (r) {
    if (!r.vid) return;
    const k = r.vid + '|' + r.date;
    kmByVidDay[k] = (kmByVidDay[k] || 0) + r.km;
  });
  const daysByVid = {};
  Object.keys(kmByVidDay).forEach(function (k) {
    const vid = k.split('|')[0];
    if (!(vid in daysByVid)) daysByVid[vid] = 0;
    if (kmByVidDay[k] > CTS_CONFIG.activeDayKm) daysByVid[vid]++;
  });
  let active = 0, half = 0, low = 0;
  Object.keys(daysByVid).forEach(function (vid) {
    const n = daysByVid[vid];
    if (n >= CTS_CONFIG.fullActiveDays) active++;
    else if (n >= CTS_CONFIG.halfActiveDays) half++;
    else low++;
  });
  return { active: active, halfActive: half, lowActivity: low, vidsSeen: Object.keys(daysByVid).length };
}

// ================================================================
// getClientMetrics — visão mensal
// ================================================================

function getClientMetrics_(month, year, country) {
  try {
    const src = ctsSource_();
    const master = ctsMaster_();

    // meses disponíveis = KMS ∪ Targets, do mais novo pro mais velho
    const monthSet = {};
    src.rows.forEach(function (r) { monthSet[r.month] = 1; });
    Object.keys(src.targets).forEach(function (k) { monthSet[k.split('|')[0]] = 1; });
    const monthKeys = Object.keys(monthSet).sort().reverse();
    if (!monthKeys.length) return { success: false, error: 'CTS sem dados' };

    // default: mês corrente (BRT) se a CTS já tem meta/dado dele; senão o mais recente
    if (!month || !year) {
      const now = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM');
      const pick = monthSet[now] ? now : monthKeys[0];
      year = +pick.slice(0, 4); month = +pick.slice(5, 7);
    }
    const mk = year + '-' + ('0' + month).slice(-2);

    const wantAll = !country || String(country).toUpperCase() === 'ALL';
    const one = wantAll ? null : ctsCountry_(country);
    if (!wantAll && !one) return { success: false, error: 'país desconhecido: ' + country };

    const monthRows = src.rows.filter(function (r) { return r.month === mk; });
    const ccWithData = {};
    monthRows.forEach(function (r) { ccWithData[r.cc] = 1; });
    const countriesList = CTS_COUNTRIES.filter(function (c) {
      return ccWithData[c.code] || src.targets[mk + '|' + c.code];
    });
    const scope = wantAll ? countriesList : [one];
    const inScope = {};
    scope.forEach(function (c) { inScope[c.code] = 1; });
    const rows = monthRows.filter(function (r) { return inScope[r.cc]; });

    // ---- por país ----
    const perCountry = [];
    const pace = [];
    const fleetByCC = {};
    scope.forEach(function (c) {
      const cr = rows.filter(function (r) { return r.cc === c.code; });
      const t0 = src.targets[mk + '|' + c.code] || { overall: 0, swarm: 0, churn: 0, workdays: [] };
      // meta diária é fração (644,333…) — a soma sai 13180,9999; arredonda pra exibir limpo
      const r2 = function (x) { return Math.round(x * 100) / 100; };
      const t = { overall: r2(t0.overall), swarm: r2(t0.swarm), churn: r2(t0.churn), workdays: t0.workdays };
      let done = 0, swarm = 0, churn = 0, hours = 0, km = 0;
      const driverDays = {};   // email|date → tkm
      cr.forEach(function (r) {
        done += r.tkm; km += r.km; hours += r.hours;
        if (r.type === 'churn') churn += r.tkm; else swarm += r.tkm;
        if (r.email && r.tkm > 0) {
          const k = r.email + '|' + r.date;
          driverDays[k] = (driverDays[k] || 0) + r.tkm;
        }
      });
      const goal = t.swarm + t.churn > 0 ? t.swarm + t.churn : t.overall;
      const hrCount = master.driversByCC ? (master.driversByCC[c.code] || 0) : null;
      const kmsDrivers = {};
      cr.forEach(function (r) { if (r.email) kmsDrivers[r.email] = 1; });

      perCountry.push({
        country: c.name,
        goalTkm: goal,
        tkmDone: done,
        achievementPct: goal > 0 ? done / goal : 0,
        avgSystemOnHours: (function () {
          const on = {};
          let h = 0;
          cr.forEach(function (r) { if (r.email && r.hours > 0) { on[r.email + '|' + r.date] = 1; h += r.hours; } });
          const n = Object.keys(on).length;
          return n > 0 ? h / n : 0;
        })(),
        swarmTkm: swarm, swarmGoal: t.swarm,
        churnTkm: churn, churnGoal: t.churn,
        kmDriven: km,
        efficiency: km > 0 ? done / km : 0,
        activeDrivers: hrCount != null ? hrCount : Object.keys(kmsDrivers).length,
        driversActive: Object.keys(kmsDrivers).length,
      });

      // ---- ritmo / projeção ----
      // Dias úteis vêm da própria Targets (dia com meta > 0 — já sem feriado).
      // "Último dia com dado" é o da CTS inteira, não do país: país que não
      // rodou ontem tem que aparecer atrasado, não "em dia".
      const lastDate = src.maxDate;
      const work = t.workdays.slice().sort();
      const elapsed = work.filter(function (d) { return d <= lastDate; }).length;
      const left = work.filter(function (d) { return d > lastDate; }).length;
      const perDay = elapsed > 0 ? done / elapsed : 0;
      const ddKeys = Object.keys(driverDays);
      let lastDayTkm = 0, lastDayDrivers = 0, cLast = '';
      ddKeys.forEach(function (k) { const d = k.split('|')[1]; if (d > cLast) cLast = d; });
      ddKeys.forEach(function (k) {
        if (k.split('|')[1] === cLast) { lastDayTkm += driverDays[k]; lastDayDrivers++; }
      });
      pace.push({
        country: c.name,
        activeDrivers: hrCount != null ? hrCount : Object.keys(kmsDrivers).length,
        daysLeft: work.length ? left : null,
        avgRequired: left > 0 ? Math.max(0, goal - done) / left : 0,
        // TKM por motorista por dia mapeado (o "MONTH AVERAGE MAPPING DAY" da CTS Goal Mgmt)
        monthAvgMappingDays: ddKeys.length ? done / ddKeys.length : 0,
        avgSystemOnHoursCts: perCountry[perCountry.length - 1].avgSystemOnHours,
        tkmPerHour: hours > 0 ? done / hours : 0,
        // mês fechado → realizado/meta; mês corrente → realizado + ritmo × dias restantes
        projection: goal > 0 ? (done + perDay * left) / goal : 0,
        lastDay: cLast || null,
        lastDayAvg: lastDayDrivers > 0 ? lastDayTkm / lastDayDrivers : 0,
        lastDayDrivers: lastDayDrivers,
      });

      fleetByCC[c.code] = ctsFleetBuckets_(cr);
    });

    // ---- motoristas ----
    const drivers = ctsDriverRows_(rows, master.nameByEmail, mk, src.qc, { idleDates: true }).map(function (d) {
      d.tkmDriverTotal = d.tkm;
      delete d.email;   // portal é público: email não sai no payload mensal
      return d;
    });
    // total do motorista em todos os países (quem rodou em 2 países)
    const totalByName = {};
    drivers.forEach(function (d) { totalByName[d.name] = (totalByName[d.name] || 0) + d.tkm; });
    drivers.forEach(function (d) { d.tkmDriverTotal = totalByName[d.name]; });

    // ---- idle days por país (cts-1.4) ----
    perCountry.forEach(function (pc) {
      pc.idle = ctsIdleSummary_(drivers.filter(function (d) { return d.country === pc.country; }));
    });

    // ---- KPIs ----
    const sum = function (k) { return perCountry.reduce(function (a, c) { return a + (c[k] || 0); }, 0); };
    const goalTkm = sum('goalTkm'), tkmDone = sum('tkmDone');
    const swarmTkm = sum('swarmTkm'), churnTkm = sum('churnTkm');
    const swarmGoal = sum('swarmGoal'), churnGoal = sum('churnGoal');
    const kmDriven = sum('kmDriven');

    let totalDrivers = 0;
    if (master.driversByCC) scope.forEach(function (c) { totalDrivers += master.driversByCC[c.code] || 0; });
    if (!totalDrivers) totalDrivers = drivers.length;

    const vidsCur = { active: 0, inactive: 0, cancelled: 0 };
    if (master.vidsByCC) scope.forEach(function (c) {
      const v = master.vidsByCC[c.code];
      if (v) { vidsCur.active += v.active; vidsCur.inactive += v.inactive; vidsCur.cancelled += v.cancelled; }
    });
    const vidsSeen = {};
    rows.forEach(function (r) { if (r.vid) vidsSeen[r.vid] = 1; });
    // VIDs = SÓ a curadoria do ops-map (aba VID Status, editada à mão). Sem
    // curadoria o card fica vazio — nunca cai pra contagem do KMS.
    const totalVids = master.vidsByCC ? vidsCur.active : null;

    // Frota: active/half pela regra da CTS; o denominador é a NOSSA frota
    // (curadoria). notActive = o que sobra da frota sem atividade suficiente.
    const fl = { fleet: 0, active: 0, halfActive: 0, notActive: 0, floating: 0 };
    scope.forEach(function (c) {
      const b = fleetByCC[c.code];
      fl.active += b.active; fl.halfActive += b.halfActive;
      const own = master.vidsByCC && master.vidsByCC[c.code] ? master.vidsByCC[c.code].active : 0;
      fl.fleet += own;
      fl.notActive += Math.max(0, own - b.active - b.halfActive);
    });
    const denom = fl.fleet || (fl.active + fl.halfActive + fl.notActive);
    fl.statusTotal = denom;
    fl.activePct = denom > 0 ? fl.active / denom : 0;
    fl.halfActivePct = denom > 0 ? fl.halfActive / denom : 0;
    fl.notActivePct = denom > 0 ? fl.notActive / denom : 0;
    fl.sourceMonth = month; fl.sourceYear = year; fl.isCurrentPeriod = true;
    fl.rule = '>' + CTS_CONFIG.activeDayKm + 'km/day; active ≥' + CTS_CONFIG.fullActiveDays + ' days, half ' + CTS_CONFIG.halfActiveDays + '–' + (CTS_CONFIG.fullActiveDays - 1);

    let onH = 0, onN = 0, mdays = 0;
    drivers.forEach(function (d) {
      if (d.avgSystemOnHours > 0) { onH += d.avgSystemOnHours; onN++; }
      mdays += d.mappingDays;
    });
    let qa = 0, qr = 0;
    Object.keys(src.qc).forEach(function (k) {
      if (k.indexOf(mk + '|') !== 0) return;
      const em = k.slice(mk.length + 1);
      if (!rows.some(function (r) { return r.email === em; })) return;   // só quem rodou no escopo
      qa += src.qc[k].acc; qr += src.qc[k].rej;
    });

    return {
      success: true,
      source: 'cts',
      version: CTS_VERSION,
      month: month,
      year: year,
      country: wantAll ? 'ALL' : one.name,
      months: monthKeys.map(function (k) { return { month: +k.slice(5, 7), year: +k.slice(0, 4) }; }),
      countries: countriesList.map(function (c) { return c.name; }),
      dataThrough: src.maxDate,
      pace: pace,
      kpis: {
        goalTkm: goalTkm,
        tkmDone: tkmDone,
        achievementPct: goalTkm > 0 ? tkmDone / goalTkm : 0,
        baselinePct: 0,
        kmDriven: kmDriven,
        efficiency: kmDriven > 0 ? tkmDone / kmDriven : 0,
        totalDrivers: totalDrivers,
        totalVids: totalVids,
        vidsBreakdown: {
          curatedActive: vidsCur.active,
          curatedInactive: vidsCur.inactive,
          curatedCancelled: vidsCur.cancelled,
          vidsInCts: Object.keys(vidsSeen).length,
          source: master.vidsByCC ? 'ops-map' : 'unavailable',
        },
        avgSystemOnHours: onN > 0 ? onH / onN : 0,
        mappingDays: mdays,
        qcScore: qa + qr > 0 ? qa / (qa + qr) : null,
        swarmTkm: swarmTkm,
        swarmGoal: swarmGoal,
        swarmAchievementPct: swarmGoal > 0 ? swarmTkm / swarmGoal : 0,
        churnTkm: churnTkm,
        churnGoal: churnGoal,
        churnAchievementPct: churnGoal > 0 ? churnTkm / churnGoal : 0,
        swarmPct: swarmTkm + churnTkm > 0 ? swarmTkm / (swarmTkm + churnTkm) : 0,
        churnPct: swarmTkm + churnTkm > 0 ? churnTkm / (swarmTkm + churnTkm) : 0,
        fleet: fl,
        idle: ctsIdleSummary_(drivers),
      },
      incidents: ctsIncidentsSummary_(src.incidents, scope.map(function (c) { return c.code; }), mk),
      perCountry: perCountry,
      drivers: drivers,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    Logger.log('[CTS Backend] getClientMetrics_ erro: ' + err + '\n' + (err && err.stack));
    return { success: false, error: String(err) };
  }
}

// ================================================================
// getClientWeeks — visão semanal (últimas N semanas ISO)
// ================================================================

function getClientWeeks_(weeksBack) {
  try {
    weeksBack = weeksBack || 8;
    const src = ctsSource_();
    const master = ctsMaster_();

    const byWeek = {};
    src.rows.forEach(function (r) {
      const w = ctsIsoWeek_(r.date);
      const key = w.year + '-W' + ('0' + w.week).slice(-2);
      const W = byWeek[key] || (byWeek[key] = { w: w, key: key, rows: [], first: r.date, last: r.date });
      W.rows.push(r);
      if (r.date < W.first) W.first = r.date;
      if (r.date > W.last) W.last = r.date;
    });

    const countrySet = {};
    const weeks = Object.keys(byWeek).sort().reverse().slice(0, weeksBack).map(function (key) {
      const W = byWeek[key];
      const drivers = ctsDriverRows_(W.rows, master.nameByEmail, null, null);
      drivers.forEach(function (d) { countrySet[d.country] = 1; });
      return {
        week: W.w.week,
        year: W.w.year,
        key: key,
        label: 'Week ' + W.w.week + ' · ' + W.w.year,
        start: W.w.start,
        end: W.w.end,
        firstDay: W.first,
        lastDay: W.last,
        drivers: drivers,
      };
    });

    return {
      success: true,
      source: 'cts',
      version: CTS_VERSION,
      weeks: weeks,
      countries: CTS_COUNTRIES.map(function (c) { return c.name; }).filter(function (n) { return countrySet[n]; }),
      dataThrough: src.maxDate,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    Logger.log('[CTS Backend] getClientWeeks_ erro: ' + err + '\n' + (err && err.stack));
    return { success: false, error: String(err) };
  }
}

// ================================================================
// MODO ADMIN (cts-1.4) — senha única, sem login
// ================================================================
//
// Senha: Configurações do projeto → Propriedades do script → ADMIN_PASSWORD.
// (Nunca no código: o repositório é público.) ADMIN_EMAIL é opcional.
//
// adminCheck      { password }                  → { token } válido por 6h
// adminRootChange { token, changes[], context } → grava na aba _admin_log do
//                  espelho + manda e-mail dizendo ONDE mudar cada número.
// "Só nesta sessão" nem chega aqui: fica no navegador de quem está apresentando.

/** De onde vem cada número do portal (o e-mail diz onde mexer). */
const CTS_SOURCES = {
  goal: {
    label: 'Meta mensal (CTS Goal)',
    where: 'Planilha da CTS → aba Targets (colunas Overall / Swarm / Churn, linhas do país nos dias úteis do mês). O "entregue" do card vem da aba KMS, coluna TKM.',
    who: 'CTS (planilha deles, só leitura pra nós) — pedir a correção pra CTS. O espelho copia de hora em hora.',
  },
  tkm: {
    label: 'TKM',
    where: 'Planilha da CTS → aba KMS, coluna TKM (linhas do país/mês; por motorista = coluna email).',
    who: 'CTS — pedir a correção pra CTS.',
  },
  km: {
    label: 'KM driven',
    where: 'Planilha da CTS → aba KMS, coluna total_kms.',
    who: 'CTS — pedir a correção pra CTS.',
  },
  efficiency: {
    label: 'Efficiency (TKM ÷ KM)',
    where: 'Calculado: TKM ÷ total_kms da aba KMS. Muda sozinho quando TKM ou KM mudarem.',
    who: 'Corrigir TKM/KM na origem (CTS).',
  },
  drivers: {
    label: 'Total drivers',
    where: 'LATAM MASTERSHEET → aba HR and Vendors Database: conta Situation = Active ou Offboarding, por Country.',
    who: 'Nós — editar a Situation na HR.',
  },
  mappingDays: {
    label: 'Mapping days',
    where: 'Planilha da CTS → aba KMS: dias com status ⬆ por motorista.',
    who: 'CTS — pedir a correção do status pra CTS.',
  },
  vids: {
    label: 'VIDs',
    where: 'Card Total VIDs = curadoria do ops-map (ops-map.html → Admin; aba VID Status da Mastersheet, VIDs ativos). Coluna VIDs da tabela = vehicle_id distintos da aba KMS.',
    who: 'Nós (card) — ops-map. CTS (tabela).',
  },
  soh: {
    label: 'Avg system on hours',
    where: 'Planilha da CTS → aba KMS, coluna mapping_hours (média por dia com horas).',
    who: 'CTS — pedir a correção pra CTS.',
  },
  fleet: {
    label: 'Fleet status per Google',
    where: 'Aba KMS (total_kms por VID/dia: > 30 km = dia ativo; ≥ 10 dias = active, 3–9 = half) sobre a frota da curadoria do ops-map (VID Status).',
    who: 'CTS (km) + nós (curadoria no ops-map).',
  },
  swarm: {
    label: 'Swarm',
    where: 'Aba KMS (season_name terminando em "Swarm") + meta na aba Targets, coluna Swarm.',
    who: 'CTS — pedir a correção pra CTS.',
  },
  churn: {
    label: 'Churn',
    where: 'Aba KMS (season_name terminando em "Churn") + meta na aba Targets, coluna Churn.',
    who: 'CTS — pedir a correção pra CTS.',
  },
  pace: {
    label: 'Pace & projection',
    where: 'Calculado: dias úteis/meta da aba Targets + TKM da aba KMS. Muda quando meta ou TKM mudarem.',
    who: 'Corrigir meta/TKM na origem (CTS).',
  },
  hotel: {
    label: 'Hotel mode',
    where: 'Planilha da CTS → aba KMS, coluna hotel (Yes/No do dia mais recente do motorista).',
    who: 'CTS — pedir a correção pra CTS.',
  },
  idle: {
    label: 'Idle days',
    where: 'Planilha da CTS → aba KMS, coluna status (⬇Motivo) por motorista e dia. Dia sem status e sem mapeamento = "Not reported".',
    who: 'CTS — pedir a correção do status pra CTS.',
  },
  incidents: {
    label: 'Accidents & incidents',
    where: 'Planilha da CTS → aba incidents (type, severity, item = liability, incident_date, country_code). 1 linha por ticket.',
    who: 'CTS — pedir a correção pra CTS.',
  },
  weekly: {
    label: 'Aba Weekly',
    where: 'Mesmas fontes do mensal, recortadas por semana ISO: aba KMS da CTS (TKM, total_kms, mapping_hours, status, hotel).',
    who: 'CTS — pedir a correção pra CTS.',
  },
  other: {
    label: 'Outro número',
    where: 'Não mapeado automaticamente — conferir as abas KMS/Targets do CTS Mirror.',
    who: '—',
  },
};

const CTS_LINKS = {
  cts: 'https://docs.google.com/spreadsheets/d/1EczaKGKiQXkgVVjXHJs3OVtCdpeQvlkPYPTdl4S5NeM/edit',
  mirror: 'https://docs.google.com/spreadsheets/d/18lTqa5I0bNcPiLCXUpid9dGT19x4r7vTlKZ7b23C_NM/edit',
  master: 'https://docs.google.com/spreadsheets/d/1hwRnvbIKHWMRVY84lT6svbCg5BcMKkIJ7iaKpnNOGjg/edit',
  opsMap: 'https://latamace.com/ops-map.html',
};

function ctsAdminCheck_(body) {
  const cache = CacheService.getScriptCache();
  const fails = parseInt(cache.get('adm_fail'), 10) || 0;
  if (fails >= 8) return { success: false, error: 'locked', message: 'Too many attempts. Try again in 15 minutes.' };
  const pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!pw) return { success: false, error: 'not_configured', message: 'ADMIN_PASSWORD not set in Script Properties.' };
  if (String(body.password || '') !== pw) {
    cache.put('adm_fail', String(fails + 1), 900);
    Utilities.sleep(800);   // freia tentativa em massa
    return { success: false, error: 'wrong_password' };
  }
  cache.remove('adm_fail');
  const token = Utilities.getUuid();
  cache.put('adm_' + token, '1', 21600);
  Logger.log('[CTS Backend] admin: login ok');
  return { success: true, token: token, expiresIn: 21600, sources: CTS_SOURCES };
}

function ctsAdminTokenOk_(token) {
  return !!token && CacheService.getScriptCache().get('adm_' + token) === '1';
}

function ctsAdminRootChange_(body) {
  if (!ctsAdminTokenOk_(body.token)) return { success: false, error: 'session_expired' };
  const changes = (Array.isArray(body.changes) ? body.changes : []).slice(0, 50);
  if (!changes.length) return { success: false, error: 'nada pra registrar' };
  const ctx = body.context || {};
  const clip = function (s, n) { return String(s == null ? '' : s).slice(0, n || 300); };
  const now = new Date();

  // 1) anota (aba _admin_log no espelho — nossa planilha; o cts-mirror.gs não mexe nela)
  let logged = false;
  try {
    const ss = SpreadsheetApp.openById(CTS_CONFIG.ctsSpreadsheetId);
    let sh = ss.getSheetByName(CTS_CONFIG.adminLogSheet);
    if (!sh) {
      sh = ss.insertSheet(CTS_CONFIG.adminLogSheet);
      sh.appendRow(['Quando', 'Aba', 'País', 'Período', 'Número', 'Contexto', 'Estava', 'Quer', 'Onde mudar', 'Quem muda', 'Nota', 'Status']);
      sh.setFrozenRows(1);
    }
    const rows = changes.map(function (c) {
      const src = CTS_SOURCES[c.sourceKey] || CTS_SOURCES.other;
      return [now, clip(ctx.view, 40), clip(ctx.country, 40), clip(ctx.period, 60), clip(c.label, 200),
              clip(c.context, 300), clip(c.from, 200), clip(c.to, 200), src.where, src.who, clip(body.note, 500), 'Pendente'];
    });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    logged = true;
  } catch (e) { Logger.log('[CTS Backend] admin: log falhou: ' + e); }

  // 2) e-mail (MailApp — GmailApp não tem escopo autorizado nos nossos projetos)
  const to = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || CTS_CONFIG.adminEmailDefault;
  const e_ = ctsEsc_;
  const items = changes.map(function (c) {
    const src = CTS_SOURCES[c.sourceKey] || CTS_SOURCES.other;
    return '<tr>' +
      '<td style="padding:10px;border-bottom:1px solid #E2E8F0;vertical-align:top"><b>' + e_(c.label) + '</b>' +
        (c.context ? '<div style="color:#64748B;font-size:12px;margin-top:3px">' + e_(clip(c.context, 300)) + '</div>' : '') + '</td>' +
      '<td style="padding:10px;border-bottom:1px solid #E2E8F0;vertical-align:top;white-space:nowrap">' +
        '<span style="color:#B91C1C;text-decoration:line-through">' + e_(c.from) + '</span><br>' +
        '<span style="color:#15803D;font-weight:700">' + e_(c.to) + '</span></td>' +
      '<td style="padding:10px;border-bottom:1px solid #E2E8F0;vertical-align:top;font-size:13px">' + e_(src.where) +
        '<div style="color:#64748B;font-size:12px;margin-top:4px">Quem muda: ' + e_(src.who) + '</div></td>' +
      '</tr>';
  }).join('');
  const first = changes[0];
  const subject = '[/cts-data] Mudar na raiz: ' + clip(first.label, 80) +
    (changes.length > 1 ? ' (+' + (changes.length - 1) + ')' : '') +
    ' · ' + (ctx.country || 'ALL') + ' · ' + (ctx.period || '');
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:760px;color:#1A202C">' +
    '<h2 style="color:#1A365D;margin:0 0 6px">Pedido de mudança na raiz — /cts-data</h2>' +
    '<div style="color:#64748B;font-size:13px;margin-bottom:14px">' +
      e_(Utilities.formatDate(now, 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm')) + ' (SP) · aba ' + e_(ctx.view || '—') +
      ' · ' + e_(ctx.country || 'ALL') + ' · ' + e_(ctx.period || '—') + '</div>' +
    (body.note ? '<div style="background:#EBF4FB;border-radius:8px;padding:10px 12px;margin-bottom:14px"><b>Nota:</b> ' + e_(clip(body.note, 500)) + '</div>' : '') +
    '<table style="border-collapse:collapse;width:100%;font-size:14px">' +
    '<tr style="background:#F1F5F9;text-align:left"><th style="padding:10px">Número</th><th style="padding:10px">Estava → Quer</th><th style="padding:10px">Onde mudar</th></tr>' +
    items + '</table>' +
    '<div style="margin-top:16px;font-size:13px">Links: <a href="' + CTS_LINKS.cts + '">Planilha da CTS</a> · ' +
      '<a href="' + CTS_LINKS.mirror + '">CTS Mirror</a> (aba ' + CTS_CONFIG.adminLogSheet + ' = histórico destes pedidos) · ' +
      '<a href="' + CTS_LINKS.master + '">Mastersheet</a> · <a href="' + CTS_LINKS.opsMap + '">ops-map</a></div>' +
    '<div style="margin-top:12px;color:#94A3B8;font-size:12px">Enquanto a origem não muda, o portal mostra o valor antigo pra todo mundo — ' +
      'o valor novo só aparece na sessão de quem editou. ' + (logged ? 'Anotado na aba ' + CTS_CONFIG.adminLogSheet + '.' : '⚠ não consegui anotar na planilha (ver log do Apps Script).') + '</div>' +
    '</div>';
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, name: 'Street View LATAM · /cts-data' });
  Logger.log('[CTS Backend] admin: pedido de mudança enviado pra ' + to + ' (' + changes.length + ' item)');
  return { success: true, emailed: to, logged: logged };
}

function ctsEsc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/**
 * Rodar UMA vez no editor depois de colar a cts-1.4: autoriza o envio de e-mail
 * (MailApp) e a escrita no espelho, e manda um e-mail de teste.
 */
function testAdminSetup() {
  const pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  Logger.log('ADMIN_PASSWORD ' + (pw ? 'definida (' + pw.length + ' caracteres)' : 'NÃO definida — Configurações do projeto → Propriedades do script'));
  const t = ctsAdminCheck_({ password: pw || '' });
  if (!t.success) { Logger.log('adminCheck: ' + JSON.stringify(t)); return; }
  const r = ctsAdminRootChange_({
    token: t.token,
    note: 'Teste do setup (pode ignorar / apagar a linha na aba _admin_log).',
    context: { view: 'Monthly', country: 'ALL', period: 'teste' },
    changes: [{ label: 'TKM delivered (teste)', context: 'e-mail de teste do testAdminSetup', from: '100', to: '101', sourceKey: 'tkm' }],
  });
  Logger.log('adminRootChange: ' + JSON.stringify(r));
}

/** Rodar no editor pra autorizar os escopos e ver os números no log. */
function testCtsBackend() {
  const r = getClientMetrics_(null, null, 'ALL');
  Logger.log(JSON.stringify({ success: r.success, error: r.error, month: r.month, year: r.year, dataThrough: r.dataThrough, kpis: r.kpis }, null, 2));
  const w = getClientWeeks_(2);
  Logger.log('weeks: ' + (w.weeks || []).map(function (x) { return x.key + ' (' + x.drivers.length + ')'; }).join(', '));
}
