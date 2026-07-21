/**
 * LATAM Street View — Backend (v5)
 * Google Apps Script
 *
 * Adicionado em v5:
 * - Endpoint POST type:'checkout' — registra fim de expediente do driver
 *   (GPS atual, TKM mapeados, KM dirigidos, observações)
 * - Atualiza a linha do check-in da manhã, ou cria nova linha marcada como
 *   "checkout sem check-in" se o driver esqueceu de checkar de manhã
 * - Novas colunas na aba Driver Daily Check-in (autocriadas):
 *   U=Checkout Timestamp, V=Checkout Lat, W=Checkout Lng, X=TKM Mapped,
 *   Y=Total KM Driven, Z=Checkout Notes, AA=Has Checkin (Yes/No)
 * - Endpoint GET getTimesheet&startDate&endDate — folha de ponto agregada
 * - Email automático quinzenal com Excel anexado (dias 1 e 15 às 8h)
 *   - Dia 1: cobre 16-fim do mês anterior
 *   - Dia 15: cobre 1-15 do mês atual
 *   - Anexo XLSX gerado nativamente via Spreadsheet temporário
 *
 * Tudo da v4 continua igual.
 *
 *
 * Este arquivo gerencia o portal de check-in dos drivers, o dashboard
 * interno E os emails automáticos de alerta.
 *
 * ================================================================
 * INSTRUÇÕES DE DEPLOY (igual às versões anteriores)
 * ================================================================
 *
 * 1) Abra LATAM_MASTERSHEET no Google Sheets
 * 2) Menu Extensões → Apps Script
 * 3) APAGUE TUDO que estiver no arquivo Código.gs
 * 4) COLE este código inteiro
 * 5) No topo, na linha CONFIG, coloque o ID correto da planilha
 * 6) Preencha também os emails em EMAIL_CONFIG (veja abaixo)
 * 7) Ctrl+S pra salvar
 * 8) Implantar → Gerenciar implantações → Editar (lápis) na implantação
 *    existente → em "Versão" escolher "Nova versão" → Implantar
 *
 * ================================================================
 * PASSO EXTRA v4 — CONFIGURAR TRIGGERS DE EMAIL (1 VEZ SÓ)
 * ================================================================
 *
 * Depois de publicar, precisa rodar UMA VEZ a função `setupEmailTriggers()`
 * pra agendar os envios automáticos:
 *
 * 1) No editor de Apps Script, selecione "setupEmailTriggers" no dropdown
 *    ao lado do botão Executar
 * 2) Clique "Executar"
 * 3) Vai pedir permissão de acesso ao Gmail — autorize
 * 4) Vai aparecer "Execução concluída" no log
 *
 * Pronto. A partir de amanhã, o email diário chega toda manhã às 9h
 * (horário de São Paulo) e o resumo semanal toda segunda às 9h.
 *
 * Se quiser parar os emails depois: rode `removeEmailTriggers()`.
 *
 * ================================================================
 * O QUE MUDOU NA V4
 * ================================================================
 *
 * Novidades vs v3:
 * - sendDailyReport() — email diário às 9h com drivers > 24h sem check-in
 *   e alertas críticos (vehicle issues)
 * - sendWeeklyReport() — email de resumo semanal às segundas 9h com
 *   scorecards, economia total, CTS progress, top/bottom drivers
 * - setupEmailTriggers() — função de setup, rodar 1x no editor
 * - removeEmailTriggers() — se quiser desativar depois
 *
 * Todos os endpoints e funções da v3 continuam funcionando igual.
 *
 * ================================================================
 */


// ================================================================
// CONFIGURAÇÃO
// ================================================================

const CONFIG = {
  spreadsheetId: '1hwRnvbIKHWMRVY84lT6svbCg5BcMKkIJ7iaKpnNOGjg',  // da URL, entre /d/ e /edit
  hrSheet: 'HR and Vendors Database',
  checkinSheet: 'Driver Daily Check-in',
  baseSheet: 'Driver Base Location',
  dashboardHmSheet: 'DASHBOARD (HM)',
  ctsGoalSheet: 'CTS Goal Management',
  driverCalendarSheet: 'DRIVER CALENDAR',
  vidCalendarSheet: 'VID Monthly CALENDAR',  // renomeada (antes era 'VID CALENDAR')
  rampSheet: 'Ramp DATABASE',
  rawCtsSheet: 'RAW CTS DATA',
  assetsSheet: 'Assets Management',
  assetsPhotoFolderId: '',                   // v5.23: opcional — Drive folder ID pras fotos do form semanal. Se vazio usa parent da spreadsheet
  pmoNotesSheet: 'PMO Notes',                // v5.24: aba pra notes/coments do pmo.html (auto-criada na primeira chamada)
  finesSheet: 'Fines LATAM',
  vehicleIssuesSheet: 'Vehicle Issues Tracking',
  // v5.16: cash flow
  cashTransferSheet: 'Cash Transfer Management',
  cashReceiptsBrSheet: 'Cash Receipts BR',
  cashReceiptsHcSheet: 'Cash Receipts HC',
  cashReceiptsFolderName: 'cash_receipts_uploads',  // pasta no Drive (auto-criada)
  // v5.25: argentina cash divergencias (ar-divergencias.html)
  argentinaCashSheet: 'Argentina Cash',
  argentinaCashFolderId: '1FfKbF6yuvNDBU7ID-7SGv9apobf0xiTX',  // pasta fixa no Drive pra anexos
  // v5.34: recrutamento (recruitment.html)
  recruitmentSheet: 'Recruitment',
  // v5.35: timesheet/payroll (timesheet.html) — leitura crua da aba pra exibir horas + valor hora
  timesheetTabSheet: 'Timesheet',
  // v5.40: ajustes de payroll (reembolsos/bônus/descontos) lançados pelo super admin no timesheet.html
  payrollAdjustmentsSheet: 'Payroll Adjustments',
  // v5.42: MyMaps (ops-map.html) — uploads mensais do Google MyMaps (KML/KMZ → GeoJSON)
  myMapsSheet: 'MyMaps Uploads',           // metadados dos uploads (auto-criada)
  myMapsFolderName: 'LATAM MyMaps Uploads', // pasta no Drive (auto-criada), subpasta por país
  // v5.46: curadoria de VIDs vira tri-estado (Active | Inactive | Cancelled) na coluna Status
  vidStatusSheet: 'VID Status',            // curadoria manual de VIDs ativos por país (auto-criada)
};

// ================================================================
// CONFIG DE EMAIL (v4)
// ================================================================

const EMAIL_CONFIG = {
  // Lista de destinatários daily/weekly (vírgulas separando múltiplos emails)
  recipients: 'lucas.fuss@aceolution.com',

  // Lista de destinatários do Timesheet quinzenal (você + colegas do RH/payroll)
  // Pode ser igual ou diferente da lista acima
  timesheetRecipients: 'lucas.fuss@aceolution.com, lucas@aceolution.com, bia@aceolution.com',

  // v5.16: notificações de cash requests/receipts (pedidos de dinheiro/reembolso)
  cashRecipients: 'lucas.fuss@aceolution.com',

  // Link público do dashboard (pra botão "Abrir dashboard" nos emails)
  dashboardUrl: 'https://addcoolnamehere.github.io/latam-driver-checkin/dashboard.html',

  // Horário dos triggers (em hora de SP / UTC-3)
  dailyHour: 9,     // 9h da manhã
  weeklyHour: 9,    // 9h da manhã também
  weeklyDay: ScriptApp.WeekDay.MONDAY,  // toda segunda
  timesheetHour: 8, // 8h da manhã nos dias 1 e 15

  // Threshold de "sem check-in" pro email diário (em horas)
  missingThresholdHours: 48,

  // Só manda email se tem algo pra reportar
  skipEmptyDailyReports: true,
};


// ================================================================
// ENDPOINTS GET (leitura)
// ================================================================

function doGet(e) {
  try {
    const action = e.parameter.action || 'getDrivers';

    // ---- Endpoints originais (portal de check-in) ----

    if (action === 'getDrivers') {
      // v5.32: inclui drivers em offboarding pro check-in não deixar ninguém de fora
      // v5.51: cache de 30min — a lista quase não muda e a leitura da HR inteira é cara
      const cache = CacheService.getScriptCache();
      const cached = cache.get('checkin_drivers_v1');
      if (cached) return jsonResponse({ success: true, drivers: JSON.parse(cached), cached: true });
      const drivers = getActiveDrivers(true);
      try { cache.put('checkin_drivers_v1', JSON.stringify(drivers), 1800); } catch (e) {}
      return jsonResponse({ success: true, drivers: drivers });
    }

    if (action === 'getBase') {
      const email = e.parameter.email;
      return jsonResponse({ success: true, base: getDriverBase(email) });
    }

    if (action === 'getLastArea') {
      const email = e.parameter.email;
      return jsonResponse({ success: true, area: getDriverLastArea(email) });
    }

    // ---- Endpoints v2 (dashboard) ----

    if (action === 'getDriversFull') {
      return jsonResponse({ success: true, drivers: getDriversWithAddress() });
    }

    if (action === 'getDashboardData') {
      const days = parseInt(e.parameter.days) || 7;
      return jsonResponse({ success: true, data: getDashboardData(days) });
    }

    if (action === 'getDriverHistory') {
      const email = e.parameter.email;
      const days = parseInt(e.parameter.days) || 30;
      return jsonResponse({ success: true, history: getDriverHistory(email, days) });
    }

    // v5.4: check-ins por período (dia específico ou range) — pra filtros específicos do dashboard
    if (action === 'getCheckinsByPeriod') {
      const startDate = e.parameter.startDate; // 'YYYY-MM-DD'
      const endDate = e.parameter.endDate || startDate;
      return jsonResponse({ success: true, checkins: getCheckinsByPeriod(startDate, endDate) });
    }

    // v5.5: dados de transações Ramp (cartões corporativos) — pra dashboard separado
    if (action === 'getRampData') {
      const startDate = e.parameter.startDate; // 'YYYY-MM-DD'
      const endDate = e.parameter.endDate || startDate;
      return jsonResponse({ success: true, data: getRampData(startDate, endDate) });
    }

    // v5.18: Cash transactions (pedidos + recibos) - pra ramp.html sub-aba Cash
    if (action === 'getCashTransactions') {
      const startDate = e.parameter.startDate;
      const endDate = e.parameter.endDate || startDate;
      return jsonResponse({ success: true, data: getCashTransactions_(startDate, endDate) });
    }

    // v5.19: base do driver (pra mapa do modal de transação cash)
    if (action === 'getDriverBase') {
      const email = e.parameter.email;
      if (!email) return jsonResponse({ success: false, error: 'email obrigatório' });
      return jsonResponse({ success: true, base: getDriverBase(email) });
    }

    // v5.21: info consolidada do driver pro modal do driver no ramp.html
    if (action === 'getDriverInfo') {
      const email = e.parameter.email;
      const name = e.parameter.name;
      if (!email && !name) return jsonResponse({ success: false, error: 'email ou name obrigatório' });
      return jsonResponse({ success: true, info: getDriverInfo_(email, name) });
    }

    // v5.6: lista de drivers ativos com eficiência (pra seletor + rankings na driver-profile)
    if (action === 'getDriversList') {
      return jsonResponse({ success: true, drivers: getDriversList_() });
    }

    // v5.25: lista de motoristas argentinos ativos (pra ar-divergencias.html)
    if (action === 'getArgentinaDrivers') {
      return jsonResponse({ success: true, drivers: getArgentinaDrivers_() });
    }

    // v5.29: scope das areas de coleta por pais (pra country_scopes.html)
    // Le aba "CSV ARGENTINA" ou "CSV COLOMBIA" da MASTERSHEET
    // v5.34: dados da aba Recruitment (resumo por país + lista de vagas abertas)
    if (action === 'getRecruitmentData') {
      return jsonResponse({ success: true, data: getRecruitmentData_() });
    }

    if (action === 'getCountryScope') {
      const country = String(e.parameter.country || '').toUpperCase();
      return jsonResponse({ success: true, areas: getCountryScope_(country) });
    }

    // v5.31: lista de divergencias da aba 'Argentina Cash' (pra ar-divergencias-admin.html)
    if (action === 'getArgentinaCashSubmissions') {
      return jsonResponse({ success: true, submissions: getArgentinaCashSubmissions_() });
    }

    // v5.6: payload completo de profile do driver (eficiência + idle + VID + base)
    if (action === 'getDriverProfile') {
      const email = e.parameter.email;
      if (!email) return jsonResponse({ success: false, error: 'email obrigatório' });
      return jsonResponse({ success: true, profile: getDriverProfile_(email) });
    }

    // v5.39: cronograma compartilhado do lançamento AR (ar-launch-calendar.html)
    if (action === 'getArLaunchSchedule') {
      return jsonResponse({ success: true, schedule: getArLaunchSchedule_() });
    }

    // v5.6: ping de saúde — retorna versão deployada (útil pra debugar deploys)
    if (action === 'ping') {
      // Faz uma chamada real à getDriversList_ pra confirmar que a função existe
      // E retorna stats de eficiência. Se isso funcionar, deploy tá certo.
      let stats = { error: null, totalDrivers: 0, withEff: 0, sampleEff: null };
      try {
        const list = getDriversList_();
        stats.totalDrivers = list.length;
        stats.withEff = list.filter(d => d.efficiency !== null && d.efficiency > 0).length;
        const sample = list.find(d => d.efficiency > 0);
        if (sample) stats.sampleEff = { name: sample.name, eff: sample.efficiency };
      } catch (err) {
        stats.error = String(err);
      }
      return jsonResponse({
        success: true,
        version: 'v5.60',
        endpoints: ['getDrivers', 'getBase', 'getDashboardData', 'getDriverHistory',
                    'getCheckinsByPeriod', 'getRampData', 'getDriversList', 'getDriverProfile',
                    'getDriverCalendar', 'getVidCalendar', 'getAvailableMonths',
                    'getDriverSsds', 'getDriverVehicleIssues',
                    'getLastAssetsForm', 'getPMONotes', 'getArgentinaDrivers',
                    'getCountryScope',
                    'POST analyzeDriver', 'POST saveVehicleIssue', 'POST assetWeekly',
                    'POST savePMONote', 'POST editPMONote', 'POST deletePMONote',
                    'POST submitArgentinaCash', 'POST updateAuthUsers',
                    'getRecruitmentData', 'getTimesheetTab', 'getPayrollCheckin', 'writeAceHours', 'POST writeAceHoursManual',
                    'getPayrollAdjustments', 'POST savePayrollAdjustment', 'POST deletePayrollAdjustment',
                    'getCrimeOverlay',
                    'getArLaunchSchedule', 'POST saveArLaunchSchedule',
                    'listMyMaps', 'getMyMap', 'POST saveMyMap',
                    'getTkmReportOptions', 'getTkmReport', 'getFleetVids',
                    'getVidStatus', 'POST saveVidStatus',
                    'getClientMetrics'],
        timestamp: new Date().toISOString(),
        diagnostic: stats,
      });
    }

    // ---- Endpoints v3 (dados calculados da mastersheet) ----

    if (action === 'getHotelModeByCountry') {
      return jsonResponse({ success: true, countries: getHotelModeByCountry() });
    }

    if (action === 'getHotelModeByDriver') {
      return jsonResponse({ success: true, drivers: getHotelModeByDriver() });
    }

    // Debug: lista exatamente os headers da linha 11 com posição/tamanho
    if (action === 'debugHeaders') {
      const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
      const sheet = getSheetWithFallback_(ss, CONFIG.dashboardHmSheet, ['DASHBOARD', 'Dashboard', 'Dashboard (HM)']);
      const lastCol = sheet.getLastColumn();
      const headers = sheet.getRange(11, 1, 1, lastCol).getValues()[0];
      const debug = headers.map((h, i) => ({
        col: String.fromCharCode(65 + i),
        index: i,
        raw: h,
        type: typeof h,
        length: String(h || '').length,
        trimmed: String(h || '').trim(),
      }));
      return jsonResponse({ success: true, lastCol: lastCol, headers: debug });
    }

    if (action === 'getCtsGoals') {
      return jsonResponse({ success: true, goals: getCtsGoals() });
    }

    // v5.2: dados das abas DRIVER CALENDAR e VID CALENDAR
    if (action === 'getDriverCalendar') {
      const monthYear = e.parameter.month;  // ex: '4.2026' (opcional)
      if (monthYear) {
        return jsonResponse({ success: true, data: getDriverCalendarByMonth_(monthYear) });
      }
      return jsonResponse({ success: true, data: getDriverCalendar() });
    }

    if (action === 'getVidCalendar') {
      // VID CALENDAR não tem multi-mês — sempre retorna o mês atual.
      // O monthYear, se passado, é só passado de volta no payload pra UI saber.
      const monthYear = e.parameter.month;
      const data = getVidCalendar();
      if (monthYear && monthYear !== (data.month + '.' + data.year)) {
        // Se pediram outro mês, marca que VID Calendar não tem
        data._monthMismatch = true;
        data._requestedMonth = monthYear;
      }
      return jsonResponse({ success: true, data: data });
    }

    // v5.7: lista de meses disponíveis na RAW CTS DATA (pra dropdown no PDF export)
    if (action === 'getAvailableMonths') {
      return jsonResponse({ success: true, months: getAvailableMonths_() });
    }

    // v5.15: dados consolidados pro Monthly Business Review (PPTX)
    if (action === 'getMonthlyReportData') {
      const month = parseInt(e.parameter.month, 10);
      const year = parseInt(e.parameter.year, 10);
      if (!month || !year) return jsonResponse({ success: false, error: 'month/year obrigatórios' });
      return jsonResponse({ success: true, data: getMonthlyReportData_(month, year) });
    }

    // v5.43: opções pros dropdowns do export TKM Report (meses/anos dos seletores B9/D9 + países)
    if (action === 'getTkmReportOptions') {
      return jsonResponse(getTkmReportOptions_());
    }

    // v5.43: dados do TKM Monthly Report pro PDF (big numbers + lista de motoristas) por mês/ano/país
    if (action === 'getTkmReport') {
      const month = parseInt(e.parameter.month, 10);
      const year = parseInt(e.parameter.year, 10);
      const country = e.parameter.country || 'ALL';
      if (!month || !year) return jsonResponse({ success: false, error: 'month/year obrigatórios' });
      return jsonResponse(getTkmReport_(month, year, country));
    }

    // v5.58: portal do CLIENTE (client-metrics.html) — KPIs + lista de motoristas
    // por país/mês, derivado direto da RAW CTS DATA (inclui Map Type: swarm/churn).
    // Público (sem login) — só dados operacionais agregados, nada financeiro.
    if (action === 'getClientMetrics') {
      const month = parseInt(e.parameter.month, 10) || null;
      const year = parseInt(e.parameter.year, 10) || null;
      const country = e.parameter.country || 'ALL';
      // v5.59: CACHE DE SERVIDOR (30min). A montagem é cara (lê a RAW CTS
      // inteira) — 45s+ por chamada. Sem isso, CADA visitante do portal
      // público pagaria esse custo e estouraria o timeout do frontend.
      // ?nocache=1 força recalcular.
      const cacheKey = 'clientMetrics_' + month + '_' + year + '_' + country;
      const cache = CacheService.getScriptCache();
      if (e.parameter.nocache !== '1') {
        const hit = cache.get(cacheKey);
        if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
      }
      const payload = getClientMetrics_(month, year, country);
      if (payload && payload.success) {
        try {
          const str = JSON.stringify(payload);
          // limite do CacheService é 100KB por chave — acima disso, só não cacheia
          if (str.length < 95000) cache.put(cacheKey, str, 1800);
          else Logger.log('getClientMetrics: payload ' + str.length + 'B — grande demais pro cache');
        } catch (e2) { Logger.log('getClientMetrics cache falhou: ' + e2); }
      }
      return jsonResponse(payload);
    }

    // v5.44: frota inteira por VID — última posição conhecida de cada VID (pro ops-map)
    if (action === 'getFleetVids') {
      return jsonResponse({ success: true, vids: getFleetVids_() });
    }

    // v5.45: curadoria manual de VIDs ativos por país (ops-map admin)
    if (action === 'getVidStatus') {
      return jsonResponse({ success: true, status: getVidStatus_() });
    }

    // v5.16: drivers ativos agrupados por país (pra dropdown na cash.html)
    if (action === 'getActiveDriversByCountry') {
      return jsonResponse({ success: true, drivers: getActiveDriversByCountry_() });
    }

    // v5.14: lista de SSDs do driver (pro dropdown no check-in)
    if (action === 'getDriverSsds') {
      const email = e.parameter.email;
      if (!email) return jsonResponse({ success: false, error: 'email obrigatório' });
      // v5.51: cache de 30min por motorista — discos quase não mudam no dia
      const ssdCache = CacheService.getScriptCache();
      const ssdKey = 'checkin_ssds_' + email;
      const ssdCached = ssdCache.get(ssdKey);
      if (ssdCached) return jsonResponse({ success: true, ssds: JSON.parse(ssdCached), cached: true });
      const ssds = getDriverSsdsByEmail_(email);
      try { ssdCache.put(ssdKey, JSON.stringify(ssds), 1800); } catch (e) {}
      return jsonResponse({ success: true, ssds: ssds });
    }

    // v5.14: issues abertas/em-andamento de um driver (pro driver-profile)
    if (action === 'getDriverVehicleIssues') {
      const email = e.parameter.email;
      if (!email) return jsonResponse({ success: false, error: 'email obrigatório' });
      return jsonResponse({ success: true, issues: getDriverVehicleIssues_(email) });
    }

    // v5.23: última resposta do driver na aba Assets Management (pré-fill do form semanal)
    // OBS: match por email aqui (diferente do getDriverAssets_(vid) privado que match por VID)
    if (action === 'getLastAssetsForm') {
      const email = e.parameter.email;
      if (!email) return jsonResponse({ success: false, error: 'email obrigatório' });
      return jsonResponse({ success: true, assets: getLastAssetsForm_(email) });
    }

    // v5.24: PMO Notes — lista/filtra notes do pmo.html
    // Suporta ?limit=N (default 200) e ?driverEmail=... (filtra server-side opcional)
    if (action === 'getPMONotes' || action === 'getAllPMONotes') {
      return jsonResponse(getPMONotesHandler_(e));
    }

    // v5: folha de ponto — retorna check-ins + checkouts agregados por dia/driver
    if (action === 'getTimesheet') {
      const startDate = e.parameter.startDate; // 'YYYY-MM-DD'
      const endDate = e.parameter.endDate;     // 'YYYY-MM-DD'
      return jsonResponse({ success: true, rows: getTimesheet(startDate, endDate) });
    }

    // v5.35: timesheet/payroll — leitura crua da aba "Timesheet" (headers + rows)
    // Frontend (timesheet.html) faz auto-discovery das colunas
    if (action === 'getTimesheetTab') {
      return jsonResponse(getTimesheetTab_());
    }

    // v5.53: payroll derivado do check-in — horas "aprovadas" + salario base por driver.
    // ?start=YYYY-MM-DD&end=YYYY-MM-DD (default: quinzena corrente 1-15 / 16-fim).
    if (action === 'getPayrollCheckin') {
      return jsonResponse(getPayrollCheckin_(e.parameter.start, e.parameter.end));
    }

    // v5.55: escreve as horas calculadas na coluna "Hrs Worked" da aba REAL da quinzena na ACE.
    // ?tab=<nome exato da aba>&start=&end=&confirm=1. Sem &tab = lista as abas; sem confirm=1 = DRY-RUN.
    if (action === 'writeAceHours') {
      return jsonResponse(writeAceHours_(e.parameter.tab, e.parameter.start, e.parameter.end, e.parameter.confirm));
    }

    // v5.40: ajustes de payroll (reembolsos/bônus/descontos) por driver+quinzena
    // ?quinzena=YYYY-MM-DD filtra pra uma quinzena específica (opcional)
    if (action === 'getPayrollAdjustments') {
      return jsonResponse(getPayrollAdjustments_(e.parameter.quinzena || ''));
    }

    // v5.41: overlay de risco/crime no dashboard — proxy + cache da API do Fogo Cruzado
    // ?days=30 (default, max 90). Retorna pontos {lat,lng,date,city,state,reason,victims,policeAction}
    // dos 4 estados cobertos (RJ/PE/BA/PA). Token email/senha em PropertiesService.
    if (action === 'getCrimeOverlay') {
      const days = Math.min(90, Math.max(1, parseInt(e.parameter.days, 10) || 30));
      return jsonResponse(getCrimeOverlay_(days));
    }

    // v5.42: MyMaps (ops-map.html) — lista os uploads (opcional ?country=AR) e serve o GeoJSON
    if (action === 'listMyMaps') {
      return jsonResponse({ success: true, maps: listMyMaps_(e.parameter.country || '') });
    }
    if (action === 'getMyMap') {
      return jsonResponse(getMyMap_(e.parameter.fileId));
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}


// ================================================================
// ENDPOINT POST (gravação de check-ins)
// ================================================================

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    ensureSheetsExist();

    if (data.type === 'checkin') {
      saveCheckin(data);
      return jsonResponse({ success: true, message: 'Check-in gravado' });
    }

    if (data.type === 'checkout') {
      const result = saveCheckout(data);
      return jsonResponse({ success: true, message: result.message, mode: result.mode });
    }

    if (data.type === 'base') {
      saveBase(data);
      return jsonResponse({ success: true, message: 'Base atualizada' });
    }

    // v5.1: edição administrativa de driver (vem do painel Admin do dashboard)
    if (data.type === 'updateDriverInfo') {
      const result = updateDriverInfo(data);
      return jsonResponse({ success: true, message: result.message, mode: result.mode });
    }

    // v5.11: análise IA do driver via Claude API
    if (data.type === 'analyzeDriver') {
      if (!data.email) return jsonResponse({ success: false, error: 'email obrigatório' });
      const result = analyzeDriverWithAi_(data.email);
      return jsonResponse(result);
    }

    // v5.14: registrar/atualizar incidente de veículo (acidente/mech/tech tracking)
    // v5.23: relatório semanal de equipamentos (Assets Management form)
    if (data.type === 'assetWeekly') {
      const result = saveAssetWeekly_(data);
      return jsonResponse({ success: true, message: result.message, photoUrls: result.photoUrls });
    }

    // v5.25: divergências de pagamento Argentina (ar-divergencias.html)
    if (data.type === 'submitArgentinaCash') {
      const result = submitArgentinaCash_(data);
      return jsonResponse(result);
    }

    // v5.24: PMO Notes — salvar note vindo do pmo.html
    if (data.type === 'savePMONote') {
      return jsonResponse(savePMONoteHandler_(data));
    }

    // v5.24: PMO Notes — editar (apenas admin)
    if (data.type === 'editPMONote') {
      if (!isPMOAdminBackend_(data.actorUsername)) {
        return jsonResponse({ success: false, error: 'Permissão negada. Apenas admins podem editar PMO notes.' });
      }
      return jsonResponse(editPMONoteHandler_(data));
    }

    // v5.24: PMO Notes — deletar (apenas admin, soft-delete)
    if (data.type === 'deletePMONote') {
      if (!isPMOAdminBackend_(data.actorUsername)) {
        return jsonResponse({ success: false, error: 'Permissão negada. Apenas admins podem deletar PMO notes.' });
      }
      return jsonResponse(deletePMONoteHandler_(data));
    }

    if (data.type === 'saveVehicleIssue') {
      const result = saveVehicleIssue_(data);
      return jsonResponse({ success: true, message: result.message, mode: result.mode });
    }

    // v5.39: salva cronograma compartilhado do lançamento AR (ar-launch-calendar.html)
    if (data.type === 'saveArLaunchSchedule') {
      return jsonResponse(saveArLaunchSchedule_(data.schedule));
    }

    // v5.42: upload de MyMaps (ops-map.html) — guarda o GeoJSON no Drive + metadados na aba
    if (data.type === 'saveMyMap') {
      return jsonResponse(saveMyMap_(data));
    }

    // v5.45: curadoria de VIDs ativos por país (ops-map admin) — persiste na aba "VID Status"
    if (data.type === 'saveVidStatus') {
      return jsonResponse(saveVidStatus_(data));
    }

    // v5.40: payroll adjustments (timesheet.html) — só super admin (fuss) lança/remove
    if (data.type === 'savePayrollAdjustment') {
      if (!isSuperAdminBackend_(data.actorUsername)) {
        return jsonResponse({ success: false, error: 'Permissão negada. Apenas o super admin pode lançar valores.' });
      }
      return jsonResponse(savePayrollAdjustment_(data));
    }
    if (data.type === 'deletePayrollAdjustment') {
      if (!isSuperAdminBackend_(data.actorUsername)) {
        return jsonResponse({ success: false, error: 'Permissão negada. Apenas o super admin pode remover valores.' });
      }
      return jsonResponse(deletePayrollAdjustment_(data));
    }

    // v5.56: grava as horas revisadas (payroll.html) na coluna "Hrs Worked" da aba da ACE.
    // { tab, rows:[{name,hours}], confirm }. Sem confirm=1 = dry-run. So super admin.
    if (data.type === 'writeAceHoursManual') {
      if (!isSuperAdminBackend_(data.actorUsername)) {
        return jsonResponse({ success: false, error: 'Permissão negada. Apenas o super admin pode gravar na ACE.' });
      }
      return jsonResponse(writeAceHoursManual_(data));
    }

    // v5.33: super-admin only — atualiza auth.js commitando direto no GitHub via API
    if (data.type === 'updateAuthUsers') {
      if (!isSuperAdminBackend_(data.actorUsername)) {
        return jsonResponse({ success: false, error: 'Permissão negada. Apenas o super admin pode gerenciar usuários.' });
      }
      return jsonResponse(updateAuthUsersHandler_(data));
    }

    // v5.16: pedido de dinheiro (deposita pra driver) — vai pra Cash Transfer Management
    if (data.type === 'saveCashRequest') {
      const result = saveCashRequest_(data);
      return jsonResponse({ success: true, message: result.message, usdAmount: result.usdAmount });
    }

    // v5.16: subir recibo de gasto (reembolso) — vai pra Cash Receipts BR ou HC
    if (data.type === 'saveCashReceipt') {
      const result = saveCashReceipt_(data);
      return jsonResponse({ success: true, message: result.message, usdAmount: result.usdAmount, fileUrl: result.fileUrl });
    }

    // v5.22: admin endpoints (edit/delete cash transactions)
    // Valida que adminUser está na whitelist
    if (data.type === 'updateCashRequest' || data.type === 'updateCashReceipt'
        || data.type === 'deleteCashRequest' || data.type === 'deleteCashReceipt') {
      if (!isCashAdminBackend_(data.adminUser)) {
        return jsonResponse({ success: false, error: 'Permissão negada. Apenas admins podem editar.' });
      }
    }

    if (data.type === 'updateCashRequest') {
      const result = updateCashRequest_(data);
      return jsonResponse({ success: true, message: result.message });
    }
    if (data.type === 'updateCashReceipt') {
      const result = updateCashReceipt_(data);
      return jsonResponse({ success: true, message: result.message });
    }
    if (data.type === 'deleteCashRequest') {
      const result = deleteCashRequest_(data);
      return jsonResponse({ success: true, message: result.message });
    }
    if (data.type === 'deleteCashReceipt') {
      const result = deleteCashReceipt_(data);
      return jsonResponse({ success: true, message: result.message });
    }

    return jsonResponse({ success: false, error: 'Unknown type: ' + data.type });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}


// ================================================================
// FUNÇÕES DE LEITURA — ORIGINAIS (portal check-in)
// ================================================================

function getActiveDrivers(includeOffboarding) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.hrSheet);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const nameIdx = headers.indexOf('Beneficiary Full Name');
  const emailIdx = headers.indexOf('Corporate E-mail');
  const countryIdx = headers.indexOf('Country');
  const situationIdx = headers.indexOf('Situation');
  const cityIdx = headers.indexOf('City');

  const drivers = [];
  for (let i = 1; i < data.length; i++) {
    const sit = data[i][situationIdx];
    const ok = sit === 'Active' || (includeOffboarding && sit === 'Offboarding');
    if (ok && data[i][emailIdx]) {
      drivers.push({
        name: data[i][nameIdx],
        email: data[i][emailIdx],
        country: data[i][countryIdx],
        city: data[i][cityIdx] || '',
      });
    }
  }

  drivers.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  return drivers;
}

function getDriverBase(email) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.baseSheet);
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][1] === email) {
      return {
        type: data[i][3],
        address: data[i][4],
        lat: data[i][5],
        lng: data[i][6],
        updatedAt: data[i][0],
      };
    }
  }
  return null;
}

function getDriverLastArea(email) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.checkinSheet);
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][3] === email && data[i][9] && data[i][10]) {
      return {
        lat: data[i][9],
        lng: data[i][10],
        address: data[i][11],
        radius: data[i][12] || 10,
      };
    }
  }
  return null;
}


// ================================================================
// FUNÇÕES DE LEITURA — v2 (dashboard)
// ================================================================

function getDriversWithAddress() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.hrSheet);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const nameIdx = headers.indexOf('Beneficiary Full Name');
  const emailIdx = headers.indexOf('Corporate E-mail');
  const countryIdx = headers.indexOf('Country');
  const situationIdx = headers.indexOf('Situation');
  const cityIdx = headers.indexOf('City');
  const zipIdx = headers.indexOf('Zip Code');
  const addressIdx = headers.indexOf('Full Adress');
  const homeLatIdx = headers.indexOf('Home Lat');
  const homeLngIdx = headers.indexOf('Home Lng');

  const drivers = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][situationIdx] === 'Active' && data[i][emailIdx]) {
      drivers.push({
        name: data[i][nameIdx],
        email: data[i][emailIdx],
        country: data[i][countryIdx],
        city: data[i][cityIdx] || '',
        zipCode: zipIdx >= 0 ? String(data[i][zipIdx] || '').trim() : '',
        fullAddress: addressIdx >= 0 ? (data[i][addressIdx] || '') : '',
        homeLat: homeLatIdx >= 0 ? (data[i][homeLatIdx] || null) : null,
        homeLng: homeLngIdx >= 0 ? (data[i][homeLngIdx] || null) : null,
      });
    }
  }

  drivers.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  return drivers;
}

function getDashboardData(days) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const checkinSheet = ss.getSheetByName(CONFIG.checkinSheet);
  const baseSheet = ss.getSheetByName(CONFIG.baseSheet);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const drivers = getDriversWithAddress();

  const bases = {};
  if (baseSheet && baseSheet.getLastRow() > 1) {
    const baseData = baseSheet.getDataRange().getValues();
    for (let i = 1; i < baseData.length; i++) {
      const email = baseData[i][1];
      const ts = baseData[i][0];
      if (!email) continue;
      if (!bases[email] || ts > bases[email].updatedAt) {
        bases[email] = {
          type: baseData[i][3],
          address: baseData[i][4],
          lat: baseData[i][5],
          lng: baseData[i][6],
          updatedAt: ts,
        };
      }
    }
  }

  const lastCheckins = {};
  if (checkinSheet && checkinSheet.getLastRow() > 1) {
    const ciData = checkinSheet.getDataRange().getValues();
    for (let i = 1; i < ciData.length; i++) {
      const email = ciData[i][3];
      const ts = ciData[i][0];
      if (!email || !(ts instanceof Date)) continue;
      if (!lastCheckins[email] || ts > lastCheckins[email].timestamp) {
        lastCheckins[email] = {
          timestamp: ts,
          hoursAgo: (Date.now() - ts.getTime()) / 3600000,
          originLat: ciData[i][5],
          originLng: ciData[i][6],
          originAddress: ciData[i][7],
          destLat: ciData[i][9],
          destLng: ciData[i][10],
          destAddress: ciData[i][11],
          destRadius: ciData[i][12],
          vehicleStatus: ciData[i][13],
          vehicleIssue: ciData[i][14],
          notes: ciData[i][15],
          // v5.30: DNM (Did Not Map) flags — pra country_scopes mostrar motivo
          didMap: ciData[i][32] || '',          // 'yes' | 'no'
          dnmReason: ciData[i][33] || '',       // 'weather' | 'mech' | 'tech' | 'disks' | ''
        };
      }
    }
  }

  return {
    drivers: drivers,
    bases: bases,
    lastCheckins: lastCheckins,
    generatedAt: new Date().toISOString(),
  };
}

function getDriverHistory(email, days) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.checkinSheet);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const data = sheet.getDataRange().getValues();
  const history = [];

  for (let i = 1; i < data.length; i++) {
    const ts = data[i][0];
    const rowEmail = data[i][3];
    if (rowEmail !== email || !(ts instanceof Date) || ts < cutoff) continue;

    // Checkout fields (cols U-AA = índices 20-26) — podem não existir em rows antigas
    const checkoutTs = data[i][20];
    const tkmMapped = data[i][23];
    const totalKmDriven = data[i][24];
    const checkoutNotes = data[i][25];
    const hasCheckin = data[i][26];

    history.push({
      timestamp: ts.toISOString(),
      date: data[i][1],
      originLat: data[i][5],
      originLng: data[i][6],
      destLat: data[i][9],
      destLng: data[i][10],
      destAddress: data[i][11],
      destRadius: data[i][12],
      vehicleStatus: data[i][13],
      vehicleIssue: data[i][14],
      notes: data[i][15],
      // v5: checkout data
      checkoutTimestamp: (checkoutTs instanceof Date) ? checkoutTs.toISOString() : null,
      tkmMapped: safeNumber(tkmMapped),
      totalKmDriven: safeNumber(totalKmDriven),
      checkoutNotes: checkoutNotes || '',
      hasCheckin: hasCheckin || 'Yes',
    });
  }

  history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return history;
}


/**
 * Retorna todos os check-ins no range [startDate, endDate], 1 por (driver, dia).
 *
 * Pra cada driver, mantém só o ÚLTIMO check-in do dia (caso tenham feito
 * mais de um). Se driver fez check-in em múltiplos dias do range, ele
 * aparece em todas as linhas (cada uma representando um dia).
 *
 * Args:
 *   startDate: 'YYYY-MM-DD' (inclusivo)
 *   endDate:   'YYYY-MM-DD' (inclusivo)
 *
 * Retorna array de objetos com mesmo formato de lastCheckins do getDashboardData,
 * mas com 1 entrada por (email, date).
 */
function getCheckinsByPeriod(startDate, endDate) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.checkinSheet);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const start = startDate ? new Date(startDate + 'T00:00:00-03:00') : new Date(0);
  const end = endDate ? new Date(endDate + 'T23:59:59-03:00') : new Date('9999-12-31');

  const data = sheet.getDataRange().getValues();
  // Map de "email|date" -> mais recente check-in desse par
  const latestPerDay = {};

  for (let i = 1; i < data.length; i++) {
    const ts = data[i][0];
    const email = data[i][3];
    if (!email || !(ts instanceof Date)) continue;
    if (ts < start || ts > end) continue;

    const dateStr = Utilities.formatDate(ts, 'America/Sao_Paulo', 'yyyy-MM-dd');
    const key = email + '|' + dateStr;

    // Mantém o mais recente do dia (último check-in)
    if (!latestPerDay[key] || ts > latestPerDay[key]._ts) {
      latestPerDay[key] = {
        _ts: ts,
        timestamp: ts.toISOString(),
        date: dateStr,
        driverEmail: email,
        driverName: data[i][2] || '',
        country: data[i][4] || '',
        originLat: data[i][5],
        originLng: data[i][6],
        originAddress: data[i][7],
        destLat: data[i][9],
        destLng: data[i][10],
        destAddress: data[i][11],
        destRadius: data[i][12],
        vehicleStatus: data[i][13],
        vehicleIssue: data[i][14],
        notes: data[i][15],
        // v5.38: DNM flags pro dashboard colorir marcador de vermelho em filtro de período
        didMap: data[i][32] || '',          // 'yes' | 'no'
        dnmReason: data[i][33] || '',       // 'weather' | 'mech' | 'tech' | 'disks' | ''
      };
    }
  }

  // Remove o _ts (campo interno) e retorna array
  return Object.values(latestPerDay).map(c => {
    delete c._ts;
    return c;
  });
}


/**
 * v5.39: cronograma compartilhado do lançamento na Argentina.
 * Doc único (locations + events) guardado como JSON no ScriptProperties —
 * sem aba na Mastersheet. Last-write-wins (uso interno, baixo volume).
 */
const AR_LAUNCH_KEY = 'AR_LAUNCH_SCHEDULE';

function getArLaunchSchedule_() {
  const raw = PropertiesService.getScriptProperties().getProperty(AR_LAUNCH_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function saveArLaunchSchedule_(schedule) {
  if (!schedule || typeof schedule !== 'object') {
    return { success: false, error: 'schedule inválido' };
  }
  const json = JSON.stringify(schedule);
  // ScriptProperties tem limite de ~9KB por valor
  if (json.length > 9000) {
    return { success: false, error: 'schedule grande demais pro storage (>9KB)' };
  }
  PropertiesService.getScriptProperties().setProperty(AR_LAUNCH_KEY, json);
  return { success: true };
}


/**
 * Retorna transações Ramp do período (com match opcional pra coordenadas via check-ins).
 *
 * Args:
 *   startDate: 'YYYY-MM-DD' (inclusivo)
 *   endDate:   'YYYY-MM-DD' (inclusivo)
 *
 * Retorna:
 *   {
 *     transactions: [{date, user, country, category, merchant, amount,
 *                     lat, lng, locationMatchStatus}, ...],
 *     totalCount, totalAmount, locatedCount,
 *     periodStart, periodEnd
 *   }
 *
 * locationMatchStatus:
 *   'exact'    → check-in no MESMO dia da transação
 *   'nearby'   → check-in até ±2 dias antes/depois
 *   'no_match' → driver fez check-in mas em outra data
 *   'no_driver' → não conseguiu identificar driver pelo nome
 *   'no_checkin' → driver identificado mas sem check-in no período
 */
function getRampData(startDate, endDate) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const rampSheet = ss.getSheetByName(CONFIG.rampSheet);
  if (!rampSheet || rampSheet.getLastRow() <= 1) {
    return { transactions: [], totalCount: 0, totalAmount: 0, locatedCount: 0 };
  }

  const start = startDate ? new Date(startDate + 'T00:00:00-03:00') : new Date(0);
  const end = endDate ? new Date(endDate + 'T23:59:59-03:00') : new Date('9999-12-31');

  // 1) Carrega check-ins do período expandido (±2 dias pra cobrir matches "nearby")
  const expandedStart = new Date(start);
  expandedStart.setDate(expandedStart.getDate() - 2);
  const expandedEnd = new Date(end);
  expandedEnd.setDate(expandedEnd.getDate() + 2);

  const checkinsByKey = buildCheckinIndex_(
    Utilities.formatDate(expandedStart, 'America/Sao_Paulo', 'yyyy-MM-dd'),
    Utilities.formatDate(expandedEnd, 'America/Sao_Paulo', 'yyyy-MM-dd')
  );

  // 2) Constrói índice de drivers (TODOS da HR, ativos e inativos) com match por
  //    cartão (físico + virtual) e por nome normalizado.
  //    Cartão é match preferencial (94% das transações batem assim).
  //    Nome é fallback (cartão não cadastrado, virtual sem mapeamento).
  const hrIndex = buildHrIndex_();

  // 3) Loop nas transações Ramp
  const data = rampSheet.getDataRange().getValues();
  // Header: A=Month, B=Card Last 4, C=Date, D=User, E=Merchant, F=Amount, G=Category, H=Department
  const transactions = [];
  let totalAmount = 0;
  let locatedCount = 0;
  let matchByCard = 0;
  let matchByName = 0;
  let matchNone = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const txDate = row[2];
    if (!(txDate instanceof Date)) continue;
    if (txDate < start || txDate > end) continue;

    const cardLast4 = row[1];
    const userName = row[3] || '';
    const merchant = row[4] || '';
    const amount = safeNumber(row[5]);
    const category = row[6] || 'Other';
    const department = row[7] || '';

    // Extrai país do department: 'SVDO_Brazil_Ace' → 'Brazil'
    const country = parseCountryFromDept_(department);

    // Match em camadas: cartão → nome → nada
    let matchedDriver = null;
    let matchSource = 'none';  // 'card' | 'name' | 'none'

    // Camada 1: cartão
    if (cardLast4) {
      const cardKey = String(cardLast4).trim().replace(/^'/, '').replace(/\.0$/, '');
      if (hrIndex.byCard[cardKey]) {
        matchedDriver = hrIndex.byCard[cardKey];
        matchSource = 'card';
        matchByCard++;
      }
    }

    // Camada 2: nome (só se cartão falhou)
    if (!matchedDriver && userName) {
      const nKey = nameKey_(userName);
      if (hrIndex.byName[nKey]) {
        matchedDriver = hrIndex.byName[nKey];
        matchSource = 'name';
        matchByName++;
      }
    }

    if (!matchedDriver) matchNone++;

    // Tenta achar coordenadas do check-in: usa email do driver matched
    let matchResult = { lat: null, lng: null, status: 'no_driver', email: '', checkinDate: null };
    if (matchedDriver && matchedDriver.email) {
      matchResult = findCheckinByEmail_(matchedDriver.email, txDate, checkinsByKey);
      matchResult.email = matchedDriver.email;
    }

    const txDateStr = Utilities.formatDate(txDate, 'America/Sao_Paulo', 'yyyy-MM-dd');

    transactions.push({
      date: txDateStr,
      user: userName,
      // Nome correto da HR (em vez do nome bruto da Ramp)
      driverName: matchedDriver ? matchedDriver.fullName : userName,
      driverEmail: matchedDriver ? matchedDriver.email : '',
      driverActive: matchedDriver ? matchedDriver.active : false,
      cardLast4: cardLast4 ? String(cardLast4).replace(/\.0$/, '') : '',
      country: country,
      department: department,
      category: category,
      merchant: merchant,
      amount: amount,
      lat: matchResult.lat,
      lng: matchResult.lng,
      locationMatchStatus: matchResult.status,
      locationDate: matchResult.checkinDate || null,
      // Origem do match: ajuda a debugar e permite UI mostrar confiança
      matchSource: matchSource,  // 'card' | 'name' | 'none'
    });

    totalAmount += amount;
    if (matchResult.lat && matchResult.lng) locatedCount++;
  }

  return {
    transactions: transactions,
    totalCount: transactions.length,
    totalAmount: Math.round(totalAmount * 100) / 100,
    locatedCount: locatedCount,
    matchStats: {
      byCard: matchByCard,
      byName: matchByName,
      none: matchNone,
    },
    periodStart: startDate,
    periodEnd: endDate,
  };
}

// =====================================================================
// DRIVER PROFILE (v5.7) — usando RAW CTS DATA pra cálculos precisos
// =====================================================================
//
// Fonte de verdade: aba RAW CTS DATA (~6000 linhas — 1 linha por dia/driver).
// Tem TKM real, KM dirigido, Status (Mapping/Mech/Tech/Personal/Weather/etc),
// e Billable Hours. Permite calcular eficiência, idle days e histórico
// completo de forma precisa, em vez de depender da VID CALENDAR.

/**
 * Mês atual no formato 'M.YYYY' usado pela aba RAW CTS DATA (ex: '5.2026').
 */
function getCurrentMonthKey_() {
  const now = new Date();
  return (now.getMonth() + 1) + '.' + now.getFullYear();
}

/**
 * Status que contam como "trabalhando produtivo" (gera TKM).
 * Outros (Personal, Mech, Tech, Weather, Disks, Travelling, Holiday) são idle.
 */
const PRODUCTIVE_STATUSES = ['Mapping'];

/**
 * Lê toda a aba RAW CTS DATA e retorna um índice agregado.
 *
 * Estrutura retornada:
 *   {
 *     'email@x.com': {
 *       'M.YYYY': {                          // por mês
 *         tkm, km, mappingDays,
 *         idleDays: { Personal, Mech, Tech, Weather, Disks, Travelling, Holiday, total },
 *         billableHours,
 *         days: [{ date, tkm, km, status, billableHours }, ...],  // raw
 *       }
 *     }
 *   }
 *
 * Note: cache em memória do request — chamadas múltiplas no mesmo request
 * reutilizam. (Apps Script não persiste entre requests, mas dentro de um
 * mesmo doGet() não relê 6k linhas várias vezes.)
 */
/** Data da RAW CTS: aceita Date ou texto ISO 'yyyy-MM-dd' (export novo manda string). */
function parseRawCtsDate_(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

let _rawCtsCache = null;
function buildRawCtsIndex_() {
  if (_rawCtsCache) return _rawCtsCache;

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.rawCtsSheet);
  if (!sheet || sheet.getLastRow() < 2) {
    _rawCtsCache = {};
    return _rawCtsCache;
  }

  // v5.47: o export trocou o schema (VID→vehicle_id, country→country_code,
  // total_km→total_kms, Status→status, Billable Hours→Billable CTS Hours).
  // findHeader_ aceita nome antigo E novo, case-insensitive.
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const monthIdx = findHeader_(headers, ['Month']);
  const countryIdx = findHeader_(headers, ['country', 'country_code']);
  const vidIdx = findHeader_(headers, ['VID', 'vehicle_id']);
  const dateIdx = findHeader_(headers, ['drive_date']);
  const emailIdx = findHeader_(headers, ['email']);
  const tkmIdx = findHeader_(headers, ['TKM']);
  const kmIdx = findHeader_(headers, ['total_km', 'total_kms']);
  const statusIdx = findHeader_(headers, ['Status']);
  const hoursIdx = findHeader_(headers, ['Billable Hours', 'Billable CTS Hours']);

  const index = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const email = row[emailIdx];
    if (!email || typeof email !== 'string') continue;
    const emailKey = email.toLowerCase();
    const month = String(row[monthIdx] || '');
    if (!month) continue;

    if (!index[emailKey]) index[emailKey] = {};
    if (!index[emailKey][month]) {
      index[emailKey][month] = {
        country: row[countryIdx] || '',
        vid: row[vidIdx] || null,
        vids: [],                 // v5.52: todos os VIDs distintos rodados no mês
        tkm: 0, km: 0,
        mappingDays: 0,
        idleDays: { Personal: 0, 'Mech.': 0, 'Tech.': 0, Weather: 0, Disks: 0, Travelling: 0, Holiday: 0, Other: 0, total: 0 },
        billableHours: 0,
        days: [],
      };
    }

    const tkm = safeNumber(row[tkmIdx]);
    const km = safeNumber(row[kmIdx]);
    const status = row[statusIdx] || 'Other';
    const hours = safeNumber(row[hoursIdx]);
    const dateObj = parseRawCtsDate_(row[dateIdx]);
    const date = dateObj
      ? Utilities.formatDate(dateObj, 'America/Sao_Paulo', 'yyyy-MM-dd')
      : null;

    const monthData = index[emailKey][month];
    monthData.tkm += tkm;
    monthData.km += km;
    monthData.billableHours += hours;

    // v5.52: acumula VIDs distintos (pro relatório TKM mostrar os números de quem usou >1)
    const vidVal = row[vidIdx];
    if (vidVal != null && vidVal !== '') {
      const vidStr = String(vidVal).trim();
      if (vidStr && monthData.vids.indexOf(vidStr) < 0) monthData.vids.push(vidStr);
    }

    if (PRODUCTIVE_STATUSES.indexOf(status) >= 0) {
      monthData.mappingDays++;
    } else {
      // Categoriza idle pelos buckets conhecidos
      const bucket = monthData.idleDays.hasOwnProperty(status) ? status : 'Other';
      monthData.idleDays[bucket]++;
      monthData.idleDays.total++;
    }

    monthData.days.push({ date, tkm, km, status, billableHours: hours });
  }

  _rawCtsCache = index;
  return index;
}

/**
 * Lista de drivers ativos com eficiência calculada do mês corrente
 * (via RAW CTS DATA). Usado pelo seletor + ranking top/bottom 5.
 *
 * Retorna: [{ name, email, country, vid, efficiency, qcScore, status,
 *             idleTotal, tkm, kmDriven, mappingDays }]
 */
function getDriversList_() {
  const drivers = getActiveDrivers();
  const vidIndex = buildVidIndexByEmail_();
  const ctsIndex = buildRawCtsIndex_();
  const currentMonth = getCurrentMonthKey_();

  // Se mês atual não tem dados ainda (começo do mês), tenta o anterior
  let useMonth = currentMonth;
  let monthHasData = false;
  for (const email in ctsIndex) {
    if (ctsIndex[email][currentMonth]) { monthHasData = true; break; }
  }
  if (!monthHasData) {
    // Fallback: pega o mês mais recente que tem dados
    const allMonths = new Set();
    for (const email in ctsIndex) {
      for (const m in ctsIndex[email]) allMonths.add(m);
    }
    const sortedMonths = Array.from(allMonths).sort((a, b) => {
      const [ma, ya] = a.split('.').map(Number);
      const [mb, yb] = b.split('.').map(Number);
      return (yb - ya) || (mb - ma);
    });
    if (sortedMonths.length > 0) useMonth = sortedMonths[0];
  }

  return drivers.map(d => {
    const emailKey = d.email.toLowerCase();
    const ctsMonth = ctsIndex[emailKey] && ctsIndex[emailKey][useMonth];
    const vid = vidIndex[emailKey];

    // Eficiência: prioritariamente do RAW CTS (mais confiável)
    let efficiency = null;
    let tkm = null, kmDriven = null, mappingDays = 0, idleTotal = 0;
    if (ctsMonth && ctsMonth.km > 0) {
      efficiency = ctsMonth.tkm / ctsMonth.km;
      tkm = ctsMonth.tkm;
      kmDriven = ctsMonth.km;
      mappingDays = ctsMonth.mappingDays;
      idleTotal = ctsMonth.idleDays.total;
    } else if (vid && vid.efficiency) {
      // Fallback pra VID CALENDAR
      efficiency = safeNumber(vid.efficiency);
    }

    return {
      name: d.name,
      email: d.email,
      country: d.country,
      vid: ctsMonth && ctsMonth.vid ? ctsMonth.vid : (vid ? vid.vid : null),
      efficiency: efficiency,
      qcScore: vid && vid.qcScore !== null ? safeNumber(vid.qcScore) : null,
      status: vid ? vid.statusPerGoogle : null,
      idleTotal: idleTotal,
      tkm: tkm,
      kmDriven: kmDriven,
      mappingDays: mappingDays,
      monthUsed: useMonth,  // pra debug
    };
  });
}

function isFiniteNum_(x) { return typeof x === 'number' && isFinite(x); }

/**
 * v5.44: Frota inteira por VID — última localização conhecida de CADA VID
 * (inclusive parados), independente de ser o VID atual do motorista. Usado no ops-map.
 *
 * Posição é DATE-AWARE: pro VID, pega o check-in do último motorista que o rodou
 * MAIS PRÓXIMO da data em que rodou — assim um carro parado fica onde estava no
 * último dia que rodou, não onde o motorista está hoje (que pode estar com outro
 * VID em outra cidade). Fallback: casa/base do motorista. Sem nada → lat/lng null.
 *
 * Retorna: [{ vid, email, driverName, driverActive, country, lastDate, daysAgo,
 *             lat, lng, posSource('checkin'|'home'|'none') }]
 */
function getFleetVids_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

  // 1) RAW CTS → por VID, a linha mais recente {email, data, country}
  const vidLast = {};
  const rawSheet = ss.getSheetByName(CONFIG.rawCtsSheet);
  if (rawSheet && rawSheet.getLastRow() >= 2) {
    const data = rawSheet.getDataRange().getValues();
    const h = data[0];
    const vIdx = findHeader_(h, ['VID', 'vehicle_id']), eIdx = findHeader_(h, ['email']),
          dIdx = findHeader_(h, ['drive_date']), cIdx = findHeader_(h, ['country', 'country_code']);
    if (vIdx >= 0 && dIdx >= 0) {
      for (let i = 1; i < data.length; i++) {
        const vidRaw = data[i][vIdx];
        if (!vidRaw) continue;
        const vid = String(vidRaw).trim();
        if (!vid) continue;
        const dObj = parseRawCtsDate_(data[i][dIdx]);
        const tm = dObj ? dObj.getTime() : 0;
        const cur = vidLast[vid];
        if (!cur || tm > cur.time) {
          vidLast[vid] = {
            vid: vid,
            email: (eIdx >= 0 && data[i][eIdx]) ? String(data[i][eIdx]).trim().toLowerCase() : '',
            time: tm,
            dateStr: dObj ? Utilities.formatDate(dObj, 'America/Sao_Paulo', 'yyyy-MM-dd') : null,
            country: cIdx >= 0 ? String(data[i][cIdx] || '').trim() : '',
          };
        }
      }
    }
  }

  // 2) Check-ins por email → [{time, lat, lng}]
  const ciByEmail = {};
  const ciSheet = ss.getSheetByName(CONFIG.checkinSheet);
  if (ciSheet && ciSheet.getLastRow() > 1) {
    const ci = ciSheet.getDataRange().getValues();
    for (let i = 1; i < ci.length; i++) {
      const ts = ci[i][0], email = ci[i][3], lat = ci[i][9], lng = ci[i][10];
      if (!email || !(ts instanceof Date) || !isFiniteNum_(lat) || !isFiniteNum_(lng)) continue;
      const key = String(email).trim().toLowerCase();
      (ciByEmail[key] = ciByEmail[key] || []).push({ time: ts.getTime(), lat: lat, lng: lng });
    }
  }

  // 3) Casa/base por email (fallback de posição)
  const baseByEmail = {};
  const baseSheet = ss.getSheetByName(CONFIG.baseSheet);
  if (baseSheet && baseSheet.getLastRow() > 1) {
    const bd = baseSheet.getDataRange().getValues();
    for (let i = 1; i < bd.length; i++) {
      const email = bd[i][1], ts = bd[i][0];
      if (!email) continue;
      const key = String(email).trim().toLowerCase();
      if (!baseByEmail[key] || ts > baseByEmail[key].ts) {
        baseByEmail[key] = { lat: bd[i][5], lng: bd[i][6], ts: ts };
      }
    }
  }

  // 4) email → nome + ativo (HR Database, todos — inclusive inativos)
  const nameByEmail = {}, activeByEmail = {};
  const hrSheet = ss.getSheetByName(CONFIG.hrSheet);
  if (hrSheet && hrSheet.getLastRow() > 1) {
    const headers = hrSheet.getRange(1, 1, 1, hrSheet.getLastColumn()).getValues()[0];
    const findCol = function () {
      const names = Array.prototype.slice.call(arguments);
      for (let i = 0; i < headers.length; i++) {
        const hh = String(headers[i] || '').trim().toLowerCase();
        for (let j = 0; j < names.length; j++) if (hh === names[j].toLowerCase()) return i;
      }
      return -1;
    };
    const iName = findCol('Beneficiary Full Name', 'Full Name', 'Driver Name', 'Name');
    const iEmail = findCol('Corporate E-mail', 'Email', 'Driver Email');
    const iSit = findCol('Situation', 'Status', 'Driver Status');
    if (iEmail >= 0) {
      const hd = hrSheet.getRange(2, 1, hrSheet.getLastRow() - 1, hrSheet.getLastColumn()).getValues();
      for (let i = 0; i < hd.length; i++) {
        const key = String(hd[i][iEmail] || '').trim().toLowerCase();
        if (!key) continue;
        if (iName >= 0) nameByEmail[key] = String(hd[i][iName] || '').trim();
        const sit = iSit >= 0 ? String(hd[i][iSit] || '').trim().toLowerCase() : 'active';
        activeByEmail[key] = (sit === 'active' || sit === 'ativo' || sit === 'activo' || sit === '');
      }
    }
  }

  // 5) Monta saída com posição date-aware
  const now = Date.now();
  const out = [];
  for (const vid in vidLast) {
    const v = vidLast[vid];
    let lat = null, lng = null, posSource = 'none';
    const cis = v.email ? ciByEmail[v.email] : null;
    if (cis && cis.length) {
      let best = null, bestDiff = Infinity;
      const target = v.time || now;
      for (let k = 0; k < cis.length; k++) {
        const diff = Math.abs(cis[k].time - target);
        if (diff < bestDiff) { bestDiff = diff; best = cis[k]; }
      }
      if (best) { lat = best.lat; lng = best.lng; posSource = 'checkin'; }
    }
    if ((lat === null || lng === null) && v.email && baseByEmail[v.email] &&
        isFiniteNum_(baseByEmail[v.email].lat) && isFiniteNum_(baseByEmail[v.email].lng)) {
      lat = baseByEmail[v.email].lat; lng = baseByEmail[v.email].lng; posSource = 'home';
    }
    out.push({
      vid: v.vid,
      email: v.email,
      driverName: nameByEmail[v.email] || '',
      driverActive: !!activeByEmail[v.email],
      country: v.country,
      lastDate: v.dateStr,
      daysAgo: v.time ? Math.floor((now - v.time) / 86400000) : null,
      lat: lat, lng: lng, posSource: posSource,
    });
  }
  out.sort(function (a, b) {
    return String(a.country).localeCompare(String(b.country)) || ((a.daysAgo || 0) - (b.daysAgo || 0));
  });
  return out;
}

/**
 * Constrói índice email→info da VID CALENDAR.
 */
function buildVidIndexByEmail_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.vidCalendarSheet, ['VID CALENDAR', 'VID Calendar', 'VID Monthly Calendar']);
  if (!sheet || sheet.getLastRow() < 14) return {};

  // ⚠ A ordem das colunas dessa aba MUDA ao longo do tempo (já trocaram E/F).
  // Fazemos lookup dinâmico por header pra ser resiliente a reordenações.
  // Headers ficam na linha 13.
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(13, 1, 1, lastCol).getValues()[0];

  // Helper: procura coluna por nome — case-insensitive, aceita variações
  const findCol = (...names) => {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim().toLowerCase();
      for (const n of names) {
        if (h === n.toLowerCase()) return i;
      }
    }
    return -1;
  };

  // Mapeia colunas por header. Inclui variações conhecidas (ex: "Efficiancy"
  // com erro de digitação que aparece na planilha hoje).
  const idx = {
    vid: findCol('VID'),
    country: findCol('Country'),
    floating: findCol('Floating Car?', 'Floating'),
    tkm: findCol('TKM'),
    kmDriven: findCol('KM Driven', 'KM'),
    efficiency: findCol('Efficiency', 'Efficiancy'),  // ⚠ typo na planilha
    mappingDays: findCol('Mapping Days'),
    avgTkmPerDay: findCol('Average TKM Per Mapping Day', 'Avg TKM Per Day'),
    email: findCol('Current/Last Driver', 'Driver Email', 'Email'),
    baselinePct: findCol('Baseline %', 'Baseline'),
    qcScore: findCol('QC Score'),
    status: findCol('Status Per Google', 'Status'),
    personal: findCol('Personal'),
    disks: findCol('Disks'),
    mech: findCol('Mech.', 'Mech'),
    tech: findCol('Tech.', 'Tech'),
    weather: findCol('Weather'),
  };

  if (idx.email < 0 || idx.vid < 0) {
    Logger.log('⚠ buildVidIndexByEmail_: colunas essenciais não encontradas. Headers: ' + headers.join(' | '));
    return {};
  }

  const data = sheet.getRange(14, 1, lastRow - 13, lastCol).getValues();

  const safeGet = (row, i) => i >= 0 ? row[i] : null;

  const index = {};
  data.forEach(row => {
    const email = safeGet(row, idx.email);
    if (!email || typeof email !== 'string') return;
    if (email.toLowerCase() === 'no driver') return;

    index[email.toLowerCase()] = {
      vid: safeGet(row, idx.vid),
      country: safeGet(row, idx.country),
      isFloating: safeGet(row, idx.floating),
      tkm: safeGet(row, idx.tkm),
      kmDriven: safeGet(row, idx.kmDriven),
      efficiency: safeGet(row, idx.efficiency),
      mappingDays: safeGet(row, idx.mappingDays),
      avgTkmPerDay: safeGet(row, idx.avgTkmPerDay),
      baselinePct: safeGet(row, idx.baselinePct),
      qcScore: safeGet(row, idx.qcScore),
      statusPerGoogle: safeGet(row, idx.status),
      personal: safeGet(row, idx.personal),
      disks: safeGet(row, idx.disks),
      mech: safeGet(row, idx.mech),
      tech: safeGet(row, idx.tech),
      weather: safeGet(row, idx.weather),
    };
  });

  return index;
}

/**
 * Payload completo de um driver. Combina HR + VID CALENDAR + RAW CTS DATA
 * (mês corrente + histórico de meses) + base atual + último check-in.
 *
 * Estrutura retornada (resumida):
 * {
 *   driver: { name, email, country, status, hireDate, cardLast4 },
 *   vid: { vid, isFloating, tkm, kmDriven, efficiency, mappingDays,
 *          qcScore, statusPerGoogle, ... },
 *   currentMonth: 'M.YYYY',  // mês usado pros cálculos principais
 *   metrics: {                // do RAW CTS DATA (fonte primária)
 *     tkm, km, efficiency, mappingDays, billableHours,
 *     idleDays: { Personal, Mech, Tech, Weather, Disks, ..., total },
 *     days: [{ date, tkm, km, status, billableHours }, ...],
 *   },
 *   monthlyHistory: [          // últimos N meses
 *     { month, tkm, km, efficiency, mappingDays, idleTotal, billableHours }
 *   ],
 *   baseline: { countryAvgEfficiency, countryAvgQc, countryDriversCount },
 *   currentBase: { type, address, lat, lng, radius },
 *   lastCheckin: { date, hoursAgo, vehicleStatus, notes },
 * }
 */
function getDriverProfile_(email) {
  const emailLower = email.toLowerCase();
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

  // ---- 1) Info da HR ----
  const hrSheet = ss.getSheetByName(CONFIG.hrSheet);
  const hrData = hrSheet.getDataRange().getValues();
  const hrHeaders = hrData[0];
  const hrEmailIdx = hrHeaders.indexOf('Corporate E-mail');
  const hrNameIdx = hrHeaders.indexOf('Beneficiary Full Name');
  const hrCountryIdx = hrHeaders.indexOf('Country');
  const hrSituationIdx = hrHeaders.indexOf('Situation');
  const hrHireDateIdx = hrHeaders.indexOf('Hire Date');
  const hrCardPhysIdx = hrHeaders.indexOf('Ramp Card Last 4');

  let driverInfo = null;
  for (let i = 1; i < hrData.length; i++) {
    const rowEmail = hrData[i][hrEmailIdx];
    if (rowEmail && String(rowEmail).toLowerCase() === emailLower) {
      driverInfo = {
        name: hrData[i][hrNameIdx],
        email: rowEmail,
        country: hrData[i][hrCountryIdx],
        status: hrData[i][hrSituationIdx],
        hireDate: hrData[i][hrHireDateIdx]
          ? Utilities.formatDate(new Date(hrData[i][hrHireDateIdx]), 'America/Sao_Paulo', 'yyyy-MM-dd')
          : null,
        cardLast4: hrData[i][hrCardPhysIdx] || null,
      };
      break;
    }
  }
  if (!driverInfo) return null;

  // ---- 2) VID Calendar (info estática + QC + status) ----
  const vidIndex = buildVidIndexByEmail_();
  const vidInfo = vidIndex[emailLower] || null;

  // ---- 3) RAW CTS DATA — mês corrente + histórico ----
  const ctsIndex = buildRawCtsIndex_();
  const driverCts = ctsIndex[emailLower] || {};

  // Mês mais recente que o driver tem dados (geralmente o atual)
  const driverMonths = Object.keys(driverCts);
  let currentMonth = getCurrentMonthKey_();
  if (!driverCts[currentMonth] && driverMonths.length > 0) {
    // Fallback: usa o mês mais recente do driver
    currentMonth = driverMonths.sort((a, b) => {
      const [ma, ya] = a.split('.').map(Number);
      const [mb, yb] = b.split('.').map(Number);
      return (yb - ya) || (mb - ma);
    })[0];
  }

  let metrics = null;
  if (driverCts[currentMonth]) {
    const m = driverCts[currentMonth];
    metrics = {
      vid: m.vid,  // VID que ele tá dirigindo este mês (do RAW CTS)
      tkm: Math.round(m.tkm * 100) / 100,
      km: Math.round(m.km * 100) / 100,
      efficiency: m.km > 0 ? m.tkm / m.km : null,
      mappingDays: m.mappingDays,
      idleDays: m.idleDays,
      billableHours: Math.round(m.billableHours * 100) / 100,
      days: m.days.sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    };
  }

  // Histórico mensal (todos os meses que o driver tem dados)
  const monthlyHistory = driverMonths
    .sort((a, b) => {
      const [ma, ya] = a.split('.').map(Number);
      const [mb, yb] = b.split('.').map(Number);
      return (ya - yb) || (ma - mb);
    })
    .map(month => {
      const m = driverCts[month];
      return {
        month: month,
        tkm: Math.round(m.tkm * 100) / 100,
        km: Math.round(m.km * 100) / 100,
        efficiency: m.km > 0 ? m.tkm / m.km : null,
        mappingDays: m.mappingDays,
        idleTotal: m.idleDays.total,
        billableHours: Math.round(m.billableHours * 100) / 100,
      };
    });

  // ---- 4) Baseline do país (avg eficiência via RAW CTS — mês corrente) ----
  let countryAvgEff = null, countryAvgQc = null, countryDriversCount = 0;
  if (driverInfo.country) {
    const countryStats = [];
    for (const otherEmail in ctsIndex) {
      const monthData = ctsIndex[otherEmail][currentMonth];
      if (monthData && monthData.km > 0 && monthData.country === driverInfo.country) {
        countryStats.push(monthData.tkm / monthData.km);
      }
    }
    if (countryStats.length > 0) {
      countryAvgEff = countryStats.reduce((s, v) => s + v, 0) / countryStats.length;
      countryDriversCount = countryStats.length;
    }
    // QC vem da VID CALENDAR (não tem na RAW CTS)
    const sameCountryDrivers = Object.values(vidIndex).filter(v => v.country === driverInfo.country);
    const validQc = sameCountryDrivers.filter(v => safeNumber(v.qcScore) > 0);
    if (validQc.length > 0) {
      countryAvgQc = validQc.reduce((s, v) => s + safeNumber(v.qcScore), 0) / validQc.length;
    }
  }

  // ---- 5) Current base + último check-in + casa do driver ----
  let currentBase = null;
  let lastCheckin = null;
  let driverHome = null;  // homeLat/homeLng da HR (casa cadastrada)

  // 5a) Casa cadastrada na HR
  const hrHomeLatIdx = hrHeaders.indexOf('Home Lat');
  const hrHomeLngIdx = hrHeaders.indexOf('Home Lng');
  const hrAddressIdx = hrHeaders.indexOf('Full Adress');
  if (hrHomeLatIdx >= 0 && hrHomeLngIdx >= 0) {
    for (let i = 1; i < hrData.length; i++) {
      if (hrData[i][hrEmailIdx] && String(hrData[i][hrEmailIdx]).toLowerCase() === emailLower) {
        const lat = hrData[i][hrHomeLatIdx];
        const lng = hrData[i][hrHomeLngIdx];
        if (lat && lng && typeof lat === 'number' && typeof lng === 'number') {
          driverHome = {
            lat: lat,
            lng: lng,
            address: hrAddressIdx >= 0 ? (hrData[i][hrAddressIdx] || '') : '',
          };
        }
        break;
      }
    }
  }

  // 5b) Base atual da aba Driver Base Location
  // Mesma lógica do getDashboardData: pega a base mais recente desse email
  try {
    const baseSheet = ss.getSheetByName(CONFIG.baseSheet);
    if (baseSheet && baseSheet.getLastRow() > 1) {
      const baseData = baseSheet.getDataRange().getValues();
      let mostRecentTs = null;
      let mostRecentBase = null;
      for (let i = 1; i < baseData.length; i++) {
        const baseEmail = baseData[i][1];
        const baseTs = baseData[i][0];
        if (!baseEmail || String(baseEmail).toLowerCase() !== emailLower) continue;
        if (!(baseTs instanceof Date)) continue;
        if (!mostRecentTs || baseTs > mostRecentTs) {
          mostRecentTs = baseTs;
          mostRecentBase = {
            type: baseData[i][3],
            address: baseData[i][4],
            lat: baseData[i][5],
            lng: baseData[i][6],
            radius: 0,  // base não tem radius (é localização pontual)
          };
        }
      }
      if (mostRecentBase && mostRecentBase.lat && mostRecentBase.lng) {
        currentBase = mostRecentBase;
      }
    }
  } catch (e) {
    Logger.log('Erro buscando base do driver: ' + e);
  }

  // 5c) Último check-in (pra info do hero — não pro mapa, que usa getDriverHistory)
  try {
    const checkinSheet = ss.getSheetByName(CONFIG.checkinSheet);
    if (checkinSheet && checkinSheet.getLastRow() > 1) {
      const ciData = checkinSheet.getDataRange().getValues();
      let mostRecentTs = null;
      let mostRecent = null;
      for (let i = 1; i < ciData.length; i++) {
        const ciEmail = ciData[i][3];
        const ciTs = ciData[i][0];
        if (!ciEmail || String(ciEmail).toLowerCase() !== emailLower) continue;
        if (!(ciTs instanceof Date)) continue;
        if (!mostRecentTs || ciTs > mostRecentTs) {
          mostRecentTs = ciTs;
          mostRecent = {
            date: ciTs.toISOString(),
            hoursAgo: (Date.now() - ciTs.getTime()) / 3600000,
            vehicleStatus: ciData[i][13] || null,
            notes: ciData[i][15] || null,
          };
        }
      }
      if (mostRecent) lastCheckin = mostRecent;
    }
  } catch (e) {
    Logger.log('Erro buscando último check-in: ' + e);
  }

  // ---- 6) Assets (discos, celular) — busca por VID ----
  let assets = null;
  try {
    // Pega VID do CTS atual (mais confiável); fallback pra VID Calendar
    const lookupVid = (metrics && metrics.vid) || (vidInfo && vidInfo.vid) || null;
    if (lookupVid) {
      assets = getDriverAssets_(lookupVid);
    }
  } catch (e) {
    Logger.log('Erro buscando assets: ' + e);
  }

  // ---- 7) Multas (Fines LATAM) — busca pelo nome ----
  let fines = [];
  try {
    fines = getDriverFines_(driverInfo.name);
  } catch (e) {
    Logger.log('Erro buscando multas: ' + e);
  }

  // ---- 8) Vehicle Issues (acidentes, mech, tech tracking) ----
  let vehicleIssues = [];
  try {
    vehicleIssues = getDriverVehicleIssues_(emailLower);
  } catch (e) {
    Logger.log('Erro buscando vehicle issues: ' + e);
  }

  return {
    driver: driverInfo,
    vid: vidInfo ? {
      vid: vidInfo.vid,
      isFloating: vidInfo.isFloating,
      qcScore: vidInfo.qcScore !== null ? safeNumber(vidInfo.qcScore) : null,
      statusPerGoogle: vidInfo.statusPerGoogle,
      // VID CALENDAR também tem TKM/KM/eff mas usamos o do RAW CTS
      vidCalendarTkm: safeNumber(vidInfo.tkm),
      vidCalendarKm: safeNumber(vidInfo.kmDriven),
      vidCalendarEfficiency: safeNumber(vidInfo.efficiency),
    } : null,
    currentMonth: currentMonth,
    metrics: metrics,
    monthlyHistory: monthlyHistory,
    baseline: {
      countryAvgEfficiency: countryAvgEff,
      countryAvgQc: countryAvgQc,
      countryDriversCount: countryDriversCount,
    },
    currentBase: currentBase,
    driverHome: driverHome,  // {lat, lng, address} ou null se não cadastrada na HR
    lastCheckin: lastCheckin,
    assets: assets,           // {discCount, discInUse, otherDiscs[], ...} ou null
    fines: fines,             // array (vazio se não tem)
    vehicleIssues: vehicleIssues,  // array (vazio se não tem)
  };
}


/**
 * Carrega índice de drivers da HR DATABASE com 2 modos de lookup:
 *   - byCard['1234']  → driver info (cartão físico OU virtual)
 *   - byName['joaodasilva'] → driver info (nome normalizado)
 *
 * Inclui TODOS os drivers (ativos e inativos) porque transações Ramp podem
 * referenciar drivers que já saíram da empresa.
 *
 * Driver info: { fullName, email, country, active }
 */
function buildHrIndex_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.hrSheet);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { byCard: {}, byName: {} };
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const nameIdx = headers.indexOf('Beneficiary Full Name');
  const cardPhysIdx = headers.indexOf('Ramp Card Last 4');
  const cardVirtIdx = headers.indexOf('Virtual Ramp Card Last 4');
  const emailIdx = headers.indexOf('Corporate E-mail');
  const countryIdx = headers.indexOf('Country');
  const situationIdx = headers.indexOf('Situation');

  const byCard = {};
  const byName = {};

  for (let i = 1; i < data.length; i++) {
    const name = data[i][nameIdx];
    if (!name) continue;
    const info = {
      fullName: String(name).trim(),
      email: String(data[i][emailIdx] || '').trim(),
      country: String(data[i][countryIdx] || '').trim(),
      active: data[i][situationIdx] === 'Active',
    };

    // Indexa por nome (normalizado)
    const nKey = nameKey_(info.fullName);
    if (nKey) byName[nKey] = info;

    // Indexa por cartão físico
    if (cardPhysIdx >= 0) {
      const cardP = data[i][cardPhysIdx];
      if (cardP) {
        const key = String(cardP).trim().replace(/^'/, '').replace(/\.0$/, '');
        if (key) byCard[key] = info;
      }
    }

    // Indexa por cartão virtual
    if (cardVirtIdx >= 0) {
      const cardV = data[i][cardVirtIdx];
      if (cardV) {
        const key = String(cardV).trim().replace(/^'/, '').replace(/\.0$/, '');
        if (key) byCard[key] = info;
      }
    }
  }

  return { byCard: byCard, byName: byName };
}


/**
 * Acha check-in mais próximo do driver (por email) na data da transação.
 * Versão da findCheckinForTransaction_ original, mas usando email direto
 * em vez de nome (eliminando uma camada de incerteza).
 */
function findCheckinByEmail_(email, txDate, checkinsByKey) {
  if (!email) return { lat: null, lng: null, status: 'no_driver', checkinDate: null };

  const txDateStr = Utilities.formatDate(txDate, 'America/Sao_Paulo', 'yyyy-MM-dd');

  // Tenta dia exato primeiro
  let key = email.toLowerCase() + '|' + txDateStr;
  if (checkinsByKey[key]) {
    return {
      lat: checkinsByKey[key].lat,
      lng: checkinsByKey[key].lng,
      status: 'exact',
      checkinDate: txDateStr,
    };
  }

  // Tenta ±1 dia, ±2 dias
  for (let offset of [-1, 1, -2, 2]) {
    const d = new Date(txDate);
    d.setDate(d.getDate() + offset);
    const dStr = Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd');
    key = email.toLowerCase() + '|' + dStr;
    if (checkinsByKey[key]) {
      return {
        lat: checkinsByKey[key].lat,
        lng: checkinsByKey[key].lng,
        status: 'nearby_' + (offset > 0 ? 'after' : 'before'),
        checkinDate: dStr,
      };
    }
  }

  return { lat: null, lng: null, status: 'no_checkin', checkinDate: null };
}

/**
 * Helper: normaliza nome pra match (lowercase, sem acentos, sem espaços extras).
 */
function nameKey_(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove acentos
    .replace(/[^a-z\s]/g, '')  // só letras e espaços
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Helper: parseia país do nome do department.
 * 'SVDO_Brazil_Ace' → 'Brazil'
 * 'SVDO_Mexico_Ace' → 'México' (com acento, igual ao usado no resto do sistema)
 * 'ACE_Admin' / 'LATAM' → 'LATAM'
 */
function parseCountryFromDept_(dept) {
  if (!dept) return 'LATAM';
  const m = String(dept).match(/SVDO_(\w+)_Ace/);
  if (m) {
    const c = m[1];
    if (c === 'Mexico') return 'México';
    return c;
  }
  return 'LATAM';
}

/**
 * Constrói índice de check-ins do período: { 'nameKey|date': {lat, lng, email, name} }
 */
function buildCheckinIndex_(startDate, endDate) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.checkinSheet);
  const index = {};
  if (!sheet || sheet.getLastRow() <= 1) return index;

  const start = new Date(startDate + 'T00:00:00-03:00');
  const end = new Date(endDate + 'T23:59:59-03:00');

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const ts = data[i][0];
    if (!(ts instanceof Date) || ts < start || ts > end) continue;

    const name = data[i][2];
    const email = data[i][3];
    const destLat = data[i][9];
    const destLng = data[i][10];
    if (!name || (!destLat && !destLng)) continue;

    const dateStr = Utilities.formatDate(ts, 'America/Sao_Paulo', 'yyyy-MM-dd');
    const key = nameKey_(name) + '|' + dateStr;
    // Mantém o mais recente do dia (caso tenha múltiplos check-ins)
    if (!index[key] || ts > index[key]._ts) {
      index[key] = {
        _ts: ts,
        lat: destLat,
        lng: destLng,
        email: email,
        name: name,
        dateStr: dateStr,
      };
    }
  }

  return index;
}

/**
 * Tenta achar check-in que corresponda a uma transação.
 *
 * Estratégia:
 * 1) Match exato por (nameKey + data da tx)
 * 2) Se não achar, tenta ±1 dia, ±2 dias (nearby)
 * 3) Se driver não tá em drivers ativos, retorna 'no_driver'
 */
function findCheckinForTransaction_(userName, txDate, driversByNameKey, checkinsByKey) {
  const userKey = nameKey_(userName);
  if (!userKey) {
    return { lat: null, lng: null, status: 'no_driver', email: null };
  }

  // Match driver pelo nome (tenta exato, depois primeiro+último nome só, depois substrings)
  let matchedDriver = driversByNameKey[userKey];
  let matchedKey = userKey;

  if (!matchedDriver) {
    // Tenta match parcial (primeiro nome + último nome do user)
    const parts = userKey.split(' ');
    if (parts.length >= 2) {
      const shortKey = parts[0] + ' ' + parts[parts.length - 1];
      matchedDriver = driversByNameKey[shortKey];
      if (matchedDriver) matchedKey = shortKey;
    }
  }

  if (!matchedDriver) {
    // Match por substring: primeiro nome do Ramp ⊂ algum driver
    const firstName = userKey.split(' ')[0];
    if (firstName && firstName.length >= 4) {
      for (const dKey in driversByNameKey) {
        if (dKey.includes(firstName) || firstName.includes(dKey.split(' ')[0])) {
          matchedDriver = driversByNameKey[dKey];
          matchedKey = dKey;
          break;
        }
      }
    }
  }

  if (!matchedDriver) {
    return { lat: null, lng: null, status: 'no_driver', email: null };
  }

  // Tenta match com check-in no mesmo dia
  const txDateStr = Utilities.formatDate(txDate, 'America/Sao_Paulo', 'yyyy-MM-dd');
  const exactKey = matchedKey + '|' + txDateStr;

  if (checkinsByKey[exactKey]) {
    const c = checkinsByKey[exactKey];
    return { lat: c.lat, lng: c.lng, status: 'exact', email: matchedDriver.email, checkinDate: c.dateStr };
  }

  // ±1, ±2 dias
  for (const offset of [-1, 1, -2, 2]) {
    const altDate = new Date(txDate);
    altDate.setDate(altDate.getDate() + offset);
    const altKey = matchedKey + '|' + Utilities.formatDate(altDate, 'America/Sao_Paulo', 'yyyy-MM-dd');
    if (checkinsByKey[altKey]) {
      const c = checkinsByKey[altKey];
      return { lat: c.lat, lng: c.lng, status: 'nearby', email: matchedDriver.email, checkinDate: c.dateStr };
    }
  }

  return { lat: null, lng: null, status: 'no_checkin', email: matchedDriver.email };
}


// ================================================================
// FUNÇÕES DE LEITURA — v3 (dados já calculados na mastersheet)
// ================================================================

/**
 * Lê Hotel Mode% por país da aba DASHBOARD (HM).
 *
 * Estrutura esperada na aba:
 *   Linha 3: headers (Country, ..., Hotel Mode%)
 *   Linhas 4-9: países (Argentina, Brazil, Chile, Colombia, México, Peru)
 *   Linha 10: SUM total LATAM
 *
 * Colunas (0-indexed):
 *   A(0) = Country
 *   C(2) = Active Drivers
 *   G(6) = Total Drivers
 *   H(7) = Salary SUM
 *   I(8) = Ramp Transactions
 *   L(11) = Total Direct Cost
 *   N(13) = Hotel Mode%
 */
function getHotelModeByCountry() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.dashboardHmSheet, ['DASHBOARD', 'Dashboard', 'Dashboard (HM)']);
  if (!sheet) return [];

  // Lê só as linhas 4 até 10 (países + SUM)
  const data = sheet.getRange(4, 1, 7, 14).getValues();
  const countries = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const countryName = row[0];
    if (!countryName) continue;

    countries.push({
      country: countryName,
      activeDrivers: row[2] || 0,
      totalDrivers: row[6] || 0,
      salarySum: row[7] || 0,
      rampTransactions: row[8] || 0,
      totalDirectCost: row[11] || 0,
      hotelModePct: row[13] || 0,
    });
  }

  return countries;
}

/**
 * Lê Monthly Hotel Mode Yes/No + TKM/Efficiency por driver da aba DASHBOARD (HM).
 *
 * Estrutura esperada:
 *   Linha 11: headers da tabela por driver
 *   Linha 12+: um driver por linha, até acabar
 *
 * Colunas (0-indexed):
 *   A(0) = Driver Full Name
 *   B(1) = Country
 *   C(2) = City
 *   E(4) = Email
 *   F(5) = Situation
 *   G(6) = Type
 *   H(7) = Paid Salary
 *   I(8) = Ramp Transactions
 *   L(11) = Total Direct Cost
 *   M(12) = BREAKEVEN TKM%
 *   N(13) = Monthly Hotel Mode (Yes/No)    [antigo]
 *   -- Colunas novas adicionadas à aba DASHBOARD (HM): --
 *   N(13) = TKM                             [novo: era Monthly Hotel Mode]
 *   O(14) = KM Driven                       [novo]
 *   P(15) = Efficiency (TKM / KM Driven)    [novo]
 *   Q(16) = Mapping Days                    [novo]
 *
 * IMPORTANTE: a coluna N "Monthly Hotel Mode" mudou de posição se o colega
 * adicionou TKM/Efficiency no meio. O código tenta detectar automaticamente
 * lendo os headers na linha 11 pra achar cada coluna pelo nome.
 */
function getHotelModeByDriver() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.dashboardHmSheet, ['DASHBOARD', 'Dashboard', 'Dashboard (HM)']);
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 12) return [];

  // Lê headers da linha 11 pra detectar posições dinamicamente
  const headers = sheet.getRange(11, 1, 1, lastCol).getValues()[0];
  const findCol = (name) => headers.findIndex(h => String(h || '').trim().toLowerCase() === name.toLowerCase());

  const nameIdx = findCol('Driver Full Name');
  const countryIdx = findCol('Country');
  const cityIdx = findCol('City');
  const emailIdx = findCol('Email');
  const situationIdx = findCol('Situation');
  const typeIdx = findCol('Type');
  const salaryIdx = findCol('Paid Salary');
  const rampIdx = findCol('Ramp Transactions');
  const costIdx = findCol('Total Direct Cost');
  const breakevenIdx = findCol('BREAKEVEN TKM%');
  // Hotel Mode pode ter vários nomes na planilha, tenta vários
  let hmMonthlyIdx = findCol('Monthly Hotel Mode');
  if (hmMonthlyIdx < 0) hmMonthlyIdx = findCol('Hotel Mode NOW');
  if (hmMonthlyIdx < 0) hmMonthlyIdx = findCol('HOTEL MODE THEN');
  if (hmMonthlyIdx < 0) hmMonthlyIdx = findCol('Hotel Mode');
  const tkmIdx = findCol('TKM');
  const kmDrivenIdx = findCol('KM Driven');
  const efficiencyIdx = findCol('Efficiency');
  const mappingDaysIdx = findCol('Mapping Days');

  // Lê da linha 12 até o fim, todas as colunas até lastCol
  const data = sheet.getRange(12, 1, lastRow - 11, lastCol).getValues();
  const drivers = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const name = nameIdx >= 0 ? row[nameIdx] : null;
    const email = emailIdx >= 0 ? row[emailIdx] : null;
    if (!name || !email) continue;

    drivers.push({
      name: name,
      country: countryIdx >= 0 ? row[countryIdx] : '',
      city: cityIdx >= 0 ? row[cityIdx] : '',
      email: email,
      situation: situationIdx >= 0 ? row[situationIdx] : '',
      type: typeIdx >= 0 ? row[typeIdx] : '',
      paidSalary: salaryIdx >= 0 ? safeNumber(row[salaryIdx]) : 0,
      rampTransactions: rampIdx >= 0 ? safeNumber(row[rampIdx]) : 0,
      totalDirectCost: costIdx >= 0 ? safeNumber(row[costIdx]) : 0,
      breakevenTkmPct: breakevenIdx >= 0 ? safeNumber(row[breakevenIdx]) : 0,
      hotelMode: hmMonthlyIdx >= 0 ? (row[hmMonthlyIdx] || 'No') : 'No',
      // Novos campos (colunas N, O, P, Q — se existirem)
      tkm: tkmIdx >= 0 ? safeNumber(row[tkmIdx]) : null,
      kmDriven: kmDrivenIdx >= 0 ? safeNumber(row[kmDrivenIdx]) : null,
      efficiency: efficiencyIdx >= 0 ? safeNumber(row[efficiencyIdx]) : null,
      mappingDays: mappingDaysIdx >= 0 ? safeNumber(row[mappingDaysIdx]) : null,
    });
  }

  return drivers;
}

/**
 * Lê CTS Goal vs Achieved mensal por país da aba CTS Goal Management.
 *
 * Colunas (0-indexed):
 *   A(0) = Period (ex: "1.2026" = Jan/2026)
 *   B(1) = Country
 *   C(2) = CTS Goal
 *   D(3) = Achived
 *   E(4) = Baseline
 *   F(5) = VID Required
 *   G(6) = Active Drivers
 *   H(7) = TKM Pending
 *   I(8) = Achived Percentage
 *   J(9) = Days Left
 *   K(10) = Average Required
 *   L(11) = Last Mapping Day Average (pode ser #DIV/0!)
 *   M(12) = Month Average
 *   N(13) = Last Mapping Day Drivers Active
 */
function getCtsGoals() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.ctsGoalSheet);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  const goals = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const period = row[0];
    const country = row[1];
    if (!period || !country) continue;

    goals.push({
      period: String(period),
      country: country,
      ctsGoal: safeNumber(row[2]),
      achieved: safeNumber(row[3]),
      baseline: safeNumber(row[4]),
      vidRequired: safeNumber(row[5]),
      activeDrivers: safeNumber(row[6]),
      tkmPending: safeNumber(row[7]),
      achievedPct: safeNumber(row[8]),
      daysLeft: safeNumber(row[9]),
      averageRequired: safeNumber(row[10]),
      lastMappingDayAverage: safeNumber(row[11]),
      monthAverage: safeNumber(row[12]),
      lastMappingDayDriversActive: safeNumber(row[13]),
    });
  }

  return goals;
}


/**
 * Lê resumo da aba DRIVER CALENDAR.
 *
 * Estrutura:
 *   Linha 3: headers do resumo por país
 *   Linhas 4-9: 6 países (Argentina, Brazil, Chile, Colombia, México, Peru)
 *   Linha 13: headers da tabela por driver
 *   Linhas 14+: drivers com TKM, KM, idle counts
 *
 * Retorna:
 *   {
 *     month, year,
 *     countries: [{country, tkmPrice, baseline, threshold, maximum, fleet}, ...],
 *     drivers:   [{name, country, email, tkm, kmDriven, mappingDays,
 *                  idlePersonal, idleDisks, idleMech, idleTech, idleWeather,
 *                  totalIdle}, ...]
 *   }
 */
function getDriverCalendar() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.driverCalendarSheet, ['DRIVER CALENDAR', 'Driver Calendar', 'Driver Monthly CALENDAR']);
  if (!sheet) return { countries: [], drivers: [], month: null, year: null };

  // Mês e ano do contexto (linha 2 col B, C)
  const month = safeNumber(sheet.getRange(2, 2).getValue());
  const year = safeNumber(sheet.getRange(2, 3).getValue());

  // Resumo por país (linhas 4-9)
  const countryData = sheet.getRange(4, 1, 6, 7).getValues();
  const countries = countryData
    .filter(row => row[0])
    .map(row => ({
      country: String(row[0]).trim(),
      tkmPrice: safeNumber(row[1]),
      baseline: safeNumber(row[2]),
      threshold: safeNumber(row[3]),
      maximum: safeNumber(row[4]),
      fleet: safeNumber(row[5]),
    }));

  // Tabela por driver (linhas 14+)
  const lastRow = sheet.getLastRow();
  if (lastRow < 14) return { countries, drivers: [], month, year };

  const driverData = sheet.getRange(14, 1, lastRow - 13, 11).getValues();
  const drivers = [];

  for (let i = 0; i < driverData.length; i++) {
    const row = driverData[i];
    if (!row[0]) continue;  // sem nome → ignora

    const idlePersonal = safeNumber(row[6]);
    const idleDisks = safeNumber(row[7]);
    const idleMech = safeNumber(row[8]);
    const idleTech = safeNumber(row[9]);
    const idleWeather = safeNumber(row[10]);

    drivers.push({
      name: String(row[0]).trim(),
      country: String(row[1] || '').trim(),
      email: String(row[2] || '').trim(),
      tkm: safeNumber(row[3]),
      kmDriven: safeNumber(row[4]),
      mappingDays: safeNumber(row[5]),
      idlePersonal: idlePersonal,
      idleDisks: idleDisks,
      idleMech: idleMech,
      idleTech: idleTech,
      idleWeather: idleWeather,
      totalIdle: idlePersonal + idleDisks + idleMech + idleTech + idleWeather,
    });
  }

  return { countries, drivers, month, year };
}


/**
 * Versão multi-mês de getDriverCalendar — agrega da aba RAW CTS DATA.
 * Permite gerar PDFs de meses passados (a aba DRIVER CALENDAR tem só o mês
 * corrente — ela é sobrescrita todo mês).
 *
 * @param {string} monthYear - formato 'M.YYYY' (ex: '4.2026' ou '11.2025')
 * @return mesma estrutura de getDriverCalendar()
 */
function getDriverCalendarByMonth_(monthYear) {
  const ctsIndex = buildRawCtsIndex_();

  // Reaproveita os meta-dados de countries da DRIVER CALENDAR (TKM Price,
  // Baseline, Threshold, Maximum, Fleet) — esses são "configuração" e não
  // mudam por mês. Vão na linhas 4-9.
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const dcSheet = getSheetWithFallback_(ss, CONFIG.driverCalendarSheet, ['DRIVER CALENDAR', 'Driver Calendar', 'Driver Monthly CALENDAR']);
  let countries = [];
  if (dcSheet) {
    const countryData = dcSheet.getRange(4, 1, 6, 7).getValues();
    countries = countryData
      .filter(row => row[0])
      .map(row => ({
        country: String(row[0]).trim(),
        tkmPrice: safeNumber(row[1]),
        baseline: safeNumber(row[2]),
        threshold: safeNumber(row[3]),
        maximum: safeNumber(row[4]),
        fleet: safeNumber(row[5]),
      }));
  }

  // Drivers: agrega RAW CTS pelo mês solicitado
  const drivers = [];
  for (const emailKey in ctsIndex) {
    const monthData = ctsIndex[emailKey][monthYear];
    if (!monthData) continue;

    const idle = monthData.idleDays;
    drivers.push({
      name: '',  // será preenchido abaixo via HR lookup
      country: monthData.country || '',
      email: emailKey,
      tkm: Math.round(monthData.tkm * 100) / 100,
      kmDriven: Math.round(monthData.km * 100) / 100,
      mappingDays: monthData.mappingDays,
      idlePersonal: idle.Personal || 0,
      idleDisks: idle.Disks || 0,
      idleMech: idle['Mech.'] || 0,
      idleTech: idle['Tech.'] || 0,
      idleWeather: idle.Weather || 0,
      totalIdle: idle.total || 0,
    });
  }

  // Preenche nomes a partir da HR DATABASE
  const hrSheet = ss.getSheetByName(CONFIG.hrSheet);
  if (hrSheet) {
    const hrData = hrSheet.getDataRange().getValues();
    const hrHeaders = hrData[0];
    const emailIdx = hrHeaders.indexOf('Corporate E-mail');
    const nameIdx = hrHeaders.indexOf('Beneficiary Full Name');
    const nameByEmail = {};
    for (let i = 1; i < hrData.length; i++) {
      const em = hrData[i][emailIdx];
      if (em) nameByEmail[String(em).toLowerCase()] = hrData[i][nameIdx];
    }
    drivers.forEach(d => {
      if (nameByEmail[d.email]) d.name = nameByEmail[d.email];
      else d.name = d.email;  // fallback: email como nome
    });
  }

  // Sort por TKM desc (mesmo padrão da função original)
  drivers.sort((a, b) => b.tkm - a.tkm);

  // Quebra month/year do formato 'M.YYYY'
  const [m, y] = monthYear.split('.').map(Number);

  return { countries, drivers, month: m, year: y };
}


/**
 * Retorna lista de meses disponíveis na RAW CTS DATA, em ordem decrescente
 * (mais recente primeiro). Usado pra popular o dropdown no PDF export.
 *
 * Retorna: ['5.2026', '4.2026', '3.2026', '2.2026', '1.2026']
 */
function getAvailableMonths_() {
  const ctsIndex = buildRawCtsIndex_();
  const months = new Set();
  for (const email in ctsIndex) {
    for (const m in ctsIndex[email]) {
      months.add(m);
    }
  }
  return Array.from(months).sort((a, b) => {
    const [ma, ya] = a.split('.').map(Number);
    const [mb, yb] = b.split('.').map(Number);
    return (yb - ya) || (mb - ma);
  });
}


/**
 * Lê resumo da aba VID CALENDAR.
 *
 * Estrutura:
 *   Linha 3: headers do resumo por país
 *   Linhas 4-9: 6 países com Fleet, Active VIDs, Non Active, Floating, QC Score
 *   Linha 13: headers da tabela por VID
 *   Linhas 14+: VIDs com Floating Car? Yes/No, Driver assigned, QC Score
 *
 * Retorna:
 *   {
 *     month, year,
 *     countries: [{country, fleet, activeVids, nonActiveVids, floatingCars,
 *                  notActivePerGoogle, avgTkm, avgKm, avgEfficiency, avgQcScore}, ...],
 *     vids:      [{vid, country, isFloating, tkm, kmDriven, efficiency,
 *                  mappingDays, currentDriver, qcScore, statusPerGoogle}, ...]
 *   }
 */
function getVidCalendar() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.vidCalendarSheet, ['VID CALENDAR', 'VID Calendar']);
  if (!sheet) return { countries: [], vids: [], month: null, year: null };

  const month = safeNumber(sheet.getRange(2, 2).getValue());
  const year = safeNumber(sheet.getRange(2, 3).getValue());

  // Resumo por país (linhas 4-9) — esses headers ficam fixos por enquanto
  const countryData = sheet.getRange(4, 1, 6, 11).getValues();
  const countries = countryData
    .filter(row => row[0])
    .map(row => ({
      country: String(row[0]).trim(),
      fleet: safeNumber(row[1]),
      baseline: safeNumber(row[2]),
      activeVids: safeNumber(row[3]),
      nonActiveVids: safeNumber(row[4]),
      floatingCars: safeNumber(row[5]),
      notActivePerGoogle: safeNumber(row[6]),
      avgTkm: safeNumber(row[7]),
      avgKm: safeNumber(row[8]),
      avgEfficiency: safeNumber(row[9]),
      avgQcScore: safeNumber(row[10]),
    }));

  // Tabela por VID (linhas 14+) — lookup dinâmico de colunas
  // (a ordem das colunas dessa tabela MUDA — já trocaram E/F)
  const lastRow = sheet.getLastRow();
  if (lastRow < 14) return { countries, vids: [], month, year };

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(13, 1, 1, lastCol).getValues()[0];
  const findCol = (...names) => {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim().toLowerCase();
      for (const n of names) {
        if (h === n.toLowerCase()) return i;
      }
    }
    return -1;
  };

  const idx = {
    vid: findCol('VID'),
    country: findCol('Country'),
    floating: findCol('Floating Car?', 'Floating'),
    tkm: findCol('TKM'),
    kmDriven: findCol('KM Driven', 'KM'),
    efficiency: findCol('Efficiency', 'Efficiancy'),  // ⚠ typo na planilha
    mappingDays: findCol('Mapping Days'),
    avgTkmPerDay: findCol('Average TKM Per Mapping Day', 'Avg TKM Per Day'),
    email: findCol('Current/Last Driver', 'Driver Email'),
    baselinePct: findCol('Baseline %', 'Baseline'),
    qcScore: findCol('QC Score'),
    status: findCol('Status Per Google', 'Status'),
  };

  const vidData = sheet.getRange(14, 1, lastRow - 13, lastCol).getValues();
  const safeGet = (row, i) => i >= 0 ? row[i] : null;
  const vids = [];

  for (let i = 0; i < vidData.length; i++) {
    const row = vidData[i];
    const vid = safeGet(row, idx.vid);
    if (!vid && vid !== 0) continue;

    vids.push({
      vid: vid,
      country: String(safeGet(row, idx.country) || '').trim(),
      isFloating: String(safeGet(row, idx.floating) || '').trim(),
      tkm: safeNumber(safeGet(row, idx.tkm)),
      kmDriven: safeNumber(safeGet(row, idx.kmDriven)),
      efficiency: safeNumber(safeGet(row, idx.efficiency)),
      mappingDays: safeNumber(safeGet(row, idx.mappingDays)),
      avgTkmPerDay: safeNumber(safeGet(row, idx.avgTkmPerDay)),
      currentDriver: String(safeGet(row, idx.email) || '').trim(),
      baselinePct: safeNumber(safeGet(row, idx.baselinePct)),
      qcScore: safeNumber(safeGet(row, idx.qcScore)),
      statusPerGoogle: String(safeGet(row, idx.status) || '').trim(),
    });
  }

  return { countries, vids, month, year };
}


/**
 * Converte valor numérico ou retorna 0 se for inválido (ex: #DIV/0!, null, texto).
 */
/**
 * Retorna lista agregada por dia+driver no range solicitado.
 * Pra cada linha de check-in/checkout, agrupa em uma única entrada
 * com horas trabalhadas + TKM + KM.
 *
 * Args:
 *   startDate: 'YYYY-MM-DD' (inclusive)
 *   endDate:   'YYYY-MM-DD' (inclusive)
 *
 * Retorna:
 *   [
 *     {date, driverName, driverEmail, country,
 *      checkinTime, checkoutTime, hoursWorked,
 *      tkmMapped, totalKmDriven, hasCheckin, notes},
 *     ...
 *   ]
 */
function getTimesheet(startDate, endDate) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.checkinSheet);
  if (!sheet || sheet.getLastRow() <= 1) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  // Parse dates pra Date objects (em SP timezone)
  const start = startDate ? new Date(startDate + 'T00:00:00-03:00') : new Date(0);
  const end = endDate ? new Date(endDate + 'T23:59:59-03:00') : new Date('9999-12-31');

  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const ts = row[0];                  // A: Timestamp
    const dateStr = row[1];             // B: Date
    const driverName = row[2];          // C: Driver Name
    const driverEmail = row[3];         // D: Driver Email
    const country = row[4];             // E: Country
    const notes = row[15];              // P: Notes (do check-in)

    // Colunas v5 (checkout): U=20, V=21, W=22, X=23, Y=24, Z=25, AA=26
    const checkoutTs = row[20];         // U: Checkout Timestamp
    const tkmMapped = row[23];          // X: TKM Mapped
    const totalKmDriven = row[24];      // Y: Total KM Driven
    const checkoutNotes = row[25];      // Z: Checkout Notes
    const hasCheckin = row[26];         // AA: Has Checkin

    // Filtra só linhas no range
    if (!(ts instanceof Date)) continue;
    if (ts < start || ts > end) continue;

    // Calcula horas trabalhadas
    let hoursWorked = '';
    let checkinTimeStr = '';
    let checkoutTimeStr = '';

    if (ts instanceof Date) {
      checkinTimeStr = Utilities.formatDate(ts, 'America/Sao_Paulo', 'HH:mm');
    }
    if (checkoutTs instanceof Date) {
      checkoutTimeStr = Utilities.formatDate(checkoutTs, 'America/Sao_Paulo', 'HH:mm');
      const diffMs = checkoutTs.getTime() - ts.getTime();
      if (diffMs > 0) {
        hoursWorked = Math.round((diffMs / 3600000) * 100) / 100; // 2 casas decimais
      }
    }

    // Combina notes (check-in + checkout) se ambos existirem
    let combinedNotes = '';
    if (notes) combinedNotes += String(notes);
    if (checkoutNotes) {
      if (combinedNotes) combinedNotes += ' | ';
      combinedNotes += 'Checkout: ' + String(checkoutNotes);
    }

    rows.push({
      date: String(dateStr || ''),
      driverName: String(driverName || ''),
      driverEmail: String(driverEmail || ''),
      country: String(country || ''),
      checkinTime: checkinTimeStr,
      checkoutTime: checkoutTimeStr,
      hoursWorked: hoursWorked,
      tkmMapped: safeNumber(tkmMapped),
      totalKmDriven: safeNumber(totalKmDriven),
      hasCheckin: String(hasCheckin || 'Yes'),
      notes: combinedNotes,
    });
  }

  // Ordena por data (asc), depois por nome do driver
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.driverName.localeCompare(b.driverName);
  });

  return rows;
}


// ================================================================
// v5.53: PAYROLL derivado do CHECK-IN — motor de horas "aprovadas"
// ----------------------------------------------------------------
// Deriva as horas da quinzena direto da aba Driver Daily Check-in,
// aplicando a regra tolerante combinada com o Lucas:
//   - Dia util (seg-sex; domingo conta como dia util se houver check-in):
//       target = 9h (Argentina) / 8h (demais paises)
//         * online (checkout - check-in) >= 6h              -> dia cheio (target)
//         * check-in SEM checkout (sem como medir o online) -> dia cheio (presenca)
//         * online > 0 e < 6h                               -> conta o online real
//   - Sabado com check-in -> 4h (>=3h online) / online real (<3h)
//   - Motorista ativo SEM nenhum check-in no periodo -> 0h (fica pro override manual)
// Salario base = horasAprovadas x rate (Per Hour Salary da HR).
// Constantes ajustaveis abaixo.
// ================================================================
const PAYROLL_WEEKDAY_TARGET_DEFAULT_ = 8;              // horas/dia (maioria dos paises)
const PAYROLL_WEEKDAY_9H_COUNTRIES_ = ['argentina'];   // paises com 9h/dia
const PAYROLL_WEEKDAY_MIN_ONLINE_ = 6;                 // >=6h online = dia cheio
const PAYROLL_SATURDAY_HOURS_ = 4;                     // sabado trabalhado
const PAYROLL_SATURDAY_MIN_ONLINE_ = 3;                // >=3h online no sabado = 4h

function countryWeekdayTarget_(country) {
  const c = String(country || '').trim().toLowerCase();
  return PAYROLL_WEEKDAY_9H_COUNTRIES_.indexOf(c) >= 0 ? 9 : PAYROLL_WEEKDAY_TARGET_DEFAULT_;
}

// Situacao "pagavel": exclui inativos; ativo/offboarding/vazio entram (fail-open).
function isPayableSituation_(sit) {
  const s = String(sit || '').trim().toLowerCase();
  if (!s) return true;
  return !/inactiv|inativ/.test(s);
}

// Quinzena "corrente" a partir de uma data ref (dia <=15 -> 1-15; senao 16-fim do mes).
function currentQuinzena_(ref) {
  const tz = 'America/Sao_Paulo';
  const d = ref || new Date();
  const y = Number(Utilities.formatDate(d, tz, 'yyyy'));
  const m = Number(Utilities.formatDate(d, tz, 'MM'));   // 1-12
  const day = Number(Utilities.formatDate(d, tz, 'dd'));
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const startDay = day <= 15 ? 1 : 16;
  const endDay = day <= 15 ? 15 : new Date(y, m, 0).getDate();  // dia 0 do mes seguinte = ultimo dia
  return { start: y + '-' + pad(m) + '-' + pad(startDay), end: y + '-' + pad(m) + '-' + pad(endDay) };
}

// Conta dias uteis (seg-sex) no periodo [start,end] inclusive — base da "quinzena cheia".
function countWeekdays_(start, end) {
  const s = start.split('-'), e = end.split('-');
  let d = new Date(Number(s[0]), Number(s[1]) - 1, Number(s[2]), 12, 0, 0);
  const last = new Date(Number(e[0]), Number(e[1]) - 1, Number(e[2]), 12, 0, 0);
  let n = 0;
  while (d <= last) { const w = d.getDay(); if (w >= 1 && w <= 5) n++; d.setDate(d.getDate() + 1); }
  return n;
}

function getPayrollCheckin_(startParam, endParam) {
  const tz = 'America/Sao_Paulo';
  let start = startParam, end = endParam;
  if (!start || !end) { const q = currentQuinzena_(); start = start || q.start; end = end || q.end; }
  const weekdays = countWeekdays_(start, end);   // dias uteis da quinzena (p/ quem nao tem check-in)

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const nkey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const round2 = n => Math.round(n * 100) / 100;

  // ---------- 1) roster HR: nome / email / pais / rate / situacao ----------
  const hrByEmail = {}, hrByName = {}, roster = [];
  const hrSheet = ss.getSheetByName(CONFIG.hrSheet);
  if (hrSheet && hrSheet.getLastRow() > 1) {
    const hd = hrSheet.getDataRange().getValues();
    const H = hd[0];
    const col = (...names) => {
      for (let i = 0; i < H.length; i++) {
        const h = String(H[i] || '').trim().toLowerCase();
        for (const n of names) if (h === n.toLowerCase()) return i;
      }
      return -1;
    };
    const iName = col('Beneficiary Full Name', 'Full Name', 'Driver Name', 'Name');
    const iEmail = col('Corporate E-mail', 'Email', 'Driver Email');
    const iCountry = col('Country');
    const iSit = col('Situation', 'Status', 'Driver Status');
    const iRate = col('Per Hour Salary (USD)', 'Per Hour Salary', 'Salary');
    for (let i = 1; i < hd.length; i++) {
      const row = hd[i];
      const name = iName >= 0 ? String(row[iName] || '').trim() : '';
      const email = iEmail >= 0 ? String(row[iEmail] || '').trim() : '';
      if (!name && !email) continue;
      const rec = {
        name: name, email: email,
        country: iCountry >= 0 ? String(row[iCountry] || '').trim() : '',
        rate: iRate >= 0 ? safeNumber(row[iRate]) : 0,
        situation: iSit >= 0 ? String(row[iSit] || '').trim() : '',
      };
      roster.push(rec);
      if (email) hrByEmail[email.toLowerCase()] = rec;
      if (name) hrByName[nkey(name)] = rec;
    }
  }

  // ---------- 2) horas por driver a partir do check-in/checkout ----------
  const startD = new Date(start + 'T00:00:00-03:00');
  const endD = new Date(end + 'T23:59:59-03:00');
  const byDriver = {};   // key -> { name, email, country, days: { 'yyyy-MM-dd': {dow, online} } }
  const sheet = ss.getSheetByName(CONFIG.checkinSheet);
  if (sheet && sheet.getLastRow() > 1) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const ts = row[0];                            // A: check-in timestamp
      if (!(ts instanceof Date)) continue;
      if (ts < startD || ts > endD) continue;
      const name = String(row[2] || '').trim();     // C: Driver Name
      const email = String(row[3] || '').trim();    // D: Driver Email
      const country = String(row[4] || '').trim();  // E: Country
      const checkoutTs = row[20];                    // U: checkout timestamp
      let online = null;
      if (checkoutTs instanceof Date) {
        const diff = checkoutTs.getTime() - ts.getTime();
        if (diff > 0) online = diff / 3600000;
      }
      const key = email ? 'e:' + email.toLowerCase() : (name ? 'n:' + nkey(name) : '');
      if (!key) continue;
      const dayStr = Utilities.formatDate(ts, tz, 'yyyy-MM-dd');
      const p = dayStr.split('-');
      const dow = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0).getDay(); // 0=Dom..6=Sab
      const drv = byDriver[key] || (byDriver[key] = { name: name, email: email, country: country, days: {} });
      if (!drv.name && name) drv.name = name;
      if (!drv.email && email) drv.email = email;
      if (!drv.country && country) drv.country = country;
      const prev = drv.days[dayStr];
      if (!prev) drv.days[dayStr] = { dow: dow, online: online };
      else if (online != null && (prev.online == null || online > prev.online)) prev.online = online;
    }
  }

  // ---------- 3) dias do periodo + calculadora por motorista (com auto-fill) ----------
  // Regra final (Lucas): TODO dia util (seg-sex) e dia cheio por padrao pra qualquer
  // ativo; o check-in so serve pra (a) somar sabado/domingo trabalhado e (b) cortar dia
  // com checkout curto (<6h online). Assim ninguem fica com hora faltando.
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const periodDays = [];
  {
    const s = start.split('-'), e = end.split('-');
    let dd = new Date(Number(s[0]), Number(s[1]) - 1, Number(s[2]), 12, 0, 0);
    const last = new Date(Number(e[0]), Number(e[1]) - 1, Number(e[2]), 12, 0, 0);
    while (dd <= last) {
      periodDays.push({ dayStr: dd.getFullYear() + '-' + pad(dd.getMonth() + 1) + '-' + pad(dd.getDate()), dow: dd.getDay() });
      dd.setDate(dd.getDate() + 1);
    }
  }

  const computeDriver = (country, dayMap, autofill) => {
    const target = countryWeekdayTarget_(country);
    let approved = 0, worked = 0, filled = 0, trimmed = 0, saturday = 0, sunday = 0;
    periodDays.forEach(pd => {
      const rec = dayMap[pd.dayStr];   // {dow, online} ou undefined
      let h = 0;
      if (pd.dow === 6) {                                             // sabado: so se trabalhou
        if (rec) { h = (rec.online == null || rec.online >= PAYROLL_SATURDAY_MIN_ONLINE_) ? PAYROLL_SATURDAY_HOURS_ : round2(rec.online); saturday++; }
      } else if (pd.dow === 0) {                                      // domingo: so se trabalhou
        if (rec) { h = (rec.online == null || rec.online >= PAYROLL_WEEKDAY_MIN_ONLINE_) ? target : round2(rec.online); sunday++; }
      } else {                                                        // seg-sex
        if (rec) {
          if (rec.online == null || rec.online >= PAYROLL_WEEKDAY_MIN_ONLINE_) { h = target; worked++; }
          else { h = round2(rec.online); trimmed++; }
        } else if (autofill) { h = target; filled++; }               // dia util sem check-in -> cheio
      }
      approved += h;
    });
    return { approved: round2(approved), breakdown: { worked: worked, filled: filled, trimmed: trimmed, saturday: saturday, sunday: sunday } };
  };
  const brkDays = b => b.worked + b.filled + b.trimmed + b.saturday + b.sunday;

  // ---------- 4) motoristas: roster ativo (auto-fill) + check-in orfao (so dias reais) ----------
  const drivers = [];
  const usedKeys = {};
  roster.forEach(r => {
    if (!isPayableSituation_(r.situation)) return;
    const kE = r.email ? 'e:' + r.email.toLowerCase() : '';
    const kN = r.name ? 'n:' + nkey(r.name) : '';
    const ci = (kE && byDriver[kE]) ? { k: kE, v: byDriver[kE] } : ((kN && byDriver[kN]) ? { k: kN, v: byDriver[kN] } : null);
    if (ci) usedKeys[ci.k] = true;
    const c = computeDriver(r.country, ci ? ci.v.days : {}, true);
    drivers.push({
      name: r.name, email: r.email, country: r.country, rate: r.rate, situation: r.situation,
      approvedHours: c.approved, daysWorked: brkDays(c.breakdown), basePay: round2(c.approved * r.rate),
      breakdown: c.breakdown, inHr: true, hasCheckin: !!ci, autofilled: c.breakdown.filled > 0,
    });
  });
  // check-in de gente fora do roster ativo (nao-HR ou inativo) -> conta so os dias registrados
  Object.keys(byDriver).forEach(key => {
    if (usedKeys[key]) return;
    const d = byDriver[key];
    const hr = (d.email && hrByEmail[d.email.toLowerCase()]) || (d.name && hrByName[nkey(d.name)]) || null;
    const country = (hr && hr.country) || d.country || '';
    const rate = hr ? hr.rate : 0;
    const c = computeDriver(country, d.days, false);
    drivers.push({
      name: (hr && hr.name) || d.name || '', email: d.email || (hr && hr.email) || '',
      country: country, rate: rate, situation: hr ? hr.situation : '',
      approvedHours: c.approved, daysWorked: brkDays(c.breakdown), basePay: round2(c.approved * rate),
      breakdown: c.breakdown, inHr: !!hr, hasCheckin: true, notRosterActive: true,
    });
  });

  drivers.sort((a, b) => (a.country || '').localeCompare(b.country || '') || (a.name || '').localeCompare(b.name || ''));

  // ---------- 5) camada de confirmacao: horas da aba "Timesheet" da MASTERSHEET ----------
  const tsMap = getTimesheetTabHours_();
  drivers.forEach(d => {
    const th = (d.email && tsMap.byEmail[d.email.toLowerCase()] != null) ? tsMap.byEmail[d.email.toLowerCase()]
             : ((d.name && tsMap.byName[nkey(d.name)] != null) ? tsMap.byName[nkey(d.name)] : null);
    d.timesheetHours = th;                                    // horas da aba Timesheet (2a fonte)
    d.timesheetDiff = (th != null) ? round2(d.approvedHours - th) : null;
  });

  return {
    success: true,
    version: 'v5.55',
    period: { start: start, end: end, weekdays: weekdays },
    rule: {
      autofillWeekdays: true, weekday9hCountries: PAYROLL_WEEKDAY_9H_COUNTRIES_,
      weekdayDefault: PAYROLL_WEEKDAY_TARGET_DEFAULT_, weekdayMinOnline: PAYROLL_WEEKDAY_MIN_ONLINE_,
      saturdayHours: PAYROLL_SATURDAY_HOURS_,
    },
    drivers: drivers,
  };
}

const ACE_SPREADSHEET_ID_ = '1tGQ9h2oSo7JMYKBtfHJqxhKgqSS-N5Lgg88s_RYebZM';

// Camada de confirmacao: horas quinzenais por driver lidas da aba "Timesheet" da MASTERSHEET.
// Reaproveita getTimesheetTab_ (headers+rows) e replica o auto-discovery do timesheet.html:
// soma as 2 ultimas colunas "Final Hours" (semana atual + anterior).
function getTimesheetTabHours_() {
  const out = { byEmail: {}, byName: {} };
  let t;
  try { t = getTimesheetTab_(); } catch (err) { return out; }
  if (!t || !t.success || !t.headers) return out;
  const headers = t.headers.map(h => String(h || '').toLowerCase().trim());
  const finalIdx = [];
  headers.forEach((h, i) => { if (h === 'final hours') finalIdx.push(i); });
  const findFirst = (...ps) => { for (const p of ps) { for (let i = 0; i < headers.length; i++) if (headers[i].indexOf(p) >= 0) return i; } return -1; };
  const iName = findFirst('worker full name', 'beneficiary', 'full name', 'driver name', 'nome');
  const iEmail = findFirst('corporate e-mail', 'corporate email', 'email', 'e-mail');
  const nkey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const num = v => {
    if (typeof v === 'number') return v;
    let s = String(v || '').trim().replace(/[^0-9.,\-]/g, '');
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) { s = (s.lastIndexOf(',') > s.lastIndexOf('.')) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''); }
    else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
    const n = parseFloat(s); return isNaN(n) ? 0 : n;
  };
  (t.rows || []).forEach(r => {
    const name = iName >= 0 ? String(r[iName] || '').trim() : '';
    const email = iEmail >= 0 ? String(r[iEmail] || '').trim() : '';
    if (!name && !email) return;
    let hq = 0;
    if (finalIdx.length >= 3) hq = num(r[finalIdx[1]]) + num(r[finalIdx[2]]);
    else if (finalIdx.length) hq = num(r[finalIdx[finalIdx.length - 1]]);
    if (email) out.byEmail[email.toLowerCase()] = hq;
    if (name) out.byName[nkey(name)] = hq;
  });
  return out;
}

// ================================================================
// v5.55: WRITER da ACE — escreve as horas calculadas na coluna "Hrs Worked"
// da aba REAL da quinzena na planilha "LATAM Timesheet ACE" (id acima),
// casando cada pessoa por NOME (os emails da ACE sao do lado CTS != check-in).
// Escreve SO a coluna de totais "Hrs Worked" das linhas que casam — nao toca
// no resto da aba nem nas colunas diarias.
// GET ?action=writeAceHours&tab=<nome exato da aba>&start=&end=&confirm=1
//   - sem &tab   -> devolve a lista de abas da ACE pra voce escolher
//   - sem confirm=1 -> DRY-RUN (mostra o que gravaria, NAO grava)
// ================================================================
function writeAceHours_(tabName, startParam, endParam, confirm) {
  const res = getPayrollCheckin_(startParam, endParam);
  if (!res.success) return res;

  let ace;
  try { ace = SpreadsheetApp.openById(ACE_SPREADSHEET_ID_); }
  catch (err) { return { success: false, error: 'Sem acesso de edicao a ACE (' + ACE_SPREADSHEET_ID_ + '): ' + err }; }

  const tabs = ace.getSheets().map(s => s.getName());
  if (!tabName) return { success: false, needTab: true, error: 'Passe &tab=<nome exato da aba da quinzena>.', tabs: tabs };
  const sh = ace.getSheetByName(tabName);
  if (!sh) return { success: false, error: 'Aba nao encontrada: "' + tabName + '"', tabs: tabs };

  const values = sh.getDataRange().getValues();
  const nkey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const isWorked = h => { const x = h.replace(/[\s.]/g, ''); return x === 'hrsworked' || x === 'hoursworked'; };

  // acha o cabecalho do bloco de totais: linha com "Name/Beneficiary" + "Hrs Worked" (1a ocorrencia = totais)
  let hdrRow = -1, nameCol = -1, workedCol = -1;
  for (let i = 0; i < Math.min(values.length, 40); i++) {
    const rowL = values[i].map(c => String(c || '').trim().toLowerCase());
    const nc = rowL.findIndex(h => h === 'name' || h === 'nome' || h === 'full name' || h === 'driver name' || h.indexOf('beneficiary') >= 0);
    let wc = -1;
    for (let j = 0; j < rowL.length; j++) { if (isWorked(rowL[j])) { wc = j; break; } }
    if (nc >= 0 && wc >= 0) { hdrRow = i; nameCol = nc; workedCol = wc; break; }
  }
  if (hdrRow < 0) return { success: false, error: 'Nao achei cabecalho com "Name" + "Hrs Worked" na aba "' + tabName + '" (primeiras 40 linhas).', tabs: tabs };

  const byName = {};
  res.drivers.forEach(d => { if (d.name) byName[nkey(d.name)] = d; });

  const plan = [];
  const usedNames = {};
  for (let i = hdrRow + 1; i < values.length; i++) {
    const nm = String(values[i][nameCol] || '').trim();
    if (!nm) continue;
    const d = byName[nkey(nm)];
    if (!d) { plan.push({ row: i + 1, name: nm, matched: false }); continue; }
    usedNames[nkey(nm)] = true;
    plan.push({ row: i + 1, name: nm, matched: true, oldVal: values[i][workedCol], newVal: d.approvedHours, timesheetHours: d.timesheetHours });
  }
  const matches = plan.filter(p => p.matched);
  const computedNotInTab = res.drivers.filter(d => d.name && !usedNames[nkey(d.name)]).map(d => ({ name: d.name, country: d.country, computed: d.approvedHours }));

  let written = 0;
  const doWrite = String(confirm) === '1';
  if (doWrite) { matches.forEach(p => { sh.getRange(p.row, workedCol + 1).setValue(p.newVal); written++; }); }

  return {
    success: true, version: 'v5.55', dryRun: !doWrite,
    tab: tabName, period: res.period,
    headerRow: hdrRow + 1, nameCol: nameCol + 1, hrsWorkedCol: workedCol + 1,
    matched: matches.length, written: written,
    unmatchedInTab: plan.filter(p => !p.matched).map(p => p.name),
    computedNotInTab: computedNotInTab,
    preview: matches.slice(0, 12).map(p => ({ name: p.name, de: p.oldVal, para: p.newVal, timesheet: p.timesheetHours })),
  };
}

// v5.56: WRITER manual — grava horas JA DECIDIDAS na pagina payroll (apos revisao/edicao
// dos outliers) na coluna "Hrs Worked" da aba da ACE. POST { tab, rows:[{name,hours}], confirm }.
// Casa por NOME; sem confirm=1 = DRY-RUN. So super admin (checado no doPost).
function writeAceHoursManual_(data) {
  const tabName = data.tab;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const doWrite = String(data.confirm) === '1';
  if (!tabName) return { success: false, error: 'Parametro "tab" obrigatorio.' };
  if (!rows.length) return { success: false, error: 'Nenhuma linha para gravar.' };

  let ace;
  try { ace = SpreadsheetApp.openById(ACE_SPREADSHEET_ID_); }
  catch (err) { return { success: false, error: 'Sem acesso de edicao a ACE: ' + err }; }
  const sh = ace.getSheetByName(tabName);
  if (!sh) return { success: false, error: 'Aba nao encontrada: "' + tabName + '"', tabs: ace.getSheets().map(s => s.getName()) };

  const values = sh.getDataRange().getValues();
  const nkey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const isWorked = h => { const x = h.replace(/[\s.]/g, ''); return x === 'hrsworked' || x === 'hoursworked'; };
  let hdrRow = -1, nameCol = -1, workedCol = -1;
  for (let i = 0; i < Math.min(values.length, 40); i++) {
    const rowL = values[i].map(c => String(c || '').trim().toLowerCase());
    const nc = rowL.findIndex(h => h === 'name' || h === 'nome' || h === 'full name' || h === 'driver name' || h.indexOf('beneficiary') >= 0);
    let wc = -1;
    for (let j = 0; j < rowL.length; j++) { if (isWorked(rowL[j])) { wc = j; break; } }
    if (nc >= 0 && wc >= 0) { hdrRow = i; nameCol = nc; workedCol = wc; break; }
  }
  if (hdrRow < 0) return { success: false, error: 'Cabecalho "Name" + "Hrs Worked" nao achado na aba "' + tabName + '".' };

  // v5.57: colunas Reimbursment / Deduction do bloco de totais (mesma linha de cabecalho)
  const hdr = values[hdrRow].map(c => String(c || '').trim().toLowerCase());
  let reimbCol = -1, dedCol = -1;
  for (let j = 0; j < hdr.length; j++) {
    if (reimbCol < 0 && /reimburs/.test(hdr[j])) reimbCol = j;   // "Reimbursment"/"Reimbursement"
    if (dedCol < 0 && /deduc/.test(hdr[j])) dedCol = j;          // "Deduction"/"Deduccion"
  }

  const byName = {};
  rows.forEach(r => {
    if (r && r.name != null) byName[nkey(r.name)] = { hours: Number(r.hours) || 0, reimb: Number(r.reimb) || 0, ded: Number(r.ded) || 0 };
  });

  const plan = [];
  const used = {};
  for (let i = hdrRow + 1; i < values.length; i++) {
    const nm = String(values[i][nameCol] || '').trim();
    if (!nm) continue;
    const k = nkey(nm);
    if (Object.prototype.hasOwnProperty.call(byName, k)) {
      const rr = byName[k]; used[k] = true;
      plan.push({ row: i + 1, name: nm, oldVal: values[i][workedCol], hours: rr.hours, reimb: rr.reimb, ded: rr.ded });
    }
  }
  // Grava horas sempre; reembolso/desconto SO quando ha valor no nosso sistema (nao zera
  // a coluna de quem nao tem, pra nao apagar o que o time ja pos a mao na ACE).
  let written = 0, reimbWritten = 0, dedWritten = 0;
  if (doWrite) {
    plan.forEach(p => {
      sh.getRange(p.row, workedCol + 1).setValue(p.hours); written++;
      if (reimbCol >= 0 && p.reimb) { sh.getRange(p.row, reimbCol + 1).setValue(p.reimb); reimbWritten++; }
      if (dedCol >= 0 && p.ded) { sh.getRange(p.row, dedCol + 1).setValue(p.ded); dedWritten++; }
    });
  }
  const notInTab = rows.filter(r => r && r.name && !used[nkey(r.name)]).map(r => r.name);

  return {
    success: true, version: 'v5.57', dryRun: !doWrite, tab: tabName,
    headerRow: hdrRow + 1, hrsWorkedCol: workedCol + 1,
    reimbCol: reimbCol >= 0 ? reimbCol + 1 : null, dedCol: dedCol >= 0 ? dedCol + 1 : null,
    matched: plan.length, written: written, reimbWritten: reimbWritten, dedWritten: dedWritten, notInTab: notInTab,
    preview: plan.slice(0, 15).map(p => ({ name: p.name, de: p.oldVal, para: p.hours, reimb: p.reimb || 0, ded: p.ded || 0 })),
  };
}


/**
 * v5.35: leitura da aba "Timesheet" (payroll page).
 * Pula linhas de metadata e identifica a linha com "Worker Full Name" como header.
 * Retorna apenas as primeiras 25 colunas (info principal por driver — sem os 1000+ cols
 * de dados diários que estouram payload).
 *
 * v5.36: extrai metadata (Next/Last Payroll Day + Week numbers) das linhas acima do header
 * pra que o frontend possa mostrar o período da quinzena.
 *
 * Formato:
 *   { success: true, headers: [...], rows: [[...], ...], sheetName: 'Timesheet',
 *     metadata: { nextPayrollDay, lastPayrollDay, currentWeek, nextPayrollWeek } }
 */
function getTimesheetTab_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.timesheetTabSheet, ['TIMESHEET', 'Payroll', 'PAYROLL', 'Folha de Ponto']);
  if (!sheet) {
    return { success: false, error: 'Aba "' + CONFIG.timesheetTabSheet + '" não encontrada' };
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    return { success: true, headers: [], rows: [], sheetName: sheet.getName(), metadata: {} };
  }

  const SCAN_COLS = Math.min(lastCol, 30);
  const SCAN_ROWS = Math.min(lastRow, 20);
  const scanData = sheet.getRange(1, 1, SCAN_ROWS, SCAN_COLS).getValues();

  let headerRowIdx = -1;
  const headerRe = /worker full name|beneficiary.*name|full name|driver name|nome.*funcion/i;
  for (let i = 0; i < scanData.length; i++) {
    const firstCell = String(scanData[i][0] || '').trim();
    if (headerRe.test(firstCell)) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) headerRowIdx = 0;

  // v5.36: extrai metadata escaneando as linhas acima do header
  // Procura labels conhecidos e pega o valor da MESMA col em alguma linha abaixo
  const metadata = {};
  const labelMap = [
    { re: /next payroll day/i, key: 'nextPayrollDay', type: 'date' },
    { re: /last payroll day/i, key: 'lastPayrollDay', type: 'date' },
    { re: /next payroll week/i, key: 'nextPayrollWeek', type: 'number' },
    { re: /current week/i, key: 'currentWeek', type: 'number' },
  ];
  for (let i = 0; i < headerRowIdx; i++) {
    for (let j = 0; j < SCAN_COLS; j++) {
      const cellStr = String(scanData[i][j] || '').trim();
      if (!cellStr) continue;
      for (const lm of labelMap) {
        if (metadata[lm.key]) continue; // já encontrou
        if (!lm.re.test(cellStr)) continue;
        // procura valor em linhas abaixo na mesma coluna
        for (let k = i + 1; k < headerRowIdx; k++) {
          const v = scanData[k][j];
          if (v === null || v === undefined || v === '') continue;
          if (lm.type === 'date') {
            if (v instanceof Date) {
              metadata[lm.key] = Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd');
              break;
            } else if (typeof v === 'string' && v.match(/\d/)) {
              metadata[lm.key] = v;
              break;
            }
          } else if (lm.type === 'number') {
            if (typeof v === 'number' && v > 0) {
              metadata[lm.key] = v;
              break;
            }
          }
        }
      }
    }
  }

  const MAX_OUT_COLS = Math.min(SCAN_COLS, 25);
  const headersRaw = scanData[headerRowIdx].slice(0, MAX_OUT_COLS);
  const headers = headersRaw.map(h => {
    if (h instanceof Date) {
      return Utilities.formatDate(h, 'America/Sao_Paulo', 'yyyy-MM-dd');
    }
    return String(h || '').trim();
  });

  let rows = [];
  const dataStartRow = headerRowIdx + 2; // 1-indexed
  if (lastRow >= dataStartRow) {
    const raw = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, MAX_OUT_COLS).getValues();
    rows = raw.map(r => r.map(cell => {
      if (cell instanceof Date) {
        return Utilities.formatDate(cell, 'America/Sao_Paulo', 'yyyy-MM-dd');
      }
      if (cell === null || cell === undefined) return '';
      return cell;
    }));
    rows = rows.filter(r => r[0] && String(r[0]).trim() !== '');
  }

  return {
    success: true,
    sheetName: sheet.getName(),
    headers: headers,
    rows: rows,
    metadata: metadata,
  };
}


// ================================================================
// PAYROLL ADJUSTMENTS (v5.40)
// ================================================================
/**
 * Ajustes de payroll (reembolsos, bônus, descontos) lançados pelo super admin
 * no timesheet.html. Como o timesheet virou fonte do financeiro, os ajustes
 * ficam numa aba auditável da Mastersheet (não em ScriptProperties), com quem
 * lançou, quando, qual driver e qual quinzena.
 *
 * Aba "Payroll Adjustments" (auto-criada na primeira escrita):
 *   ID | Timestamp | Added By | Quinzena (Pay Date) | Driver Name | Driver Email |
 *   Country | Category | Amount (USD) | Note | Status
 *
 * - Amount já vem assinado (descontos chegam negativos do frontend).
 * - Status: 'active' | 'deleted' (soft-delete preserva trilha de auditoria).
 */
const PAYROLL_ADJ_HEADERS = ['ID', 'Timestamp', 'Added By', 'Quinzena (Pay Date)',
  'Driver Name', 'Driver Email', 'Country', 'Category', 'Amount (USD)', 'Note', 'Status'];
const PAYROLL_ADJ_STATUS_COL = 11; // col K (1-indexed)

function getOrCreatePayrollAdjustmentsSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  let sheet = ss.getSheetByName(CONFIG.payrollAdjustmentsSheet);
  if (sheet) return sheet;
  sheet = ss.insertSheet(CONFIG.payrollAdjustmentsSheet);
  sheet.appendRow(PAYROLL_ADJ_HEADERS);
  sheet.getRange(1, 1, 1, PAYROLL_ADJ_HEADERS.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Lista ajustes ativos. Se quinzena (YYYY-MM-DD) for passada, filtra só os dela.
 * Retorna { success, adjustments: [{id, timestamp, addedBy, quinzena,
 *   driverName, driverEmail, country, category, amount, note}] }.
 */
function getPayrollAdjustments_(quinzena) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.payrollAdjustmentsSheet);
  if (!sheet || sheet.getLastRow() < 2) {
    return { success: true, adjustments: [] };
  }
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, PAYROLL_ADJ_HEADERS.length).getValues();
  const qFilter = String(quinzena || '').trim();
  const adjustments = [];
  data.forEach(function (r) {
    const status = String(r[10] || '').trim().toLowerCase();
    if (status === 'deleted') return;
    let q = r[3];
    if (q instanceof Date) q = Utilities.formatDate(q, 'America/Sao_Paulo', 'yyyy-MM-dd');
    else q = String(q || '').trim();
    if (qFilter && q !== qFilter) return;
    let ts = r[1];
    if (ts instanceof Date) ts = ts.toISOString();
    adjustments.push({
      id: String(r[0] || ''),
      timestamp: String(ts || ''),
      addedBy: String(r[2] || ''),
      quinzena: q,
      driverName: String(r[4] || ''),
      driverEmail: String(r[5] || ''),
      country: String(r[6] || ''),
      category: String(r[7] || ''),
      amount: Number(r[8]) || 0,
      note: String(r[9] || ''),
    });
  });
  return { success: true, adjustments: adjustments };
}

/**
 * Salva um ajuste novo. Permissão já validada no doPost (super admin).
 * data: { actorUsername, quinzena, driverName, driverEmail, country, category, amount, note }
 */
function savePayrollAdjustment_(data) {
  const name = String(data.driverName || '').trim();
  if (!name) return { success: false, error: 'driverName obrigatório' };
  const amount = Number(data.amount);
  if (!isFinite(amount) || amount === 0) return { success: false, error: 'amount inválido' };
  const category = String(data.category || '').trim();
  if (!category) return { success: false, error: 'category obrigatória' };
  const quinzena = String(data.quinzena || '').trim();

  const sheet = getOrCreatePayrollAdjustmentsSheet_();
  const id = 'ADJ-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const now = new Date();
  const driverEmail = String(data.driverEmail || '').trim();
  const country = String(data.country || '').trim();
  const note = String(data.note || '').trim();

  sheet.appendRow([
    id, now, String(data.actorUsername || ''), quinzena,
    name, driverEmail, country, category, amount, note, 'active',
  ]);

  return {
    success: true,
    adjustment: {
      id: id, timestamp: now.toISOString(), addedBy: String(data.actorUsername || ''),
      quinzena: quinzena, driverName: name, driverEmail: driverEmail,
      country: country, category: category, amount: amount, note: note,
    },
  };
}

/**
 * Soft-delete: marca Status='deleted' pra preservar auditoria.
 * data: { actorUsername, id }
 */
function deletePayrollAdjustment_(data) {
  const id = String(data.id || '').trim();
  if (!id) return { success: false, error: 'id obrigatório' };
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.payrollAdjustmentsSheet);
  if (!sheet || sheet.getLastRow() < 2) return { success: false, error: 'nenhum ajuste encontrado' };
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === id) {
      sheet.getRange(i + 2, PAYROLL_ADJ_STATUS_COL).setValue('deleted');
      return { success: true };
    }
  }
  return { success: false, error: 'id não encontrado' };
}


/**
 * Pega aba do spreadsheet tentando o nome principal e nomes alternativos
 * (renomeações comuns). Loga warning se cair no fallback. Retorna null
 * se nenhum nome bater (e loga error).
 *
 * @param {Spreadsheet} ss
 * @param {string} primaryName  - nome esperado (CONFIG.xxxSheet)
 * @param {string[]} fallbacks  - nomes alternativos pra tentar
 * @return {Sheet|null}
 */
function getSheetWithFallback_(ss, primaryName, fallbacks) {
  let sheet = ss.getSheetByName(primaryName);
  if (sheet) return sheet;

  // Tenta fallbacks
  for (let i = 0; i < (fallbacks || []).length; i++) {
    sheet = ss.getSheetByName(fallbacks[i]);
    if (sheet) {
      Logger.log('⚠ Aba "' + primaryName + '" não encontrada — usando fallback "' + fallbacks[i] + '". Atualize CONFIG.');
      return sheet;
    }
  }

  // Tenta busca insensível a maiúsculas (último recurso)
  const allSheets = ss.getSheets();
  const primaryLower = primaryName.toLowerCase();
  for (let i = 0; i < allSheets.length; i++) {
    if (allSheets[i].getName().toLowerCase() === primaryLower) {
      Logger.log('⚠ Aba "' + primaryName + '" achada com case diferente: "' + allSheets[i].getName() + '"');
      return allSheets[i];
    }
  }

  Logger.log('✗ Aba "' + primaryName + '" não encontrada. Disponíveis: ' +
    allSheets.map(s => s.getName()).join(', '));
  return null;
}


function safeNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'string' && v.startsWith('#')) return 0;  // Excel errors
  if (typeof v === 'string' && /^-?[\d.]+,\d+$/.test(v.trim())) {
    v = v.trim().replace(/\./g, '').replace(',', '.');  // '1.234,56' / '0,57' → decimal pt-BR como texto
  }
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}


// ================================================================
// FUNÇÕES DE ESCRITA (gravação de check-ins)
// ================================================================

function saveCheckin(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.checkinSheet);
  ensureCheckinExtraColumns_(sheet);  // v5.14: garante AB-AD (odômetro inicial + SSD)
  ensureDnmColumns_(sheet);           // v5.17: garante AG-AH (Did Map flag + DNM Reason)

  const today = new Date();
  const dateStr = Utilities.formatDate(today, 'America/Sao_Paulo', 'yyyy-MM-dd');

  // v5.17: se driver não vai mapear, dist=0 (não há destino real)
  const isDnm = data.didMap === 'no';

  const distOriginToCenter = isDnm ? 0 : calcDistanceKm(data.originLat, data.originLng, data.destLat, data.destLng);
  const distOriginToEdge = (!isDnm && distOriginToCenter != null)
    ? Math.max(0, Math.round((distOriginToCenter - (data.destRadius || 0)) * 10) / 10)
    : '';

  const base = getDriverBase(data.driverEmail);
  let distBaseToCenter = '';
  let distBaseToEdge = '';
  if (!isDnm && base && base.lat && base.lng) {
    distBaseToCenter = calcDistanceKm(base.lat, base.lng, data.destLat, data.destLng);
    if (distBaseToCenter != null) {
      distBaseToEdge = Math.max(0, Math.round((distBaseToCenter - (data.destRadius || 0)) * 10) / 10);
    }
  }

  // Linha: 27 cols originais (A-AA) + 3 v5.14 (AB-AD) + 2 v5.14 checkout (AE-AF) + 2 v5.17 DNM (AG-AH) = 34
  // AG(33)=Did Map flag, AH(34)=DNM Reason
  const row = new Array(34).fill('');
  row[0] = today;
  row[1] = dateStr;
  row[2] = data.driverName;
  row[3] = data.driverEmail;
  row[4] = data.country;
  row[5] = data.originLat;
  row[6] = data.originLng;
  row[7] = data.originAddress;
  row[8] = data.originMethod;
  row[9] = data.destLat;
  row[10] = data.destLng;
  row[11] = data.destAddress;
  row[12] = data.destRadius || '';
  row[13] = data.vehicleStatus;
  row[14] = data.vehicleIssue || '';
  row[15] = data.notes || '';
  row[16] = distOriginToCenter;
  row[17] = distOriginToEdge;
  row[18] = distBaseToCenter;
  row[19] = distBaseToEdge;
  // 20-26 = colunas de checkout (vazias nesse momento)
  // 27 = AB Odometer Start
  row[27] = safeNumber(data.odometerStart);
  // 28 = AC SSD In Use
  row[28] = data.ssdInUse || '';
  // 29 = AD SSD Source ('dropdown' ou 'manual')
  row[29] = data.ssdSource || '';
  // 30, 31 = AE/AF (checkout extras, não preenchidos no check-in)
  // v5.17: DNM flags
  row[32] = data.didMap || 'yes';   // AG: 'yes' | 'no'
  row[33] = data.dnmReason || '';   // AH: 'weather' | 'mech' | 'tech' | 'disks' | ''

  // v5.37: insere no topo (logo abaixo do header) em vez de no fim — mais recente em cima
  insertRowAt_(sheet, 2, row);

  // Se foi reportado vehicle issue com detalhes, também grava em Vehicle Issues Tracking
  // v5.17: pra DNM com motivo mech/tech/disks também cria issue (clima não cria)
  const shouldCreateIssue = data.vehicleStatus && data.vehicleStatus !== 'OK' && data.vehicleIssueDetails
    && (!isDnm || data.dnmReason !== 'weather');

  if (shouldCreateIssue) {
    try {
      saveVehicleIssue_({
        driverEmail: data.driverEmail,
        driverName: data.driverName,
        country: data.country,
        severity: data.vehicleStatus,  // 'Minor Issue' ou 'Critical Issue'
        description: data.vehicleIssue || '',
        ...data.vehicleIssueDetails,   // category, stopDate, serviceStatus, expectedEndDate, endStatus
      });
    } catch (e) {
      Logger.log('Erro salvando vehicle issue do check-in: ' + e);
    }
  }
}

function saveBase(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.baseSheet);

  sheet.appendRow([
    new Date(), data.driverEmail, data.driverName, data.baseType,
    data.baseAddress, data.baseLat, data.baseLng, data.country, data.notes || '',
  ]);
}

/**
 * Edição administrativa de driver vinda do painel Admin do dashboard.
 *
 * Atualmente edita 3 coisas:
 * - Base type (Home/Hotel/Mixed) + endereço/coordenadas → cria nova linha
 *   em Driver Base Location (mesmo padrão do saveBase original do checkin)
 * - Email do driver → atualiza coluna Email da DASHBOARD (HM)
 *   (procura linha pelo nome completo, usa lookup dinâmico de header)
 * - Notas administrativas → guardadas na nova linha de Driver Base Location
 *
 * Espera no payload:
 *   editorUsername, editorName  (pra audit log)
 *   driverName, driverEmail (atual)
 *   newEmail (opcional, se vazio mantém o atual)
 *   baseType, baseAddress, baseLat, baseLng (todos opcionais)
 *   notes (opcional)
 *   country
 */
function updateDriverInfo(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

  // 1) Sempre cria nova linha em Driver Base Location se houver mudança de base
  const baseSheet = ss.getSheetByName(CONFIG.baseSheet);
  const hasBaseUpdate = data.baseType || data.baseAddress;

  let baseUpdateMsg = '';
  if (hasBaseUpdate && baseSheet) {
    baseSheet.appendRow([
      new Date(),
      data.newEmail || data.driverEmail,
      data.driverName,
      data.baseType || '',
      data.baseAddress || '',
      data.baseLat || '',
      data.baseLng || '',
      data.country || '',
      'Admin edit by ' + (data.editorName || data.editorUsername || 'unknown') +
        (data.notes ? ' — ' + data.notes : ''),
    ]);
    baseUpdateMsg = 'Base atualizada. ';
  }

  // 2) Se mudou o email, atualiza na DASHBOARD (HM)
  let emailUpdateMsg = '';
  if (data.newEmail && data.newEmail !== data.driverEmail) {
    const hmSheet = getSheetWithFallback_(ss, CONFIG.dashboardHmSheet, ['DASHBOARD', 'Dashboard', 'Dashboard (HM)']);
    if (hmSheet) {
      const lastRow = hmSheet.getLastRow();
      const headers = hmSheet.getRange(11, 1, 1, hmSheet.getLastColumn()).getValues()[0];
      const nameIdx = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'driver full name');
      const emailIdx = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'email');

      if (nameIdx >= 0 && emailIdx >= 0) {
        const dataRange = hmSheet.getRange(12, 1, lastRow - 11, hmSheet.getLastColumn()).getValues();
        for (let i = 0; i < dataRange.length; i++) {
          if (String(dataRange[i][nameIdx]).trim() === data.driverName) {
            // Atualiza email nessa linha
            hmSheet.getRange(12 + i, emailIdx + 1).setValue(data.newEmail);
            emailUpdateMsg = 'Email atualizado de ' + data.driverEmail + ' para ' + data.newEmail + '. ';
            break;
          }
        }
      }
    }
  }

  // 3) Audit log no Logger (aparece em Apps Script → Execuções)
  Logger.log('[ADMIN EDIT] ' + (data.editorName || 'unknown') + ' editou ' + data.driverName +
             ': ' + baseUpdateMsg + emailUpdateMsg);

  return {
    mode: 'updated',
    message: (baseUpdateMsg + emailUpdateMsg) || 'Nenhuma mudança aplicada',
  };
}

/**
 * Registra fim de expediente do driver.
 *
 * Lógica:
 * - Procura linha de check-in DO MESMO DRIVER NO MESMO DIA (mais recente)
 * - Se achar: atualiza essa linha com colunas U-AA (checkout data)
 *             e marca "Has Checkin" = "Yes"
 * - Se não achar: cria linha nova só com dados de checkout
 *                 e marca "Has Checkin" = "No" (alerta no dashboard)
 *
 * Espera no payload:
 *   driverEmail, driverName, country,
 *   checkoutLat, checkoutLng,
 *   tkmMapped, totalKmDriven,
 *   notes (opcional)
 */
function saveCheckout(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.checkinSheet);
  ensureCheckoutColumns(sheet);
  ensureCheckinExtraColumns_(sheet);  // v5.14: AB-AD pra check-in extras
  ensureCheckoutExtraColumns_(sheet); // v5.14: AE-AF pra checkout extras

  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'America/Sao_Paulo', 'yyyy-MM-dd');

  // Procura check-in do mesmo driver no mesmo dia (mais recente primeiro)
  const lastRow = sheet.getLastRow();
  let foundRow = -1;

  if (lastRow > 1) {
    const range = sheet.getRange(2, 1, lastRow - 1, 4).getValues(); // só timestamp/date/name/email
    for (let i = range.length - 1; i >= 0; i--) {
      const rowDate = range[i][1];
      const rowEmail = range[i][3];
      // Date pode vir como Date object ou string yyyy-MM-dd
      const rowDateStr = (rowDate instanceof Date)
        ? Utilities.formatDate(rowDate, 'America/Sao_Paulo', 'yyyy-MM-dd')
        : String(rowDate);

      if (rowEmail === data.driverEmail && rowDateStr === todayStr) {
        foundRow = i + 2; // +2 porque range começa em row 2 e i é 0-indexed
        break;
      }
    }
  }

  // Valores das colunas de checkout (U=21, V=22, W=23, X=24, Y=25, Z=26, AA=27)
  const checkoutValues = [[
    now,                              // U: Checkout Timestamp
    data.checkoutLat || '',           // V: Checkout Lat
    data.checkoutLng || '',           // W: Checkout Lng
    safeNumber(data.tkmMapped),       // X: TKM Mapped
    safeNumber(data.totalKmDriven),   // Y: Total KM Driven
    data.notes || '',                 // Z: Checkout Notes
    foundRow > 0 ? 'Yes' : 'No',      // AA: Has Checkin
  ]];

  // v5.14: extras de checkout (AE=Odometer End, AF=SSD Fill Level)
  const checkoutExtras = [[
    safeNumber(data.odometerEnd),     // AE: Odometer End
    data.ssdFillLevel || '',          // AF: SSD Fill (empty/low/half/high/full)
  ]];

  if (foundRow > 0) {
    // Atualiza linha existente do check-in
    sheet.getRange(foundRow, 21, 1, 7).setValues(checkoutValues);
    sheet.getRange(foundRow, 31, 1, 2).setValues(checkoutExtras);  // AE-AF
    return { mode: 'updated', message: 'Checkout registrado na linha do check-in' };
  } else {
    // Cria linha nova: 27 cols originais + 3 v5.14 check-in extras + 2 v5.14 checkout extras = 32 total
    const newRow = new Array(32).fill('');
    newRow[0] = now;                        // A: Timestamp
    newRow[1] = todayStr;                   // B: Date
    newRow[2] = data.driverName || '';      // C: Driver Name
    newRow[3] = data.driverEmail;           // D: Driver Email
    newRow[4] = data.country || '';         // E: Country
    // Cols U-AA (índices 20-26): preenche com checkout
    for (let i = 0; i < 7; i++) {
      newRow[20 + i] = checkoutValues[0][i];
    }
    // Cols AE-AF (índices 30-31): checkout extras v5.14
    newRow[30] = checkoutExtras[0][0];
    newRow[31] = checkoutExtras[0][1];
    // v5.37: insere no topo (logo abaixo do header) em vez de no fim — mais recente em cima
    insertRowAt_(sheet, 2, newRow);
    return { mode: 'created', message: 'Checkout sem check-in registrado (linha nova)' };
  }
}

/**
 * Garante que as colunas U-AA (checkout) existem na aba Driver Daily Check-in.
 * Se a aba foi criada na v4 (só 20 colunas), adiciona os headers das 7 novas.
 */
function ensureCheckoutColumns(sheet) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol >= 27) return; // já tem todas

  const newHeaders = [
    'Checkout Timestamp', 'Checkout Lat', 'Checkout Lng',
    'TKM Mapped', 'Total KM Driven', 'Checkout Notes', 'Has Checkin'
  ];

  // Adiciona apenas as que faltam (a partir da coluna 21)
  const startCol = 21;
  const numToAdd = 27 - lastCol;
  if (numToAdd <= 0) return;

  const headersToAdd = newHeaders.slice(7 - numToAdd);
  sheet.getRange(1, startCol, 1, numToAdd).setValues([headersToAdd]);
  sheet.getRange(1, startCol, 1, numToAdd).setFontWeight('bold').setBackground('#f0f0f0');
}


// ================================================================
// v5.14: COLUNAS NOVAS (check-in/checkout extras + Vehicle Issues)
// ================================================================

/**
 * Garante colunas AB-AD (28-30) na aba Driver Daily Check-in:
 *   AB(28) = Odometer Start
 *   AC(29) = SSD In Use
 *   AD(30) = SSD Source
 */
function ensureCheckinExtraColumns_(sheet) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  // Garante que tem pelo menos as 27 originais (AA) + 3 novas = 30
  if (lastCol >= 30) return;

  // Primeiro garante AA (caso vinda da v4 sem checkout)
  ensureCheckoutColumns(sheet);

  const headers = ['Odometer Start', 'SSD In Use', 'SSD Source'];
  const startCol = 28;
  const numToAdd = 30 - Math.max(lastCol, 27);
  if (numToAdd <= 0) return;

  const headersToAdd = headers.slice(3 - numToAdd);
  sheet.getRange(1, startCol + (3 - numToAdd), 1, numToAdd).setValues([headersToAdd]);
  sheet.getRange(1, startCol + (3 - numToAdd), 1, numToAdd)
    .setFontWeight('bold').setBackground('#f0f0f0');
}

/**
 * Garante colunas AE-AF (31-32) na aba Driver Daily Check-in:
 *   AE(31) = Odometer End
 *   AF(32) = SSD Fill Level (empty/low/half/high/full)
 */
function ensureCheckoutExtraColumns_(sheet) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol >= 32) return;

  // Primeiro garante checkin extras (AB-AD)
  ensureCheckinExtraColumns_(sheet);

  const headers = ['Odometer End', 'SSD Fill Level'];
  const startCol = 31;
  const currentLast = Math.max(sheet.getLastColumn(), 30);
  const numToAdd = 32 - currentLast;
  if (numToAdd <= 0) return;

  const headersToAdd = headers.slice(2 - numToAdd);
  sheet.getRange(1, startCol + (2 - numToAdd), 1, numToAdd).setValues([headersToAdd]);
  sheet.getRange(1, startCol + (2 - numToAdd), 1, numToAdd)
    .setFontWeight('bold').setBackground('#f0f0f0');
}

/**
 * v5.17: Garante colunas AG-AH (33-34) na aba Driver Daily Check-in:
 *   AG(33) = Did Map (yes/no)
 *   AH(34) = DNM Reason (weather/mech/tech/disks)
 */
function ensureDnmColumns_(sheet) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  if (lastCol >= 34) return;

  // Garante que tem todas extras anteriores antes (AB-AF)
  ensureCheckinExtraColumns_(sheet);
  ensureCheckoutExtraColumns_(sheet);

  const headers = ['Did Map', 'DNM Reason'];
  const startCol = 33;
  const currentLast = Math.max(sheet.getLastColumn(), 32);
  const numToAdd = 34 - currentLast;
  if (numToAdd <= 0) return;

  const headersToAdd = headers.slice(2 - numToAdd);
  sheet.getRange(1, startCol + (2 - numToAdd), 1, numToAdd).setValues([headersToAdd]);
  sheet.getRange(1, startCol + (2 - numToAdd), 1, numToAdd)
    .setFontWeight('bold').setBackground('#FFE4E6');  // rosa claro pra destacar dia parado
}

/**
 * Garante que a aba Vehicle Issues Tracking existe com headers corretos.
 * Auto-criada na primeira chamada de saveVehicleIssue_.
 */
function ensureVehicleIssuesSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  let sheet = ss.getSheetByName(CONFIG.vehicleIssuesSheet);

  // Headers oficiais (v5.14.1: adiciona Category)
  const expectedHeaders = [
    'Issue ID',           // A
    'Created Timestamp',  // B
    'Driver Email',       // C
    'Driver Name',        // D
    'Country',            // E
    'Severity',           // F: 'Minor Issue' | 'Critical Issue'
    'Category',           // G: 'mech' | 'tech' (v5.14.1)
    'Description',        // H
    'Stop Date',          // I
    'Service Status',     // J: 'not_started' | 'in_progress' | 'finished'
    'Expected End Date',  // K
    'End Status',         // L: 'picked_up' | 'awaiting_payment' | ''
    'Resolved Date',      // M
    'Last Update',        // N
    'Updated By',         // O
  ];

  // Cria do zero se não existe
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.vehicleIssuesSheet);
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.getRange(1, 1, 1, expectedHeaders.length).setFontWeight('bold').setBackground('#f0f0f0');
    sheet.setFrozenRows(1);
    Logger.log('✓ Aba "Vehicle Issues Tracking" criada com Category.');
    return sheet;
  }

  // Aba já existe — verifica se precisa adicionar Category (migração da v5.14 → v5.14.1)
  const lastCol = sheet.getLastColumn();
  if (lastCol < expectedHeaders.length) {
    // Adiciona "Category" na coluna G se não tem
    const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const hasCategory = currentHeaders.some(h => String(h).trim().toLowerCase() === 'category');
    if (!hasCategory) {
      // Insere coluna G (depois de Severity), shifta Description→I, etc
      sheet.insertColumnAfter(6);  // depois de F (Severity)
      sheet.getRange(1, 7).setValue('Category').setFontWeight('bold').setBackground('#f0f0f0');
      Logger.log('✓ Coluna "Category" adicionada à aba Vehicle Issues Tracking');
    }
  }

  return sheet;
}

/**
 * Mapeia índices das colunas por header. Aceita variações.
 * Retorna objeto com índices 0-based (ou -1 se não encontrar).
 */
function _vehicleIssueColumnsIdx(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const find = (...names) => {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim().toLowerCase();
      for (const n of names) {
        if (h === n.toLowerCase()) return i;
      }
    }
    return -1;
  };
  return {
    id: find('Issue ID'),
    created: find('Created Timestamp', 'Created'),
    email: find('Driver Email'),
    name: find('Driver Name'),
    country: find('Country'),
    severity: find('Severity'),
    category: find('Category'),
    description: find('Description'),
    stopDate: find('Stop Date'),
    serviceStatus: find('Service Status'),
    expectedEnd: find('Expected End Date'),
    endStatus: find('End Status'),
    resolvedDate: find('Resolved Date'),
    lastUpdate: find('Last Update'),
    updatedBy: find('Updated By'),
  };
}


// ================================================================
// v5.14: FUNÇÕES DE LEITURA — SSDs do driver + Vehicle Issues
// ================================================================

/**
 * Retorna lista de SSDs disponíveis pra um driver (pra dropdown no check-in).
 * Reusa getDriverAssets_ que faz lookup por VID.
 */
function getDriverSsdsByEmail_(email) {
  if (!email) return [];

  // Pega VID do driver via VID Calendar
  const vidIndex = buildVidIndexByEmail_();
  const vidInfo = vidIndex[email.toLowerCase()];
  if (!vidInfo || !vidInfo.vid) return [];

  const assets = getDriverAssets_(vidInfo.vid);
  if (!assets) return [];

  // Lista combinada: o que está em uso primeiro (marcado), depois os outros
  const ssds = [];
  if (assets.discInUse) {
    ssds.push({ code: assets.discInUse, inUse: true });
  }
  if (assets.otherDiscs) {
    assets.otherDiscs.forEach(code => {
      // Evita duplicar se já está como inUse
      if (!ssds.some(s => s.code === code)) {
        ssds.push({ code: code, inUse: false });
      }
    });
  }
  return ssds;
}

/**
 * Retorna issues abertas/em-andamento de um driver.
 * Usado pelo driver-profile.html no card de Compliance.
 */
function getDriverVehicleIssues_(email) {
  if (!email) return [];
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.vehicleIssuesSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const idx = _vehicleIssueColumnsIdx(sheet);
  if (idx.email < 0) {
    Logger.log('⚠ getDriverVehicleIssues_: coluna Driver Email não encontrada');
    return [];
  }

  const data = sheet.getDataRange().getValues();
  const emailLower = email.toLowerCase();
  const issues = [];
  const get = (row, i) => i >= 0 ? row[i] : null;
  const isoDate = (v) => (v instanceof Date) ? v.toISOString() : null;

  for (let i = 1; i < data.length; i++) {
    const rowEmail = get(data[i], idx.email);
    if (!rowEmail || String(rowEmail).toLowerCase() !== emailLower) continue;

    issues.push({
      id: get(data[i], idx.id),
      created: isoDate(get(data[i], idx.created)),
      severity: get(data[i], idx.severity) || '',
      category: String(get(data[i], idx.category) || '').toLowerCase(),  // v5.14.1
      description: get(data[i], idx.description) || '',
      stopDate: isoDate(get(data[i], idx.stopDate)),
      serviceStatus: get(data[i], idx.serviceStatus) || '',
      expectedEndDate: isoDate(get(data[i], idx.expectedEnd)),
      endStatus: get(data[i], idx.endStatus) || '',
      resolvedDate: isoDate(get(data[i], idx.resolvedDate)),
      lastUpdate: isoDate(get(data[i], idx.lastUpdate)),
      updatedBy: get(data[i], idx.updatedBy) || '',
    });
  }

  // Ordena: abertas primeiro, depois mais recente primeiro
  issues.sort((a, b) => {
    const aOpen = a.serviceStatus !== 'finished' || a.endStatus === 'awaiting_payment';
    const bOpen = b.serviceStatus !== 'finished' || b.endStatus === 'awaiting_payment';
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    if (!a.created) return 1;
    if (!b.created) return -1;
    return b.created.localeCompare(a.created);
  });

  return issues;
}


// ================================================================
// v5.14: SAVE VEHICLE ISSUE (cria nova linha — driver não atualiza)
// ================================================================

/**
 * Cria uma nova entrada na aba Vehicle Issues Tracking.
 * Cada incidente vira uma linha. Atualizações futuras são feitas
 * por gerentes via dashboard (TODO: ainda não temos UI de update).
 *
 * Espera no payload:
 *   driverEmail, driverName, country, severity, description (do check-in)
 *   stopDate (date string 'yyyy-MM-dd')
 *   serviceStatus ('not_started' | 'in_progress' | 'finished')
 *   expectedEndDate (date string opcional)
 *   endStatus ('picked_up' | 'awaiting_payment' | '')
 */
function saveVehicleIssue_(data) {
  const sheet = ensureVehicleIssuesSheet_();
  const idx = _vehicleIssueColumnsIdx(sheet);
  const lastCol = sheet.getLastColumn();
  const now = new Date();

  // ID único: timestamp + 4 chars random
  const issueId = 'VI-' + now.getTime().toString(36).toUpperCase() +
    '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

  const stopDate = data.stopDate ? new Date(data.stopDate + 'T12:00:00') : '';
  const expectedEndDate = data.expectedEndDate ? new Date(data.expectedEndDate + 'T12:00:00') : '';
  const resolvedDate = (data.serviceStatus === 'finished') ? now : '';

  // Constrói row na ordem correta de acordo com o lookup dinâmico
  // (resiliente caso alguém reordene colunas no futuro)
  const row = new Array(lastCol).fill('');
  const setIf = (i, v) => { if (i >= 0 && i < lastCol) row[i] = v; };

  setIf(idx.id, issueId);
  setIf(idx.created, now);
  setIf(idx.email, data.driverEmail || '');
  setIf(idx.name, data.driverName || '');
  setIf(idx.country, data.country || '');
  setIf(idx.severity, data.severity || '');
  setIf(idx.category, data.category || '');             // v5.14.1
  setIf(idx.description, data.description || '');
  setIf(idx.stopDate, stopDate);
  setIf(idx.serviceStatus, data.serviceStatus || '');
  setIf(idx.expectedEnd, expectedEndDate);
  setIf(idx.endStatus, data.endStatus || '');
  setIf(idx.resolvedDate, resolvedDate);
  setIf(idx.lastUpdate, now);
  setIf(idx.updatedBy, data.driverEmail || '');

  sheet.appendRow(row);

  Logger.log('Vehicle issue criada: ' + issueId + ' driver=' + data.driverEmail + ' category=' + data.category);
  return { mode: 'created', message: 'Issue registrada', id: issueId };
}


// ================================================================
// FUNÇÕES INTERNAS
// ================================================================

function ensureSheetsExist() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

  if (!ss.getSheetByName(CONFIG.checkinSheet)) {
    const sheet = ss.insertSheet(CONFIG.checkinSheet);
    sheet.appendRow([
      'Timestamp', 'Date', 'Driver Name', 'Driver Email', 'Country',
      'Origin Lat', 'Origin Lng', 'Origin Address', 'Origin Method',
      'Dest Center Lat', 'Dest Center Lng', 'Dest Area Description', 'Dest Radius Km',
      'Vehicle Status', 'Vehicle Issue', 'Notes',
      'Origin→Area Center Km', 'Origin→Area Edge Km',
      'Base→Area Center Km', 'Base→Area Edge Km',
      // v5: colunas de checkout
      'Checkout Timestamp', 'Checkout Lat', 'Checkout Lng',
      'TKM Mapped', 'Total KM Driven', 'Checkout Notes', 'Has Checkin'
    ]);
    sheet.getRange(1, 1, 1, 27).setFontWeight('bold').setBackground('#f0f0f0');
    sheet.setFrozenRows(1);
  } else {
    // Aba já existe — verifica se as colunas de checkout (v5) existem; se não, adiciona
    ensureCheckoutColumns(ss.getSheetByName(CONFIG.checkinSheet));
  }

  if (!ss.getSheetByName(CONFIG.baseSheet)) {
    const sheet = ss.insertSheet(CONFIG.baseSheet);
    sheet.appendRow([
      'Timestamp', 'Driver Email', 'Driver Name', 'Base Type',
      'Base Address', 'Base Lat', 'Base Lng', 'Country', 'Notes'
    ]);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#f0f0f0');
    sheet.setFrozenRows(1);
  }
}

function calcDistanceKm(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lat2) return '';
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ================================================================
// EMAIL AUTOMATION (v4)
// ================================================================

/**
 * Envia email diário com drivers sem check-in recente + vehicle issues.
 * Rodada automaticamente via trigger diário às 9h.
 */
function sendDailyReport() {
  const data = getDashboardData(7);
  const drivers = data.drivers;
  const bases = data.bases;
  const checkins = data.lastCheckins;

  // Drivers ativos (só pros ativos, não PMO)
  const activeDrivers = drivers.filter(d => d.email);

  // Drivers sem check-in há mais de X horas (threshold configurável)
  const missingDrivers = [];
  const criticalIssues = [];
  const minorIssues = [];

  const now = Date.now();
  activeDrivers.forEach(d => {
    const checkin = checkins[d.email];
    if (!checkin) {
      missingDrivers.push({ ...d, hoursAgo: null, reason: 'Nunca fez check-in' });
    } else {
      const hoursAgo = (now - checkin.timestamp.getTime()) / 3600000;
      if (hoursAgo > EMAIL_CONFIG.missingThresholdHours) {
        missingDrivers.push({ ...d, hoursAgo: Math.round(hoursAgo), reason: Math.round(hoursAgo) + 'h sem update' });
      }

      if (checkin.vehicleStatus === 'Critical Issue') {
        criticalIssues.push({ ...d, issue: checkin.vehicleIssue || 'Não especificado', notes: checkin.notes });
      } else if (checkin.vehicleStatus === 'Minor Issue') {
        minorIssues.push({ ...d, issue: checkin.vehicleIssue || 'Não especificado', notes: checkin.notes });
      }
    }
  });

  // Se não tem nada pra reportar e config manda pular, não envia
  if (EMAIL_CONFIG.skipEmptyDailyReports &&
      missingDrivers.length === 0 &&
      criticalIssues.length === 0 &&
      minorIssues.length === 0) {
    Logger.log('Nenhum alerta. Pulando email diário.');
    return;
  }

  // Monta HTML
  const html = buildDailyEmailHtml({
    missingDrivers,
    criticalIssues,
    minorIssues,
    totalDrivers: activeDrivers.length,
  });

  const subject = buildDailySubject(missingDrivers.length, criticalIssues.length, minorIssues.length);

  MailApp.sendEmail({
    to: EMAIL_CONFIG.recipients,
    subject: subject,
    htmlBody: html,
  });

  Logger.log('Email diário enviado: ' + subject);
}

function buildDailySubject(missing, critical, minor) {
  const parts = [];
  if (critical > 0) parts.push('🔴 ' + critical + ' crítico' + (critical > 1 ? 's' : ''));
  if (missing > 0) parts.push('⚠ ' + missing + ' sem check-in');
  if (minor > 0) parts.push('🟡 ' + minor + ' alerta' + (minor > 1 ? 's' : ''));

  const date = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM');
  return '[LATAM Daily ' + date + '] ' + (parts.length > 0 ? parts.join(' · ') : 'Tudo OK');
}

function buildDailyEmailHtml(data) {
  const { missingDrivers, criticalIssues, minorIssues, totalDrivers } = data;
  const date = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy');

  let html = '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1A202C;">';

  // Header
  html += '<div style="background:linear-gradient(135deg,#2C5282,#4A9FE0);color:white;padding:20px;border-radius:8px 8px 0 0;">';
  html += '<h1 style="margin:0;font-size:18px;">Street View LATAM · Relatório Diário</h1>';
  html += '<p style="margin:6px 0 0;font-size:13px;opacity:0.85;">' + date + ' · ' + totalDrivers + ' drivers ativos</p>';
  html += '</div>';

  html += '<div style="background:white;padding:20px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">';

  // Critical issues
  if (criticalIssues.length > 0) {
    html += '<h2 style="color:#991B1B;font-size:14px;margin:0 0 10px;">🔴 Issues críticos (' + criticalIssues.length + ')</h2>';
    html += '<div style="background:#FEF2F2;border-left:3px solid #EF4444;padding:12px;margin-bottom:16px;border-radius:4px;">';
    criticalIssues.forEach(d => {
      html += '<div style="margin-bottom:10px;">';
      html += '<strong style="color:#991B1B;">' + d.name + '</strong> <span style="color:#64748B;font-size:12px;">(' + d.country + ')</span><br>';
      html += '<span style="font-size:13px;">Problema: ' + escapeHtmlEmail(d.issue) + '</span>';
      if (d.notes) html += '<br><span style="font-size:12px;color:#475569;font-style:italic;">"' + escapeHtmlEmail(d.notes) + '"</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  // Missing check-ins
  if (missingDrivers.length > 0) {
    html += '<h2 style="color:#92400E;font-size:14px;margin:0 0 10px;">⚠ Sem check-in há ' + EMAIL_CONFIG.missingThresholdHours + 'h+ (' + missingDrivers.length + ')</h2>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">';
    html += '<thead><tr style="background:#FEF3C7;"><th style="text-align:left;padding:8px;">Driver</th><th style="text-align:left;padding:8px;">País</th><th style="text-align:left;padding:8px;">Status</th></tr></thead>';
    html += '<tbody>';
    missingDrivers.forEach((d, i) => {
      const bg = i % 2 === 0 ? '#FFFBEB' : 'white';
      html += '<tr style="background:' + bg + ';">';
      html += '<td style="padding:8px;border-bottom:1px solid #FDE68A;"><strong>' + d.name + '</strong></td>';
      html += '<td style="padding:8px;border-bottom:1px solid #FDE68A;color:#64748B;">' + d.country + '</td>';
      html += '<td style="padding:8px;border-bottom:1px solid #FDE68A;color:#92400E;">' + d.reason + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
  }

  // Minor issues
  if (minorIssues.length > 0) {
    html += '<h2 style="color:#854F0B;font-size:14px;margin:0 0 10px;">🟡 Alertas menores (' + minorIssues.length + ')</h2>';
    html += '<ul style="font-size:13px;padding-left:20px;margin-bottom:16px;">';
    minorIssues.forEach(d => {
      html += '<li style="margin-bottom:6px;"><strong>' + d.name + '</strong> <span style="color:#64748B;">(' + d.country + ')</span>: ' + escapeHtmlEmail(d.issue) + '</li>';
    });
    html += '</ul>';
  }

  if (missingDrivers.length === 0 && criticalIssues.length === 0 && minorIssues.length === 0) {
    html += '<div style="text-align:center;padding:30px 20px;">';
    html += '<div style="font-size:36px;">✅</div>';
    html += '<p style="margin:10px 0 0;color:#16A34A;font-weight:600;">Tudo em ordem</p>';
    html += '<p style="color:#64748B;font-size:13px;margin:4px 0 0;">Todos os drivers fizeram check-in recente e sem issues.</p>';
    html += '</div>';
  }

  // Button
  html += '<div style="text-align:center;margin-top:20px;">';
  html += '<a href="' + EMAIL_CONFIG.dashboardUrl + '" style="display:inline-block;background:#2C5282;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px;">Abrir dashboard →</a>';
  html += '</div>';

  // Footer
  html += '<div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #E2E8F0;">';
  html += '<p style="font-size:11px;color:#94A3B8;margin:0;">Aceolution do Brasil · Relatório automático diário</p>';
  html += '</div>';

  html += '</div></div>';
  return html;
}

/**
 * Envia email semanal com resumo geral da operação.
 * Rodada automaticamente via trigger toda segunda às 9h.
 */
function sendWeeklyReport() {
  const data = getDashboardData(7);
  const hmByCountry = getHotelModeByCountry();
  const ctsGoals = getCtsGoals();

  const drivers = data.drivers;
  const bases = data.bases;
  const checkins = data.lastCheckins;
  const activeDrivers = drivers.filter(d => d.email);

  // Métricas
  const now = Date.now();
  const withCheckin7d = activeDrivers.filter(d => {
    const ci = checkins[d.email];
    return ci && (now - ci.timestamp.getTime()) < 7 * 86400000;
  }).length;

  const hotelMode = activeDrivers.filter(d => {
    const b = bases[d.email];
    return b && b.type === 'Hotel';
  }).length;

  // Economia total
  let savingsTotal = 0;
  const driversWithSavings = [];
  activeDrivers.forEach(d => {
    const b = bases[d.email];
    const ci = checkins[d.email];
    if (b && b.type === 'Hotel' && d.homeLat && d.homeLng && ci && ci.destLat) {
      const distHome = haversineKm(d.homeLat, d.homeLng, ci.destLat, ci.destLng);
      const distBase = haversineKm(b.lat, b.lng, ci.destLat, ci.destLng);
      const radius = ci.destRadius || 0;
      const savings = Math.max(0, distHome - radius) - Math.max(0, distBase - radius);
      if (savings > 0) {
        savingsTotal += savings;
        driversWithSavings.push({ ...d, savingsKm: Math.round(savings * 10) / 10 });
      }
    }
  });

  const topSavings = driversWithSavings.sort((a, b) => b.savingsKm - a.savingsKm).slice(0, 5);

  // CTS do mês mais recente
  const periods = [...new Set(ctsGoals.map(g => g.period))].sort((a, b) => {
    const [ma, ya] = a.split('.').map(Number);
    const [mb, yb] = b.split('.').map(Number);
    return (yb - ya) || (mb - ma);
  });
  const latestPeriod = periods[0];
  const ctsCurrentMonth = ctsGoals.filter(g => g.period === latestPeriod);

  const html = buildWeeklyEmailHtml({
    totalDrivers: activeDrivers.length,
    withCheckin7d,
    hotelMode,
    savingsTotal: Math.round(savingsTotal),
    topSavings,
    hmByCountry,
    ctsCurrentMonth,
    latestPeriod,
  });

  const date = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM');
  const subject = '[LATAM Weekly] Resumo da semana · ' + date;

  MailApp.sendEmail({
    to: EMAIL_CONFIG.recipients,
    subject: subject,
    htmlBody: html,
  });

  Logger.log('Email semanal enviado');
}

function buildWeeklyEmailHtml(data) {
  const { totalDrivers, withCheckin7d, hotelMode, savingsTotal, topSavings, hmByCountry, ctsCurrentMonth, latestPeriod } = data;
  const date = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy');
  const pct = totalDrivers > 0 ? Math.round((hotelMode / totalDrivers) * 100) : 0;

  let html = '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#1A202C;">';

  // Header
  html += '<div style="background:linear-gradient(135deg,#2C5282,#4A9FE0);color:white;padding:24px;border-radius:8px 8px 0 0;">';
  html += '<h1 style="margin:0;font-size:20px;">Street View LATAM · Weekly Report</h1>';
  html += '<p style="margin:6px 0 0;font-size:13px;opacity:0.85;">Semana fechada em ' + date + '</p>';
  html += '</div>';

  html += '<div style="background:white;padding:24px;border:1px solid #E2E8F0;border-top:none;">';

  // Scorecards
  html += '<table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:20px;"><tr>';
  html += weeklyCardHtml(t_pt('scActiveDrivers', 'DRIVERS ATIVOS'), totalDrivers, withCheckin7d + ' com check-in na semana', '#2C5282');
  html += weeklyCardHtml('EM HOTEL MODE', hotelMode, pct + '% do total', '#4A9FE0');
  html += weeklyCardHtml('ECONOMIA TOTAL', savingsTotal.toLocaleString() + ' km', 'km/dia evitados', '#16A34A');
  html += '</tr></table>';

  // Hotel Mode por país
  if (hmByCountry.length > 0) {
    html += '<h2 style="color:#1A365D;font-size:15px;margin:20px 0 10px;">Hotel Mode por país</h2>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">';
    html += '<thead><tr style="background:#F8FAFC;">';
    html += '<th style="text-align:left;padding:8px;border-bottom:1px solid #E2E8F0;">País</th>';
    html += '<th style="text-align:right;padding:8px;border-bottom:1px solid #E2E8F0;">Drivers</th>';
    html += '<th style="text-align:right;padding:8px;border-bottom:1px solid #E2E8F0;">Hotel Mode%</th>';
    html += '</tr></thead><tbody>';
    hmByCountry.filter(c => c.country !== 'SUM').forEach(c => {
      const p = Math.round((c.hotelModePct || 0) * 100);
      const color = p >= 70 ? '#16A34A' : (p >= 40 ? '#F59E0B' : '#EF4444');
      html += '<tr>';
      html += '<td style="padding:8px;border-bottom:1px solid #F1F5F9;"><strong>' + c.country + '</strong></td>';
      html += '<td style="padding:8px;border-bottom:1px solid #F1F5F9;text-align:right;color:#64748B;">' + c.activeDrivers + '</td>';
      html += '<td style="padding:8px;border-bottom:1px solid #F1F5F9;text-align:right;"><strong style="color:' + color + ';">' + p + '%</strong></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
  }

  // CTS
  if (ctsCurrentMonth.length > 0) {
    html += '<h2 style="color:#1A365D;font-size:15px;margin:20px 0 10px;">CTS Goal vs Achieved · ' + latestPeriod + '</h2>';
    ctsCurrentMonth.forEach(g => {
      const pctV = g.ctsGoal > 0 ? Math.round((g.achieved / g.ctsGoal) * 100) : 0;
      const color = pctV >= 80 ? '#16A34A' : (pctV >= 40 ? '#F59E0B' : '#EF4444');
      const fillWidth = Math.min(100, pctV);
      html += '<div style="margin-bottom:12px;">';
      html += '<div style="display:flex;justify-content:space-between;margin-bottom:4px;">';
      html += '<strong style="font-size:13px;">' + g.country + '</strong>';
      html += '<span style="color:' + color + ';font-weight:700;font-size:13px;">' + pctV + '%</span>';
      html += '</div>';
      html += '<div style="background:#E2E8F0;height:6px;border-radius:3px;overflow:hidden;">';
      html += '<div style="background:' + color + ';height:100%;width:' + fillWidth + '%;"></div>';
      html += '</div>';
      html += '<div style="font-size:11px;color:#64748B;margin-top:3px;">' + Math.round(g.achieved).toLocaleString() + ' / ' + Math.round(g.ctsGoal).toLocaleString() + ' · faltam ' + Math.round(g.tkmPending).toLocaleString() + ' TKM</div>';
      html += '</div>';
    });
  }

  // Top savings
  if (topSavings.length > 0) {
    html += '<h2 style="color:#1A365D;font-size:15px;margin:20px 0 10px;">Top 5 economia hotel mode</h2>';
    html += '<ol style="font-size:13px;padding-left:20px;">';
    topSavings.forEach(d => {
      html += '<li style="margin-bottom:6px;"><strong>' + d.name + '</strong> <span style="color:#64748B;">(' + d.country + ')</span> · <strong style="color:#16A34A;">+' + d.savingsKm + ' km</strong></li>';
    });
    html += '</ol>';
  }

  // Button
  html += '<div style="text-align:center;margin-top:24px;">';
  html += '<a href="' + EMAIL_CONFIG.dashboardUrl + '" style="display:inline-block;background:#2C5282;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Abrir dashboard completo →</a>';
  html += '</div>';

  html += '<div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #E2E8F0;">';
  html += '<p style="font-size:11px;color:#94A3B8;margin:0;">Aceolution do Brasil · Relatório automático semanal (toda segunda 9h)</p>';
  html += '</div>';

  html += '</div></div>';
  return html;
}

function weeklyCardHtml(label, value, sub, color) {
  let html = '<td style="background:#F8FAFC;border-left:3px solid ' + color + ';border-radius:6px;padding:14px;vertical-align:top;">';
  html += '<div style="font-size:10px;color:#64748B;letter-spacing:0.5px;text-transform:uppercase;font-weight:600;">' + label + '</div>';
  html += '<div style="font-size:24px;font-weight:700;color:#1A365D;margin:4px 0;">' + value + '</div>';
  html += '<div style="font-size:11px;color:#64748B;">' + sub + '</div>';
  html += '</td>';
  return html;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function escapeHtmlEmail(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Placeholder pra i18n do email (por enquanto só PT, fácil de extender depois)
function t_pt(key, fallback) { return fallback; }


// ================================================================
// SETUP DOS TRIGGERS (rodar 1x no editor do Apps Script)
// ================================================================

/**
 * Configura os triggers automáticos de email.
 * RODAR UMA VEZ SÓ depois de publicar o script. Vai pedir permissão do Gmail.
 *
 * Como rodar: no editor de Apps Script, no dropdown ao lado do botão
 * Executar, selecione "setupEmailTriggers" e clique Executar.
 */
// ================================================================
// TIMESHEET QUINZENAL (v5)
// ================================================================

/**
 * Envia folha de ponto da quinzena anterior por email com Excel anexado.
 *
 * Trigger dispara dia 1 e dia 15 de cada mês às 8h. Mas como o
 * ScriptApp.Trigger não suporta "dia X do mês" diretamente, usamos um
 * trigger DIÁRIO + check de dia interno.
 *
 * Lógica do período:
 * - Se hoje é dia 1: cobre 16-fim_do_mes_anterior do mês passado
 * - Se hoje é dia 15: cobre 1-15 do mês atual
 * - Outros dias: NÃO faz nada (sai cedo)
 */
function sendBiweeklyTimesheet() {
  const now = new Date();
  const dayOfMonth = now.getDate();

  // Só roda dia 1 ou 15
  if (dayOfMonth !== 1 && dayOfMonth !== 15) {
    Logger.log('Hoje (' + dayOfMonth + ') não é dia 1 nem 15. Pulando timesheet quinzenal.');
    return;
  }

  // Calcula o range da quinzena anterior
  let startDate, endDate;
  if (dayOfMonth === 1) {
    // Cobre 16 a fim do mês anterior
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    startDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 16);
    // Último dia do mês anterior = dia 0 do mês atual
    endDate = new Date(now.getFullYear(), now.getMonth(), 0);
  } else {
    // dia 15: cobre 1-15 do mês atual
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 15);
  }

  const startStr = Utilities.formatDate(startDate, 'America/Sao_Paulo', 'yyyy-MM-dd');
  const endStr = Utilities.formatDate(endDate, 'America/Sao_Paulo', 'yyyy-MM-dd');

  Logger.log('Gerando timesheet de ' + startStr + ' a ' + endStr);

  // Pega os dados via mesma função do endpoint
  const rows = getTimesheet(startStr, endStr);

  if (rows.length === 0) {
    Logger.log('Nenhum check-in no período. Pulando email.');
    return;
  }

  // Gera o arquivo Excel
  const xlsxBlob = buildTimesheetXlsxBlob(rows, startStr, endStr);

  // Monta o email
  const subject = '[LATAM Folha de Ponto] ' + formatDateBR(startDate) + ' a ' + formatDateBR(endDate);
  const html = buildTimesheetEmailHtml(rows, startStr, endStr);

  MailApp.sendEmail({
    to: EMAIL_CONFIG.timesheetRecipients,
    subject: subject,
    htmlBody: html,
    attachments: [xlsxBlob],
  });

  Logger.log('Timesheet quinzenal enviado pra: ' + EMAIL_CONFIG.timesheetRecipients);
}

/**
 * Gera arquivo XLSX da folha de ponto e retorna como Blob anexável ao email.
 *
 * Estratégia: cria um Spreadsheet temporário no Drive, popula com os dados,
 * exporta como XLSX, deleta o temporário, retorna o blob.
 */
function buildTimesheetXlsxBlob(rows, startDate, endDate) {
  // Cria um Spreadsheet temporário
  const tempSs = SpreadsheetApp.create('temp_timesheet_' + new Date().getTime());
  const tempSheet = tempSs.getActiveSheet();
  tempSheet.setName('Folha de Ponto');

  // Calcula totais
  const totalHours = rows.reduce((s, r) => s + (typeof r.hoursWorked === 'number' ? r.hoursWorked : 0), 0);
  const totalTkm = rows.reduce((s, r) => s + (r.tkmMapped || 0), 0);
  const totalKm = rows.reduce((s, r) => s + (r.totalKmDriven || 0), 0);
  const uniqueDrivers = (new Set(rows.map(r => r.driverEmail))).size;

  // Linha 1: título
  tempSheet.getRange(1, 1).setValue('Folha de Ponto LATAM');
  tempSheet.getRange(1, 1, 1, 9).merge();
  tempSheet.getRange(1, 1).setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center')
    .setFontColor('#1A365D');

  // Linha 2: período
  tempSheet.getRange(2, 1).setValue('De ' + startDate + ' até ' + endDate);
  tempSheet.getRange(2, 1, 1, 9).merge();
  tempSheet.getRange(2, 1).setFontStyle('italic').setHorizontalAlignment('center')
    .setFontColor('#64748B');

  // Linha 4: totais
  tempSheet.getRange(4, 1).setValue('Drivers: ' + uniqueDrivers);
  tempSheet.getRange(4, 3).setValue('Total horas: ' + totalHours.toFixed(1) + 'h');
  tempSheet.getRange(4, 6).setValue('Total TKM: ' + totalTkm.toFixed(1));
  tempSheet.getRange(4, 8).setValue('Total KM: ' + totalKm.toFixed(1));
  tempSheet.getRange(4, 1, 1, 9).setFontWeight('bold').setBackground('#EBF4FB');

  // Linha 6: headers
  const headers = ['Driver', 'País', 'Data', 'Entrada', 'Saída',
                   'Horas trabalhadas', 'TKM', 'KM', 'Observações'];
  tempSheet.getRange(6, 1, 1, headers.length).setValues([headers]);
  tempSheet.getRange(6, 1, 1, headers.length)
    .setFontWeight('bold').setFontColor('#FFFFFF')
    .setBackground('#2C5282').setHorizontalAlignment('center');

  // Linhas 7+: dados
  if (rows.length > 0) {
    const dataMatrix = rows.map(r => [
      r.driverName,
      r.country,
      r.date,
      r.checkinTime || (r.hasCheckin === 'No' ? '⚠ sem check-in' : ''),
      r.checkoutTime || '',
      typeof r.hoursWorked === 'number' ? r.hoursWorked : '',
      r.tkmMapped || '',
      r.totalKmDriven || '',
      r.notes || '',
    ]);
    tempSheet.getRange(7, 1, dataMatrix.length, headers.length).setValues(dataMatrix);
  }

  // Larguras de coluna
  const widths = [200, 80, 80, 70, 70, 110, 60, 60, 280];
  widths.forEach((w, i) => tempSheet.setColumnWidth(i + 1, w));

  // Freeze header
  tempSheet.setFrozenRows(6);

  SpreadsheetApp.flush();

  // Exporta como XLSX usando UrlFetchApp
  const tempId = tempSs.getId();
  const url = 'https://docs.google.com/spreadsheets/d/' + tempId + '/export?format=xlsx';
  const token = ScriptApp.getOAuthToken();
  const response = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  const blob = response.getBlob().setName('folha-ponto-' + startDate + '_' + endDate + '.xlsx');

  // Deleta o arquivo temporário do Drive
  DriveApp.getFileById(tempId).setTrashed(true);

  return blob;
}

function buildTimesheetEmailHtml(rows, startDate, endDate) {
  const totalHours = rows.reduce((s, r) => s + (typeof r.hoursWorked === 'number' ? r.hoursWorked : 0), 0);
  const totalTkm = rows.reduce((s, r) => s + (r.tkmMapped || 0), 0);
  const totalKm = rows.reduce((s, r) => s + (r.totalKmDriven || 0), 0);
  const uniqueDrivers = (new Set(rows.map(r => r.driverEmail))).size;

  let html = '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#1A202C;">';

  // Header
  html += '<div style="background:linear-gradient(135deg,#2C5282,#4A9FE0);color:white;padding:24px;border-radius:8px 8px 0 0;">';
  html += '<h1 style="margin:0;font-size:20px;">Folha de Ponto · LATAM</h1>';
  html += '<p style="margin:6px 0 0;font-size:13px;opacity:0.85;">Período: ' + startDate + ' a ' + endDate + '</p>';
  html += '</div>';

  html += '<div style="background:white;padding:24px;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 8px 8px;">';

  // Resumo
  html += '<table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:20px;"><tr>';
  html += weeklyCardHtml('DRIVERS', uniqueDrivers, 'no per\u00edodo', '#2C5282');
  html += weeklyCardHtml('HORAS TRABALHADAS', totalHours.toFixed(1) + 'h', 'somat\u00f3rio do per\u00edodo', '#4A9FE0');
  html += weeklyCardHtml('TKM TOTAL', totalTkm.toFixed(1), 'mapeados na quinzena', '#16A34A');
  html += '</tr></table>';

  html += '<p style="font-size:14px;color:#475569;margin:20px 0 10px;">';
  html += 'Em anexo, a folha de ponto detalhada por driver e por dia da quinzena. ';
  html += '<strong>' + rows.length + ' linhas</strong> no total.';
  html += '</p>';

  // Aviso sobre dados incompletos (se houver)
  const noCheckinCount = rows.filter(r => r.hasCheckin === 'No').length;
  const noCheckoutCount = rows.filter(r => !r.checkoutTime && r.checkinTime).length;
  if (noCheckinCount > 0 || noCheckoutCount > 0) {
    html += '<div style="background:#FEF3C7;border-left:3px solid #F59E0B;padding:12px;border-radius:4px;margin-top:16px;font-size:13px;">';
    html += '<strong>⚠ Atenção:</strong><br>';
    if (noCheckinCount > 0) html += '• ' + noCheckinCount + ' linha(s) com checkout mas <strong>sem check-in</strong> matinal<br>';
    if (noCheckoutCount > 0) html += '• ' + noCheckoutCount + ' linha(s) com check-in mas <strong>sem checkout</strong> no fim do dia<br>';
    html += '<small style="color:#854F0B;">Dados incompletos podem afetar o cálculo de horas. Verifique no Excel anexo.</small>';
    html += '</div>';
  }

  // Botão dashboard
  html += '<div style="text-align:center;margin-top:24px;">';
  html += '<a href="' + EMAIL_CONFIG.dashboardUrl + '" style="display:inline-block;background:#2C5282;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Abrir dashboard \u2192</a>';
  html += '</div>';

  html += '<div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #E2E8F0;">';
  html += '<p style="font-size:11px;color:#94A3B8;margin:0;">Aceolution do Brasil \u00b7 Folha de ponto autom\u00e1tica (dias 1 e 15 de cada m\u00eas)</p>';
  html += '</div>';

  html += '</div></div>';
  return html;
}

function formatDateBR(d) {
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM/yyyy');
}


// ================================================================
// SETUP DOS TRIGGERS (rodar 1x no editor do Apps Script)
// ================================================================

function setupEmailTriggers() {
  // Remove triggers antigos primeiro pra evitar duplicatas
  removeEmailTriggers();

  // Trigger diário às 9h (horário de SP)
  ScriptApp.newTrigger('sendDailyReport')
    .timeBased()
    .atHour(EMAIL_CONFIG.dailyHour)
    .everyDays(1)
    .inTimezone('America/Sao_Paulo')
    .create();

  // Trigger semanal: segundas às 9h
  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased()
    .onWeekDay(EMAIL_CONFIG.weeklyDay)
    .atHour(EMAIL_CONFIG.weeklyHour)
    .inTimezone('America/Sao_Paulo')
    .create();

  // Trigger diário às 8h pra timesheet (a função interna decide se é dia 1 ou 15)
  ScriptApp.newTrigger('sendBiweeklyTimesheet')
    .timeBased()
    .atHour(EMAIL_CONFIG.timesheetHour)
    .everyDays(1)
    .inTimezone('America/Sao_Paulo')
    .create();

  Logger.log('Triggers criados com sucesso.');
  Logger.log('Diário: todo dia às ' + EMAIL_CONFIG.dailyHour + 'h');
  Logger.log('Semanal: toda segunda às ' + EMAIL_CONFIG.weeklyHour + 'h');
  Logger.log('Timesheet quinzenal: dias 1 e 15 às ' + EMAIL_CONFIG.timesheetHour + 'h');
  Logger.log('Destinatário daily/weekly: ' + EMAIL_CONFIG.recipients);
  Logger.log('Destinatário timesheet: ' + EMAIL_CONFIG.timesheetRecipients);
}

/**
 * Remove todos os triggers automáticos de email.
 * Rodar se quiser desativar os envios.
 */
function removeEmailTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === 'sendDailyReport' || fn === 'sendWeeklyReport' || fn === 'sendBiweeklyTimesheet') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log('Triggers removidos: ' + removed);
}

/**
 * Função utilitária pra testar o email diário SEM esperar o trigger.
 * Rodar manualmente no editor pra ver se o email chega certinho.
 */
function testDailyReport() {
  sendDailyReport();
  Logger.log('Email diário de teste enviado. Confere a caixa de entrada.');
}

/**
 * Função utilitária pra testar o email semanal.
 */
function testWeeklyReport() {
  sendWeeklyReport();
  Logger.log('Email semanal de teste enviado. Confere a caixa de entrada.');
}

/**
 * Função utilitária pra testar o timesheet quinzenal SEM esperar o dia 1 ou 15.
 *
 * Atenção: o sendBiweeklyTimesheet original sai cedo se hoje não é dia 1 ou 15.
 * Esta versão de teste força o range pra "últimos 15 dias" pra você poder
 * validar o email e o anexo a qualquer momento.
 */
function testBiweeklyTimesheet() {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 14);
  const startStr = Utilities.formatDate(start, 'America/Sao_Paulo', 'yyyy-MM-dd');
  const endStr = Utilities.formatDate(now, 'America/Sao_Paulo', 'yyyy-MM-dd');

  const rows = getTimesheet(startStr, endStr);

  if (rows.length === 0) {
    Logger.log('Sem check-ins nos últimos 15 dias. Email não enviado.');
    return;
  }

  const xlsxBlob = buildTimesheetXlsxBlob(rows, startStr, endStr);
  const subject = '[TESTE] LATAM Folha de Ponto · ' + startStr + ' a ' + endStr;
  const html = buildTimesheetEmailHtml(rows, startStr, endStr);

  MailApp.sendEmail({
    to: EMAIL_CONFIG.timesheetRecipients,
    subject: subject,
    htmlBody: html,
    attachments: [xlsxBlob],
  });

  Logger.log('Timesheet de TESTE enviado pra: ' + EMAIL_CONFIG.timesheetRecipients);
}

// ================================================================
// ASSETS & FINES (v5.12) — discos, celulares, multas
// ================================================================

/**
 * Lê última entrada da aba Assets Management pra um VID específico.
 * A aba é um histórico de check-ins semanais (ordenado mais recente → mais antigo).
 * Match é por VID (mais confiável que nome — não tem coluna email).
 *
 * Retorna:
 *   { discCount, discInUse, otherDiscs[], lastUpdate, phoneModel, phoneImei,
 *     odometer, plate, hotelMode, city, comments, vid }
 *   ou null se não encontrar.
 *
 * Estrutura da aba:
 *   Col 0: Carimbo de data/hora      Col 14: ¿Cuantos DISCOS?
 *   Col 1: Nome Completo             Col 15: ¿Qué DISCO estás usando?
 *   Col 2: VID                       Col 16: Códigos dos outros discos
 *   Col 3: País                      Col 17: ¿Cuantos celulares?
 *   Col 10: Odômetro                 Col 18: Modelo do celular
 *   Col 12: Placa do carro           Col 19: IMEI
 *                                    Col 21: Cidade atual
 *                                    Col 22: Modo hotel
 *                                    Col 27: Comentarios
 */
function getDriverAssets_(vid) {
  if (!vid && vid !== 0) return null;
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.assetsSheet, ['Assets Management', 'Assets']);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const data = sheet.getDataRange().getValues();
  const vidStr = String(vid).trim();

  // Procura a linha mais recente desse VID. Como a aba já está ordenada
  // por data desc (mais recente primeiro), o primeiro match é o mais novo.
  let mostRecent = null;
  let mostRecentTs = null;
  for (let i = 1; i < data.length; i++) {
    const rowVid = data[i][2];
    if (!rowVid && rowVid !== 0) continue;
    if (String(rowVid).trim() !== vidStr) continue;

    const ts = data[i][0];
    // Se data inválida, ignora; senão compara
    if (!(ts instanceof Date)) continue;
    if (!mostRecentTs || ts > mostRecentTs) {
      mostRecentTs = ts;
      mostRecent = data[i];
    }
  }

  if (!mostRecent) return null;

  // Parse da lista de "outros discos" — pode vir separada por \n, vírgula,
  // ponto-e-vírgula, espaço, etc. Normalizamos pra array de strings limpas.
  const otherDiscsRaw = mostRecent[16] ? String(mostRecent[16]) : '';
  const otherDiscs = otherDiscsRaw
    .split(/[\n,;]+/)
    .map(s => s.replace(/^SN:?\s*/i, '').trim())  // remove prefixo "SN:" comum
    .filter(s => s && s !== '.' && s.length > 1);

  return {
    vid: vidStr,
    name: mostRecent[1] || '',
    country: mostRecent[3] || '',
    plate: mostRecent[12] || '',
    odometer: safeNumber(mostRecent[10]),
    discCount: safeNumber(mostRecent[14]),
    discInUse: mostRecent[15] ? String(mostRecent[15]).replace(/^SN:?\s*/i, '').trim() : '',
    otherDiscs: otherDiscs,
    phoneCount: safeNumber(mostRecent[17]),
    phoneModel: mostRecent[18] ? String(mostRecent[18]).trim() : '',
    phoneImei: mostRecent[19] ? String(mostRecent[19]).trim() : '',
    breathalyzer: safeNumber(mostRecent[20]),
    city: mostRecent[21] ? String(mostRecent[21]).trim() : '',
    hotelMode: mostRecent[22] || '',
    comments: mostRecent[27] ? String(mostRecent[27]).trim() : '',
    lastUpdate: mostRecentTs.toISOString(),
  };
}

/**
 * v5.23: lê a última resposta do driver na aba Assets Management pelo EMAIL.
 * Diferente de getDriverAssets_(vid) acima, que busca por VID e devolve
 * objeto estruturado pro driver-profile. Esta versão é pra pré-preencher
 * o form semanal em assets.html — retorna OBJETO KEYED PELOS HEADERS da aba
 * (cliente faz pickHeader com matching liberal).
 *
 * Espera coluna de email em B (índice 1) que é onde o Forms nativo grava.
 */
function getLastAssetsForm_(email) {
  if (!email) return null;
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.assetsSheet,
    ['Assets Management', 'Asset Management', 'Assets', 'Respostas ao formulário 1']);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Acha coluna de email (header tipo "Endereço de e-mail" ou similar)
  let emailIdx = headers.findIndex(h => /e-?mail/i.test(String(h)));
  if (emailIdx < 0) emailIdx = 1; // fallback pra col B (padrão do Forms)

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const target = String(email).trim().toLowerCase();

  // Itera de baixo pra cima — pega a última submissão do driver
  for (let i = data.length - 1; i >= 0; i--) {
    const rowEmail = String(data[i][emailIdx] || '').trim().toLowerCase();
    if (rowEmail === target) {
      const obj = { _row: i + 2 };
      for (let j = 0; j < headers.length; j++) {
        const key = String(headers[j] || '').trim();
        if (!key) continue;
        let val = data[i][j];
        if (val instanceof Date) val = val.toISOString();
        obj[key] = val;
      }
      return obj;
    }
  }
  return null;
}

/**
 * v5.23: grava nova linha na aba Assets Management.
 * Faz upload das 4 fotos do veículo pro Drive (base64 → arquivo) e grava as URLs.
 *
 * Ordem das colunas (A-AC, 29 colunas) — mesma do Forms nativo:
 *   A  Carimbo de data/hora
 *   B  Endereço de e-mail
 *   C  Nome Completo
 *   D  VID
 *   E  Pais
 *   F  Horas e dias trabalhados [8]
 *   G  Horas e dias trabalhados [9]
 *   H  Dias mapeou
 *   I  Dias chuva
 *   J  Dias mecânico
 *   K  Vai trabalhar fim de semana
 *   L  Odômetro
 *   M  Targets
 *   N  Placa
 *   O  Quando recebeu carro
 *   P  Quantos discos
 *   Q  Disco em uso
 *   R  Códigos outros discos
 *   S  Quantos celulares
 *   T  Modelo celular
 *   U  IMEI
 *   V  Bafômetros
 *   W  Cidade
 *   X  Modo hotel
 *   Y  Foto frontal
 *   Z  Foto lat direita
 *   AA Foto lat esquerda
 *   AB Foto traseira
 *   AC Comentários
 *
 * Payload esperado: ver assets.html (campos camelCase).
 */
function saveAssetWeekly_(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.assetsSheet,
    ['Assets Management', 'Asset Management', 'Assets', 'Respostas ao formulário 1']);
  if (!sheet) throw new Error('Aba Assets Management não encontrada');

  const photos = data.photos || {};
  const folder = getAssetsPhotoFolder_();
  const safeDriverName = String(data.driverName || 'unknown')
    .replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
  const timestamp = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd_HH-mm-ss');

  const photoUrls = { front: '', right: '', left: '', back: '' };
  ['front', 'right', 'left', 'back'].forEach(function(key) {
    const p = photos[key];
    if (p && p.base64) {
      try {
        photoUrls[key] = uploadAssetPhotoToDrive_(p, safeDriverName, timestamp, key, folder);
      } catch (err) {
        Logger.log('[saveAssetWeekly_] falha upload foto ' + key + ': ' + err);
      }
    }
  });

  sheet.appendRow([
    new Date(),                                        // A
    data.driverEmail || '',                            // B
    data.driverName || '',                             // C
    data.vid || '',                                    // D
    data.country || '',                                // E
    data.hoursWeek1 || '',                             // F
    data.hoursWeek2 || '',                             // G
    data.daysMapped || '',                             // H
    data.daysRain || '',                               // I
    data.daysMechanic || '',                           // J
    data.workingWeekend || '',                         // K
    data.odometer || '',                               // L
    data.targets || '',                                // M
    data.licensePlate || '',                           // N
    data.vehicleReceivedDate || '',                    // O
    data.diskCount || '',                              // P
    data.diskInUse || '',                              // Q
    data.disksOther || '',                             // R
    data.phoneCount || '',                             // S
    data.phoneModel || '',                             // T
    data.phoneImei || '',                              // U
    data.breathalyzerCount || '',                      // V
    data.city || '',                                   // W
    data.hotelMode || '',                              // X
    photoUrls.front || '',                             // Y
    photoUrls.right || '',                             // Z
    photoUrls.left || '',                              // AA
    photoUrls.back || '',                              // AB
    data.comments || '',                               // AC
  ]);

  return { message: 'Asset weekly report saved', photoUrls: photoUrls };
}

function uploadAssetPhotoToDrive_(photo, safeDriverName, timestamp, label, folder) {
  const mime = photo.mimeType || 'image/jpeg';
  const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const filename = safeDriverName + '_' + timestamp + '_' + label + '.' + ext;
  const blob = Utilities.newBlob(Utilities.base64Decode(photo.base64), mime, filename);
  const file = folder.createFile(blob);
  return 'https://drive.google.com/open?id=' + file.getId();
}

function getAssetsPhotoFolder_() {
  // Se CONFIG.assetsPhotoFolderId estiver setado, usa ele
  if (CONFIG.assetsPhotoFolderId) {
    try {
      return DriveApp.getFolderById(CONFIG.assetsPhotoFolderId);
    } catch (e) {
      Logger.log('[getAssetsPhotoFolder_] folder ID inválido, fallback pro parent. Erro: ' + e);
    }
  }
  // Senão usa pasta pai da spreadsheet (próximo do Forms original)
  try {
    const ssFile = DriveApp.getFileById(CONFIG.spreadsheetId);
    const parents = ssFile.getParents();
    if (parents.hasNext()) return parents.next();
  } catch (e) {
    Logger.log('[getAssetsPhotoFolder_] não achou parent: ' + e);
  }
  return DriveApp.getRootFolder();
}

/**
 * Lê todas as multas de um driver pela coluna "Driver Responsible" da
 * aba Fines LATAM. Match é por nome normalizado (lowercase, sem acentos).
 *
 * Retorna array de:
 *   { month, country, plate, code, localAmount, usdAmount, issueDate,
 *     receivedDate, location, responsibleOfPayment, status, reason,
 *     paymentDate, totalDeduction, copyLink }
 *
 * Estrutura da aba:
 *   Col 0: Month       Col 7: Issue Date       Col 14: Comment
 *   Col 1: Country     Col 8: Received Date    Col 15: Fine Copy Link
 *   Col 2: Car Plate   Col 9: Issue Location   Col 18: Total Deduction
 *   Col 3: Fine Code   Col 10: Resp. Payment   Col 19: Driver Responsible
 *   Col 4: Local Amt   Col 11: Status
 *   Col 6: USD Amount  Col 12: Fine Reason
 *                      Col 13: Payment Date
 */
function getDriverFines_(driverName) {
  if (!driverName) return [];
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.finesSheet, ['Fines LATAM', 'Fines']);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const targetKey = nameKey_(driverName);
  if (!targetKey) return [];

  const fines = [];
  for (let i = 1; i < data.length; i++) {
    const responsible = data[i][19];
    if (!responsible) continue;
    const respKey = nameKey_(String(responsible));
    if (!respKey) continue;

    // Match exato OU substring (pra cobrir nomes parciais tipo "João Silva" vs "João da Silva")
    const isMatch = respKey === targetKey ||
      respKey.includes(targetKey) ||
      targetKey.includes(respKey);
    if (!isMatch) continue;

    const issueDate = data[i][7];
    const receivedDate = data[i][8];
    const paymentDate = data[i][13];

    fines.push({
      month: data[i][0] ? String(data[i][0]) : '',
      country: data[i][1] || '',
      plate: data[i][2] || '',
      code: data[i][3] || '',
      localAmount: safeNumber(data[i][4]),
      usdAmount: safeNumber(data[i][6]),
      issueDate: (issueDate instanceof Date) ? issueDate.toISOString() : null,
      receivedDate: (receivedDate instanceof Date) ? receivedDate.toISOString() : null,
      location: data[i][9] || '',
      responsibleOfPayment: data[i][10] || '',
      status: data[i][11] || '',
      reason: data[i][12] || '',
      paymentDate: (paymentDate instanceof Date) ? paymentDate.toISOString() : null,
      comment: data[i][14] || '',
      copyLink: data[i][15] || '',
      totalDeduction: safeNumber(data[i][18]),
    });
  }

  // Ordena por issue date desc (mais recente primeiro)
  fines.sort((a, b) => {
    if (!a.issueDate) return 1;
    if (!b.issueDate) return -1;
    return b.issueDate.localeCompare(a.issueDate);
  });

  return fines;
}


// ================================================================
// v5.15: MONTHLY BUSINESS REVIEW — dados consolidados pro PPTX
// ================================================================

/**
 * Retorna TODOS os dados pra montar o Monthly Business Review (PPTX) em uma chamada.
 *
 * @param {number} month - 1-12
 * @param {number} year - ex: 2026
 * @returns {Object} {
 *   month, year, monthName,
 *   tkmReport: [{ country, ctsGoal, achievementPct, tkmDone, kmDriven, efficiency, baselinePct, qcScore }, ...],
 *   tkmReportSum: { ... totals ... },
 *   topDrivers: [{ name, country, email, tkm, km, efficiency, baseline, qcScore, mappingDays }, ...] (top 10 by baseline%),
 *   vidManagement: [{ country, fleet, baseline, activeVids, halfActive, notActive, floatingCars, avgTkmPerDay, avgKmPerDay, avgEfficiency, avgQcScore, fleetBaselinePct }, ...],
 *   vidManagementTotals: { fleet, activeVids, halfActive, notActive, floatingCars, avgTkmPerDay, avgKmPerDay, avgEfficiency, avgQcScore, fleetBaselinePct },
 *   idleness: [{ country, personal, disks, mech, tech, weather }, ...],
 *   idlenessTotals: { personal, disks, mech, tech, weather }
 * }
 *
 * Note: o relatório do mês selecionado precisa **estar visível** na VID Monthly CALENDAR
 * (ela só tem o mês corrente). Se o mês solicitado não bater com o mês corrente da aba,
 * retorna o que está disponível.
 */
function getMonthlyReportData_(month, year) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[month - 1] || ('Month ' + month);

  // ---- 1) TKM Report (slide 4) — aba "TKM Monthly Drivers Report" ----
  // Cabeçalho linha 10, dados 11-16 (6 países), SUM linha 17. Lido POR NOME de
  // cabeçalho (a aba ganhou colunas Swarm/Churn no meio — a leitura por posição
  // fixa antiga pegava as colunas erradas).
  const tkmReport = [];
  let tkmReportSum = null;
  try {
    const tkmSheet = ss.getSheetByName('TKM Monthly Drivers Report');
    if (tkmSheet && tkmSheet.getLastRow() >= 17) {
      const lastCol = tkmSheet.getLastColumn();
      const head = tkmSheet.getRange(10, 1, 1, lastCol).getValues()[0];
      const ix = {
        country: findHeader_(head, ['country']),
        ctsGoal: findHeader_(head, ['cts goal (target)', 'cts goal']),
        achievement: findHeader_(head, ['cts goal achievement %', 'cts goal achievement', 'achievement']),
        tkm: findHeader_(head, ['tkm (done by drivers)', 'tkm done', 'tkm']),
        km: findHeader_(head, ['km driven', 'km']),
        eff: findHeader_(head, ['overall efficiency', 'efficiency', 'eff']),
        baseline: findHeader_(head, ['% overall baseline', 'overall baseline', 'baseline']),
        qc: findHeader_(head, ['qc score', 'qc']),
      };
      const data = tkmSheet.getRange(11, 1, 7, lastCol).getValues();  // 6 países + SUM
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const country = ix.country >= 0 ? String(row[ix.country] || '').trim() : '';
        if (!country) continue;
        const obj = {
          country: country,
          ctsGoal: safeNumber(row[ix.ctsGoal]),
          achievementPct: safeNumber(row[ix.achievement]),
          tkmDone: safeNumber(row[ix.tkm]),
          kmDriven: safeNumber(row[ix.km]),
          efficiency: safeNumber(row[ix.eff]),
          baselinePct: safeNumber(row[ix.baseline]),
          qcScore: safeNumber(row[ix.qc]),
        };
        if (country.toUpperCase() === 'SUM') {
          tkmReportSum = obj;
        } else {
          tkmReport.push(obj);
        }
      }
    }
  } catch (e) {
    Logger.log('Erro lendo TKM Report: ' + e);
  }

  // ---- 2) Top 10 Best Drivers (slide 5) — mesma aba, cabeçalho linha 20, dados 21+ ----
  // Lido por nome de cabeçalho. Ordenado por Baseline% desc.
  const allDrivers = [];
  try {
    const tkmSheet = ss.getSheetByName('TKM Monthly Drivers Report');
    if (tkmSheet) {
      const lastRow = tkmSheet.getLastRow();
      const lastCol = tkmSheet.getLastColumn();
      if (lastRow >= 21) {
        const head = tkmSheet.getRange(20, 1, 1, lastCol).getValues()[0];
        const ix = {
          name: findHeader_(head, ['driver name', 'name']),
          country: findHeader_(head, ['country']),
          email: findHeader_(head, ['corporate e-mail', 'corporate email', 'email', 'e-mail']),
          tkm: findHeader_(head, ['tkm sum', 'tkm']),
          km: findHeader_(head, ['km driven', 'km']),
          eff: findHeader_(head, ['efficiency', 'eff']),
          baseline: findHeader_(head, ['baseline%', 'baseline %', 'baseline']),
          qc: findHeader_(head, ['qc score', 'qc']),
          mappingDays: findHeader_(head, ['mapping days', 'mapping']),
        };
        const data = tkmSheet.getRange(21, 1, lastRow - 20, lastCol).getValues();
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const name = ix.name >= 0 ? String(row[ix.name] || '').trim() : '';
          const email = ix.email >= 0 ? String(row[ix.email] || '').trim() : '';
          if (!name || !email) continue;  // sem nome ou email
          allDrivers.push({
            name: name,
            country: ix.country >= 0 ? String(row[ix.country] || '').trim() : '',
            email: email,
            tkm: safeNumber(row[ix.tkm]),
            km: safeNumber(row[ix.km]),
            efficiency: safeNumber(row[ix.eff]),
            baseline: safeNumber(row[ix.baseline]),
            qcScore: safeNumber(row[ix.qc]),
            mappingDays: safeNumber(row[ix.mappingDays]),
          });
        }
      }
    }
  } catch (e) {
    Logger.log('Erro lendo Top Drivers: ' + e);
  }

  // Ordena por baseline% desc e pega top 10
  allDrivers.sort((a, b) => (b.baseline || 0) - (a.baseline || 0));
  const topDrivers = allDrivers.slice(0, 10);

  // ---- 3) VID Management (slide 6) + Idleness (slide 7) — aba "VID Monthly CALENDAR" ----
  // Headers linha 3 (idx 2): Country | Fleet | Baseline | Active VIDs | Half Active | Not Active |
  //   Floating Cars | Avg TKM/Day | Avg KM/Day | Avg Efficiency | Avg QC | Fleet Baseline% |
  //   Personal | Disks | Mech | Tech | Weather
  // Dados linha 4-9 (6 países)
  const vidManagement = [];
  let vidManagementTotals = null;
  const idleness = [];
  let idlenessTotals = null;

  try {
    const vidSheet = getSheetWithFallback_(ss, CONFIG.vidCalendarSheet, ['VID CALENDAR', 'VID Calendar']);
    if (vidSheet && vidSheet.getLastRow() >= 9) {
      // 6 países (linhas 4-9) + 1 linha SUM se tiver (linha 10?)
      const lastRowToRead = Math.min(vidSheet.getLastRow(), 11);
      const data = vidSheet.getRange(4, 1, lastRowToRead - 3, 17).getValues();

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const countryRaw = row[0];
        // Linha vazia ou linha de "totals" sem country
        if (!countryRaw && i < 6) continue;

        const country = countryRaw ? String(countryRaw).trim() : '';
        const isTotalRow = !country || country.toUpperCase() === 'SUM' || country.toUpperCase() === 'TOTAL';

        const vidObj = {
          country: country,
          fleet: safeNumber(row[1]),
          baseline: safeNumber(row[2]),
          activeVids: safeNumber(row[3]),
          halfActive: safeNumber(row[4]),
          notActive: safeNumber(row[5]),
          floatingCars: safeNumber(row[6]),
          avgTkmPerDay: safeNumber(row[7]),
          avgKmPerDay: safeNumber(row[8]),
          avgEfficiency: safeNumber(row[9]),
          avgQcScore: safeNumber(row[10]),
          fleetBaselinePct: safeNumber(row[11]),
        };

        const idleObj = {
          country: country,
          personal: safeNumber(row[12]),
          disks: safeNumber(row[13]),
          mech: safeNumber(row[14]),
          tech: safeNumber(row[15]),
          weather: safeNumber(row[16]),
        };

        if (isTotalRow) {
          vidManagementTotals = vidObj;
          idlenessTotals = idleObj;
        } else {
          vidManagement.push(vidObj);
          idleness.push(idleObj);
        }
      }

      // Se a planilha não tem linha SUM, calcula manualmente
      if (!vidManagementTotals && vidManagement.length > 0) {
        vidManagementTotals = computeVidManagementTotals_(vidManagement);
      }
      if (!idlenessTotals && idleness.length > 0) {
        idlenessTotals = computeIdlenessTotals_(idleness);
      }
    }
  } catch (e) {
    Logger.log('Erro lendo VID Calendar: ' + e);
  }

  return {
    month: month,
    year: year,
    monthName: monthName,
    tkmReport: tkmReport,
    tkmReportSum: tkmReportSum,
    topDrivers: topDrivers,
    vidManagement: vidManagement,
    vidManagementTotals: vidManagementTotals,
    idleness: idleness,
    idlenessTotals: idlenessTotals,
  };
}


// ================================================================
// v5.43: TKM Monthly Report — export PDF (dashboard)
// Lê a aba "TKM Monthly Drivers Report":
//   - bloco de país (cabeçalho linha 10, dados 11-16, SUM 17) → big numbers
//   - bloco de motoristas (cabeçalho linha 20, dados 21+)
// O mês/ano é dirigido pelos seletores B9 (mês) e D9 (ano) da aba. Pra exportar
// um mês específico a gente grava B9/D9, força recalc (flush) e DEPOIS restaura
// os valores originais. Serializado por LockService pra dois exports simultâneos
// não brigarem pela mesma célula. Colunas lidas POR NOME do cabeçalho (não por
// posição fixa) — a aba já foi reestruturada uma vez e quebrou o MBR.
// ================================================================

var TKM_REPORT_SHEET_ = 'TKM Monthly Drivers Report';

// Active Cars (v5.49): um carro conta como "ativo" se mapeou MAIS de 10 dias no mês
// (engloba Active + Half Active da terminologia da planilha — "carros que efetivamente
// mapearam por mais de 10 dias"). Contado por VID distinto direto da RAW CTS (sempre
// fresco), em vez do "Fleet Active %" da aba (que é percentual e desatualiza).
var ACTIVE_CAR_MIN_MAPPING_DAYS_ = 10;

/**
 * Conta carros ativos por país no mês: VIDs distintos da RAW CTS com MAIS de
 * ACTIVE_CAR_MIN_MAPPING_DAYS_ dias de mapeamento (status produtivo). Uma linha
 * por VID-dia; agrupa por vehicle_id, soma os dias de Mapping, e conta os que
 * passam do limite. Retorna { normCountry: count }. Fail-safe: {} se não ler.
 */
function getActiveCarCountByCountry_(monthKey) {
  const out = {};
  try {
    const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(CONFIG.rawCtsSheet);
    if (!sheet || sheet.getLastRow() < 2) return out;
    const data = sheet.getDataRange().getValues();
    const h = data[0];
    const monthIdx = findHeader_(h, ['Month']);
    const vidIdx = findHeader_(h, ['VID', 'vehicle_id']);
    const countryIdx = findHeader_(h, ['country', 'country_code']);
    const statusIdx = findHeader_(h, ['Status', 'status']);
    if (monthIdx < 0 || vidIdx < 0) return out;
    const byVid = {}; // vid → { country, days }
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][monthIdx] || '') !== monthKey) continue;
      const vid = String(data[i][vidIdx] || '').trim();
      if (!vid) continue;
      if (!byVid[vid]) byVid[vid] = { country: countryIdx >= 0 ? String(data[i][countryIdx] || '').trim() : '', days: 0 };
      if (PRODUCTIVE_STATUSES.indexOf(data[i][statusIdx]) >= 0) byVid[vid].days++;
    }
    for (const v in byVid) {
      if (byVid[v].days > ACTIVE_CAR_MIN_MAPPING_DAYS_) {
        const k = normCountry_(byVid[v].country);
        if (k) out[k] = (out[k] || 0) + 1;
      }
    }
  } catch (e) { Logger.log('getActiveCarCountByCountry_ erro: ' + e); }
  return out;
}

/**
 * Opções pros dropdowns do modal de export: meses/anos válidos (data-validation
 * dos seletores B9/D9) + lista de países do bloco de país. NÃO mexe na planilha.
 */
function getTkmReportOptions_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(TKM_REPORT_SHEET_);
  if (!sheet) return { success: false, error: 'aba "' + TKM_REPORT_SHEET_ + '" não encontrada' };

  const months = readValidationList_(sheet.getRange('B9'));
  const years = readValidationList_(sheet.getRange('D9'));

  // Países = coluna A do bloco de país (linhas 11-16), ignorando SUM/vazio
  const countries = [];
  const block = sheet.getRange(11, 1, 6, 1).getValues();
  for (let i = 0; i < block.length; i++) {
    const c = String(block[i][0] || '').trim();
    if (c && c.toUpperCase() !== 'SUM') countries.push(c);
  }

  return {
    success: true,
    months: months.length ? months.map(function (m) { return safeNumber(m); }).filter(Boolean) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    years: years.length ? years.map(function (y) { return safeNumber(y); }).filter(Boolean) : [safeNumber(sheet.getRange('D9').getValue())],
    countries: countries,
    currentMonth: safeNumber(sheet.getRange('B9').getValue()),
    currentYear: safeNumber(sheet.getRange('D9').getValue()),
  };
}

/**
 * Lê os valores permitidos de uma data-validation (lista direta ou intervalo).
 * Retorna [] se não houver validação reconhecível.
 */
function readValidationList_(range) {
  try {
    const dv = range.getDataValidation();
    if (!dv) return [];
    const type = dv.getCriteriaType();
    const vals = dv.getCriteriaValues();
    if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      return (vals[0] || []).slice();
    }
    if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
      const r = vals[0];
      const flat = r.getValues().reduce(function (a, row) { return a.concat(row); }, []);
      return flat.filter(function (v) { return v !== '' && v !== null; });
    }
    return [];
  } catch (e) {
    Logger.log('readValidationList_ erro: ' + e);
    return [];
  }
}

/**
 * Gera os dados do TKM Monthly Report pro mês/ano/país pedidos.
 * Grava B9 (mês) e D9 (ano), força recalc, lê, e SEMPRE restaura os originais.
 * @param {number} month 1-12
 * @param {number} year  ex 2026
 * @param {string} country  nome do país, ou 'ALL'/'' pra todos
 */
function getTkmReport_(month, year, country) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(TKM_REPORT_SHEET_);
  if (!sheet) return { success: false, error: 'aba "' + TKM_REPORT_SHEET_ + '" não encontrada' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return { success: false, error: 'sistema ocupado gerando outro relatório, tenta de novo em instantes' };
  }

  const wantAll = !country || String(country).toUpperCase() === 'ALL' || String(country).trim() === '';
  const monthKey = String(month) + '.' + String(year); // formato da RAW CTS / getCurrentMonthKey_ (ex '6.2026')
  let prevMonth = null, prevYear = null, restored = false;

  try {
    const mCell = sheet.getRange('B9');
    const yCell = sheet.getRange('D9');
    prevMonth = mCell.getValue();
    prevYear = yCell.getValue();

    // Só escreve se mudou (evita recalc desnecessário)
    let changed = false;
    if (month && safeNumber(prevMonth) !== month) { mCell.setValue(month); changed = true; }
    if (year && safeNumber(prevYear) !== year) { yCell.setValue(year); changed = true; }
    if (changed) SpreadsheetApp.flush();

    // ============================================================
    // FONTES VIVAS (v5.48): a aba "TKM Monthly Drivers Report" é um rollup
    // que fica desatualizado (QC/VID/timestamps de update manuais). Em vez de
    // confiar 100% nela, recalcula o que dá direto da FONTE:
    //   • TKM done / Km Driven / Efficiency / Baseline% ← RAW CTS DATA (buildRawCtsIndex_)
    //   • CTS Goal (Target) / Baseline-alvo            ← CTS Goal Management (getCtsGoals)
    // FAIL-SAFE: se a fonte viva não tiver o dado (motorista/país/mês sem linha,
    // ou erro de leitura), MANTÉM o valor da aba — nunca fica pior que hoje.
    // FICAM da aba (não dá pra re-sourcear com segurança): QC Score e VID Active
    // SUM (por motorista) + "% Overall Baseline" do bloco de país.
    // ============================================================
    const goalsByCountry = {};   // normCountry → { ctsGoal, baseline } (do período pedido)
    const liveByCountry = {};    // normCountry → { tkm, km } (Σ da RAW CTS no mês)
    let ctsIndex = {};
    try {
      const goals = getCtsGoals();
      for (let i = 0; i < goals.length; i++) {
        const g = goals[i];
        if (!periodMatches_(g.period, month, year)) continue;
        goalsByCountry[normCountry_(g.country)] = { ctsGoal: g.ctsGoal, baseline: g.baseline };
      }
    } catch (e) { Logger.log('getTkmReport_: getCtsGoals falhou (fallback p/ aba): ' + e); }
    try {
      ctsIndex = buildRawCtsIndex_();
      for (const em in ctsIndex) {
        const md = ctsIndex[em][monthKey];
        if (!md) continue;
        const k = normCountry_(md.country);
        if (!k) continue;
        if (!liveByCountry[k]) liveByCountry[k] = { tkm: 0, km: 0 };
        liveByCountry[k].tkm += safeNumber(md.tkm);
        liveByCountry[k].km += safeNumber(md.km);
      }
    } catch (e) { Logger.log('getTkmReport_: buildRawCtsIndex_ falhou (fallback p/ aba): ' + e); }

    // Active Cars por país (RAW CTS, VIDs com > 10 dias de mapeamento no mês)
    const activeCarsByCountry = getActiveCarCountByCountry_(monthKey);

    const lastCol = sheet.getLastColumn();

    // ---- Bloco de país (cabeçalho linha 10, dados 11-16, SUM 17) ----
    const cHead = sheet.getRange(10, 1, 1, lastCol).getValues()[0];
    const cIx = {
      country: findHeader_(cHead, ['country']),
      ctsGoal: findHeader_(cHead, ['cts goal (target)', 'cts goal']),
      achievement: findHeader_(cHead, ['cts goal achievement %', 'cts goal achievement', 'achievement']),
      tkm: findHeader_(cHead, ['tkm (done by drivers)', 'tkm done', 'tkm']),
      baseline: findHeader_(cHead, ['% overall baseline', 'overall baseline', 'baseline']),
      avgHours: findHeader_(cHead, ['avg system on hours', 'average mapping hours', 'avg mapping hours', 'system on hours', 'avg system']),
      // v5.58: blocos "Swarm Productivity" / "Churn Management" da aba
      swarmAchieved: findHeader_(cHead, ['swarm achieved']),
      swarmGoal: findHeader_(cHead, ['swarm goal']),
      churnAchieved: findHeader_(cHead, ['churn achieved']),
      churnGoal: findHeader_(cHead, ['churn goal']),
    };
    const cRows = sheet.getRange(11, 1, 7, lastCol).getValues(); // 6 países + SUM
    const perCountry = [];
    let sumRow = null;
    for (let i = 0; i < cRows.length; i++) {
      const row = cRows[i];
      const name = cIx.country >= 0 ? String(row[cIx.country] || '').trim() : '';
      if (!name) continue;
      const obj = {
        country: name,
        ctsGoal: safeNumber(row[cIx.ctsGoal]),
        achievementPct: safeNumber(row[cIx.achievement]),
        tkmDone: safeNumber(row[cIx.tkm]),
        baselinePct: safeNumber(row[cIx.baseline]),   // "% Overall Baseline" — FICA da aba
        avgHours: safeNumber(row[cIx.avgHours]),       // "AVG System on Hours" (col N) — FICA da aba
        // v5.58: swarm/churn são TIPOS DE MAPA distintos, com meta própria.
        // Não existem na RAW CTS (não há coluna Map Type) — só nesta aba.
        swarmAchieved: cIx.swarmAchieved >= 0 ? safeNumber(row[cIx.swarmAchieved]) : 0,
        swarmGoal: cIx.swarmGoal >= 0 ? safeNumber(row[cIx.swarmGoal]) : 0,
        churnAchieved: cIx.churnAchieved >= 0 ? safeNumber(row[cIx.churnAchieved]) : 0,
        churnGoal: cIx.churnGoal >= 0 ? safeNumber(row[cIx.churnGoal]) : 0,
      };
      if (name.toUpperCase() === 'SUM') sumRow = obj; else perCountry.push(obj);
    }

    let bigNumbers;
    if (wantAll) {
      bigNumbers = sumRow || { country: 'SUM', ctsGoal: 0, achievementPct: 0, tkmDone: 0, baselinePct: 0 };
    } else {
      bigNumbers = null;
      for (let i = 0; i < perCountry.length; i++) {
        if (matchCountry_(perCountry[i].country, country)) { bigNumbers = perCountry[i]; break; }
      }
      if (!bigNumbers) bigNumbers = { country: country, ctsGoal: 0, achievementPct: 0, tkmDone: 0, baselinePct: 0 };
    }

    // ---- Override do bloco de país com fontes vivas (CTS Goal + Σ TKM RAW CTS) ----
    // Mantém "% Overall Baseline" (baselinePct) da aba. Recalcula achievement só
    // quando ctsGoal ou tkmDone foram efetivamente trocados (evita drift de arredondamento).
    // Nota: CTS Goal (Target) vem do CTS Goal Management (getCtsGoals) — pode divergir
    // um pouco do nº na aba (a aba às vezes não é atualizada); o mgmt é o mais fresco.
    const cmpCountry = [];
    let anyCountryTouched = false;
    const overrideCountry = function (obj) {
      const k = normCountry_(obj.country);
      const g = goalsByCountry[k];
      const live = liveByCountry[k];
      const sheetVals = { tkmDone: obj.tkmDone, ctsGoal: obj.ctsGoal, achievementPct: obj.achievementPct };
      let touched = false;
      if (g && g.ctsGoal) { obj.ctsGoal = g.ctsGoal; touched = true; }
      if (live) { obj.tkmDone = live.tkm; touched = true; }
      if (touched) {
        anyCountryTouched = true;
        obj.achievementPct = obj.ctsGoal > 0 ? obj.tkmDone / obj.ctsGoal : sheetVals.achievementPct;
      }
      cmpCountry.push({
        country: obj.country,
        tkmDone: { sheet: sheetVals.tkmDone, live: obj.tkmDone },
        ctsGoal: { sheet: sheetVals.ctsGoal, live: obj.ctsGoal },
        achievementPct: { sheet: sheetVals.achievementPct, live: obj.achievementPct },
      });
    };
    perCountry.forEach(overrideCountry);
    if (wantAll && anyCountryTouched) {
      // SUM/LATAM: soma os países (já com valores vivos quando disponíveis)
      let sg = 0, st = 0;
      for (let i = 0; i < perCountry.length; i++) { sg += perCountry[i].ctsGoal || 0; st += perCountry[i].tkmDone || 0; }
      const sheetSum = { tkmDone: bigNumbers.tkmDone, ctsGoal: bigNumbers.ctsGoal, achievementPct: bigNumbers.achievementPct };
      if (sg) bigNumbers.ctsGoal = sg;
      if (st) bigNumbers.tkmDone = st;
      bigNumbers.achievementPct = bigNumbers.ctsGoal > 0 ? bigNumbers.tkmDone / bigNumbers.ctsGoal : sheetSum.achievementPct;
      cmpCountry.push({
        country: 'SUM',
        tkmDone: { sheet: sheetSum.tkmDone, live: bigNumbers.tkmDone },
        ctsGoal: { sheet: sheetSum.ctsGoal, live: bigNumbers.ctsGoal },
        achievementPct: { sheet: sheetSum.achievementPct, live: bigNumbers.achievementPct },
      });
    }

    // ---- Bloco de motoristas (cabeçalho linha 20, dados 21+) ----
    // Só entram motoristas ATIVOS (Situation=Active na HR Database, cruzado por email).
    // Fail-open: se a HR não puder ser lida (set vazio), não filtra — melhor mostrar
    // todos do que um relatório vazio por divergência de email.
    const activeSet = getActiveDriverEmailSet_();
    const hasActiveSet = Object.keys(activeSet).length > 0;

    const dHead = sheet.getRange(20, 1, 1, lastCol).getValues()[0];
    const dIx = {
      name: findHeader_(dHead, ['driver name', 'name']),
      country: findHeader_(dHead, ['country']),
      email: findHeader_(dHead, ['corporate e-mail', 'corporate email', 'email', 'e-mail']),
      qc: findHeader_(dHead, ['qc score', 'qc']),
      km: findHeader_(dHead, ['km driven', 'km']),
      eff: findHeader_(dHead, ['efficiency', 'eff']),
      vidActive: findHeader_(dHead, ['vid active sum', 'vid active']),
      baseline: findHeader_(dHead, ['baseline%', 'baseline %', 'baseline']),
      // v5.52: TKM por motorista (fallback da aba; fonte viva é a RAW CTS),
      // AVG System on Hours por motorista, e o VID atual (fallback quando não há RAW CTS)
      tkm: findHeader_(dHead, ['tkm sum', 'tkm (done by drivers)', 'tkm done']),
      avgHours: findHeader_(dHead, ['avg system on hours', 'average mapping hours', 'avg mapping hours', 'system on hours', 'avg system']),
      currentVid: findHeader_(dHead, ['current/last vid', 'current vid', 'last vid']),
      // v5.58: blocos "Swarm Productivity" / "Churn Maps" por motorista
      tkmSwarm: findHeader_(dHead, ['tkm swarm']),
      kmSwarm: findHeader_(dHead, ['km driven swarm']),
      swarmDays: findHeader_(dHead, ['swarm days']),
      tkmChurn: findHeader_(dHead, ['tkm churn']),
      kmChurn: findHeader_(dHead, ['km driven churn']),
      churnDays: findHeader_(dHead, ['churn days']),
    };
    const drivers = [];
    const driverDiffs = [];
    let driversWithLive = 0;
    const lastRow = sheet.getLastRow();
    if (lastRow >= 21 && dIx.name >= 0) {
      const dRows = sheet.getRange(21, 1, lastRow - 20, lastCol).getValues();
      for (let i = 0; i < dRows.length; i++) {
        const row = dRows[i];
        const dName = String(row[dIx.name] || '').trim();
        if (!dName) continue;
        const dCountry = dIx.country >= 0 ? String(row[dIx.country] || '').trim() : '';
        if (!wantAll && !matchCountry_(dCountry, country)) continue;
        const dEmail = dIx.email >= 0 ? String(row[dIx.email] || '').trim().toLowerCase() : '';
        // filtro de ativo (por email)
        if (hasActiveSet && (!dEmail || !activeSet[dEmail])) continue;

        // valores da aba (fallback)
        const sheetKm = safeNumber(row[dIx.km]);
        const sheetEff = safeNumber(row[dIx.eff]);
        const sheetBaseline = safeNumber(row[dIx.baseline]);
        const sheetTkm = dIx.tkm >= 0 ? safeNumber(row[dIx.tkm]) : 0;

        // override com RAW CTS + CTS Goal (só se houver linha viva do motorista no mês)
        let kmDriven = sheetKm, efficiency = sheetEff, baselinePct = sheetBaseline, tkm = sheetTkm;
        let vids = [];
        const liveMd = (dEmail && ctsIndex[dEmail]) ? ctsIndex[dEmail][monthKey] : null;
        if (liveMd) {
          driversWithLive++;
          const lTkm = safeNumber(liveMd.tkm), lKm = safeNumber(liveMd.km);
          kmDriven = lKm;
          tkm = lTkm;
          efficiency = lKm > 0 ? lTkm / lKm : sheetEff;
          if (liveMd.vids && liveMd.vids.length) vids = liveMd.vids.slice();
          const cb = goalsByCountry[normCountry_(dCountry)];
          baselinePct = (cb && cb.baseline > 0) ? lTkm / cb.baseline : sheetBaseline;
          if (driverDiffs.length < 12) {
            driverDiffs.push({
              name: dName,
              km: { sheet: sheetKm, live: kmDriven },
              eff: { sheet: sheetEff, live: efficiency },
              baselinePct: { sheet: sheetBaseline, live: baselinePct },
            });
          }
        }

        // Sem linha viva na RAW CTS: usa o "Current/Last VID" da aba como número único
        if (!vids.length && dIx.currentVid >= 0 && row[dIx.currentVid] != null && row[dIx.currentVid] !== '') {
          vids = [String(row[dIx.currentVid]).trim()];
        }

        drivers.push({
          name: dName,
          country: dCountry,
          qcScore: safeNumber(row[dIx.qc]),              // QC Score — FICA da aba
          tkm: tkm,                                      // v5.52: TKM (RAW CTS, fallback aba)
          kmDriven: kmDriven,
          efficiency: efficiency,
          avgHours: dIx.avgHours >= 0 ? safeNumber(row[dIx.avgHours]) : 0,  // v5.52: AVG System on Hours — da aba
          vidActiveSum: safeNumber(row[dIx.vidActive]),  // VID Active SUM — FICA da aba
          vids: vids,                                    // v5.52: VIDs distintos rodados (RAW CTS)
          baselinePct: baselinePct,
          // v5.58: swarm vs churn por motorista (só existem nesta aba)
          tkmSwarm: dIx.tkmSwarm >= 0 ? safeNumber(row[dIx.tkmSwarm]) : 0,
          kmSwarm: dIx.kmSwarm >= 0 ? safeNumber(row[dIx.kmSwarm]) : 0,
          swarmDays: dIx.swarmDays >= 0 ? safeNumber(row[dIx.swarmDays]) : 0,
          tkmChurn: dIx.tkmChurn >= 0 ? safeNumber(row[dIx.tkmChurn]) : 0,
          kmChurn: dIx.kmChurn >= 0 ? safeNumber(row[dIx.kmChurn]) : 0,
          churnDays: dIx.churnDays >= 0 ? safeNumber(row[dIx.churnDays]) : 0,
        });
      }
    }
    // ordena por baseline% desc (igual a aba)
    drivers.sort(function (a, b) { return (b.baselinePct || 0) - (a.baselinePct || 0); });

    // restaura ANTES de retornar (e marca pra não restaurar de novo no finally)
    if (changed) {
      mCell.setValue(prevMonth);
      yCell.setValue(prevYear);
      SpreadsheetApp.flush();
    }
    restored = true;

    // Baseline (valor absoluto alvo) por país, da CTS Goal Management, do período pedido.
    try {
      let baseTotal = 0;
      for (const k in goalsByCountry) baseTotal += goalsByCountry[k].baseline || 0;
      for (let i = 0; i < perCountry.length; i++) {
        const gb = goalsByCountry[normCountry_(perCountry[i].country)];
        perCountry[i].baseline = gb ? (gb.baseline || 0) : 0;
      }
      bigNumbers.baseline = wantAll ? baseTotal : ((goalsByCountry[normCountry_(country)] || {}).baseline || 0);
    } catch (e) {
      Logger.log('Erro montando baseline-alvo: ' + e);
    }

    // Active Cars por país (RAW CTS, > 10 dias de mapeamento) + total LATAM
    try {
      let carsTotal = 0;
      for (let i = 0; i < perCountry.length; i++) {
        const ac = activeCarsByCountry[normCountry_(perCountry[i].country)] || 0;
        perCountry[i].activeCars = ac;
        carsTotal += ac;
      }
      bigNumbers.activeCars = wantAll ? carsTotal : (activeCarsByCountry[normCountry_(country)] || 0);
    } catch (e) {
      Logger.log('Erro montando activeCars: ' + e);
    }

    // v5.52: # motoristas + VIDs (com motoristas / ativos) por país e total LATAM.
    // Calculado do próprio array de motoristas já filtrado por ativo (consistente com a tabela).
    // - driversActive  = quantos motoristas ativos
    // - vidsWithDrivers = nº de VIDs distintos rodados por motoristas (RAW CTS)
    // - vidsActive      = soma do "VID Active SUM" da aba (ativos as per Google)
    try {
      const perC = {};
      let totVidActive = 0;
      const totVidSet = {};
      drivers.forEach(function (d) {
        const k = normCountry_(d.country);
        if (!perC[k]) perC[k] = { drivers: 0, vidActive: 0, vidSet: {} };
        perC[k].drivers++;
        const va = safeNumber(d.vidActiveSum);
        perC[k].vidActive += va;
        totVidActive += va;
        (d.vids || []).forEach(function (v) { if (v) { perC[k].vidSet[v] = true; totVidSet[v] = true; } });
      });
      for (let i = 0; i < perCountry.length; i++) {
        const pc = perC[normCountry_(perCountry[i].country)] || { drivers: 0, vidActive: 0, vidSet: {} };
        perCountry[i].driversActive = pc.drivers;
        perCountry[i].vidsActive = pc.vidActive;
        perCountry[i].vidsWithDrivers = Object.keys(pc.vidSet).length;
      }
      bigNumbers.driversActive = drivers.length;
      bigNumbers.vidsActive = totVidActive;
      bigNumbers.vidsWithDrivers = Object.keys(totVidSet).length;
    } catch (e) {
      Logger.log('Erro montando driversActive/vids: ' + e);
    }

    return {
      success: true,
      month: month,
      year: year,
      country: wantAll ? 'ALL' : country,
      bigNumbers: bigNumbers,   // país escolhido (ou SUM/LATAM quando ALL); .baseline vem da CTS Goal Mgmt
      perCountry: perCountry,   // big numbers de cada país (pro PDF seccionado de ALL)
      drivers: drivers,
      // v5.48: auditoria live-vs-aba pra validar o re-sourcing (pode remover depois)
      comparison: {
        monthKey: monthKey,
        perCountry: cmpCountry,
        drivers: { total: drivers.length, withLiveData: driversWithLive, sampleDiffs: driverDiffs },
      },
    };
  } catch (err) {
    Logger.log('getTkmReport_ erro: ' + err);
    return { success: false, error: String(err) };
  } finally {
    if (!restored && prevMonth !== null) {
      try {
        sheet.getRange('B9').setValue(prevMonth);
        sheet.getRange('D9').setValue(prevYear);
        SpreadsheetApp.flush();
      } catch (e) { Logger.log('restore B9/D9 erro: ' + e); }
    }
    lock.releaseLock();
  }
}

// ================================================================
// v5.58 — CLIENT METRICS (portal público do cliente)
// ================================================================
// Alimenta o client-metrics.html: escolhe país + mês e vê KPIs no topo
// e a lista de motoristas embaixo. Fonte = RAW CTS DATA (1 linha por
// VID-dia, com Map Type = Swarm/Churn), CTS Goal Management (meta),
// VID Monthly CALENDAR (status per Google) e HR (nome do motorista).
//
// NADA financeiro entra aqui — a página é pública.

/** Códigos de país da RAW CTS → nome cheio (o export às vezes manda ISO2). */
const CLIENT_COUNTRY_NAMES_ = {
  ar: 'Argentina', arg: 'Argentina',
  br: 'Brazil', bra: 'Brazil',
  cl: 'Chile', chl: 'Chile',
  co: 'Colombia', col: 'Colombia',
  mx: 'Mexico', mex: 'Mexico',
  pe: 'Peru', per: 'Peru',
};

/** Normaliza país vindo da RAW CTS: aceita 'AR', 'Argentina', 'argentina'. */
function clientCountryName_(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const k = normCountry_(s);
  if (CLIENT_COUNTRY_NAMES_[k]) return CLIENT_COUNTRY_NAMES_[k];
  return s.charAt(0).toUpperCase() + s.slice(1);
}


/**
 * Status da frota per Google por país, da aba VID Monthly CALENDAR
 * (bloco de país, linhas 4-9): Active VIDs | Half Active | Not Active | Fleet.
 * ⚠ A aba é do MÊS CORRENTE dela — devolve também qual mês ela representa
 * pro frontend avisar quando o usuário pedir um mês diferente.
 */
function getClientFleetStatus_() {
  const out = { byCountry: {}, month: null, year: null };
  try {
    const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const sheet = getSheetWithFallback_(ss, CONFIG.vidCalendarSheet, ['VID CALENDAR', 'VID Calendar']);
    if (!sheet || sheet.getLastRow() < 4) return out;
    out.month = safeNumber(sheet.getRange(2, 2).getValue()) || null;
    out.year = safeNumber(sheet.getRange(2, 3).getValue()) || null;
    const lastRow = Math.min(sheet.getLastRow(), 11);
    const data = sheet.getRange(4, 1, lastRow - 3, 7).getValues();
    for (let i = 0; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();
      if (!name) continue;
      if (name.toUpperCase() === 'SUM' || name.toUpperCase() === 'TOTAL') continue;
      out.byCountry[normCountry_(clientCountryName_(name))] = {
        fleet: safeNumber(data[i][1]),
        active: safeNumber(data[i][3]),
        halfActive: safeNumber(data[i][4]),
        notActive: safeNumber(data[i][5]),
        floating: safeNumber(data[i][6]),
      };
    }
  } catch (e) {
    Logger.log('getClientFleetStatus_ erro: ' + e);
  }
  return out;
}

/** Soma os buckets de frota de vários países num objeto só. */
function sumFleet_(list) {
  const t = { fleet: 0, active: 0, halfActive: 0, notActive: 0, floating: 0 };
  list.forEach(function (f) {
    t.fleet += f.fleet || 0;
    t.active += f.active || 0;
    t.halfActive += f.halfActive || 0;
    t.notActive += f.notActive || 0;
    t.floating += f.floating || 0;
  });
  return t;
}

/** Adiciona activePct/halfPct/notActivePct (0-1) ao objeto de frota. */
function withFleetPcts_(f) {
  const base = (f.active || 0) + (f.halfActive || 0) + (f.notActive || 0);
  const denom = base > 0 ? base : (f.fleet || 0);
  f.statusTotal = denom;
  f.activePct = denom > 0 ? f.active / denom : 0;
  f.halfActivePct = denom > 0 ? f.halfActive / denom : 0;
  f.notActivePct = denom > 0 ? f.notActive / denom : 0;
  return f;
}

/**
 * KPIs + lista de motoristas pro portal do cliente (/cts-data).
 *
 * FONTE: a aba "TKM Monthly Drivers Report" (via getTkmReport_), que é
 * exatamente o que a CTS enxerga — inclui swarm e churn, que são TIPOS DE
 * MAPA com meta própria e NÃO existem na RAW CTS DATA (não há coluna
 * Map Type lá). Status da frota vem do VID Monthly CALENDAR.
 *
 * ⚠ getTkmReport_ só escreve em B9/D9 quando o mês/ano pedido é diferente
 * do que já está lá (e restaura sempre, sob lock). Como o portal usa por
 * padrão o período corrente da aba, o caso normal é leitura pura.
 *
 * @param {number} month  1-12 (default: período corrente da aba)
 * @param {number} year   ex 2026
 * @param {string} country nome do país, ou 'ALL'
 */
function getClientMetrics_(month, year, country) {
  try {
    // Sem mês/ano explícito: usa o período que a aba já está mostrando
    // (evita qualquer escrita na planilha no acesso padrão do cliente).
    let opts = null;
    try { opts = getTkmReportOptions_(); } catch (e) { Logger.log('getClientMetrics_: options falhou: ' + e); }
    if (!month) month = (opts && opts.currentMonth) || (new Date().getMonth() + 1);
    if (!year) year = (opts && opts.currentYear) || (new Date().getFullYear());

    const wantAll = !country || String(country).toUpperCase() === 'ALL' || String(country).trim() === '';

    const rep = getTkmReport_(month, year, wantAll ? 'ALL' : country);
    if (!rep || rep.success === false) {
      return { success: false, error: (rep && rep.error) || 'falha lendo o relatório mensal' };
    }

    const big = rep.bigNumbers || {};
    const repDrivers = rep.drivers || [];

    // ---- motoristas ----
    const vidSetAll = {};
    const drivers = repDrivers.map(function (d) {
      (d.vids || []).forEach(function (v) { if (v) vidSetAll[v] = true; });
      const tkmSwarm = safeNumber(d.tkmSwarm);
      const tkmChurn = safeNumber(d.tkmChurn);
      const typed = tkmSwarm + tkmChurn;
      return {
        name: d.name,
        country: clientCountryName_(d.country),
        tkm: safeNumber(d.tkm),
        kmDriven: safeNumber(d.kmDriven),
        efficiency: safeNumber(d.efficiency),
        avgSystemOnHours: safeNumber(d.avgHours),   // "AVG System on Hours" da aba
        qcScore: safeNumber(d.qcScore),
        baselinePct: safeNumber(d.baselinePct),
        tkmSwarm: tkmSwarm,
        kmSwarm: safeNumber(d.kmSwarm),
        swarmDays: safeNumber(d.swarmDays),
        tkmChurn: tkmChurn,
        kmChurn: safeNumber(d.kmChurn),
        churnDays: safeNumber(d.churnDays),
        swarmPct: typed > 0 ? tkmSwarm / typed : 0,
        churnPct: typed > 0 ? tkmChurn / typed : 0,
        mappingDays: safeNumber(d.swarmDays) + safeNumber(d.churnDays),
        vids: d.vids || [],
        vidCount: (d.vids || []).length,
      };
    });

    // ---- frota per Google (VID Monthly CALENDAR) ----
    const fleetSrc = getClientFleetStatus_();
    let fleet;
    if (wantAll) {
      const list = [];
      for (const k in fleetSrc.byCountry) list.push(fleetSrc.byCountry[k]);
      fleet = sumFleet_(list);
    } else {
      fleet = fleetSrc.byCountry[normCountry_(clientCountryName_(country))] ||
              { fleet: 0, active: 0, halfActive: 0, notActive: 0, floating: 0 };
    }
    withFleetPcts_(fleet);
    fleet.sourceMonth = fleetSrc.month;
    fleet.sourceYear = fleetSrc.year;
    fleet.isCurrentPeriod = (fleetSrc.month === month && fleetSrc.year === year);

    // ---- KPIs ----
    // AVG System on Hours: usa o da aba (país). No ALL, média ponderada pelos
    // motoristas — a linha SUM da aba às vezes traz média simples dos países.
    let avgHours = safeNumber(big.avgHours);
    if (drivers.length) {
      let sum = 0, n = 0;
      drivers.forEach(function (d) { if (d.avgSystemOnHours > 0) { sum += d.avgSystemOnHours; n++; } });
      if (n > 0) avgHours = sum / n;
    }

    const swarmAch = safeNumber(big.swarmAchieved);
    const churnAch = safeNumber(big.churnAchieved);
    const typedTotal = swarmAch + churnAch;

    let totalMappingDays = 0;
    drivers.forEach(function (d) { totalMappingDays += d.mappingDays; });

    // Meses/países pros seletores (data-validation da aba — o que o relatório aceita)
    const months = [];
    if (opts && opts.months && opts.years) {
      const ys = opts.years.slice().sort(function (a, b) { return b - a; });
      ys.forEach(function (y) {
        opts.months.slice().sort(function (a, b) { return b - a; }).forEach(function (m) {
          months.push({ month: m, year: y });
        });
      });
    } else {
      months.push({ month: month, year: year });
    }

    const countries = (rep.perCountry || []).map(function (c) { return clientCountryName_(c.country); });

    return {
      success: true,
      month: month,
      year: year,
      country: wantAll ? 'ALL' : country,
      months: months,
      countries: countries,
      kpis: {
        goalTkm: safeNumber(big.ctsGoal),
        tkmDone: safeNumber(big.tkmDone),
        achievementPct: safeNumber(big.achievementPct),
        baselinePct: safeNumber(big.baselinePct),
        kmDriven: (function () { let k = 0; drivers.forEach(function (d) { k += d.kmDriven; }); return k; })(),
        efficiency: (function () {
          let t = 0, k = 0;
          drivers.forEach(function (d) { t += d.tkm; k += d.kmDriven; });
          return k > 0 ? t / k : 0;
        })(),
        totalDrivers: drivers.length,
        totalVids: Object.keys(vidSetAll).length || safeNumber(big.vidsActive),
        avgSystemOnHours: avgHours,
        mappingDays: totalMappingDays,
        // swarm/churn: TKM entregue vs meta de cada tipo de mapa
        swarmTkm: swarmAch,
        swarmGoal: safeNumber(big.swarmGoal),
        swarmAchievementPct: safeNumber(big.swarmGoal) > 0 ? swarmAch / safeNumber(big.swarmGoal) : 0,
        churnTkm: churnAch,
        churnGoal: safeNumber(big.churnGoal),
        churnAchievementPct: safeNumber(big.churnGoal) > 0 ? churnAch / safeNumber(big.churnGoal) : 0,
        swarmPct: typedTotal > 0 ? swarmAch / typedTotal : 0,
        churnPct: typedTotal > 0 ? churnAch / typedTotal : 0,
        fleet: fleet,
      },
      perCountry: (rep.perCountry || []).map(function (c) {
        return {
          country: clientCountryName_(c.country),
          goalTkm: safeNumber(c.ctsGoal),
          tkmDone: safeNumber(c.tkmDone),
          achievementPct: safeNumber(c.achievementPct),
          avgSystemOnHours: safeNumber(c.avgHours),
          swarmTkm: safeNumber(c.swarmAchieved),
          swarmGoal: safeNumber(c.swarmGoal),
          churnTkm: safeNumber(c.churnAchieved),
          churnGoal: safeNumber(c.churnGoal),
          driversActive: safeNumber(c.driversActive),
        };
      }),
      drivers: drivers,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    Logger.log('getClientMetrics_ erro: ' + err);
    return { success: false, error: String(err) };
  }
}



/**
 * Acha o índice (0-based) da 1ª coluna cujo cabeçalho casa com um dos candidatos
 * (case-insensitive, ignora espaços extras). Tenta igualdade exata, depois "contém".
 * Retorna -1 se não achar.
 */
function findHeader_(headerRow, candidates) {
  const norm = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); };
  const H = headerRow.map(norm);
  const C = candidates.map(norm);
  for (let j = 0; j < C.length; j++) {
    const idx = H.indexOf(C[j]);
    if (idx >= 0) return idx;
  }
  for (let j = 0; j < C.length; j++) {
    for (let i = 0; i < H.length; i++) {
      if (H[i] && H[i].indexOf(C[j]) >= 0) return i;
    }
  }
  return -1;
}

/** Normaliza nome de país: minúsculas, sem acento, trim. */
function normCountry_(s) {
  s = String(s == null ? '' : s).toLowerCase().trim();
  return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
}

/** Compara país de forma tolerante (case-insensitive, trim, ignora acentos). */
function matchCountry_(a, b) {
  const x = normCountry_(a), y = normCountry_(b);
  return !!x && !!y && x === y;
}

/** Período "M.YYYY" (ex "6.2026") casa com mês/ano numéricos? Tolera "06.2026". */
function periodMatches_(periodStr, month, year) {
  const parts = String(periodStr == null ? '' : periodStr).split('.');
  if (parts.length < 2) return false;
  return parseInt(parts[0], 10) === month && parseInt(parts[1], 10) === year;
}

/**
 * Set (objeto-mapa) de emails (lowercase) de motoristas com Situation=Active na
 * HR Database. Mesmo critério do getActiveDriversByCountry_ (Active/Ativo/Activo
 * ou vazio). Retorna {} se não conseguir ler (o chamador deve fazer fail-open).
 */
function getActiveDriverEmailSet_() {
  const set = {};
  try {
    const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(CONFIG.hrSheet);
    if (!sheet || sheet.getLastRow() < 2) return set;
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const findCol = function () {
      const names = Array.prototype.slice.call(arguments);
      for (let i = 0; i < headers.length; i++) {
        const h = String(headers[i] || '').trim().toLowerCase();
        for (let j = 0; j < names.length; j++) if (h === names[j].toLowerCase()) return i;
      }
      return -1;
    };
    const idxEmail = findCol('Corporate E-mail', 'Email', 'Driver Email');
    const idxStatus = findCol('Situation', 'Status', 'Driver Status');
    if (idxEmail < 0) return set;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    for (let i = 0; i < data.length; i++) {
      const email = String(data[i][idxEmail] || '').trim().toLowerCase();
      if (!email) continue;
      const status = idxStatus >= 0 ? String(data[i][idxStatus] || '').trim().toLowerCase() : 'active';
      const isActive = status === 'active' || status === 'ativo' || status === 'activo' || status === '';
      if (isActive) set[email] = true;
    }
  } catch (e) {
    Logger.log('getActiveDriverEmailSet_ erro: ' + e);
  }
  return set;
}


function computeVidManagementTotals_(rows) {
  if (!rows.length) return null;
  let fleet = 0, active = 0, half = 0, notAct = 0, float_ = 0;
  let avgTkmSum = 0, avgKmSum = 0, avgEffSum = 0, avgQcSum = 0, fleetBaseSum = 0;
  rows.forEach(r => {
    fleet += r.fleet || 0;
    active += r.activeVids || 0;
    half += r.halfActive || 0;
    notAct += r.notActive || 0;
    float_ += r.floatingCars || 0;
    avgTkmSum += r.avgTkmPerDay || 0;
    avgKmSum += r.avgKmPerDay || 0;
    avgEffSum += r.avgEfficiency || 0;
    avgQcSum += r.avgQcScore || 0;
    fleetBaseSum += r.fleetBaselinePct || 0;
  });
  const n = rows.length;
  return {
    country: 'TOTAL',
    fleet: fleet,
    activeVids: active,
    halfActive: half,
    notActive: notAct,
    floatingCars: float_,
    avgTkmPerDay: avgTkmSum / n,
    avgKmPerDay: avgKmSum / n,
    avgEfficiency: avgEffSum / n,
    avgQcScore: avgQcSum / n,
    fleetBaselinePct: fleetBaseSum / n,
  };
}

function computeIdlenessTotals_(rows) {
  if (!rows.length) return null;
  return rows.reduce((acc, r) => ({
    country: 'TOTAL',
    personal: (acc.personal || 0) + (r.personal || 0),
    disks: (acc.disks || 0) + (r.disks || 0),
    mech: (acc.mech || 0) + (r.mech || 0),
    tech: (acc.tech || 0) + (r.tech || 0),
    weather: (acc.weather || 0) + (r.weather || 0),
  }), {});
}


// ================================================================
// v5.16: CASH FLOW — Cash Requests + Receipts (substitui Google Forms)
// ================================================================
//
// 2 fluxos:
//   A) saveCashRequest  — driver pede dinheiro adiantado (vai pra Cash Transfer Management)
//   B) saveCashReceipt  — driver sobe recibo de gasto (vai pra Cash Receipts BR ou HC)
//
// Em ambos:
//   - Converte valor local → USD via Frankfurter API (com cache 1h)
//   - Notifica via email pro EMAIL_CONFIG.cashRecipients
//   - Recibos uploaded como base64 → pasta no Drive (auto-criada)
//
// País → moeda:
//   Argentina → ARS, Brasil → BRL, Chile → CLP, Colombia → COP, México → MXN, Peru → PEN

const CASH_COUNTRY_CURRENCY = {
  'argentina': 'ARS',
  'brazil': 'BRL', 'brasil': 'BRL',
  'chile': 'CLP',
  'colombia': 'COP',
  'mexico': 'MXN', 'méxico': 'MXN',
  'peru': 'PEN', 'perú': 'PEN',
};

/**
 * Lista drivers ATIVOS agrupados por país (pro dropdown da cash.html).
 * Critério de "ativo": Status na HR DATABASE = 'Active'.
 * Retorna: { Argentina: [{name, email, country, currency}, ...], Brazil: [...], ... }
 */
function getActiveDriversByCountry_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.hrSheet);
  if (!sheet || sheet.getLastRow() < 2) return {};

  // Lê headers pra fazer findCol dinâmico
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const findCol = (...names) => {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim().toLowerCase();
      for (const n of names) {
        if (h === n.toLowerCase()) return i;
      }
    }
    return -1;
  };

  const idxName = findCol('Beneficiary Full Name', 'Full Name', 'Driver Name', 'Name');
  const idxEmail = findCol('Corporate E-mail', 'Email', 'Driver Email');
  const idxCountry = findCol('Country');
  const idxStatus = findCol('Situation', 'Status', 'Driver Status');

  if (idxName < 0 || idxEmail < 0 || idxCountry < 0) {
    Logger.log('⚠ getActiveDriversByCountry_: colunas essenciais não encontradas. Headers: ' + headers.join(' | '));
    return {};
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const grouped = {};

  data.forEach(row => {
    const name = String(row[idxName] || '').trim();
    const email = String(row[idxEmail] || '').trim();
    const country = String(row[idxCountry] || '').trim();
    const status = idxStatus >= 0 ? String(row[idxStatus] || '').trim().toLowerCase() : 'active';

    if (!name || !email || !country) return;
    // "Active" / "Activo" / "Ativo" — outros valores como "Inactive", "End", "Vacation" filtramos fora
    const isActive = status === 'active' || status === 'ativo' || status === 'activo' || status === '';
    if (!isActive) return;

    const currency = CASH_COUNTRY_CURRENCY[country.toLowerCase()] || 'USD';

    if (!grouped[country]) grouped[country] = [];
    grouped[country].push({ name, email, country, currency });
  });

  // Ordena drivers dentro de cada país por nome
  Object.keys(grouped).forEach(c => {
    grouped[c].sort((a, b) => a.name.localeCompare(b.name));
  });

  return grouped;
}

/**
 * Pega cotação USD→moeda (ex: USD→BRL = 5.42).
 * Fonte: api.frankfurter.dev (free, sem auth).
 * Cache via PropertiesService (1h) pra evitar bater toda vez.
 */
function getUsdRate_(currency) {
  if (!currency || currency === 'USD') return 1;
  const cur = String(currency).toUpperCase();

  const props = PropertiesService.getScriptProperties();
  const cacheKey = 'usd_rates_all_v2';
  const cached = props.getProperty(cacheKey);

  if (cached) {
    const parsed = JSON.parse(cached);
    const ageMin = (Date.now() - parsed.fetchedAt) / 1000 / 60;
    if (ageMin < 60 && parsed.rates && parsed.rates[cur]) return parsed.rates[cur];
  }

  // Cache miss ou vencido — chama open.er-api.com (suporta TODAS moedas LATAM: ARS, BRL, CLP, COP, PEN, MXN)
  // Frankfurter foi descartada porque não suporta ARS/COP/CLP/PEN.
  try {
    const url = 'https://open.er-api.com/v6/latest/USD';
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Logger.log('⚠ open.er-api erro: ' + response.getResponseCode());
      if (cached) return JSON.parse(cached).rates[cur] || null;
      return null;
    }
    const data = JSON.parse(response.getContentText());
    if (data.result !== 'success' || !data.rates) {
      Logger.log('⚠ open.er-api resposta inválida');
      if (cached) return JSON.parse(cached).rates[cur] || null;
      return null;
    }
    props.setProperty(cacheKey, JSON.stringify({ rates: data.rates, fetchedAt: Date.now() }));
    return data.rates[cur] || null;
  } catch (e) {
    Logger.log('Erro chamando open.er-api: ' + e);
    if (cached) return JSON.parse(cached).rates[cur] || null;
    return null;
  }
}

/**
 * Converte valor em moeda local pra USD.
 * Retorna { usdAmount, rate } ou { usdAmount: null, rate: null } se falhar.
 */
function convertToUsd_(amount, currency) {
  if (!amount || amount <= 0) return { usdAmount: 0, rate: null };
  if (currency === 'USD') return { usdAmount: amount, rate: 1 };

  const rate = getUsdRate_(currency);
  if (!rate) return { usdAmount: null, rate: null };

  return {
    usdAmount: Math.round((amount / rate) * 100) / 100,
    rate: rate,
  };
}

/**
 * Garante que a pasta de uploads no Drive existe.
 * Estrutura: cash_receipts_uploads/YYYY-MM/
 */
/**
 * v5.20: Helper pra inserir nova linha numa posição específica (em vez de appendRow no fim).
 * Usado pelas abas de Cash que organizam mais recente em cima.
 *
 * @param {Sheet} sheet — a aba do spreadsheet
 * @param {number} atRow — linha onde inserir (1-indexed). A linha atual nessa posição
 *                         é empurrada pra baixo.
 * @param {Array} rowValues — array de valores pra escrever
 */
function insertRowAt_(sheet, atRow, rowValues) {
  if (!sheet || !rowValues || rowValues.length === 0) return;
  // Insere linha vazia na posição
  sheet.insertRowBefore(atRow);
  // Escreve os valores
  sheet.getRange(atRow, 1, 1, rowValues.length).setValues([rowValues]);
}

function ensureCashUploadsFolder_() {
  const yearMonth = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM');
  const rootName = CONFIG.cashReceiptsFolderName;

  // Procura pasta raiz
  const rootIter = DriveApp.getFoldersByName(rootName);
  let rootFolder = rootIter.hasNext() ? rootIter.next() : DriveApp.createFolder(rootName);

  // Procura subpasta por mês
  const monthIter = rootFolder.getFoldersByName(yearMonth);
  return monthIter.hasNext() ? monthIter.next() : rootFolder.createFolder(yearMonth);
}

/**
 * Faz upload de um recibo (base64) pro Drive.
 * Retorna o link público do arquivo.
 */
function uploadReceiptToDrive_(base64Data, originalFilename, driverName) {
  if (!base64Data) return '';

  // Strip do prefixo "data:image/jpeg;base64,"
  const cleanBase64 = String(base64Data).replace(/^data:[^;]+;base64,/, '');

  // Detecta MIME pelo prefixo
  const mimeMatch = String(base64Data).match(/^data:([^;]+);base64,/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const ext = mime.split('/')[1] || 'jpg';

  const folder = ensureCashUploadsFolder_();
  const ts = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd_HH-mm-ss');
  const safeName = String(driverName || 'unknown')
    .replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const filename = `${ts}_${safeName}_${(originalFilename || 'recibo').replace(/[^a-z0-9.]/gi, '_')}.${ext}`;

  const blob = Utilities.newBlob(Utilities.base64Decode(cleanBase64), mime, filename);
  const file = folder.createFile(blob);

  // Permissão "anyone with link can view" pra ficar acessível pelo planilha
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('Aviso ao definir sharing: ' + e);
  }

  return file.getUrl();
}


// ================================================================
// MyMaps (v5.42) — uploads mensais do Google MyMaps por país.
// O frontend (ops-map.html) parseia o KML/KMZ pra GeoJSON e manda o
// GeoJSON já pronto; aqui só guardamos no Drive + metadados na aba.
// ================================================================

/** Pasta raiz dos MyMaps no Drive (auto-criada), com subpasta por país. */
function getMyMapsFolder_(countryCode) {
  const rootName = CONFIG.myMapsFolderName;
  const it = DriveApp.getFoldersByName(rootName);
  const root = it.hasNext() ? it.next() : DriveApp.createFolder(rootName);
  if (!countryCode) return root;
  const safe = String(countryCode).replace(/[^a-z0-9]/gi, '_').toUpperCase() || 'X';
  const subIt = root.getFoldersByName(safe);
  return subIt.hasNext() ? subIt.next() : root.createFolder(safe);
}

/** Garante a aba de metadados dos MyMaps com cabeçalho. */
function ensureMyMapsSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.myMapsSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.myMapsSheet);
    sheet.appendRow(['Timestamp', 'Country', 'Month', 'Label', 'Filename', 'FileId', 'Url', 'UploadedBy', 'FeatureCount']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ================================================================
// v5.45: VID Status — curadoria manual de quais VIDs estão ativos por país
// (ops-map admin). Persiste na aba "VID Status". Por VID (asset único).
// ================================================================

/** Garante a aba "VID Status" com cabeçalho. */
function ensureVidStatusSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.vidStatusSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.vidStatusSheet);
    sheet.appendRow(['Country', 'VID', 'Status', 'UpdatedBy', 'UpdatedAt']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Lê a curadoria. Retorna [{ country, vid, status('active'|'inactive'|'cancelled'), active(bool) }]. */
function getVidStatus_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.vidStatusSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const country = String(data[i][0] || '').trim();
    const vid = String(data[i][1] || '').trim();
    if (!country || !vid) continue;
    const raw = String(data[i][2]).trim().toLowerCase();
    // tri-estado: ativo (frota) | inativo (parado, mas é nosso) | cancelado (não temos mais)
    let status = 'active';
    if (['cancelled', 'canceled', 'cancelado', 'cancelada'].indexOf(raw) >= 0) status = 'cancelled';
    else if (['inactive', 'inativo', 'inactivo', 'no', 'false', '0'].indexOf(raw) >= 0) status = 'inactive';
    out.push({ country: country, vid: vid, status: status, active: status === 'active' });
  }
  return out;
}

/**
 * Sobrescreve a curadoria de UM país (mantém os outros países intactos).
 * data: { country, items: [{vid, status('active'|'inactive'|'cancelled')}], updatedBy }
 * (aceita também o legado {vid, active(bool)})
 */
function saveVidStatus_(data) {
  const country = String(data.country || '').trim();
  if (!country) return { success: false, error: 'country obrigatório' };
  const items = Array.isArray(data.items) ? data.items : [];
  const user = String(data.updatedBy || '');

  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { success: false, error: 'sistema ocupado, tenta de novo' }; }
  try {
    const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const sheet = ensureVidStatusSheet_(ss);
    const now = new Date();

    const all = sheet.getLastRow() >= 2 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues() : [];
    const kept = all.filter(function (r) {
      return String(r[0] || '').trim().toLowerCase() !== country.toLowerCase();
    });

    const fresh = [];
    const seen = {};
    for (let i = 0; i < items.length; i++) {
      const vid = String(items[i].vid || '').trim();
      if (!vid || seen[vid]) continue;
      seen[vid] = true;
      let st = String(items[i].status || '').trim().toLowerCase();
      if (!st) st = items[i].active ? 'active' : 'inactive';   // fallback legado
      const label = st === 'cancelled' ? 'Cancelled' : (st === 'inactive' ? 'Inactive' : 'Active');
      fresh.push([country, vid, label, user, now]);
    }

    if (sheet.getLastRow() >= 2) sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();
    const rows = kept.concat(fresh);
    if (rows.length) sheet.getRange(2, 1, rows.length, 5).setValues(rows);

    return { success: true, count: fresh.length };
  } catch (err) {
    Logger.log('saveVidStatus_ erro: ' + err);
    return { success: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Salva um MyMaps (GeoJSON já parseado no client) no Drive + registra na aba.
 * data: { country, month ('YYYY-MM'), label, originalFilename, featureCount, uploadedBy, geojson (string) }
 */
function saveMyMap_(data) {
  const country = String(data.country || '').trim();
  const month = String(data.month || '').trim();
  if (!country || !month) return { success: false, error: 'country e month são obrigatórios' };
  const geojsonStr = data.geojson;
  if (!geojsonStr) return { success: false, error: 'geojson vazio' };

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const folder = getMyMapsFolder_(country);
  const safeCountry = country.replace(/[^a-z0-9]/gi, '_').toUpperCase();
  const stamp = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd_HH-mm-ss');
  const filename = `${safeCountry}_${month}_${stamp}.geojson`;

  const blob = Utilities.newBlob(geojsonStr, 'application/json', filename);
  const file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    Logger.log('MyMaps sharing aviso: ' + e);
  }

  const sheet = ensureMyMapsSheet_(ss);
  sheet.appendRow([
    new Date(), country, month, String(data.label || month),
    String(data.originalFilename || filename), file.getId(), file.getUrl(),
    String(data.uploadedBy || ''), data.featureCount || '',
  ]);

  return { success: true, fileId: file.getId(), url: file.getUrl(), filename: filename };
}

/** Lista os uploads de MyMaps (mais recentes primeiro). Filtra por país se informado. */
function listMyMaps_(country) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.myMapsSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const wanted = String(country || '').toUpperCase();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const c = String(row[1] || '');
    if (wanted && c.toUpperCase() !== wanted) continue;
    out.push({
      timestamp: (row[0] instanceof Date) ? row[0].toISOString() : '',
      country: c,
      month: String(row[2] || ''),
      label: String(row[3] || ''),
      filename: String(row[4] || ''),
      fileId: String(row[5] || ''),
      url: String(row[6] || ''),
      uploadedBy: String(row[7] || ''),
      featureCount: row[8] || 0,
    });
  }
  out.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  return out;
}

/** Serve o conteúdo (GeoJSON em texto) de um upload pelo fileId do Drive. */
function getMyMap_(fileId) {
  if (!fileId) return { success: false, error: 'fileId obrigatório' };
  try {
    const file = DriveApp.getFileById(fileId);
    const content = file.getBlob().getDataAsString();  // utf-8
    return { success: true, geojson: content, filename: file.getName() };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Garante que as 4 colunas extras existem nas abas Cash Receipts:
 *   Currency, Local Amount, USD Amount, USD Rate Used
 * (Adicionadas DEPOIS das colunas existentes, sem mexer nas originais)
 */
function ensureCashReceiptsExtraColumns_(sheet) {
  if (!sheet) return;
  const lastCol = sheet.getLastColumn();
  // Headers existentes vão até col 10 (J = "Recibo"). Extras: K,L,M,N
  if (lastCol >= 14) return;

  const extras = ['Currency', 'Local Amount', 'USD Amount', 'USD Rate Used'];
  const startCol = Math.max(lastCol + 1, 11);
  const numToAdd = 14 - Math.max(lastCol, 10);
  const headersToAdd = extras.slice(4 - numToAdd);
  if (numToAdd <= 0) return;

  sheet.getRange(1, startCol, 1, numToAdd).setValues([headersToAdd]);
  sheet.getRange(1, startCol, 1, numToAdd).setFontWeight('bold').setBackground('#f0f0f0');
}

/**
 * Salva um pedido de dinheiro (driver pedindo X moeda local pra Salary/Operational Spends).
 * Vai pra aba Cash Transfer Management. Notifica por email.
 *
 * Espera:
 *   driverName, driverEmail, country, localAmount, currency,
 *   reason ('Salary' | 'Operational Spends'), neededByDate ('yyyy-MM-dd'),
 *   notes (opcional)
 */
/**
 * v5.18: Lê e retorna pedidos (Cash Transfer Management) + recibos (Cash Receipts BR + HC)
 * num formato unificado pra ramp.html.
 *
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate 'YYYY-MM-DD'
 * @returns {Object} { requests: [...], receipts: [...] }
 */
function getCashTransactions_(startDate, endDate) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

  const start = startDate ? new Date(startDate + 'T00:00:00') : null;
  const end = endDate ? new Date(endDate + 'T23:59:59') : null;

  // ============ Pedidos (Cash Transfer Management) ============
  const requests = [];
  try {
    const sheet = ss.getSheetByName(CONFIG.cashTransferSheet);
    if (sheet && sheet.getLastRow() >= 2) {
      const lastCol = Math.max(sheet.getLastColumn(), 20);
      const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
      // Estrutura: A=Beneficiary, B=Country, C=USD Amount, D=Date Request, E=Date Needed,
      // F=Reason, G=Responsible, H=Status, I=Save, K=Google Rates,
      // L=Local Amount, M=Currency, N=USD Rate Used,
      // O=Category, P=Location Address, Q=Lat, R=Lng, S=Method, T=Attachment URL
      data.forEach((row, idx) => {
        if (!row[0] || !row[3]) return;  // sem driver ou sem data
        const dateRequest = row[3] instanceof Date ? row[3] : new Date(row[3]);
        if (isNaN(dateRequest.getTime())) return;
        if (start && dateRequest < start) return;
        if (end && dateRequest > end) return;

        requests.push({
          rowIdx: idx + 2,  // pra futuras edições admin
          driverName: String(row[0] || '').trim(),
          country: String(row[1] || '').trim(),
          usdAmount: safeNumber(row[2]),
          dateRequest: Utilities.formatDate(dateRequest, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss'),
          dateNeeded: row[4] instanceof Date
            ? Utilities.formatDate(row[4], 'America/Sao_Paulo', 'yyyy-MM-dd')
            : (row[4] || ''),
          reason: String(row[5] || '').trim(),
          responsible: String(row[6] || '').trim(),
          status: String(row[7] || '').trim() || 'Pending',
          localAmount: safeNumber(row[11]),
          currency: String(row[12] || '').toUpperCase(),
          usdRate: safeNumber(row[13]),
          category: String(row[14] || '').trim(),
          locationAddress: String(row[15] || '').trim(),
          locationLat: row[16] !== '' && row[16] !== null ? safeNumber(row[16]) : null,
          locationLng: row[17] !== '' && row[17] !== null ? safeNumber(row[17]) : null,
          locationMethod: String(row[18] || '').trim(),
          attachmentUrl: String(row[19] || '').trim(),
        });
      });
    }
  } catch (err) {
    Logger.log('Erro lendo Cash Transfer Management: ' + err);
  }

  // ============ Recibos (Cash Receipts BR + HC unificados) ============
  const receipts = [];
  ['cashReceiptsBrSheet', 'cashReceiptsHcSheet'].forEach(sheetKey => {
    try {
      const sheetName = CONFIG[sheetKey];
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() < 2) return;

      const lastCol = Math.max(sheet.getLastColumn(), 14);
      const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
      // Estrutura: A=Timestamp, B=Email, C=Nome, D=Categoria, E=Quando, F=Quanto,
      // G=Estabelecimento, H=Observação, I=Hotel dates, J=Recibo,
      // K=Currency, L=Local Amount, M=USD Amount, N=USD Rate Used
      data.forEach((row, idx) => {
        if (!row[0] || !row[2]) return;  // sem timestamp ou sem nome
        const timestamp = row[0] instanceof Date ? row[0] : new Date(row[0]);
        if (isNaN(timestamp.getTime())) return;
        if (start && timestamp < start) return;
        if (end && timestamp > end) return;

        // País é inferido pela aba (BR sheet → Brazil, HC sheet → outros)
        const isBr = sheetKey === 'cashReceiptsBrSheet';

        receipts.push({
          rowIdx: idx + 2,
          source: isBr ? 'BR' : 'HC',
          sheetName: sheetName,
          timestamp: Utilities.formatDate(timestamp, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm:ss'),
          driverEmail: String(row[1] || '').trim(),
          driverName: String(row[2] || '').trim(),
          category: String(row[3] || '').trim(),
          paymentDate: row[4] instanceof Date
            ? Utilities.formatDate(row[4], 'America/Sao_Paulo', 'yyyy-MM-dd')
            : (row[4] || ''),
          localAmount: safeNumber(row[5]),
          establishment: String(row[6] || '').trim(),
          notes: String(row[7] || '').trim(),
          hotelDates: String(row[8] || '').trim(),
          receiptUrl: String(row[9] || '').trim(),
          currency: String(row[10] || '').toUpperCase(),
          usdAmount: row[12] !== '' && row[12] !== null ? safeNumber(row[12]) : null,
          usdRate: row[13] !== '' && row[13] !== null ? safeNumber(row[13]) : null,
        });
      });
    } catch (err) {
      Logger.log('Erro lendo ' + sheetKey + ': ' + err);
    }
  });

  // Enriquece recibos com país (puxa do HR Database por email)
  const driversByEmail = getDriversCountryMap_();
  receipts.forEach(r => {
    r.country = driversByEmail[r.driverEmail.toLowerCase()] || (r.source === 'BR' ? 'Brazil' : '');
  });

  // Ordena ambos por data desc
  requests.sort((a, b) => b.dateRequest.localeCompare(a.dateRequest));
  receipts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return { requests, receipts };
}

/**
 * Retorna mapa email→país lendo HR Database (cache leve)
 */
function getDriversCountryMap_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.hrSheet);
  if (!sheet || sheet.getLastRow() < 2) return {};

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const findCol = (...names) => {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim().toLowerCase();
      for (const n of names) if (h === n.toLowerCase()) return i;
    }
    return -1;
  };
  const idxEmail = findCol('Corporate E-mail', 'Email');
  const idxCountry = findCol('Country');
  if (idxEmail < 0 || idxCountry < 0) return {};

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const map = {};
  data.forEach(row => {
    const email = String(row[idxEmail] || '').trim().toLowerCase();
    const country = String(row[idxCountry] || '').trim();
    if (email && country) map[email] = country;
  });
  return map;
}

/**
 * v5.21: Retorna info consolidada de um driver pro modal do motorista.
 *
 * @param {string} email - email do driver (preferencial)
 * @param {string} name - nome do driver (fallback se sem email)
 * @returns {Object|null} { name, email, country, status, base, ... } ou null se não achar
 */
/**
 * v5.22: Whitelist de admins backend (espelha CASH_ADMIN_USERNAMES do frontend).
 * Defesa em profundidade: mesmo se atacante manipular o frontend, backend rejeita.
 */
function isCashAdminBackend_(username) {
  const adminList = ['fuss'];
  if (!username) return false;
  return adminList.includes(String(username).toLowerCase().trim());
}

/**
 * v5.22: Valida que a linha esperada ainda corresponde ao driver+timestamp do request.
 * Protege contra race conditions (alguém adicionou linha entre leitura e edição).
 *
 * @param {Sheet} sheet
 * @param {number} rowIdx 1-indexed
 * @param {string} expectedDriverName
 * @param {string} expectedTimestamp ISO ou data formatada
 * @param {number} nameCol coluna do nome (0-indexed)
 * @param {number} dateCol coluna do timestamp (0-indexed)
 * @returns {Object|null} dados da linha se válida, null se mudou
 */
function validateCashRow_(sheet, rowIdx, expectedDriverName, expectedTimestamp, nameCol, dateCol) {
  if (rowIdx < 2 || rowIdx > sheet.getLastRow()) return null;
  const row = sheet.getRange(rowIdx, 1, 1, sheet.getLastColumn()).getValues()[0];
  const actualName = String(row[nameCol] || '').trim().toLowerCase();
  const expected = String(expectedDriverName || '').trim().toLowerCase();
  if (actualName !== expected) {
    Logger.log('Row mismatch: row ' + rowIdx + ' has name "' + actualName + '" but expected "' + expected + '"');
    return null;
  }
  // Compara só a parte da data (yyyy-MM-dd) pra ser tolerante com formatação
  if (expectedTimestamp) {
    const actualDate = row[dateCol] instanceof Date
      ? Utilities.formatDate(row[dateCol], 'America/Sao_Paulo', 'yyyy-MM-dd')
      : String(row[dateCol] || '').substring(0, 10);
    const expectedDate = String(expectedTimestamp).substring(0, 10);
    if (actualDate !== expectedDate) {
      Logger.log('Date mismatch: row ' + rowIdx + ' has date "' + actualDate + '" but expected "' + expectedDate + '"');
      return null;
    }
  }
  return row;
}

/**
 * v5.22: Grava ação no audit log (cria aba se não existir).
 */
function appendCashAudit_(action, sheetName, rowIdx, before, after, adminUser) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  let sheet = ss.getSheetByName('Cash Audit Log');

  if (!sheet) {
    sheet = ss.insertSheet('Cash Audit Log');
    const headers = ['Timestamp', 'Admin User', 'Action', 'Sheet', 'Row Idx', 'Driver', 'Before (JSON)', 'After (JSON)'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1E3A5F').setFontColor('white');
    sheet.setFrozenRows(1);
  }

  const driver = (before && (before.driverName || before[0])) || (after && after.driverName) || '';
  const beforeJson = before ? JSON.stringify(before).substring(0, 5000) : '';
  const afterJson = after ? JSON.stringify(after).substring(0, 5000) : '';

  sheet.appendRow([
    new Date(),
    adminUser || '?',
    action,
    sheetName,
    rowIdx,
    driver,
    beforeJson,
    afterJson,
  ]);
}

/**
 * v5.22: Atualiza um pedido de dinheiro (Cash Transfer Management).
 * Espera: rowIdx, expectedDriver, expectedDate (validação)
 *         + os campos a atualizar: status, category, localAmount, currency,
 *         responsible, reason, notes, dateNeeded, adminUser
 */
function updateCashRequest_(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.cashTransferSheet);
  if (!sheet) throw new Error('Aba não encontrada');

  const rowIdx = parseInt(data.rowIdx, 10);
  if (!rowIdx || rowIdx < 11) throw new Error('rowIdx inválido');

  // Cash Transfer Management: A=Beneficiary(0), D=Date Request(3)
  const oldRow = validateCashRow_(sheet, rowIdx, data.expectedDriver, data.expectedDate, 0, 3);
  if (!oldRow) throw new Error('Linha foi modificada por outro usuário. Recarregue a página e tente novamente.');

  const before = {
    driverName: oldRow[0],
    country: oldRow[1],
    usdAmount: oldRow[2],
    dateRequest: oldRow[3],
    dateNeeded: oldRow[4],
    reason: oldRow[5],
    responsible: oldRow[6],
    status: oldRow[7],
    localAmount: oldRow[11],
    currency: oldRow[12],
    category: oldRow[14],
  };

  // Aplica updates (só nos campos que vieram)
  if (data.status !== undefined) sheet.getRange(rowIdx, 8).setValue(data.status);
  if (data.responsible !== undefined) sheet.getRange(rowIdx, 7).setValue(data.responsible);
  if (data.reason !== undefined) sheet.getRange(rowIdx, 6).setValue(data.reason);
  if (data.dateNeeded !== undefined) {
    const dn = data.dateNeeded ? new Date(data.dateNeeded + 'T12:00:00') : '';
    sheet.getRange(rowIdx, 5).setValue(dn);
  }
  if (data.localAmount !== undefined) {
    const localAmount = safeNumber(data.localAmount);
    sheet.getRange(rowIdx, 12).setValue(localAmount);
    // Recalcula USD se moeda + valor presentes
    const currency = data.currency || oldRow[12];
    if (currency) {
      const conv = convertToUsd_(localAmount, currency);
      if (conv.usdAmount !== null) {
        sheet.getRange(rowIdx, 3).setValue(conv.usdAmount);
        sheet.getRange(rowIdx, 14).setValue(conv.rate);
      }
    }
  }
  if (data.currency !== undefined) sheet.getRange(rowIdx, 13).setValue(String(data.currency).toUpperCase());
  if (data.category !== undefined) sheet.getRange(rowIdx, 15).setValue(data.category);

  appendCashAudit_('UPDATE', CONFIG.cashTransferSheet, rowIdx, before, data, data.adminUser);

  return { message: 'Pedido atualizado' };
}

/**
 * v5.22: Atualiza um recibo de gasto (Cash Receipts BR ou HC).
 */
function updateCashReceipt_(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheetName = data.source === 'BR' ? CONFIG.cashReceiptsBrSheet : CONFIG.cashReceiptsHcSheet;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Aba não encontrada: ' + sheetName);

  const rowIdx = parseInt(data.rowIdx, 10);
  if (!rowIdx || rowIdx < 2) throw new Error('rowIdx inválido');

  // Cash Receipts: A=Timestamp(0), C=Nome(2)
  const oldRow = validateCashRow_(sheet, rowIdx, data.expectedDriver, data.expectedDate, 2, 0);
  if (!oldRow) throw new Error('Linha foi modificada por outro usuário. Recarregue a página e tente novamente.');

  const before = {
    timestamp: oldRow[0],
    driverEmail: oldRow[1],
    driverName: oldRow[2],
    category: oldRow[3],
    paymentDate: oldRow[4],
    localAmount: oldRow[5],
    establishment: oldRow[6],
    notes: oldRow[7],
    currency: oldRow[10],
  };

  // Aplica updates
  if (data.category !== undefined) sheet.getRange(rowIdx, 4).setValue(data.category);
  if (data.paymentDate !== undefined) {
    const pd = data.paymentDate ? new Date(data.paymentDate + 'T12:00:00') : '';
    sheet.getRange(rowIdx, 5).setValue(pd);
  }
  if (data.establishment !== undefined) sheet.getRange(rowIdx, 7).setValue(data.establishment);
  if (data.notes !== undefined) sheet.getRange(rowIdx, 8).setValue(data.notes);
  if (data.localAmount !== undefined) {
    const localAmount = safeNumber(data.localAmount);
    sheet.getRange(rowIdx, 6).setValue(localAmount);
    sheet.getRange(rowIdx, 12).setValue(localAmount);
    // Recalcula USD
    const currency = data.currency || oldRow[10];
    if (currency) {
      const conv = convertToUsd_(localAmount, currency);
      if (conv.usdAmount !== null) {
        sheet.getRange(rowIdx, 13).setValue(conv.usdAmount);
        sheet.getRange(rowIdx, 14).setValue(conv.rate);
      }
    }
  }
  if (data.currency !== undefined) sheet.getRange(rowIdx, 11).setValue(String(data.currency).toUpperCase());

  appendCashAudit_('UPDATE', sheetName, rowIdx, before, data, data.adminUser);

  return { message: 'Recibo atualizado' };
}

/**
 * v5.22: Deleta linha do Cash Transfer Management.
 */
function deleteCashRequest_(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.cashTransferSheet);
  if (!sheet) throw new Error('Aba não encontrada');

  const rowIdx = parseInt(data.rowIdx, 10);
  if (!rowIdx || rowIdx < 11) throw new Error('rowIdx inválido');

  const oldRow = validateCashRow_(sheet, rowIdx, data.expectedDriver, data.expectedDate, 0, 3);
  if (!oldRow) throw new Error('Linha foi modificada por outro usuário. Recarregue a página e tente novamente.');

  const before = {
    driverName: oldRow[0],
    country: oldRow[1],
    usdAmount: oldRow[2],
    dateRequest: oldRow[3],
    reason: oldRow[5],
    status: oldRow[7],
    localAmount: oldRow[11],
    currency: oldRow[12],
  };

  // Loga ANTES de deletar (senão perde a info)
  appendCashAudit_('DELETE', CONFIG.cashTransferSheet, rowIdx, before, null, data.adminUser);

  sheet.deleteRow(rowIdx);

  return { message: 'Pedido deletado' };
}

/**
 * v5.22: Deleta linha do Cash Receipts (BR ou HC).
 */
function deleteCashReceipt_(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheetName = data.source === 'BR' ? CONFIG.cashReceiptsBrSheet : CONFIG.cashReceiptsHcSheet;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Aba não encontrada: ' + sheetName);

  const rowIdx = parseInt(data.rowIdx, 10);
  if (!rowIdx || rowIdx < 2) throw new Error('rowIdx inválido');

  const oldRow = validateCashRow_(sheet, rowIdx, data.expectedDriver, data.expectedDate, 2, 0);
  if (!oldRow) throw new Error('Linha foi modificada por outro usuário. Recarregue a página e tente novamente.');

  const before = {
    timestamp: oldRow[0],
    driverEmail: oldRow[1],
    driverName: oldRow[2],
    category: oldRow[3],
    localAmount: oldRow[5],
    currency: oldRow[10],
  };

  appendCashAudit_('DELETE', sheetName, rowIdx, before, null, data.adminUser);

  sheet.deleteRow(rowIdx);

  return { message: 'Recibo deletado' };
}


function getDriverInfo_(email, name) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.hrSheet);
  if (!sheet || sheet.getLastRow() < 2) return null;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const findCol = (...names) => {
    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i] || '').trim().toLowerCase();
      for (const n of names) if (h === n.toLowerCase()) return i;
    }
    return -1;
  };

  const idxName = findCol('Beneficiary Full Name', 'Full Name', 'Driver Name', 'Name');
  const idxEmail = findCol('Corporate E-mail', 'Email', 'Driver Email');
  const idxCountry = findCol('Country');
  const idxStatus = findCol('Situation', 'Status');
  const idxPhone = findCol('Phone Number', 'Phone');
  const idxJoining = findCol('Joining Date/Renovation Date', 'Joining Date', 'First Joining Date');
  const idxRate = findCol('Per Hour Salary (USD)', 'Salary');

  if (idxName < 0 || idxEmail < 0) return null;

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const emailLower = (email || '').toLowerCase();
  const nameLower = (name || '').toLowerCase();

  let found = null;
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rEmail = String(row[idxEmail] || '').trim().toLowerCase();
    const rName = String(row[idxName] || '').trim().toLowerCase();
    if ((emailLower && rEmail === emailLower) || (nameLower && rName === nameLower)) {
      found = row;
      break;
    }
  }

  if (!found) return null;

  // Pega base também
  const driverEmail = String(found[idxEmail] || '').trim();
  let base = null;
  try {
    base = getDriverBase(driverEmail);
  } catch (e) { /* ignore */ }

  return {
    name: String(found[idxName] || '').trim(),
    email: driverEmail,
    country: String(found[idxCountry] || '').trim(),
    status: idxStatus >= 0 ? String(found[idxStatus] || '').trim() : '',
    phone: idxPhone >= 0 ? String(found[idxPhone] || '').trim() : '',
    joiningDate: idxJoining >= 0 && found[idxJoining]
      ? Utilities.formatDate(new Date(found[idxJoining]), 'America/Sao_Paulo', 'yyyy-MM-dd')
      : '',
    hourlyRate: idxRate >= 0 ? safeNumber(found[idxRate]) : null,
    base: base,
  };
}


function saveCashRequest_(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.cashTransferSheet);
  if (!sheet) {
    throw new Error('Aba "' + CONFIG.cashTransferSheet + '" não encontrada');
  }

  const now = new Date();
  const localAmount = safeNumber(data.localAmount);
  const currency = String(data.currency || '').toUpperCase();
  const conv = convertToUsd_(localAmount, currency);
  const usdAmount = conv.usdAmount;
  const rate = conv.rate;

  const neededBy = data.neededByDate ? new Date(data.neededByDate + 'T12:00:00') : '';

  // v2.1: upload opcional (orçamento, foto, nota proforma)
  let attachmentUrl = '';
  if (data.attachmentBase64) {
    try {
      attachmentUrl = uploadReceiptToDrive_(data.attachmentBase64, data.attachmentFilename, data.driverName);
    } catch (e) {
      Logger.log('Erro upload anexo: ' + e);
    }
  }

  // Estrutura ATUAL da aba Cash Transfer Management (re-verificada com user em 2026-05-15):
  //   A: Beneficiary's Full Name | B: Country | C: Amount (USD) | D: Date of Request | E: Date of Payment/Needed by
  //   F: Reason for deposit | G: Responsible | H: Status (validation strict: Requested/Cancelled/Finished/Delayed/In Process)
  //   I: Fee USD | J: Local Amount Received (Estimated) | K: Personal E-mail | L: Corporate E-mail
  //   M: Month (MM/YYYY) | N: (vazio)
  //   O: Category | P: Location Address | Q: Location Lat | R: Location Lng | S: Location Method
  //   T: Attachment URL
  const monthStr = Utilities.formatDate(now, 'America/Sao_Paulo', 'MM/yyyy');

  const row = new Array(20).fill('');
  row[0] = data.driverName || '';                                                    // A: Beneficiary
  row[1] = data.country || '';                                                       // B: Country
  row[2] = usdAmount !== null ? usdAmount : '';                                      // C: Amount (USD)
  row[3] = now;                                                                      // D: Date of Request
  row[4] = neededBy;                                                                 // E: Date of Payment/Needed by
  row[5] = data.reason || '';                                                        // F: Reason for deposit
  row[6] = '';                                                                       // G: Responsible (preenchido manualmente depois)
  row[7] = 'Requested';                                                              // H: Status — só aceita Requested/Cancelled/Finished/Delayed/In Process
  row[8] = '';                                                                       // I: Fee USD (vazio — não temos info)
  row[9] = localAmount;                                                              // J: Local Amount Received (Estimated)
  row[10] = '';                                                                      // K: Personal E-mail (vazio — não temos)
  row[11] = data.driverEmail || '';                                                  // L: Corporate E-mail
  row[12] = monthStr;                                                                // M: Month (MM/YYYY)
  row[13] = '';                                                                      // N: (vazio na planilha)
  row[14] = data.category || '';                                                     // O: Category
  row[15] = data.locationAddress || '';                                              // P: Location Address
  row[16] = data.locationLat !== null && data.locationLat !== undefined ? data.locationLat : '';  // Q: Location Lat
  row[17] = data.locationLng !== null && data.locationLng !== undefined ? data.locationLng : '';  // R: Location Lng
  row[18] = data.locationMethod || '';                                               // S: Location Method
  row[19] = attachmentUrl;                                                           // T: Attachment URL

  // v5.20: insere no topo (linha 11), não no fim
  // A aba Cash Transfer Management tem header em L9-L10 ("Transactions History")
  // e dados começam em L11 com mais recente em cima.
  insertRowAt_(sheet, 11, row);

  // Notifica por email
  try {
    sendCashNotificationEmail_('request', {
      driverName: data.driverName,
      driverEmail: data.driverEmail,
      country: data.country,
      localAmount: localAmount,
      currency: currency,
      usdAmount: usdAmount,
      reason: data.reason,
      neededByDate: data.neededByDate,
      notes: data.notes,
      category: data.category,
      locationAddress: data.locationAddress,
      locationLat: data.locationLat,
      locationLng: data.locationLng,
      locationMethod: data.locationMethod,      // v2
      fileUrl: attachmentUrl,                   // v2.1: anexo (orçamento/foto)
    });
  } catch (e) {
    Logger.log('Aviso: erro ao enviar email de notificação: ' + e);
  }

  Logger.log('Cash request salvo: ' + data.driverName + ' ' + currency + ' ' + localAmount);
  return {
    message: 'Pedido registrado',
    usdAmount: usdAmount,
    fileUrl: attachmentUrl,
  };
}

/**
 * Salva um recibo de gasto (driver justificando gasto, com upload de foto).
 * Vai pra Cash Receipts BR (se Brasil) ou HC (resto LATAM).
 *
 * Espera:
 *   driverName, driverEmail, country, category, paymentDate ('yyyy-MM-dd'),
 *   localAmount, currency, establishment, notes (opcional),
 *   hotelDates (opcional, pra categoria Hotel),
 *   receiptBase64 (opcional, "data:image/...;base64,..."), receiptFilename
 */
function saveCashReceipt_(data) {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);

  // Decide aba pelo país
  const country = String(data.country || '').toLowerCase();
  const isBrazil = country === 'brazil' || country === 'brasil';
  const sheetName = isBrazil ? CONFIG.cashReceiptsBrSheet : CONFIG.cashReceiptsHcSheet;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Aba "' + sheetName + '" não encontrada');
  }

  ensureCashReceiptsExtraColumns_(sheet);

  const now = new Date();
  const localAmount = safeNumber(data.localAmount);
  const currency = String(data.currency || '').toUpperCase();
  const conv = convertToUsd_(localAmount, currency);
  const usdAmount = conv.usdAmount;
  const rate = conv.rate;

  // Upload do recibo se enviado
  let fileUrl = '';
  if (data.receiptBase64) {
    try {
      fileUrl = uploadReceiptToDrive_(data.receiptBase64, data.receiptFilename, data.driverName);
    } catch (e) {
      Logger.log('Erro upload recibo: ' + e);
    }
  }

  // Data de pagamento como Date object (não string)
  const paymentDate = data.paymentDate ? new Date(data.paymentDate + 'T12:00:00') : '';

  // Estrutura (idêntica entre BR e HC):
  //   A: Timestamp | B: Email | C: Nome | D: Categoria | E: Quando? | F: Quanto? |
  //   G: Estabelecimento | H: Observação | I: Hotel dates | J: Recibo (link Drive) |
  //   K: Currency (extra) | L: Local Amount (extra) | M: USD Amount (extra) | N: USD Rate Used (extra)
  // Nota: F (Quanto?) recebe o valor LOCAL (igual aos forms hoje fazem) — pra histórico ficar consistente
  const row = [
    now,                         // A: Timestamp
    data.driverEmail || '',      // B: Email
    data.driverName || '',       // C: Nome
    data.category || '',         // D: Categoria
    paymentDate,                 // E: Quando?
    localAmount,                 // F: Quanto? (valor local)
    data.establishment || '',    // G: Estabelecimento
    data.notes || '',            // H: Observação
    data.hotelDates || '',       // I: Datas hotel
    fileUrl,                     // J: Recibo (link Drive)
    currency,                    // K: Currency
    localAmount,                 // L: Local Amount (duplicado, mas explícito)
    usdAmount !== null ? usdAmount : '',  // M: USD Amount
    rate !== null ? rate : '',   // N: USD Rate Used
  ];

  // v5.20: insere no topo (linha 2), não no fim
  // Cash Receipts BR/HC têm header em L1 e dados começam em L2 com mais recente em cima.
  insertRowAt_(sheet, 2, row);

  // Notifica por email
  try {
    sendCashNotificationEmail_('receipt', {
      driverName: data.driverName,
      driverEmail: data.driverEmail,
      country: data.country,
      category: data.category,
      establishment: data.establishment,
      localAmount: localAmount,
      currency: currency,
      usdAmount: usdAmount,
      paymentDate: data.paymentDate,
      notes: data.notes,
      fileUrl: fileUrl,
      sheetName: sheetName,
    });
  } catch (e) {
    Logger.log('Aviso: erro ao enviar email de notificação: ' + e);
  }

  Logger.log('Cash receipt salvo: ' + data.driverName + ' ' + currency + ' ' + localAmount + ' (' + sheetName + ')');
  return {
    message: 'Recibo registrado',
    usdAmount: usdAmount,
    fileUrl: fileUrl,
  };
}

/**
 * Envia email de notificação ao Ops Lead quando rola um cash request ou receipt.
 */
function sendCashNotificationEmail_(type, data) {
  if (!EMAIL_CONFIG.cashRecipients) return;

  const isRequest = type === 'request';
  const tz = 'America/Sao_Paulo';
  const today = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm');

  const usdStr = data.usdAmount !== null && data.usdAmount !== undefined
    ? `USD ${data.usdAmount.toFixed(2)}`
    : 'USD ?';

  const subject = isRequest
    ? `💰 [Cash Request] ${data.driverName} (${data.country}) — ${data.currency} ${data.localAmount} = ${usdStr}`
    : `🧾 [Cash Receipt] ${data.driverName} (${data.country}) — ${data.category}: ${data.currency} ${data.localAmount} = ${usdStr}`;

  let html = `<div style="font-family:Arial,sans-serif;max-width:560px;">
    <div style="background:#1E3A5F;color:white;padding:14px 20px;border-radius:6px 6px 0 0;">
      <h2 style="margin:0;font-size:18px;">${isRequest ? '💰 Novo pedido de dinheiro' : '🧾 Novo recibo enviado'}</h2>
      <div style="font-size:12px;opacity:0.9;margin-top:4px;">${today}</div>
    </div>
    <div style="background:#fff;border:1px solid #ddd;border-top:none;padding:18px 20px;border-radius:0 0 6px 6px;">
      <table style="width:100%;font-size:13px;">
        <tr><td style="padding:6px 0;color:#64748B;width:120px;">Driver:</td><td><strong>${escapeHtml_(data.driverName)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#64748B;">Email:</td><td>${escapeHtml_(data.driverEmail)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748B;">País:</td><td>${escapeHtml_(data.country)}</td></tr>`;

  if (isRequest) {
    html += `
        <tr><td style="padding:6px 0;color:#64748B;">Motivo:</td><td><strong>${escapeHtml_(data.reason)}</strong></td></tr>`;

    // v2: categoria (só Operational tem)
    if (data.category) {
      html += `<tr><td style="padding:6px 0;color:#64748B;">Categoria:</td><td><strong>${escapeHtml_(data.category)}</strong></td></tr>`;
    }

    html += `
        <tr><td style="padding:6px 0;color:#64748B;">Valor pedido:</td><td style="font-size:16px;"><strong>${data.currency} ${data.localAmount}</strong> ≈ <strong style="color:#16A34A;">${usdStr}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#64748B;">Precisa até:</td><td><strong>${data.neededByDate || '—'}</strong></td></tr>`;

    // v2: localização (só Operational tem)
    if (data.locationAddress || data.locationLat) {
      const methodEmoji = data.locationMethod === 'gps' ? '📍' : '✍';
      const mapsLink = (data.locationLat && data.locationLng)
        ? ` (<a href="https://www.google.com/maps?q=${data.locationLat},${data.locationLng}" style="color:#5BA0DC;">ver no mapa</a>)`
        : '';
      html += `<tr><td style="padding:6px 0;color:#64748B;">${methodEmoji} Localização:</td><td>${escapeHtml_(data.locationAddress || '')}${mapsLink}</td></tr>`;
    }

    // v2.1: anexo opcional (orçamento, foto do problema, etc) — só mostra se tiver
    if (data.fileUrl) {
      html += `<tr><td style="padding:6px 0;color:#64748B;">📎 Comprovante:</td><td><a href="${data.fileUrl}" style="color:#5BA0DC;">Ver anexo</a></td></tr>`;
    }
  } else {
    html += `
        <tr><td style="padding:6px 0;color:#64748B;">Categoria:</td><td><strong>${escapeHtml_(data.category)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#64748B;">Estabelecimento:</td><td>${escapeHtml_(data.establishment || '—')}</td></tr>
        <tr><td style="padding:6px 0;color:#64748B;">Valor:</td><td style="font-size:16px;"><strong>${data.currency} ${data.localAmount}</strong> ≈ <strong style="color:#16A34A;">${usdStr}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#64748B;">Data pagamento:</td><td>${data.paymentDate || '—'}</td></tr>`;
    if (data.fileUrl) {
      html += `<tr><td style="padding:6px 0;color:#64748B;">Recibo:</td><td><a href="${data.fileUrl}" style="color:#5BA0DC;">📎 Ver foto</a></td></tr>`;
    } else {
      html += `<tr><td style="padding:6px 0;color:#DC2626;">⚠ Recibo:</td><td style="color:#DC2626;">Não enviado</td></tr>`;
    }
  }

  if (data.notes) {
    html += `<tr><td style="padding:6px 0;color:#64748B;vertical-align:top;">Observações:</td><td style="white-space:pre-wrap;">${escapeHtml_(data.notes)}</td></tr>`;
  }

  html += `
      </table>
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#94A3B8;">
        Registrado automaticamente em ${isRequest ? CONFIG.cashTransferSheet : (data.sheetName || 'Cash Receipts')}.
      </div>
    </div>
  </div>`;

  // v5.28: trocado de GmailApp pra MailApp. GmailApp precisava de scope
  // (gmail.send) que nunca foi autorizado depois do deploy — falhava silenciosamente
  // dentro do try/catch silencioso de saveCashRequest_. MailApp usa scope
  // script.send_mail que ja esta autorizado (emails diarios funcionam com ele).
  // Trade-off: perde header 'Importance: High' (so afetava marca "Importante" no Outlook).
  MailApp.sendEmail({
    to: EMAIL_CONFIG.cashRecipients,
    subject: subject,
    htmlBody: html,
  });
}

/**
 * Helper de escape HTML pros emails.
 */
function escapeHtml_(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


// ================================================================
// AI ANALYSIS (v5.11) — análise por Claude API
// ================================================================
//
// Como usar:
// 1) Crie uma API key em https://console.anthropic.com → API Keys
// 2) Rode UMA VEZ no editor do Apps Script:
//      setAnthropicApiKey('sk-ant-api03-XXXXXX...')
//    (substitua pela sua key real)
// 3) A key fica salva no PropertiesService (não exposta no código).
// 4) Pode ser revisada/atualizada chamando setAnthropicApiKey() de novo.
// 5) Pra remover: removeAnthropicApiKey()
//
// Modelo: Claude Haiku 4.5 (rápido + barato).
// Pra trocar: edite ANTHROPIC_MODEL abaixo.
// ================================================================

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 1500;  // suficiente pra ~3 alerts + 3 sugestões + 3 strengths

/**
 * Salva a API key da Anthropic no cofre do projeto (PropertiesService).
 * Roda UMA VEZ no editor do Apps Script.
 *
 * Uso:
 *   setAnthropicApiKey('sk-ant-api03-XXXXX...')
 */
function setAnthropicApiKey(key) {
  if (!key || typeof key !== 'string' || !key.startsWith('sk-ant-')) {
    throw new Error('API key inválida. Deve começar com "sk-ant-"');
  }
  PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY', key);
  Logger.log('✓ API key salva. Pode chamar analyzeDriverWithAi_() agora.');
}

/**
 * Remove a API key (caso queira revogar acesso ou mudar de conta).
 */
function removeAnthropicApiKey() {
  PropertiesService.getScriptProperties().deleteProperty('ANTHROPIC_API_KEY');
  Logger.log('API key removida.');
}

/**
 * Função principal: análise IA de um driver.
 * Retorna o objeto JSON pronto pra o frontend mostrar.
 */
function analyzeDriverWithAi_(email) {
  // 1) Verifica se a key tá cadastrada
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return {
      success: false,
      error: 'Anthropic API key not configured. Run setAnthropicApiKey() in the Apps Script editor first.',
    };
  }

  // 2) Pega o profile completo (mesma função que driver-profile.html usa)
  const profile = getDriverProfile_(email);
  if (!profile) {
    return { success: false, error: 'Driver not found: ' + email };
  }

  // 3) Monta o prompt
  const prompt = buildAnalysisPrompt_(profile);

  // 4) Chama Claude API
  let analysis;
  try {
    analysis = callClaudeApi_(apiKey, prompt);
  } catch (err) {
    Logger.log('Claude API error: ' + err);
    return { success: false, error: 'Claude API call failed: ' + err.message };
  }

  return {
    success: true,
    analysis: analysis,
    model: ANTHROPIC_MODEL,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Monta o prompt textual com todos os dados do driver pro Claude analisar.
 * Output esperado: JSON estruturado com alerts/suggestions/strengths.
 */
function buildAnalysisPrompt_(profile) {
  const d = profile.driver;
  const m = profile.metrics;
  const baseline = profile.baseline;
  const history = profile.monthlyHistory || [];
  const idle = m ? m.idleDays : null;

  // Construção do contexto factual (em inglês, factual, sem juízo de valor)
  let context = `# Driver Profile Analysis Request

## Driver
- Name: ${d.name}
- Country: ${d.country}
- Status: ${d.status}
- Hire date: ${d.hireDate || 'unknown'}
- Email: ${d.email}

## Current Month Performance (${profile.currentMonth || 'N/A'})
`;

  if (m) {
    const effPct = m.efficiency != null ? (m.efficiency * 100).toFixed(1) : 'N/A';
    context += `- Efficiency: ${effPct}% (TKM/KM driven)\n`;
    context += `- TKM: ${Math.round(m.tkm)} km tracked\n`;
    context += `- Total KM driven: ${Math.round(m.km)}\n`;
    context += `- Mapping days: ${m.mappingDays}\n`;
    context += `- Billable hours: ${m.billableHours}\n`;
    if (idle && idle.total > 0) {
      context += `- Idle days breakdown: total=${idle.total} ` +
        `(personal=${idle.Personal}, mech=${idle['Mech.']}, tech=${idle['Tech.']}, ` +
        `weather=${idle.Weather}, disks=${idle.Disks}, travelling=${idle.Travelling || 0}, ` +
        `holiday=${idle.Holiday || 0}, other=${idle.Other || 0})\n`;
    } else {
      context += `- Idle days: 0\n`;
    }
  } else {
    context += `- No CTS data available for current month.\n`;
  }

  // Baseline do país
  if (baseline && baseline.countryAvgEfficiency != null) {
    context += `\n## Country Baseline (${d.country})\n`;
    context += `- Average efficiency: ${(baseline.countryAvgEfficiency * 100).toFixed(1)}% ` +
      `(across ${baseline.countryDriversCount} active drivers)\n`;
    if (baseline.countryAvgQc != null) {
      context += `- Average QC score: ${(baseline.countryAvgQc * 100).toFixed(1)}%\n`;
    }
  }

  // VID + QC info
  if (profile.vid) {
    context += `\n## VID Info\n`;
    context += `- VID: ${profile.vid.vid || 'N/A'}\n`;
    context += `- Floating car: ${profile.vid.isFloating || 'No'}\n`;
    if (profile.vid.qcScore != null) {
      context += `- QC Score: ${(profile.vid.qcScore * 100).toFixed(1)}%\n`;
    }
    context += `- Status per Google: ${profile.vid.statusPerGoogle || 'N/A'}\n`;
  }

  // Histórico mensal
  if (history.length > 1) {
    context += `\n## Monthly History (oldest to newest)\n`;
    history.forEach(h => {
      const eff = h.efficiency != null ? (h.efficiency * 100).toFixed(1) + '%' : 'N/A';
      context += `- ${h.month}: efficiency=${eff}, TKM=${Math.round(h.tkm)}, ` +
        `mapping_days=${h.mappingDays}, idle_total=${h.idleTotal}\n`;
    });
  }

  // Base + casa
  if (profile.currentBase) {
    context += `\n## Current Operational Base\n`;
    context += `- Type: ${profile.currentBase.type}\n`;
    context += `- Address: ${profile.currentBase.address || 'N/A'}\n`;
  }
  if (profile.driverHome && profile.currentBase) {
    const dist = haversineKm(
      profile.driverHome.lat, profile.driverHome.lng,
      profile.currentBase.lat, profile.currentBase.lng
    );
    context += `- Distance from driver's home to current base: ${dist.toFixed(0)} km\n`;
  }

  // Instruções pra Claude
  const instructions = `

---

You are an operations analyst helping the LATAM Street View fleet manager understand driver performance.
Analyze the data above and respond with a JSON object (and ONLY a JSON object — no preamble, no markdown fences) with this exact structure:

{
  "alerts": [
    { "title": "Short title (5-10 words)", "description": "1-2 sentences explaining what to investigate", "severity": "low" | "medium" | "high" }
  ],
  "suggestions": [
    { "title": "Short actionable title", "description": "1-2 sentences with the specific recommendation", "severity": "low" | "medium" | "high" }
  ],
  "strengths": [
    { "title": "Short title", "description": "1-2 sentences highlighting what is going well" }
  ]
}

Rules:
- Up to 4 items per category. If a category has nothing meaningful to say, use an empty array.
- Compare against country baseline when relevant (e.g., "20pp below Brazil avg").
- Look at trends across the monthly history (improving / declining / stable).
- For idle days, flag if mechanical issues are recurring or if personal days seem high.
- For hotel-mode considerations, mention the home-to-base distance when relevant.
- Be specific with numbers — "efficiency dropped from 78% to 52% over 3 months" beats "efficiency declined".
- Respond in English. Keep tone professional and concise.
- Output ONLY the JSON object, nothing else.`;

  return context + instructions;
}

/**
 * Chama Claude API com retry simples.
 * Retorna o objeto parseado (alerts/suggestions/strengths).
 */
function callClaudeApi_(apiKey, prompt) {
  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    messages: [
      { role: 'user', content: prompt }
    ],
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(ANTHROPIC_API_URL, options);
  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code !== 200) {
    Logger.log('Claude API HTTP ' + code + ': ' + body);
    throw new Error('HTTP ' + code + ' from Anthropic API. Check that your API key is valid and you have credits.');
  }

  const parsed = JSON.parse(body);
  if (!parsed.content || !parsed.content[0] || !parsed.content[0].text) {
    throw new Error('Unexpected response format from Claude');
  }

  // Claude responde texto. Esperamos JSON puro mas às vezes vem com markdown fences.
  let text = parsed.content[0].text.trim();

  // Limpa markdown fences se vier
  text = text.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  text = text.replace(/^```\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  let analysis;
  try {
    analysis = JSON.parse(text);
  } catch (parseErr) {
    Logger.log('Failed to parse Claude response as JSON: ' + text);
    throw new Error('Claude returned invalid JSON. Try again.');
  }

  // Validação básica
  return {
    alerts: Array.isArray(analysis.alerts) ? analysis.alerts : [],
    suggestions: Array.isArray(analysis.suggestions) ? analysis.suggestions : [],
    strengths: Array.isArray(analysis.strengths) ? analysis.strengths : [],
  };
}


// ================================================================
// v5.24: PMO NOTES — comentários por driver pelo painel pmo.html
// ================================================================
//
// Schema da aba 'PMO Notes' (auto-criada na 1ª chamada):
//   A: Timestamp         (Date — chave composta com Author)
//   B: Author            (string — nome completo, ex: "Lucas Fuss")
//   C: Driver Email      (lowercase)
//   D: Driver Name
//   E: Country
//   F: Category          ('accident' | 'conduct' | 'vehicle' | 'note' | 'positive')
//   G: Body
//   H: Edited At         (Date ou vazio)
//   I: Edited By         ('[DELETED]' se soft-deleted, senão username admin)
//
// Identificador único de note = Timestamp ISO + Author (chave composta).
// Soft-delete: limpa Body, marca Edited At = now, Edited By = '[DELETED]'.
// readAllPmoNotes_ ignora linhas com essa marca.
//
// ⚠ PMO_ADMIN_USERNAMES precisa estar sincronizado com pmo.html se você
// adicionar UI de edit/delete lá no frontend.

const PMO_ADMIN_USERNAMES = ['fuss'];

function isPMOAdminBackend_(username) {
  if (!username) return false;
  const u = String(username).toLowerCase().trim();
  return PMO_ADMIN_USERNAMES.indexOf(u) !== -1;
}

function getOrCreatePmoNotesSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  let sheet = ss.getSheetByName(CONFIG.pmoNotesSheet);
  if (sheet) return sheet;

  // Cria do zero
  sheet = ss.insertSheet(CONFIG.pmoNotesSheet);
  const headers = ['Timestamp', 'Author', 'Driver Email', 'Driver Name',
                   'Country', 'Category', 'Body', 'Edited At', 'Edited By'];
  sheet.getRange(1, 1, 1, 9).setValues([headers]);
  sheet.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#f0f0f0');
  sheet.setFrozenRows(1);
  // Larguras pra leitura humana
  sheet.setColumnWidth(1, 180);  // Timestamp
  sheet.setColumnWidth(2, 160);  // Author
  sheet.setColumnWidth(3, 220);  // Driver Email
  sheet.setColumnWidth(4, 180);  // Driver Name
  sheet.setColumnWidth(5, 100);  // Country
  sheet.setColumnWidth(6, 100);  // Category
  sheet.setColumnWidth(7, 480);  // Body
  sheet.setColumnWidth(8, 180);  // Edited At
  sheet.setColumnWidth(9, 110);  // Edited By

  Logger.log('✓ Aba "' + CONFIG.pmoNotesSheet + '" criada (PMO Notes v5.24)');
  return sheet;
}

function readAllPmoNotes_() {
  const sheet = getOrCreatePmoNotesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  const out = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const editedBy = String(row[8] || '').trim();
    if (editedBy === '[DELETED]') continue; // soft-deleted: pular

    const ts = row[0];
    if (!(ts instanceof Date)) continue; // ignora linhas malformadas

    out.push({
      created:     ts.toISOString(),
      author:      String(row[1] || ''),
      driverEmail: String(row[2] || '').toLowerCase().trim(),
      driverName:  String(row[3] || ''),
      country:     String(row[4] || ''),
      category:    String(row[5] || 'note'),
      body:        String(row[6] || ''),
      editedAt:    (row[7] instanceof Date) ? row[7].toISOString() : '',
      editedBy:    editedBy,
    });
  }

  return out;
}

/**
 * Procura linha pela chave composta (timestamp ISO + author).
 * Retorna { rowIndex } ou null.
 */
function findPmoNoteRow_(targetTimestamp, targetAuthor) {
  const sheet = getOrCreatePmoNotesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const targetIso = String(targetTimestamp).trim();
  const targetA = String(targetAuthor).trim().toLowerCase();

  for (let i = 0; i < values.length; i++) {
    const ts = values[i][0];
    const author = String(values[i][1] || '').trim().toLowerCase();
    if (!(ts instanceof Date)) continue;
    if (ts.toISOString() === targetIso && author === targetA) {
      return { rowIndex: i + 2 };
    }
  }
  return null;
}


// ----- HANDLERS -----

function getPMONotesHandler_(e) {
  const params = (e && e.parameter) || {};
  const limitRaw = parseInt(params.limit, 10);
  const limit = isNaN(limitRaw) || limitRaw <= 0 ? 200 : Math.min(limitRaw, 2000);
  const driverEmail = String(params.driverEmail || '').toLowerCase().trim();

  let all = readAllPmoNotes_();

  if (driverEmail) {
    all = all.filter(n => n.driverEmail === driverEmail);
  }

  // Mais recentes primeiro (ordenação server-side, pmo.html mantém)
  all.sort((a, b) => (b.created || '').localeCompare(a.created || ''));

  // Aplica limit
  const limited = all.slice(0, limit);

  return { success: true, notes: limited, count: limited.length, total: all.length };
}

function savePMONoteHandler_(data) {
  const author      = String(data.author || '').trim();
  const driverEmail = String(data.driverEmail || '').toLowerCase().trim();
  const driverName  = String(data.driverName || '').trim();
  const country     = String(data.country || '').trim();
  const category    = String(data.category || 'note').trim();
  const body        = String(data.body || '').trim();

  if (!author)      return { success: false, error: 'author required' };
  if (!driverEmail) return { success: false, error: 'driverEmail required' };
  if (!body)        return { success: false, error: 'body required' };

  // Valida category contra valores esperados (defensivo — pmo.html só manda esses)
  const validCats = ['accident', 'conduct', 'vehicle', 'note', 'positive'];
  const cat = validCats.indexOf(category) !== -1 ? category : 'note';

  const sheet = getOrCreatePmoNotesSheet_();
  const timestamp = new Date();

  sheet.appendRow([
    timestamp,
    author,
    driverEmail,
    driverName,
    country,
    cat,
    body,
    '',  // Edited At
    '',  // Edited By
  ]);

  Logger.log('PMO Note add: ' + author + ' → ' + driverEmail + ' [' + cat + ']');

  return {
    success: true,
    note: {
      created:     timestamp.toISOString(),
      author:      author,
      driverEmail: driverEmail,
      driverName:  driverName,
      country:     country,
      category:    cat,
      body:        body,
      editedAt:    '',
      editedBy:    '',
    },
  };
}

function editPMONoteHandler_(data) {
  const actorUsername = String(data.actorUsername || '').toLowerCase().trim();
  const origTimestamp = String(data.origTimestamp || '').trim();
  const origAuthor    = String(data.origAuthor || '').trim();
  const newBody       = String(data.newBody || '').trim();
  const newCategory   = String(data.newCategory || '').trim();

  if (!actorUsername) return { success: false, error: 'actorUsername required' };
  if (!origTimestamp || !origAuthor) {
    return { success: false, error: 'origTimestamp + origAuthor required' };
  }
  if (!newBody) return { success: false, error: 'newBody required' };

  const match = findPmoNoteRow_(origTimestamp, origAuthor);
  if (!match) return { success: false, error: 'note not found' };

  const sheet = getOrCreatePmoNotesSheet_();
  const now = new Date();

  sheet.getRange(match.rowIndex, 7).setValue(newBody);  // Body
  if (newCategory) {
    const validCats = ['accident', 'conduct', 'vehicle', 'note', 'positive'];
    if (validCats.indexOf(newCategory) !== -1) {
      sheet.getRange(match.rowIndex, 6).setValue(newCategory);  // Category
    }
  }
  sheet.getRange(match.rowIndex, 8).setValue(now);             // Edited At
  sheet.getRange(match.rowIndex, 9).setValue(actorUsername);   // Edited By

  Logger.log('PMO Note edit: ' + actorUsername + ' editou note de ' + origAuthor);

  return {
    success: true,
    edited: {
      created:  origTimestamp,
      author:   origAuthor,
      body:     newBody,
      editedAt: now.toISOString(),
      editedBy: actorUsername,
    },
  };
}

function deletePMONoteHandler_(data) {
  const actorUsername = String(data.actorUsername || '').toLowerCase().trim();
  const origTimestamp = String(data.origTimestamp || '').trim();
  const origAuthor    = String(data.origAuthor || '').trim();

  if (!actorUsername) return { success: false, error: 'actorUsername required' };
  if (!origTimestamp || !origAuthor) {
    return { success: false, error: 'origTimestamp + origAuthor required' };
  }

  const match = findPmoNoteRow_(origTimestamp, origAuthor);
  if (!match) return { success: false, error: 'note not found' };

  const sheet = getOrCreatePmoNotesSheet_();
  const now = new Date();

  // Soft-delete: limpa body, marca [DELETED]
  sheet.getRange(match.rowIndex, 7).setValue('');           // Body vazio
  sheet.getRange(match.rowIndex, 8).setValue(now);          // Edited At
  sheet.getRange(match.rowIndex, 9).setValue('[DELETED]');  // Edited By

  Logger.log('PMO Note delete: ' + actorUsername + ' soft-deletou note de ' + origAuthor);

  return {
    success: true,
    deleted: {
      created:   origTimestamp,
      author:    origAuthor,
      deletedAt: now.toISOString(),
      deletedBy: actorUsername,
    },
  };
}


// ================================================================
// ARGENTINA CASH DIVERGÊNCIAS (v5.25) — ar-divergencias.html
// ================================================================

/**
 * Lista motoristas argentinos ativos.
 * Usado pelo dropdown da ar-divergencias.html.
 * Retorna: [{ name, email, city }]
 */
function getArgentinaDrivers_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.hrSheet);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const nameIdx     = headers.indexOf('Beneficiary Full Name');
  const emailIdx    = headers.indexOf('Corporate E-mail');
  const countryIdx  = headers.indexOf('Country');
  const situationIdx = headers.indexOf('Situation');
  const cityIdx     = headers.indexOf('City');

  const drivers = [];
  for (let i = 1; i < data.length; i++) {
    const country = String(data[i][countryIdx] || '').trim().toLowerCase();
    if (data[i][situationIdx] === 'Active' && country === 'argentina' && data[i][nameIdx]) {
      drivers.push({
        name: String(data[i][nameIdx]).trim(),
        email: String(data[i][emailIdx] || '').trim(),
        city: cityIdx >= 0 ? String(data[i][cityIdx] || '').trim() : '',
      });
    }
  }

  drivers.sort((a, b) => a.name.localeCompare(b.name));
  return drivers;
}


// ================================================================
// COUNTRY SCOPES (v5.29) — country_scopes.html
// ================================================================

/**
 * Le aba "CSV ARGENTINA" ou "CSV COLOMBIA" da MASTERSHEET e retorna array
 * com status atualizado de cada area de coleta.
 *
 * Cada linha do CSV tem o ID completo (ex:
 * "collectionScopes/sv2:094dcc10:AR:11-7FCuHL/collectionAreas/940255e5-AR.0").
 * Aqui extraimos so o sufixo (940255e5-AR.0) pra fazer match com o ID curto
 * usado no GeoJSON estatico do frontend.
 *
 * @param {string} country  'AR' | 'CO' (case-insensitive)
 * @return {Array<Object>}  [{ id, name, status, camera, targetMeters, collectedMeters, ... }]
 */
function getCountryScope_(country) {
  const map = {
    'AR': 'CSV ARGENTINA',
    'CO': 'CSV COLOMBIA',
    // Adicionar outros paises aqui conforme forem chegando
  };
  const sheetName = map[String(country || '').toUpperCase()];
  if (!sheetName) return [];

  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const idIdx     = headers.indexOf('ID');
  const nameIdx   = headers.indexOf('Name');
  const statusIdx = headers.indexOf('Status');
  const cameraIdx = headers.indexOf('Camera');
  const tgtIdx    = headers.indexOf('Active Target Segment Total Meters');
  const colIdx    = headers.indexOf('Active Target Segment Collected Meters');
  const rcTgtIdx  = headers.indexOf('Active Recollect Target Segment Total Meters');
  const rcColIdx  = headers.indexOf('Active Recollect Target Segment Collected Meters');
  const tsIdx     = headers.indexOf('Last Computed Time');

  if (idIdx < 0 || nameIdx < 0) return [];

  const areas = [];
  for (let i = 1; i < data.length; i++) {
    const fullId = String(data[i][idIdx] || '').trim();
    if (!fullId) continue;
    // Extrai sufixo: ".../collectionAreas/940255e5-AR.0" → "940255e5-AR.0"
    const m = fullId.match(/\/([^/]+)$/);
    const shortId = m ? m[1] : fullId;

    areas.push({
      id: shortId,
      name: String(data[i][nameIdx] || '').trim(),
      status: String(data[i][statusIdx] || '').trim(),
      camera: cameraIdx >= 0 ? String(data[i][cameraIdx] || '').trim() : '',
      targetMeters: parseScopeNumeric_(data[i][tgtIdx]),
      collectedMeters: parseScopeNumeric_(data[i][colIdx]),
      recollectTargetMeters: parseScopeNumeric_(data[i][rcTgtIdx]),
      recollectCollectedMeters: parseScopeNumeric_(data[i][rcColIdx]),
      lastComputed: tsIdx >= 0 ? String(data[i][tsIdx] || '') : '',
    });
  }
  return areas;
}

/**
 * Parser robusto de numericos do CSV.
 * CSV original usa "24466,59917" (virgula como decimal).
 * Quando importado pro Sheets ele pode virar Number, string com virgula,
 * ou string com ponto. Trata todos os casos.
 */
function parseScopeNumeric_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  // String — pode ter virgula como decimal
  const s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  // Se tem virgula E ponto, o ponto provavelmente eh milhar (24.466,59)
  // Se so tem virgula, troca por ponto pra parseFloat
  // Se so tem ponto, deixa
  let normalized;
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
    // Assume formato BR: ponto=milhar, virgula=decimal
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (s.indexOf(',') >= 0) {
    normalized = s.replace(',', '.');
  } else {
    normalized = s;
  }
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}


/**
 * Garante que a aba 'Argentina Cash' existe. Cria com headers se não existir.
 * Colunas:
 *   A=Timestamp | B=Session ID | C=Driver Name | D=Driver Email |
 *   E=Quinzena Label | F=Quinzena Start | G=Quinzena End |
 *   H=Amount | I=Currency | J=Comment | K=File Links
 */
function getOrCreateArgentinaCashSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  let sheet = ss.getSheetByName(CONFIG.argentinaCashSheet);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.argentinaCashSheet);
  const headers = [
    'Timestamp', 'Session ID', 'Driver Name', 'Driver Email',
    'Quinzena Label', 'Quinzena Start', 'Quinzena End',
    'Amount', 'Currency', 'Comment', 'File Links'
  ];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f0f0f0');
  sheet.setFrozenRows(1);
  return sheet;
}


/**
 * Faz upload de um arquivo (base64) pra pasta Argentina Cash no Drive.
 * Retorna a URL pública do arquivo.
 *
 * fileObj: { name: 'recibo.jpg', base64: 'data:image/...;base64,...' }
 */
function uploadArgentinaFileToDrive_(fileObj, driverName, quinzenaLabel) {
  if (!fileObj || !fileObj.base64) return '';

  const cleanBase64 = String(fileObj.base64).replace(/^data:[^;]+;base64,/, '');
  const mimeMatch = String(fileObj.base64).match(/^data:([^;]+);base64,/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';

  const folder = DriveApp.getFolderById(CONFIG.argentinaCashFolderId);
  const ts = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'yyyy-MM-dd_HH-mm-ss');
  const safeDriver = String(driverName || 'unknown')
    .replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const safeQuinz = String(quinzenaLabel || '')
    .replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const safeOrigName = String(fileObj.name || 'arquivo')
    .replace(/[^a-z0-9._-]/gi, '_');
  const filename = `${ts}_${safeDriver}_${safeQuinz}_${safeOrigName}`;

  const blob = Utilities.newBlob(Utilities.base64Decode(cleanBase64), mime, filename);
  const file = folder.createFile(blob);

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    Logger.log('[Argentina Cash] Aviso ao definir sharing: ' + err);
  }

  return file.getUrl();
}


/**
 * Salva um envio de divergências de pagamento da Argentina.
 *
 * Payload esperado:
 * {
 *   type: 'submitArgentinaCash',
 *   driverName: 'Fulano de Tal',
 *   driverEmail: 'fulano@aceolution.com',
 *   divergences: [
 *     {
 *       quinzenaLabel: '01–15 Mai/2026',
 *       quinzenaStart: '2026-05-01',  // YYYY-MM-DD
 *       quinzenaEnd:   '2026-05-15',
 *       amount: 12345.67,
 *       currency: 'ARS',              // 'ARS' | 'USD'
 *       comment: 'observação livre',
 *       files: [ { name, base64 }, ... ]   // até 5
 *     },
 *     ...
 *   ]
 * }
 *
 * Salva 1 row por divergência na aba 'Argentina Cash'. Todas as divergências
 * do mesmo envio compartilham o mesmo Session ID (UUID).
 */


/**
 * v5.31: lê todas as linhas da aba 'Argentina Cash' e retorna como array.
 * Usado pelo ar-divergencias-admin.html pra revisar as submissões.
 * Cada elemento corresponde a UMA divergência (não 1 submissão — agrupar
 * por sessionId no frontend pra ter "submissões").
 *
 * Estrutura retornada:
 *   { timestamp, sessionId, driverName, driverEmail, quinzenaLabel,
 *     quinzenaStart, quinzenaEnd, amount, currency, comment, fileLinks: [] }
 */
function getArgentinaCashSubmissions_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.argentinaCashSheet);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  // Headers (linha 0): Timestamp | Session ID | Driver Name | Driver Email |
  //   Quinzena Label | Quinzena Start | Quinzena End |
  //   Amount | Currency | Comment | File Links
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;  // skip empty rows
    const tsRaw = row[0];
    const qStartRaw = row[5];
    const qEndRaw = row[6];
    out.push({
      timestamp: (tsRaw instanceof Date) ? tsRaw.toISOString() : String(tsRaw || ''),
      sessionId: String(row[1] || ''),
      driverName: String(row[2] || '').trim(),
      driverEmail: String(row[3] || '').trim(),
      quinzenaLabel: String(row[4] || '').trim(),
      quinzenaStart: (qStartRaw instanceof Date) ? Utilities.formatDate(qStartRaw, 'America/Sao_Paulo', 'yyyy-MM-dd') : String(qStartRaw || ''),
      quinzenaEnd:   (qEndRaw   instanceof Date) ? Utilities.formatDate(qEndRaw,   'America/Sao_Paulo', 'yyyy-MM-dd') : String(qEndRaw || ''),
      amount: Number(row[7]) || 0,
      currency: String(row[8] || '').trim().toUpperCase(),
      comment: String(row[9] || '').trim(),
      fileLinks: String(row[10] || '').split('\n').map(s => s.trim()).filter(s => s),
    });
  }
  // Mais recentes primeiro
  out.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return out;
}


function submitArgentinaCash_(data) {
  if (!data || !data.driverName) {
    return { success: false, error: 'driverName obrigatório' };
  }
  if (!Array.isArray(data.divergences) || data.divergences.length === 0) {
    return { success: false, error: 'nenhuma divergência enviada' };
  }

  const sheet = getOrCreateArgentinaCashSheet_();
  const sessionId = Utilities.getUuid();
  const now = new Date();
  const rowsToAppend = [];

  for (let i = 0; i < data.divergences.length; i++) {
    const d = data.divergences[i];

    // Validações por divergência (best-effort)
    if (d.amount === null || d.amount === undefined || d.amount === '') {
      return { success: false, error: 'valor obrigatório na divergência #' + (i + 1) };
    }
    if (!d.quinzenaLabel) {
      return { success: false, error: 'quinzena obrigatória na divergência #' + (i + 1) };
    }

    // Upload dos arquivos (até 5)
    const fileLinks = [];
    const files = Array.isArray(d.files) ? d.files.slice(0, 5) : [];
    for (let j = 0; j < files.length; j++) {
      try {
        const url = uploadArgentinaFileToDrive_(files[j], data.driverName, d.quinzenaLabel);
        if (url) fileLinks.push(url);
      } catch (err) {
        Logger.log('[Argentina Cash] Erro upload arquivo #' + (j + 1) + ' div #' + (i + 1) + ': ' + err);
      }
    }

    rowsToAppend.push([
      now,
      sessionId,
      String(data.driverName || '').trim(),
      String(data.driverEmail || '').trim(),
      String(d.quinzenaLabel || '').trim(),
      d.quinzenaStart ? new Date(d.quinzenaStart) : '',
      d.quinzenaEnd   ? new Date(d.quinzenaEnd)   : '',
      Number(d.amount) || 0,
      String(d.currency || 'ARS').toUpperCase(),
      String(d.comment || '').trim(),
      fileLinks.join('\n'),
    ]);
  }

  // Append em batch
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length)
    .setValues(rowsToAppend);

  Logger.log('[Argentina Cash] Sess ' + sessionId + ' — ' + data.driverName +
             ' enviou ' + rowsToAppend.length + ' divergência(s)');

  return {
    success: true,
    sessionId: sessionId,
    rowsAdded: rowsToAppend.length,
    message: 'Divergências registradas com sucesso',
  };
}


// ================================================================
// v5.33: SUPER-ADMIN — gerenciamento de usuários via GitHub API
// Chamado pelo admin-users.html. Só 'fuss' pode invocar.
// ================================================================

function isSuperAdminBackend_(username) {
  if (!username) return false;
  return String(username).toLowerCase().trim() === 'fuss';
}

/**
 * Recebe { users: [{username, passwordHash, fullName, pages?}], admins: [usernames],
 *          actorUsername, commitMessage? } e commita novo auth.js no GitHub.
 * v5.50: `pages` (opcional) = lista de páginas .html que um usuário RESTRITO pode
 *        acessar (ex: ['ops-map.html']). Vazio/ausente = acesso normal (tiers).
 *
 * Requer no Script Properties:
 *   - GITHUB_TOKEN  (Personal Access Token com contents:write no repo)
 *   - GITHUB_REPO   (opcional, default: AddCoolNameHere/latam-driver-checkin)
 *   - GITHUB_BRANCH (opcional, default: main)
 */
function updateAuthUsersHandler_(data) {
  // ---- Validações ----
  if (!Array.isArray(data.users) || data.users.length === 0) {
    return { success: false, error: 'Lista de users vazia ou inválida' };
  }
  if (!Array.isArray(data.admins)) {
    return { success: false, error: 'admins precisa ser array (pode ser vazio)' };
  }
  const usernamesSeen = {};
  for (const u of data.users) {
    if (!u.username || !u.passwordHash || !u.fullName) {
      return { success: false, error: 'Cada user precisa de username, passwordHash, fullName' };
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(u.username)) {
      return { success: false, error: 'Username inválido (apenas letras/números/._-): ' + u.username };
    }
    if (!/^[a-f0-9]{64}$/.test(u.passwordHash)) {
      return { success: false, error: 'passwordHash inválido (precisa ser SHA-256 hex, 64 chars) pro user: ' + u.username };
    }
    // v5.50: pages (opcional) — allowlist de páginas pra usuário restrito (cargo de página única)
    if (u.pages != null) {
      if (!Array.isArray(u.pages)) {
        return { success: false, error: 'pages precisa ser array pro user: ' + u.username };
      }
      for (const p of u.pages) {
        if (typeof p !== 'string' || !/^[a-z0-9._-]+\.html$/i.test(p)) {
          return { success: false, error: 'pages inválido (esperado nomes de arquivo .html) pro user: ' + u.username };
        }
      }
    }
    const key = String(u.username).toLowerCase();
    if (usernamesSeen[key]) {
      return { success: false, error: 'Username duplicado: ' + u.username };
    }
    usernamesSeen[key] = true;
  }
  // Salvaguarda: pelo menos 'fuss' precisa continuar na lista (senão você perde acesso)
  if (!usernamesSeen['fuss']) {
    return { success: false, error: 'Não pode remover o user "fuss" — é o super admin' };
  }
  // E precisa estar em ADMIN_USERNAMES
  const adminLower = data.admins.map(a => String(a).toLowerCase());
  if (adminLower.indexOf('fuss') < 0) {
    return { success: false, error: 'Não pode remover "fuss" da lista de admins' };
  }

  // ---- Config do GitHub ----
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GITHUB_TOKEN');
  if (!token) {
    return { success: false, error: 'GITHUB_TOKEN não configurado no Script Properties do Apps Script' };
  }
  const repo   = props.getProperty('GITHUB_REPO')   || 'AddCoolNameHere/latam-driver-checkin';
  const branch = props.getProperty('GITHUB_BRANCH') || 'main';
  const filePath = 'auth.js';

  const apiUrl = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURIComponent(filePath);
  const ghHeaders = {
    'Authorization': 'token ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'aceolution-latam-admin',
  };

  // ---- 1. Buscar SHA do arquivo atual ----
  let currentSha;
  try {
    const getRes = UrlFetchApp.fetch(apiUrl + '?ref=' + encodeURIComponent(branch), {
      method: 'get',
      headers: ghHeaders,
      muteHttpExceptions: true,
    });
    const code = getRes.getResponseCode();
    if (code !== 200) {
      return {
        success: false,
        error: 'Falha ao buscar auth.js atual no GitHub (HTTP ' + code + '): ' +
               getRes.getContentText().substring(0, 250),
      };
    }
    currentSha = JSON.parse(getRes.getContentText()).sha;
  } catch (err) {
    return { success: false, error: 'Erro de rede ao buscar auth.js: ' + err.toString() };
  }

  // ---- 2. Montar novo conteúdo do auth.js ----
  const newContent = buildAuthJsContent_(data.users, data.admins);
  const newContentB64 = Utilities.base64Encode(newContent, Utilities.Charset.UTF_8);

  // ---- 3. PUT commit ----
  const commitMsg = String(data.commitMessage || '').trim()
    || ('admin: atualiza auth.js via painel (' +
        new Date().toISOString().substring(0, 10) + ')');
  try {
    const putRes = UrlFetchApp.fetch(apiUrl, {
      method: 'put',
      headers: ghHeaders,
      contentType: 'application/json',
      payload: JSON.stringify({
        message: commitMsg,
        content: newContentB64,
        sha: currentSha,
        branch: branch,
      }),
      muteHttpExceptions: true,
    });
    const code = putRes.getResponseCode();
    if (code !== 200 && code !== 201) {
      return {
        success: false,
        error: 'Falha ao commitar auth.js (HTTP ' + code + '): ' +
               putRes.getContentText().substring(0, 300),
      };
    }
    const commit = JSON.parse(putRes.getContentText());
    return {
      success: true,
      message: 'auth.js commitado. GitHub Pages atualiza em 1-10min — force Ctrl+Shift+R depois.',
      commitSha: commit.commit && commit.commit.sha,
      commitUrl: commit.commit && commit.commit.html_url,
    };
  } catch (err) {
    return { success: false, error: 'Erro de rede ao commitar: ' + err.toString() };
  }
}

/**
 * Gera o conteúdo completo do auth.js a partir das listas de users e admins.
 * Template é montado inline pra facilitar manutenção (todo o resto do auth.js é fixo).
 */
function buildAuthJsContent_(users, admins) {
  const usersBlock = users.map(function(u) {
    var pagesLine = '';
    if (Array.isArray(u.pages) && u.pages.length) {
      var ps = u.pages.map(function(p){ return JSON.stringify(String(p).toLowerCase().trim()); }).join(', ');
      pagesLine = '    pages: [' + ps + '],\n';
    }
    return '  {\n' +
           '    username: ' + JSON.stringify(String(u.username).toLowerCase().trim()) + ',\n' +
           '    passwordHash: ' + JSON.stringify(String(u.passwordHash).toLowerCase().trim()) + ',\n' +
           '    fullName: ' + JSON.stringify(String(u.fullName).trim()) + ',\n' +
           pagesLine +
           '  },';
  }).join('\n');

  const adminsBlock = admins
    .map(function(a) { return JSON.stringify(String(a).toLowerCase().trim()); })
    .join(', ');

  const generatedAt = new Date().toISOString();

  return [
    '/**',
    ' * ============================================================',
    ' * Aceolution LATAM — Auth Configuration',
    ' * ============================================================',
    ' *',
    ' * ARQUIVO GERADO AUTOMATICAMENTE pelo painel admin-users.html.',
    ' * NÃO EDITE MANUALMENTE — suas mudanças serão sobrescritas no',
    ' * próximo commit feito pelo painel. Pra alterar, abra:',
    ' *   admin-users.html (acesso restrito ao usuário "fuss")',
    ' *',
    ' * Última geração: ' + generatedAt,
    ' *',
    ' * ⚠ NOTA DE SEGURANÇA:',
    ' * Este é client-side ("teatro de segurança"): qualquer pessoa',
    ' * com acesso ao GitHub Pages pode ver os hashes e tentar quebrá-los',
    ' * por força bruta offline. Não use senhas reutilizadas em outros',
    ' * serviços. Senhas longas e únicas mitigam o risco.',
    ' *',
    ' * ============================================================',
    ' */',
    '',
    '// ----------------------------------------------------------------',
    '// LISTA DE USUÁRIOS',
    '// ----------------------------------------------------------------',
    'const USERS = [',
    usersBlock,
    '];',
    '',
    '// ----------------------------------------------------------------',
    '// USUÁRIOS COM PRIVILÉGIO ADMIN',
    '// (veem o botão ⚙ Admin no dashboard e seções restritas)',
    '// ----------------------------------------------------------------',
    'const ADMIN_USERNAMES = [' + adminsBlock + '];',
    '',
    '// ----------------------------------------------------------------',
    '// HELPER: SHA-256 hash (compatível com browser moderno)',
    '// ----------------------------------------------------------------',
    'async function sha256(text) {',
    '  const buffer = new TextEncoder().encode(text);',
    '  const hashBuf = await crypto.subtle.digest(\'SHA-256\', buffer);',
    '  return Array.from(new Uint8Array(hashBuf))',
    '    .map(b => b.toString(16).padStart(2, \'0\'))',
    '    .join(\'\');',
    '}',
    '',
    '// ----------------------------------------------------------------',
    '// HELPER: validar credenciais',
    '// Retorna o objeto user em caso de sucesso, null em falha.',
    '// ----------------------------------------------------------------',
    'async function validateLogin(username, password) {',
    '  if (!username || !password) return null;',
    '  const passwordHash = await sha256(password);',
    '  const u = (username || \'\').trim().toLowerCase();',
    '  return USERS.find(x =>',
    '    x.username.toLowerCase() === u && x.passwordHash === passwordHash',
    '  ) || null;',
    '}',
    '',
    '// ----------------------------------------------------------------',
    '// HELPER: checa se um username tem privilégio admin',
    '// ----------------------------------------------------------------',
    'function isAdmin(username) {',
    '  if (!username) return false;',
    '  return ADMIN_USERNAMES.indexOf(String(username).toLowerCase()) >= 0;',
    '}',
    '',
    '// ----------------------------------------------------------------',
    '// HELPER: páginas permitidas pra um usuário restrito (cargo de página única)',
    '// Retorna array de filenames (lowercase) ou null se o user tem acesso normal.',
    '// ----------------------------------------------------------------',
    'function userPages(username) {',
    '  if (!username) return null;',
    '  const u = USERS.find(x => x.username.toLowerCase() === String(username).toLowerCase());',
    '  return (u && Array.isArray(u.pages) && u.pages.length)',
    '    ? u.pages.map(p => String(p).toLowerCase())',
    '    : null;',
    '}',
    '',
    '// ----------------------------------------------------------------',
    '// SESSION: SSO cross-page via localStorage (8h TTL)',
    '// ----------------------------------------------------------------',
    'const SESSION_KEY = \'aceolution_latam_session\';',
    'const SESSION_TTL_HOURS = 8;',
    '',
    'function saveSession(user) {',
    '  if (!user || !user.username) return;',
    '  try {',
    '    localStorage.setItem(SESSION_KEY, JSON.stringify({',
    '      username: user.username,',
    '      fullName: user.fullName || user.username,',
    '      expiresAt: Date.now() + SESSION_TTL_HOURS * 3600 * 1000,',
    '    }));',
    '  } catch (e) { /* localStorage indisponível */ }',
    '}',
    '',
    '// Retorna {username, fullName} se sessão válida, null caso contrário.',
    '// Re-valida que o user ainda existe em USERS (caso auth.js tenha mudado).',
    'function loadSession() {',
    '  try {',
    '    const raw = localStorage.getItem(SESSION_KEY);',
    '    if (!raw) return null;',
    '    const s = JSON.parse(raw);',
    '    if (!s || !s.username || !s.expiresAt || Date.now() > s.expiresAt) {',
    '      localStorage.removeItem(SESSION_KEY);',
    '      return null;',
    '    }',
    '    const u = USERS.find(x => x.username.toLowerCase() === String(s.username).toLowerCase());',
    '    return u ? { username: u.username, fullName: u.fullName } : null;',
    '  } catch (e) { return null; }',
    '}',
    '',
    'function clearSession() {',
    '  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}',
    '}',
    '',
  ].join('\n');
}


// ================================================================
// v5.34: RECRUITMENT — leitura da aba "Recruitment"
//
// Aba tem múltiplas seções (resumo current, lista de vagas current,
// resumo histórico, lista histórica). Aqui pegamos só as duas
// primeiras (as "current") — que é o que importa pro recruitment.html.
//
// Identificamos as seções pelos cabeçalhos:
//   - Summary current:   "Country | Open | Shortlisted | Training |
//                          Offboarding | Currently Active | Offboarded | Hired"
//   - Demand current:    "Country | Sourcing City | Demand Raised On | ..."
//
// Parsing é defensivo a mudanças menores na ordem das colunas — usa
// `indexOf` por nome de coluna em vez de índices fixos.
// ================================================================

function getRecruitmentData_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = getSheetWithFallback_(ss, CONFIG.recruitmentSheet,
    ['Recruitment', 'RECRUITMENT', 'recruitment', 'Recrutamento']);
  if (!sheet) {
    return { summary: [], demand: [], error: 'aba Recruitment não encontrada' };
  }

  const data = sheet.getDataRange().getValues();
  let summary = [];
  let demand = [];
  let summaryHeaderRow = -1;
  let demandHeaderRow = -1;

  // Primeira passada: localiza as linhas de header de cada seção.
  for (let i = 0; i < data.length; i++) {
    const row = data[i].map(c => String(c == null ? '' : c).trim());
    // Summary current: tem 'Currently Active'
    if (summaryHeaderRow < 0 &&
        row.indexOf('Country') >= 0 &&
        row.indexOf('Currently Active') >= 0 &&
        row.indexOf('Open') >= 0) {
      summaryHeaderRow = i;
    }
    // Demand current: tem 'Sourcing City' e 'Demand Raised On'
    if (demandHeaderRow < 0 &&
        row.indexOf('Country') >= 0 &&
        row.indexOf('Sourcing City') >= 0 &&
        row.indexOf('Demand Raised On') >= 0) {
      demandHeaderRow = i;
    }
    if (summaryHeaderRow >= 0 && demandHeaderRow >= 0) break;
  }

  // --- Parse summary section ---
  if (summaryHeaderRow >= 0) {
    const headers = data[summaryHeaderRow].map(c => String(c == null ? '' : c).trim());
    const idx = name => headers.indexOf(name);
    const cols = {
      country: idx('Country'),
      open: idx('Open'),
      shortlisted: idx('Shortlisted'),
      training: idx('Training'),
      offboarding: idx('Offboarding'),
      currentlyActive: idx('Currently Active'),
      offboarded: idx('Offboarded'),
      hired: idx('Hired'),
    };
    for (let i = summaryHeaderRow + 1; i < data.length; i++) {
      const row = data[i];
      const country = String(row[cols.country] || '').trim();
      if (!country) break;                  // bloco terminou
      if (country === 'Sum' || country === 'Total') continue;  // pula linha de soma
      // Se virou outro header de seção, para
      if (country === 'Country') break;
      summary.push({
        country: country,
        open:            Number(row[cols.open]) || 0,
        shortlisted:     Number(row[cols.shortlisted]) || 0,
        training:        Number(row[cols.training]) || 0,
        offboarding:     Number(row[cols.offboarding]) || 0,
        currentlyActive: Number(row[cols.currentlyActive]) || 0,
        offboarded:      Number(row[cols.offboarded]) || 0,
        hired:           Number(row[cols.hired]) || 0,
      });
    }
  }

  // --- Parse demand section ---
  if (demandHeaderRow >= 0) {
    const headers = data[demandHeaderRow].map(c => String(c == null ? '' : c).trim());
    const idx = name => headers.indexOf(name);
    const cols = {
      country: idx('Country'),
      city:    idx('Sourcing City'),
      raisedOn: idx('Demand Raised On'),
      candidate: headers.findIndex(h => /Shortlisted.*Candidate.*Name/i.test(h)),
      status:  idx('Status'),
      remarks: idx('Remarks'),
      totalLeads: idx('TOTAL LEADS'),
      leadsCalled: headers.findIndex(h => /LEADS CALLED/i.test(h)),
    };
    for (let i = demandHeaderRow + 1; i < data.length; i++) {
      const row = data[i];
      const country = String(row[cols.country] || '').trim();
      if (!country) break;                  // bloco terminou
      if (country === 'Country') break;     // próximo header de seção
      const status = String(row[cols.status] || '').trim();
      // Filtra histórico — só interessam vagas "current" (Open/Shortlisted/On Hold)
      // Se status for Hired/Cancelled/Replaced, ignora
      const isCurrent = /^(open|shortlisted|on hold|in progress)$/i.test(status);
      if (!isCurrent) continue;
      demand.push({
        country: country,
        city:    String(row[cols.city] || '').trim(),
        raisedOn: row[cols.raisedOn] instanceof Date
                    ? Utilities.formatDate(row[cols.raisedOn], 'America/Sao_Paulo', 'yyyy-MM-dd')
                    : String(row[cols.raisedOn] || '').trim(),
        candidate: cols.candidate >= 0 ? String(row[cols.candidate] || '').trim() : '',
        status:    status,
        remarks:   cols.remarks >= 0 ? String(row[cols.remarks] || '').trim() : '',
        totalLeads: cols.totalLeads >= 0 ? (Number(row[cols.totalLeads]) || 0) : 0,
        leadsCalled: cols.leadsCalled >= 0 ? (Number(row[cols.leadsCalled]) || 0) : 0,
      });
    }
  }

  return {
    summary: summary,
    demand: demand,
    generatedAt: new Date().toISOString(),
  };
}


// ================================================================
// FOGO CRUZADO — Overlay de risco/crime no mapa do dashboard (v5.41)
// ================================================================
/**
 * Proxy + cache pra API do Fogo Cruzado (https://api.fogocruzado.org.br/docs).
 * Dataset gratuito de tiroteios/disparos com cobertura nas regiões metropolitanas
 * de RJ (desde 2016), PE (2018), BA (2022) e PA (2023). Requer cadastro free.
 *
 * SETUP (uma vez):
 *   1. User cria conta em https://api.fogocruzado.org.br/sign-up e aguarda aprovação.
 *   2. No Apps Script: Project Settings → Script Properties, adiciona:
 *      - FOGO_CRUZADO_EMAIL    = email da conta
 *      - FOGO_CRUZADO_PASSWORD = senha
 *
 * Sem as credenciais setadas, o endpoint retorna error explicativo (não quebra
 * o dashboard — o overlay simplesmente fica desabilitado).
 *
 * Cache:
 *   - Token JWT: 50min (validade é 1h, deixa margem)
 *   - Resultado da query: 6h (dataset é diário, não precisa ser tempo real)
 *   - State UUIDs: persistido em ScriptProperties (descoberto 1x)
 */
const FC_API_BASE = 'https://api-service.fogocruzado.org.br/api/v2';
const FC_TARGET_STATES = ['Rio de Janeiro', 'Pernambuco', 'Bahia', 'Pará'];
const FC_TOKEN_CACHE_KEY = 'fogo_cruzado_token';
const FC_TOKEN_CACHE_SEC = 50 * 60;      // 50min (token vive 1h)
const FC_RESULT_CACHE_PREFIX = 'fogo_cruzado_result_';
const FC_RESULT_CACHE_SEC = 6 * 3600;    // 6h
const FC_STATE_IDS_PROP = 'FOGO_CRUZADO_STATE_IDS';

function getCrimeOverlay_(days) {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('FOGO_CRUZADO_EMAIL');
  const pass  = props.getProperty('FOGO_CRUZADO_PASSWORD');
  if (!email || !pass) {
    return {
      success: false,
      error: 'Credenciais Fogo Cruzado não configuradas. Setar FOGO_CRUZADO_EMAIL e FOGO_CRUZADO_PASSWORD em Script Properties.',
      points: [],
    };
  }

  // Cache check antes de qualquer chamada externa
  const cache = CacheService.getScriptCache();
  const cacheKey = FC_RESULT_CACHE_PREFIX + days;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      parsed._fromCache = true;
      return parsed;
    } catch (e) { /* cache corrompido, refaz */ }
  }

  try {
    const stateIds = fogoCruzadoStateIds_();
    if (!stateIds || stateIds.length === 0) {
      return { success: false, error: 'Não foi possível descobrir UUIDs dos estados.', points: [] };
    }

    // Janela de datas (YYYY-MM-DD, fuso UTC pra simplicidade — API usa BRT)
    const today = new Date();
    const start = new Date(today.getTime() - days * 86400000);
    const fmt = function (d) { return Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd'); };
    const initialdate = fmt(start);
    const finaldate = fmt(today);

    // Pagina cada estado. Limite total pra evitar payload gigante.
    const MAX_POINTS = 5000;
    const TAKE = 200;
    const points = [];
    let totalRaw = 0;

    for (let i = 0; i < stateIds.length && points.length < MAX_POINTS; i++) {
      const stateId = stateIds[i];
      let page = 1;
      while (points.length < MAX_POINTS) {
        const url = FC_API_BASE + '/occurrences'
          + '?order=DESC'
          + '&page=' + page
          + '&take=' + TAKE
          + '&idState=' + encodeURIComponent(stateId)
          + '&initialdate=' + initialdate
          + '&finaldate=' + finaldate;
        const res = fogoCruzadoAuthedFetch_(url);
        if (!res || res.code !== 200 || !Array.isArray(res.data)) break;

        totalRaw += res.data.length;
        res.data.forEach(function (o) {
          if (points.length >= MAX_POINTS) return;
          const lat = parseFloat(o.latitude);
          const lng = parseFloat(o.longitude);
          if (!isFinite(lat) || !isFinite(lng)) return;
          const victims = Array.isArray(o.victims) ? o.victims : [];
          const deaths = victims.filter(function (v) { return v && String(v.situation || '').toLowerCase() === 'dead'; }).length;
          points.push({
            lat: lat,
            lng: lng,
            date: o.date || '',
            city: (o.city && o.city.name) || '',
            state: (o.state && o.state.name) || '',
            reason: (o.contextInfo && o.contextInfo.mainReason && o.contextInfo.mainReason.name) || '',
            policeAction: !!o.policeAction,
            victims: victims.length,
            deaths: deaths,
          });
        });

        const meta = res.pageMeta || {};
        if (!meta.hasNextPage) break;
        page++;
        if (page > 50) break; // hard stop defensivo
      }
    }

    const result = {
      success: true,
      points: points,
      days: days,
      generatedAt: new Date().toISOString(),
      windowStart: initialdate,
      windowEnd: finaldate,
      totalRawFetched: totalRaw,
      capped: points.length >= MAX_POINTS,
    };
    // CacheService tem limite de 100KB por valor — só cacheia se couber
    try {
      const serialized = JSON.stringify(result);
      if (serialized.length < 95000) {
        cache.put(cacheKey, serialized, FC_RESULT_CACHE_SEC);
      } else {
        Logger.log('[Fogo Cruzado] resultado grande demais pra cache (' + serialized.length + 'b)');
      }
    } catch (e) { /* skip cache */ }
    return result;
  } catch (e) {
    Logger.log('[Fogo Cruzado] erro: ' + e.message);
    return { success: false, error: 'Erro ao consultar Fogo Cruzado: ' + e.message, points: [] };
  }
}

/**
 * Retorna array de UUIDs dos 4 estados-alvo. Descobre via /states na 1ª vez
 * e persiste em ScriptProperties. Se a aba states mudar, basta apagar a property.
 */
function fogoCruzadoStateIds_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty(FC_STATE_IDS_PROP);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* refaz */ }
  }
  const res = fogoCruzadoAuthedFetch_(FC_API_BASE + '/states');
  if (!res || !Array.isArray(res.data)) return [];
  const targetSet = {};
  FC_TARGET_STATES.forEach(function (n) { targetSet[n.toLowerCase()] = true; });
  const ids = res.data
    .filter(function (s) { return s && s.name && targetSet[String(s.name).toLowerCase()]; })
    .map(function (s) { return s.id; });
  if (ids.length > 0) {
    props.setProperty(FC_STATE_IDS_PROP, JSON.stringify(ids));
  }
  return ids;
}

/**
 * GET autenticado: pega token do cache (ou faz login), chama URL com Bearer.
 * Se der 401, força refresh do token e tenta 1x mais.
 */
function fogoCruzadoAuthedFetch_(url) {
  let token = fogoCruzadoToken_(false);
  let res = fogoCruzadoRawFetch_(url, token);
  if (res && res.code === 401) {
    // Token expirou — força novo login e tenta de novo
    token = fogoCruzadoToken_(true);
    res = fogoCruzadoRawFetch_(url, token);
  }
  return res;
}

function fogoCruzadoRawFetch_(url, token) {
  const opts = {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true,
  };
  const r = UrlFetchApp.fetch(url, opts);
  const txt = r.getContentText();
  try {
    const j = JSON.parse(txt);
    j.code = j.code || r.getResponseCode();
    return j;
  } catch (e) {
    return { code: r.getResponseCode(), error: txt.slice(0, 200) };
  }
}

/**
 * Login no Fogo Cruzado, retorna accessToken. Cacheia por 50min.
 * forceRefresh=true ignora o cache.
 */
function fogoCruzadoToken_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const t = cache.get(FC_TOKEN_CACHE_KEY);
    if (t) return t;
  }
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('FOGO_CRUZADO_EMAIL');
  const pass  = props.getProperty('FOGO_CRUZADO_PASSWORD');
  if (!email || !pass) throw new Error('FOGO_CRUZADO_EMAIL/PASSWORD não configurados');

  const r = UrlFetchApp.fetch(FC_API_BASE + '/auth/login', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ email: email, password: pass }),
    muteHttpExceptions: true,
  });
  const code = r.getResponseCode();
  let j;
  try { j = JSON.parse(r.getContentText()); } catch (e) {
    throw new Error('Login Fogo Cruzado retornou resposta inválida (code ' + code + ')');
  }
  if (code !== 200 && code !== 201) {
    throw new Error('Login Fogo Cruzado falhou: ' + (j && j.msg ? j.msg : 'code ' + code));
  }
  const token = j && j.data && j.data.accessToken;
  if (!token) throw new Error('Login Fogo Cruzado: accessToken não veio na resposta');
  cache.put(FC_TOKEN_CACHE_KEY, token, FC_TOKEN_CACHE_SEC);
  return token;
}