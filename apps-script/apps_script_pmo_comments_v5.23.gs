/**
 * ============================================================================
 *  PMO COMMENTS — Bloco v5.23 pro Code.gs do LATAM_MASTERSHEET
 * ============================================================================
 *
 *  Bloco isolado pra colar no FIM do Code.gs v5.22 (depois de
 *  callClaudeApi_), transformando-o em v5.23.
 *
 *  As 5 modificações pontuais necessárias estão no arquivo
 *  apps_script_v5.22_to_v5.23_diff.txt — aplique TODAS antes de testar.
 *
 *  Convenções seguidas (match com o resto do Code.gs):
 *    - jsonResponse  (sem underscore — função existente)
 *    - retornos { success: true/false, ... }
 *    - handlers POST recebem `data` direto (JSON.parse já feito em doPost)
 *    - handlers GET recebem `e` e leem `e.parameter.x`
 *
 *  Schema da aba 'Driver Comments' (auto-criada na 1ª chamada):
 *    A: Timestamp           (Date — chave composta com Author Username)
 *    B: Author Username     (lowercase, ex: 'fuss')
 *    C: Author Full Name
 *    D: Driver Email        (lowercase)
 *    E: Driver Name
 *    F: Comment             (string vazia se soft-deleted)
 *    G: Edited At           (Date ou vazio)
 *    H: Edited By           ('[DELETED]' se soft-deleted, senão username editor)
 *
 *  Identificador único de comment = Timestamp ISO + Author Username (chave composta).
 *  O frontend manda os dois em edit/delete.
 *
 *  Soft-delete: limpa Comment, marca Edited At = now, Edited By = '[DELETED]'.
 *  readAllDriverComments_ ignora linhas com essa marca.
 *
 *  ⚠ COMMENTS_ADMIN_USERNAMES precisa estar sincronizado com pmo.html (frontend).
 * ============================================================================
 */


// ================================================================
// v5.23: PMO COMMENTS — comentários por driver pelo painel PMO
// ================================================================

const COMMENTS_ADMIN_USERNAMES = ['fuss'];

function isCommentsAdminBackend_(username) {
  if (!username) return false;
  const u = String(username).toLowerCase().trim();
  return COMMENTS_ADMIN_USERNAMES.indexOf(u) !== -1;
}

function getOrCreateDriverCommentsSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  let sheet = ss.getSheetByName(CONFIG.driverCommentsSheet);
  if (sheet) return sheet;

  // Cria do zero
  sheet = ss.insertSheet(CONFIG.driverCommentsSheet);
  const headers = ['Timestamp', 'Author Username', 'Author Full Name',
                   'Driver Email', 'Driver Name', 'Comment',
                   'Edited At', 'Edited By'];
  sheet.getRange(1, 1, 1, 8).setValues([headers]);
  sheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#f0f0f0');
  sheet.setFrozenRows(1);
  // Larguras pra leitura humana
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 160);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(5, 180);
  sheet.setColumnWidth(6, 480);
  sheet.setColumnWidth(7, 180);
  sheet.setColumnWidth(8, 110);

  Logger.log('✓ Aba "' + CONFIG.driverCommentsSheet + '" criada (PMO Comments v5.23)');
  return sheet;
}

function readAllDriverComments_() {
  const sheet = getOrCreateDriverCommentsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const out = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const editedBy = String(row[7] || '').trim();
    if (editedBy === '[DELETED]') continue; // soft-deleted: pular

    const ts = row[0];
    if (!(ts instanceof Date)) continue; // ignora linhas malformadas

    out.push({
      timestamp:      ts.toISOString(),
      authorUsername: String(row[1] || '').toLowerCase().trim(),
      authorFullName: String(row[2] || ''),
      driverEmail:    String(row[3] || '').toLowerCase().trim(),
      driverName:     String(row[4] || ''),
      comment:        String(row[5] || ''),
      editedAt:       (row[6] instanceof Date) ? row[6].toISOString() : '',
      editedBy:       editedBy,
    });
  }

  return out;
}

/**
 * Procura linha pela chave composta (timestamp ISO + author username).
 * Retorna { rowIndex } ou null.
 */
function findCommentRow_(targetTimestamp, targetAuthor) {
  const sheet = getOrCreateDriverCommentsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const targetIso = String(targetTimestamp).trim();
  const targetUser = String(targetAuthor).toLowerCase().trim();

  for (let i = 0; i < values.length; i++) {
    const ts = values[i][0];
    const author = String(values[i][1] || '').toLowerCase().trim();
    if (!(ts instanceof Date)) continue;
    if (ts.toISOString() === targetIso && author === targetUser) {
      return { rowIndex: i + 2 };
    }
  }
  return null;
}


// ----- HANDLERS GET -----

