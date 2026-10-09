/**
 * CTS Mirror — réplica da planilha da CTS numa planilha nossa ("CTS Mirror").
 *
 * Por quê: a planilha da CTS só abre com lucas.fuss@aceolution.com, e essa conta
 * não consegue publicar App da Web. Então:
 *   - ESTE script roda na conta aceolution (gatilho de hora em hora, sem implantar);
 *   - o cts-data-backend.gs roda na conta pessoal e lê o ESPELHO.
 *
 * Duas camadas:
 *   DADOS      (MIRROR_CONFIG.rawTabs)       → valores copiados de hora em hora (mirrorCts)
 *   DASHBOARDS (MIRROR_CONFIG.dashboardTabs) → copiados UMA vez com fórmula, formatação,
 *              gráficos e validação (setupDashboards). As fórmulas apontam pras abas de
 *              dados do espelho, então recalculam sozinhas a cada cópia horária.
 *              Se a CTS mudar um dashboard, roda setupDashboards de novo.
 *
 * Só LÊ a planilha da CTS. Nunca escreve nela.
 *
 * Datas: gravadas como número de série do Sheets (sem fuso) + formato yyyy-mm-dd.
 * Copiar o Date cru deslocava 1 dia; texto quebraria as fórmulas dos dashboards.
 *
 * Setup (logado na lucas.fuss@aceolution.com):
 *   1. mirrorCts            → copia as abas de dados
 *   2. setupDashboards      → recria os dashboards (uma vez; demora alguns minutos)
 *   3. installMirrorTrigger → gatilho de hora em hora (uma vez)
 * Logs: [CTS Mirror]
 */

const MIRROR_CONFIG = {
  sourceId: '1EczaKGKiQXkgVVjXHJs3OVtCdpeQvlkPYPTdl4S5NeM', // planilha da CTS (só leitura)
  targetId: '18lTqa5I0bNcPiLCXUpid9dGT19x4r7vTlKZ7b23C_NM', // planilha espelho (dona: conta pessoal)
  // Dados crus + abas que puxam de OUTRAS planilhas por IMPORTRANGE (Attritions Data,
  // Active car count Summary MAY): no espelho o IMPORTRANGE não teria acesso, então
  // vão como valor.
  rawTabs: ['KMS', 'Targets', 'QC', 'CB', 'SD', 'ODO', 'incidents', 'Attritions Data',
            'Active car count Summary MAY', 'Script', 'SSD', 'Metrics Summary'],
  // Na ordem da planilha da CTS (quem depende de quem vem depois, na maioria).
  dashboardTabs: ['Country wise Summary', 'Metrics Performance Summary', 'CB Summary',
                  'Attrition Summary', '⬇Personal', 'Driver Quality Summary', 'Active car count',
                  'Calc_Data_Weekly_VID', 'Calc_Data_VID', 'QC Summary', 'Trainee_Drivers',
                  'ODO Summary', 'Status', 'trainings'],
  metaTab: '_mirror',
};

function mirrorCts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log('[CTS Mirror] outra execução em andamento, pulando'); return; }
  try {
    const t0 = Date.now();
    const ctx = mirrorOpen_();
    // Teto de tempo: o Apps Script corta em 6 min. O que sobrar vai na próxima hora
    // (KMS/Targets/QC vêm primeiro na lista, então o portal nunca fica pra trás).
    const report = MIRROR_CONFIG.rawTabs.map(name =>
      (Date.now() - t0 > 270000) ? name + ': adiada (tempo)' : mirrorRawTab_(ctx, name));
    mirrorMeta_(ctx.dst, 'lastSync', report.join(' | '));
    SpreadsheetApp.flush();
    console.log('[CTS Mirror] ok em ' + Math.round((Date.now() - t0) / 1000) + 's — ' + report.join(' | '));
  } finally {
    lock.releaseLock();
  }
}

