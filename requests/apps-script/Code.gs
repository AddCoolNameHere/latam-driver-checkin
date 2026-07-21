/**
 * LATAM Requests — Backend (Google Apps Script)
 * Aceolution do Brasil — Street View LATAM team
 *
 * Web App que conecta os HTMLs (requests.html + triage.html + dashboard.html) a uma planilha.
 *
 * FLUXO (v1.1):
 *   1. requests.html  -> nova solicitação entra como "pendente de triagem" (Validated vazio)
 *                        e DISPARA EMAIL pra Bia.
 *   2. triage.html    -> o time designa responsável, ajusta, e VALIDA. Validar exige responsável,
 *                        envia email pro solicitante e marca Validated = Yes.
 *   3. dashboard.html -> mostra SÓ os validados (somente leitura). Edição é só na triagem.
 *
 * DEPLOY: ver README.md. Importante: emails exigem autorizar o escopo de e-mail
 *   (rode testEmail() uma vez no editor) e reimplantar "Nova versão".
 *
 * Comunicação: GET ?action=...  /  POST body JSON { type:'...' } (fire-and-forget, no-cors).
 */

// ================================================================
// CONFIG
// ================================================================
const CONFIG = {
  version: 'v1.2',

  // '' = usa a planilha onde o script está colado (recomendado).
  spreadsheetId: '',
  sheetName: 'Requests',

  // SLA automático por prioridade (DIAS ÚTEIS a partir da criação).
  sla: { Urgent: 1, High: 3, Normal: 5, Low: 10 },

  categories: [
    'Operations', 'Legal', 'Finance', 'Billing', 'HR', 'Recruiting',
    'Client Requests', 'Fleet', 'Accidents', 'Ramp / Payhawk', 'Contracts',
    'IT', 'Procurement', 'Business Development', 'New client',
  ],

  statuses: [
    'New', 'Waiting on Me', 'Waiting Internal', 'Waiting Client',
    'Waiting Vendor', 'Completed', 'Blocked', 'Finished',
  ],

  priorities: ['Urgent', 'High', 'Normal', 'Low'],

  // Time LATAM (responsáveis). EDITE com a equipe real.
  team: ['Bia', 'Fuss', 'Lucas Muzitano', 'David', 'Eduardo'],

  countries: ['Brazil', 'Argentina', 'Chile', 'Colombia', 'Mexico', 'Peru', 'LATAM (all)', 'Other'],

  // Notificações por email.
  notify: {
    enabled: true,
    bia: 'Bia@aceolution.com',                                            // recebe TODA nova solicitação
    triageUrl: 'https://addcoolnamehere.github.io/latam-requests/triage.html',
    fromName: 'LATAM Requests',
  },
};

// Colunas canônicas. Leitura usa mapa header->índice (ordem pode mudar), mas NÃO renomeie.
const HEADERS = [
  'ID', 'Created At', 'Requester Name', 'Requester Email', 'Category',
  'Subject', 'Description', 'Project', 'Country', 'Priority',
  'Responsible', 'ETA', 'SLA Due', 'Status', 'Link', 'Internal Notes', 'Updated At',
  'Validated', 'Validated At',
];

// ================================================================
// SETUP / SHEET
// ================================================================
function setup() {
  const sh = ensureSheet_();
  const lastRow = sh.getLastRow();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('lastRequestId')) {
    props.setProperty('lastRequestId', String(Math.max(0, lastRow - 1)));
  }
  return 'Setup OK — aba "' + CONFIG.sheetName + '" pronta. Versão ' + CONFIG.version;
}

// Rode UMA VEZ no editor pra autorizar o envio de email e confirmar que a Bia recebe.
function testEmail() {
  notifyBiaNewRequest_({
    id: 'TESTE-0000', requesterName: 'Teste', requesterEmail: 'teste@aceolution.com',
    category: 'IT', priority: 'Normal', subject: 'Teste de email / autorização',
    description: 'Se você recebeu isto, o envio de email está autorizado.',
    project: 'Setup', country: 'Brazil', responsible: '—', eta: '', slaDue: '', link: '',
  });
  return 'Email de teste enviado para ' + CONFIG.notify.bia;
}

function getSpreadsheet_() {
  if (CONFIG.spreadsheetId) return SpreadsheetApp.openById(CONFIG.spreadsheetId);
  return SpreadsheetApp.getActive();
}