function getDriverCommentsHandler_(e) {
  const driverEmail = String((e.parameter && e.parameter.driverEmail) || '')
    .toLowerCase().trim();
  if (!driverEmail) {
    return { success: false, error: 'driverEmail required' };
  }

  const all = readAllDriverComments_();
  const filtered = all.filter(c => c.driverEmail === driverEmail);

  // Mais recentes primeiro
  filtered.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  return { success: true, comments: filtered, count: filtered.length };
}

function getAllDriverCommentsHandler_(e) {
  const all = readAllDriverComments_();
  all.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return { success: true, comments: all, count: all.length };
}


// ----- HANDLERS POST -----

function addDriverCommentHandler_(data) {
  const authorUsername = String(data.authorUsername || '').toLowerCase().trim();
  const authorFullName = String(data.authorFullName || '').trim();
  const driverEmail    = String(data.driverEmail || '').toLowerCase().trim();
  const driverName     = String(data.driverName || '').trim();
  const comment        = String(data.comment || '').trim();

  if (!authorUsername) return { success: false, error: 'authorUsername required' };
  if (!driverEmail)    return { success: false, error: 'driverEmail required' };
  if (!comment)        return { success: false, error: 'comment required' };

  const sheet = getOrCreateDriverCommentsSheet_();
  const timestamp = new Date();

  sheet.appendRow([
    timestamp,
    authorUsername,
    authorFullName,
    driverEmail,
    driverName,
    comment,
    '',  // Edited At
    '',  // Edited By
  ]);

  Logger.log('PMO Comment add: ' + authorUsername + ' → ' + driverEmail);

  return {
    success: true,
    comment: {
      timestamp:      timestamp.toISOString(),
      authorUsername: authorUsername,
      authorFullName: authorFullName,
      driverEmail:    driverEmail,
      driverName:     driverName,
      comment:        comment,
      editedAt:       '',
      editedBy:       '',
    },
  };
}

function editDriverCommentHandler_(data) {
  const actorUsername = String(data.actorUsername || '').toLowerCase().trim();
  const origTimestamp = String(data.origTimestamp || '').trim();
  const origAuthor    = String(data.origAuthor || '').toLowerCase().trim();
  const newComment    = String(data.newComment || '').trim();

  if (!actorUsername) return { success: false, error: 'actorUsername required' };
  if (!isCommentsAdminBackend_(actorUsername)) {
    return { success: false, error: 'forbidden: not a comments admin' };
  }
  if (!origTimestamp || !origAuthor) {
    return { success: false, error: 'origTimestamp + origAuthor required' };
  }
  if (!newComment) return { success: false, error: 'newComment required' };

  const match = findCommentRow_(origTimestamp, origAuthor);
  if (!match) return { success: false, error: 'comment not found' };

  const sheet = getOrCreateDriverCommentsSheet_();
  const now = new Date();

  sheet.getRange(match.rowIndex, 6).setValue(newComment);     // Comment
  sheet.getRange(match.rowIndex, 7).setValue(now);            // Edited At
  sheet.getRange(match.rowIndex, 8).setValue(actorUsername);  // Edited By

  Logger.log('PMO Comment edit: ' + actorUsername + ' editou comment de ' + origAuthor);

  return {
    success: true,
    edited: {
      timestamp:      origTimestamp,
      authorUsername: origAuthor,
      comment:        newComment,
      editedAt:       now.toISOString(),
      editedBy:       actorUsername,
    },
  };
}

function deleteDriverCommentHandler_(data) {
  const actorUsername = String(data.actorUsername || '').toLowerCase().trim();
  const origTimestamp = String(data.origTimestamp || '').trim();
  const origAuthor    = String(data.origAuthor || '').toLowerCase().trim();

  if (!actorUsername) return { success: false, error: 'actorUsername required' };
  if (!isCommentsAdminBackend_(actorUsername)) {
    return { success: false, error: 'forbidden: not a comments admin' };
  }
  if (!origTimestamp || !origAuthor) {
    return { success: false, error: 'origTimestamp + origAuthor required' };
  }

  const match = findCommentRow_(origTimestamp, origAuthor);
  if (!match) return { success: false, error: 'comment not found' };

  const sheet = getOrCreateDriverCommentsSheet_();
  const now = new Date();

  // Soft-delete: limpa comentário, marca [DELETED]
  sheet.getRange(match.rowIndex, 6).setValue('');             // Comment vazio
  sheet.getRange(match.rowIndex, 7).setValue(now);            // Edited At
  sheet.getRange(match.rowIndex, 8).setValue('[DELETED]');    // Edited By

  Logger.log('PMO Comment delete: ' + actorUsername + ' soft-deletou comment de ' + origAuthor);

  return {
    success: true,
    deleted: {
      timestamp:      origTimestamp,
      authorUsername: origAuthor,
      deletedAt:      now.toISOString(),
      deletedBy:      actorUsername,
    },
  };
}