/** Recria os dashboards da CTS no espelho (fórmulas + formatação + gráficos). */
function setupDashboards() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log('[CTS Mirror] outra execução em andamento, tenta de novo'); return; }
  try {
    const t0 = Date.now();
    const ctx = mirrorOpen_();
    const src = ctx.src, dst = ctx.dst;

    // dados primeiro: as fórmulas copiadas resolvem as referências pelo nome da aba
    MIRROR_CONFIG.rawTabs.forEach(name => { if (!dst.getSheetByName(name)) mirrorRawTab_(ctx, name); });

    const done = [];
    MIRROR_CONFIG.dashboardTabs.forEach(name => {
      const s = src.getSheetByName(name);
      if (!s) { console.log('[CTS Mirror] dashboard não encontrado na CTS: ' + name); return; }
      const old = dst.getSheetByName(name);
      if (old) dst.deleteSheet(old);
      const c = s.copyTo(dst);
      c.setName(name);
      done.push(name);
    });

    // Fórmula que aponta pra outro dashboard copiado DEPOIS dela fica #REF!
    // mesmo com o texto idêntico (o Sheets resolve a referência na hora da
    // cópia e não revisita). Ex.: Active car count → QUERY(Calc_Data_VID!…).
    // Regrava toda fórmula que cita outro dashboard ou que ficou diferente.
    const otherDash = name => done.filter(n => n !== name);
    const citesDash = (formula, names) => names.some(n => formula.indexOf(n + '!') >= 0 || formula.indexOf("'" + n + "'!") >= 0);
    let fixed = 0, skipped = 0;
    done.forEach(name => {
      const s = src.getSheetByName(name), d = dst.getSheetByName(name);
      const rows = s.getLastRow(), cols = s.getLastColumn();
      if (!rows || !cols) return;
      const sf = s.getRange(1, 1, rows, cols).getFormulas();
      const df = d.getRange(1, 1, rows, cols).getFormulas();
      const others = otherDash(name);
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        if (sf[i][j] && (sf[i][j] !== df[i][j] || citesDash(sf[i][j], others))) {
          if (fixed >= 3000) { skipped++; continue; }   // teto pra não estourar os 6 min
          d.getRange(i + 1, j + 1).setFormula(sf[i][j]); fixed++;
        }
      }
    });

    // mesma ordem e visibilidade das abas da CTS
    const order = src.getSheets().map(s => s.getName());
    let pos = 1;
    order.forEach(name => {
      const d = dst.getSheetByName(name);
      if (!d) return;
      dst.setActiveSheet(d);
      dst.moveActiveSheet(pos++);
    });
    order.forEach(name => {
      const d = dst.getSheetByName(name);
      if (d && src.getSheetByName(name).isSheetHidden()) d.hideSheet(); else if (d) d.showSheet();
    });
    dst.setActiveSheet(dst.getSheets().filter(sh => !sh.isSheetHidden())[0]);
    // aba padrão vazia da planilha nova
    dst.getSheets().forEach(sh => {
      const n = sh.getName();
      if (order.indexOf(n) < 0 && n !== MIRROR_CONFIG.metaTab && sh.getLastRow() === 0) dst.deleteSheet(sh);
    });

    mirrorMeta_(dst, 'dashboards', new Date() + ' — ' + done.length + ' abas, ' + fixed + ' fórmulas regravadas' + (skipped ? ', ' + skipped + ' NÃO regravadas (teto)' : ''));
    SpreadsheetApp.flush();
    console.log('[CTS Mirror] dashboards ok em ' + Math.round((Date.now() - t0) / 1000) + 's — ' +
      done.length + ' abas (' + done.join(', ') + '), ' + fixed + ' fórmulas regravadas' +
      (skipped ? ', ' + skipped + ' NÃO regravadas (teto — roda de novo)' : ''));
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

// ================================================================