function ensureSheet_() {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(CONFIG.sheetName);
  if (!sh) sh = ss.insertSheet(CONFIG.sheetName);

  const lastCol = Math.max(1, sh.getLastColumn());
  const headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const hasHeader = headerRow.some(function (v) { return String(v).trim() !== ''; });

  if (!hasHeader) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#1A365D').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    return sh;
  }

  // Migração: adiciona colunas de HEADERS que ainda não existem (ex: Validated em planilhas antigas).
  const existing = headerRow.map(function (v) { return String(v).trim(); });
  let col = existing.length;
  HEADERS.forEach(function (h) {
    if (existing.indexOf(h) === -1) {
      col++;
      sh.getRange(1, col).setValue(h).setFontWeight('bold').setBackground('#1A365D').setFontColor('#FFFFFF');
    }
  });
  return sh;
}

function headerMap_(sh) {
  const row = sh.getRange(1, 1, 1, Math.max(HEADERS.length, sh.getLastColumn())).getValues()[0];
  const map = {};
  row.forEach(function (h, i) { map[String(h).trim()] = i; });
  return map;
}

// ================================================================
// HELPERS
// ================================================================
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function toIso_(v) {
  if (!v) return '';
  if (isDate_(v)) return v.toISOString();
  return String(v);
}

