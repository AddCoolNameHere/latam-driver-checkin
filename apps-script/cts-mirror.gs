/**
 * CTS Mirror — copia as abas cruas da planilha da CTS pra uma planilha espelho nossa.
 *
 * Por quê: a planilha da CTS só abre com lucas.fuss@aceolution.com, e essa conta
 * não consegue publicar App da Web. Então:
 *   - ESTE script roda na conta aceolution, por gatilho de tempo (não precisa implantar);
 *   - o cts-data-backend.gs roda na conta pessoal (a mesma do Code udpt.gs) e lê o ESPELHO.
 *
 * Só LÊ a planilha da CTS. Nunca escreve nela.
 *
 * Setup (logado na lucas.fuss@aceolution.com):
 *   1. Conta pessoal cria uma planilha vazia "CTS Mirror" e compartilha com a aceolution como Editor.
 *   2. Cola o ID dela em MIRROR_CONFIG.targetId.
 *   3. Executa mirrorCts uma vez (autoriza) e confere o log.
 *   4. Executa installMirrorTrigger uma vez (cria o gatilho de hora em hora).
 * Logs: [CTS Mirror]
 */

const MIRROR_CONFIG = {
  sourceId: '1EczaKGKiQXkgVVjXHJs3OVtCdpeQvlkPYPTdl4S5NeM', // planilha da CTS (só leitura)
  targetId: '18lTqa5I0bNcPiLCXUpid9dGT19x4r7vTlKZ7b23C_NM', // planilha espelho (dona: conta pessoal)
  tabs: ['KMS', 'Targets', 'QC'],
  metaTab: '_mirror',
};

function mirrorCts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log('[CTS Mirror] outra execução em andamento, pulando'); return; }
  try {
    if (!MIRROR_CONFIG.targetId) throw new Error('MIRROR_CONFIG.targetId vazio');
    const src = SpreadsheetApp.openById(MIRROR_CONFIG.sourceId);
    const dst = SpreadsheetApp.openById(MIRROR_CONFIG.targetId);
    // mesmo fuso da CTS: o backend formata as datas no fuso da planilha que lê
    const tz = src.getSpreadsheetTimeZone();
    if (dst.getSpreadsheetTimeZone() !== tz) dst.setSpreadsheetTimeZone(tz);

    const report = [];
    MIRROR_CONFIG.tabs.forEach(name => {
      const s = src.getSheetByName(name);
      if (!s) { report.push(name + ': NÃO ENCONTRADA na CTS'); return; }
      const values = s.getDataRange().getValues();
      const rows = values.length, cols = rows ? values[0].length : 0;
      // Datas viram texto 'yyyy-MM-dd' no fuso da CTS. Copiar o Date cru deslocava
      // tudo 1 dia ao ler o espelho (1º/out caía em 30/set e a meta de outubro zerava).
      const dateCols = {};
      values.forEach(r => r.forEach((v, j) => {
        if (Object.prototype.toString.call(v) === '[object Date]') {
          r[j] = isNaN(v.getTime()) ? '' : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
          dateCols[j] = true;
        }
      }));
      let d = dst.getSheetByName(name) || dst.insertSheet(name);
      if (rows && cols) {
        if (d.getMaxRows() < rows) d.insertRowsAfter(d.getMaxRows(), rows - d.getMaxRows());
        if (d.getMaxColumns() < cols) d.insertColumnsAfter(d.getMaxColumns(), cols - d.getMaxColumns());
        // coluna de data como texto puro, senão o Sheets converte '2026-10-01' de volta pra Date
        Object.keys(dateCols).forEach(j => d.getRange(1, +j + 1, rows, 1).setNumberFormat('@'));
        // escreve por cima e só depois limpa a sobra: o espelho nunca fica vazio no meio da cópia
        d.getRange(1, 1, rows, cols).setValues(values);
      }
      const lastRow = d.getLastRow(), lastCol = d.getLastColumn();
      if (lastRow > rows) d.getRange(rows + 1, 1, lastRow - rows, Math.max(lastCol, 1)).clearContent();
      if (lastCol > cols && rows) d.getRange(1, cols + 1, rows, lastCol - cols).clearContent();
      report.push(name + ': ' + rows + 'x' + cols);
    });

    const meta = dst.getSheetByName(MIRROR_CONFIG.metaTab) || dst.insertSheet(MIRROR_CONFIG.metaTab);
    meta.getRange(1, 1, 2, 2).setValues([
      ['lastSync', new Date()],
      ['report', report.join(' | ')],
    ]);
    SpreadsheetApp.flush();
    console.log('[CTS Mirror] ok — ' + report.join(' | '));
  } finally {
    lock.releaseLock();
  }
}

function installMirrorTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'mirrorCts')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('mirrorCts').timeBased().everyHours(1).create();
  console.log('[CTS Mirror] gatilho de hora em hora instalado');
}
