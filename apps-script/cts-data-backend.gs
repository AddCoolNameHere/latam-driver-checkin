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

const CTS_VERSION = 'cts-1.1';

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
    try { ctsCachePut_(cache, key, str); } catch (e) { Logger.log('[CTS Backend] cache falhou: ' + e); }
  }
  return ContentService.createTextOutput(str).setMimeType(ContentService.MimeType.JSON);
}

function ctsCachePut_(cache, key, str) {
  const CHUNK = 90000;
  const n = Math.ceil(str.length / CHUNK);
  const map = {};
  for (let i = 0; i < n; i++) map[key + '_' + i] = str.slice(i * CHUNK, (i + 1) * CHUNK);
  map[key + '_n'] = String(n);
  cache.putAll(map, CTS_CONFIG.cacheSeconds);
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

  _ctsSource = { tz: tz, rows: rows, maxDate: maxDate, targets: targets, qc: qc };
  return _ctsSource;
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
function ctsDriverRows_(rows, nameByEmail, monthKeyForQc, qc) {
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
        _days: {}, _onDays: {}, _swarmDays: {}, _churnDays: {},
        _hotelDate: '', hotel: false, vids: [],
      };
    }
    D.tkm += r.tkm; D.km += r.km; D.hours += r.hours;
    if (r.type === 'churn') { D.tkmChurn += r.tkm; D.kmChurn += r.km; if (r.tkm > 0) D._churnDays[r.date] = 1; }
    else { D.tkmSwarm += r.tkm; D.kmSwarm += r.km; if (r.tkm > 0) D._swarmDays[r.date] = 1; }
    // um dia conta 1x mesmo com 2 linhas (troca de VID / swarm+churn no mesmo dia)
    const mapping = ctsIsMappingDay_(r.status, r.hours, r.tkm);
    D._days[r.date] = D._days[r.date] || mapping;
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
    return {
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
    };
  }).sort(function (a, b) { return b.tkm - a.tkm; });
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
    const drivers = ctsDriverRows_(rows, master.nameByEmail, mk, src.qc).map(function (d) {
      d.tkmDriverTotal = d.tkm;
      delete d.email;   // portal é público: email não sai no payload mensal
      return d;
    });
    // total do motorista em todos os países (quem rodou em 2 países)
    const totalByName = {};
    drivers.forEach(function (d) { totalByName[d.name] = (totalByName[d.name] || 0) + d.tkm; });
    drivers.forEach(function (d) { d.tkmDriverTotal = totalByName[d.name]; });

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
    const totalVids = vidsCur.active || Object.keys(vidsSeen).length;

    // Frota: active/half pela regra da CTS; o denominador é a NOSSA frota
    // (curadoria). notActive = o que sobra da frota sem atividade suficiente.
    const fl = { fleet: 0, active: 0, halfActive: 0, notActive: 0, floating: 0 };
    scope.forEach(function (c) {
      const b = fleetByCC[c.code];
      fl.active += b.active; fl.halfActive += b.halfActive;
      const own = master.vidsByCC && master.vidsByCC[c.code] ? master.vidsByCC[c.code].active : b.vidsSeen;
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
          source: vidsCur.active ? 'curation' : 'cts',
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
      },
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

/** Rodar no editor pra autorizar os escopos e ver os números no log. */
function testCtsBackend() {
  const r = getClientMetrics_(null, null, 'ALL');
  Logger.log(JSON.stringify({ success: r.success, error: r.error, month: r.month, year: r.year, dataThrough: r.dataThrough, kpis: r.kpis }, null, 2));
  const w = getClientWeeks_(2);
  Logger.log('weeks: ' + (w.weeks || []).map(function (x) { return x.key + ' (' + x.drivers.length + ')'; }).join(', '));
}