function fmtBr_(v) {
  if (!v) return '';
  let d = isDate_(v) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function addBusinessDays_(start, days) {
  const d = new Date(start.getTime());
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  d.setHours(23, 59, 0, 0);
  return d;
}

function slaDueFrom_(created, priority) {
  const days = CONFIG.sla[priority];
  if (!days) return '';
  return addBusinessDays_(created, days);
}

function nextRequestId_() {
  const props = PropertiesService.getScriptProperties();
  let n = parseInt(props.getProperty('lastRequestId') || '0', 10) + 1;
  props.setProperty('lastRequestId', String(n));
  return 'LATAM-' + String(n).padStart(4, '0');
}

function findRow_(sh, map, id) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const idCol = map['ID'];
  const ids = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function setCell_(sh, map, row, name, value) {
  const i = map[name];
  if (i !== undefined) sh.getRange(row, i + 1).setValue(value);
}
function getCell_(sh, map, row, name) {
  const i = map[name];
  return (i === undefined) ? '' : sh.getRange(row, i + 1).getValue();
}

function rowToObj_(row, map, rowNumber) {
  function cell(name) { const i = map[name]; return (i === undefined) ? '' : row[i]; }
  return {
    rowNumber: rowNumber,
    id: String(cell('ID')),
    createdAt: toIso_(cell('Created At')),
    requesterName: String(cell('Requester Name')),
    requesterEmail: String(cell('Requester Email')),
    category: String(cell('Category')),
    subject: String(cell('Subject')),
    description: String(cell('Description')),
    project: String(cell('Project')),
    country: String(cell('Country')),
    priority: String(cell('Priority')),
    responsible: String(cell('Responsible')),
    eta: toIso_(cell('ETA')),
    slaDue: toIso_(cell('SLA Due')),
    status: String(cell('Status')) || 'New',
    link: String(cell('Link')),
    notes: String(cell('Internal Notes')),
    updatedAt: toIso_(cell('Updated At')),
    validated: String(cell('Validated')).trim().toLowerCase() === 'yes',
    validatedAt: toIso_(cell('Validated At')),
  };
}

function readRow_(sh, map, targetRow) {
  const width = Math.max(HEADERS.length, sh.getLastColumn());
  const row = sh.getRange(targetRow, 1, 1, width).getValues()[0];
  return rowToObj_(row, map, targetRow);
}

// ================================================================
// GET
// ================================================================
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'ping';

    if (action === 'ping') {
      const sh = ensureSheet_();
      const all = getAllRequests_();
      return jsonResponse({
        success: true,
        version: CONFIG.version,
        sheet: CONFIG.sheetName,
        totalRequests: all.length,
        pendingTriage: all.filter(function (r) { return !r.validated; }).length,
        emailEnabled: !!(CONFIG.notify && CONFIG.notify.enabled),
        endpoints: ['ping', 'getMeta', 'getRequests',
                    'POST createRequest', 'POST updateRequest', 'POST validateRequest'],
        timestamp: new Date().toISOString(),
      });
    }

    if (action === 'getMeta') {
      return jsonResponse({
        success: true,
        version: CONFIG.version,
        categories: CONFIG.categories,
        statuses: CONFIG.statuses,
        priorities: CONFIG.priorities,
        team: CONFIG.team,
        countries: CONFIG.countries,
        sla: CONFIG.sla,
      });
    }

    if (action === 'getRequests') {
      return jsonResponse({ success: true, requests: getAllRequests_() });
    }

    return jsonResponse({ success: false, error: 'Ação desconhecida: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  }
}

function getAllRequests_() {
  const sh = ensureSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const map = headerMap_(sh);
  const width = Math.max(HEADERS.length, sh.getLastColumn());
  const rows = sh.getRange(2, 1, lastRow - 1, width).getValues();

  const out = [];
  for (let r = 0; r < rows.length; r++) {
    const obj = rowToObj_(rows[r], map, r + 2);
    if (!obj.id) continue;
    out.push(obj);
  }
  out.reverse(); // mais recentes primeiro
  return out;
}

// ================================================================
// POST
// ================================================================
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const data = JSON.parse(e.postData.contents);

    if (data.type === 'createRequest')   return jsonResponse(createRequest_(data));
    if (data.type === 'updateRequest')   return jsonResponse(updateRequest_(data));
    if (data.type === 'validateRequest') return jsonResponse(validateRequest_(data));

    return jsonResponse({ success: false, error: 'Tipo desconhecido: ' + data.type });
  } catch (err) {
    return jsonResponse({ success: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function createRequest_(data) {
  const sh = ensureSheet_();
  const map = headerMap_(sh);
  const now = new Date();
  const id = nextRequestId_();
  const priority = CONFIG.priorities.indexOf(data.priority) >= 0 ? data.priority : 'Normal';
  const slaDue = slaDueFrom_(now, priority);
  const eta = data.eta ? new Date(data.eta) : '';

  const record = {
    'ID': id,
    'Created At': now,
    'Requester Name': data.requesterName || '',
    'Requester Email': data.requesterEmail || '',
    'Category': data.category || '',
    'Subject': data.subject || '',
    'Description': data.description || '',
    'Project': data.project || '',
    'Country': data.country || '',
    'Priority': priority,
    'Responsible': data.responsible || '',
    'ETA': eta,
    'SLA Due': slaDue,
    'Status': 'New',
    'Link': data.link || '',
    'Internal Notes': '',
    'Updated At': now,
    'Validated': '',          // pendente de triagem — não aparece no dashboard ainda
    'Validated At': '',
  };

  const width = Math.max(HEADERS.length, sh.getLastColumn());
  const rowArr = new Array(width).fill('');
  HEADERS.forEach(function (h) { const i = map[h]; if (i !== undefined) rowArr[i] = record[h]; });
  sh.appendRow(rowArr);

  // notifica a Bia (não bloqueia a criação se o email falhar)
  try {
    notifyBiaNewRequest_({
      id: id, requesterName: data.requesterName, requesterEmail: data.requesterEmail,
      category: data.category, priority: priority, subject: data.subject, description: data.description,
      project: data.project, country: data.country, responsible: data.responsible,
      eta: fmtBr_(eta), slaDue: fmtBr_(slaDue), link: data.link,
    });
  } catch (err) { /* segue o jogo */ }

  return { success: true, id: id, slaDue: toIso_(slaDue), pending: true,
           message: 'Request registered — awaiting triage' };
}

// edição (usada pela triagem) — NÃO mexe em Validated
function updateRequest_(data) {
  if (!data.id) return { success: false, error: 'id obrigatório' };
  const sh = ensureSheet_();
  const map = headerMap_(sh);
  const targetRow = findRow_(sh, map, data.id);
  if (targetRow === -1) return { success: false, error: 'ID não encontrado: ' + data.id };
  applyEdits_(sh, map, targetRow, data);
  setCell_(sh, map, targetRow, 'Updated At', new Date());
  return { success: true, id: data.id, message: 'Updated' };
}

// valida: exige responsável, marca Validated=Yes e notifica o solicitante
function validateRequest_(data) {
  if (!data.id) return { success: false, error: 'id obrigatório' };
  const sh = ensureSheet_();
  const map = headerMap_(sh);
  const targetRow = findRow_(sh, map, data.id);
  if (targetRow === -1) return { success: false, error: 'ID não encontrado: ' + data.id };

  applyEdits_(sh, map, targetRow, data);

  const responsible = String(getCell_(sh, map, targetRow, 'Responsible')).trim();
  if (!responsible) return { success: false, error: 'Please assign an owner before validating.' };

  setCell_(sh, map, targetRow, 'Validated', 'Yes');
  setCell_(sh, map, targetRow, 'Validated At', new Date());
  setCell_(sh, map, targetRow, 'Updated At', new Date());

  const rec = readRow_(sh, map, targetRow);
  try { notifyRequesterValidated_(rec); } catch (err) { /* não bloqueia */ }

  return { success: true, id: data.id, message: 'Validated and requester notified' };
}

function applyEdits_(sh, map, targetRow, data) {
  if (data.status !== undefined && CONFIG.statuses.indexOf(data.status) >= 0) {
    setCell_(sh, map, targetRow, 'Status', data.status);
  }
  if (data.responsible !== undefined) setCell_(sh, map, targetRow, 'Responsible', data.responsible);
  if (data.eta !== undefined) setCell_(sh, map, targetRow, 'ETA', data.eta ? new Date(data.eta) : '');
  if (data.notes !== undefined) setCell_(sh, map, targetRow, 'Internal Notes', data.notes);
  if (data.priority !== undefined && CONFIG.priorities.indexOf(data.priority) >= 0) {
    setCell_(sh, map, targetRow, 'Priority', data.priority);
    const created = getCell_(sh, map, targetRow, 'Created At');
    const createdDate = isDate_(created) ? created : new Date(created);
    setCell_(sh, map, targetRow, 'SLA Due', slaDueFrom_(createdDate, data.priority));
  }
}

// ================================================================
// EMAIL
// ================================================================
function emailRow_(label, value) {
  return '<tr><td style="padding:3px 10px 3px 0;color:#718096;vertical-align:top;white-space:nowrap"><b>' +
    label + '</b></td><td style="padding:3px 0;color:#1A202C">' + (value == null ? '' : String(value)) + '</td></tr>';
}

function notifyBiaNewRequest_(rec) {
  if (!CONFIG.notify || !CONFIG.notify.enabled || !CONFIG.notify.bia) return;
  const subject = 'New request ' + rec.id + ' — ' + rec.category + ' (' + rec.priority + ')';
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px">' +
    '<h2 style="color:#1A365D;margin:0 0 4px">New LATAM request</h2>' +
    '<p style="margin:0 0 14px;color:#718096">Awaiting triage.</p>' +
    '<table style="border-collapse:collapse;font-size:14px">' +
      emailRow_('ID', rec.id) +
      emailRow_('Requester', (rec.requesterName || '') + ' (' + (rec.requesterEmail || '') + ')') +
      emailRow_('Category', rec.category) +
      emailRow_('Priority', rec.priority) +
      emailRow_('Subject', rec.subject) +
      emailRow_('Description', rec.description) +
      emailRow_('Project', rec.project || '—') +
      emailRow_('Country', rec.country || '—') +
      emailRow_('Suggested owner', rec.responsible || '—') +
      emailRow_('Suggested ETA', rec.eta || '—') +
      emailRow_('SLA', rec.slaDue || '—') +
      (rec.link ? emailRow_('Link', '<a href="' + rec.link + '">' + rec.link + '</a>') : '') +
    '</table>' +
    '<p style="margin:20px 0 6px"><a href="' + (CONFIG.notify.triageUrl || '#') +
      '" style="background:#2C5282;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Open triage →</a></p>' +
    '</div>';
  MailApp.sendEmail({ to: CONFIG.notify.bia, subject: subject, htmlBody: html, name: CONFIG.notify.fromName || 'LATAM Requests' });
}

function notifyRequesterValidated_(rec) {
  if (!CONFIG.notify || !CONFIG.notify.enabled) return;
  if (!rec.requesterEmail) return;
  const subject = 'Your request ' + rec.id + ' has been received — ' + rec.status;
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px">' +
    '<h2 style="color:#1A365D;margin:0 0 8px">Request received</h2>' +
    '<p>Hi ' + (rec.requesterName || '') + ',</p>' +
    '<p>Your request <b>' + rec.id + '</b> ("' + rec.subject + '") has been received by the LATAM team and is now in progress.</p>' +
    '<table style="border-collapse:collapse;font-size:14px;margin:8px 0">' +
      emailRow_('Owner', rec.responsible || '—') +
      emailRow_('Current status', rec.status) +
      (rec.eta ? emailRow_('ETA', fmtBr_(rec.eta)) : '') +
      (rec.slaDue ? emailRow_('Due (SLA)', fmtBr_(rec.slaDue)) : '') +
    '</table>' +
    '<p style="margin-top:14px;color:#718096">You\'ll be notified of important updates. Thank you!</p>' +
    '<p style="color:#718096;font-size:12px">— LATAM Team, Aceolution</p>' +
    '</div>';
  MailApp.sendEmail({ to: rec.requesterEmail, subject: subject, htmlBody: html, name: CONFIG.notify.fromName || 'LATAM Requests' });
}