function mirrorOpen_() {
  if (!MIRROR_CONFIG.targetId || MIRROR_CONFIG.targetId === MIRROR_CONFIG.sourceId) {
    throw new Error('targetId inválido — nunca pode ser a planilha da CTS');
  }
  const src = SpreadsheetApp.openById(MIRROR_CONFIG.sourceId);
  const dst = SpreadsheetApp.openById(MIRROR_CONFIG.targetId);
  // mesmo fuso e locale da CTS: as fórmulas dos dashboards se comportam igual
  const tz = src.getSpreadsheetTimeZone();
  if (dst.getSpreadsheetTimeZone() !== tz) dst.setSpreadsheetTimeZone(tz);
  const locale = src.getSpreadsheetLocale();
  if (dst.getSpreadsheetLocale() !== locale) dst.setSpreadsheetLocale(locale);
  return { src: src, dst: dst, tz: tz };
}

/** Copia uma aba como valores. Escreve por cima e só depois limpa a sobra (nunca fica vazia). */
function mirrorRawTab_(ctx, name) {
  const s = ctx.src.getSheetByName(name);
  if (!s) return name + ': NÃO ENCONTRADA na CTS';
  const rows = s.getLastRow(), cols = s.getLastColumn();
  const t1 = Date.now();
  let d = ctx.dst.getSheetByName(name);
  if (rows && cols) {
    const values = s.getRange(1, 1, rows, cols).getValues();
    // Pula a escrita se nada mudou desde a última cópia: a CTS atualiza ~1×/dia,
    // então a maioria das rodadas horárias só lê e compara.
    const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(values)));
    const props = PropertiesService.getScriptProperties();
    if (d && d.getLastRow() === rows && props.getProperty('h:' + name) === hash) return name + ': =';
    d = d || ctx.dst.insertSheet(name);
    const dateFmt = {};   // coluna → formato
    const memo = {};      // getTime() → [série, tipo]; datas repetem muito (1 por dia no KMS/CB)
    values.forEach(r => r.forEach((v, j) => {
      if (Object.prototype.toString.call(v) !== '[object Date]') return;
      const ms = v.getTime();
      if (isNaN(ms)) { r[j] = ''; return; }
      let m = memo[ms];
      if (!m) {
        const p = Utilities.formatDate(v, ctx.tz, 'yyyy-MM-dd-HH-mm-ss').split('-').map(Number);
        m = memo[ms] = [(Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]) - Date.UTC(1899, 11, 30)) / 86400000,
          p[0] < 1900 ? 'hh:mm:ss' : ((p[3] || p[4] || p[5]) ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd')];
      }
      r[j] = m[0];
      const kind = m[1];
      const prev = dateFmt[j];
      if (!prev || (prev === 'yyyy-mm-dd' && kind === 'yyyy-mm-dd hh:mm:ss') || (prev === 'hh:mm:ss' && kind !== 'hh:mm:ss')) dateFmt[j] = kind;
    }));
    if (d.getMaxRows() < rows) d.insertRowsAfter(d.getMaxRows(), rows - d.getMaxRows());
    if (d.getMaxColumns() < cols) d.insertColumnsAfter(d.getMaxColumns(), cols - d.getMaxColumns());
    Object.keys(dateFmt).forEach(j => d.getRange(1, +j + 1, rows, 1).setNumberFormat(dateFmt[j]));
    d.getRange(1, 1, rows, cols).setValues(values);
    props.setProperty('h:' + name, hash);
  }
  d = d || ctx.dst.insertSheet(name);
  const lastRow = d.getLastRow(), lastCol = d.getLastColumn();
  if (lastRow > rows) d.getRange(rows + 1, 1, lastRow - rows, Math.max(lastCol, 1)).clearContent();
  if (lastCol > cols && rows) d.getRange(1, cols + 1, rows, lastCol - cols).clearContent();
  return name + ': ' + rows + 'x' + cols + ' (' + Math.round((Date.now() - t1) / 1000) + 's)';
}

function mirrorMeta_(dst, key, text) {
  const meta = dst.getSheetByName(MIRROR_CONFIG.metaTab) || dst.insertSheet(MIRROR_CONFIG.metaTab);
  const keys = meta.getLastRow() ? meta.getRange(1, 1, meta.getLastRow(), 1).getValues().map(r => r[0]) : [];
  let row = keys.indexOf(key) + 1;
  if (!row) row = keys.length + 1;
  meta.getRange(row, 1, 1, 3).setValues([[key, new Date(), text]]);
}
