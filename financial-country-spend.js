/* Country card views. The regional P&L is never allocated to countries here. */
(function () {
  'use strict';
  const panels = ['opening', 'costs', 'overview', 'countries'];
  const copy = {
    pt: {
      scope: 'Visão do relatório', totalNa: 'Total América do Norte', consolidated: 'P&L consolidada', cardOnly: 'Somente cartão', cardSpend: 'Despesas de cartão',
      scopeHint: 'Receita, folha e resultado permanecem na P&L consolidada de América do Norte.', selected: 'Período selecionado', ytd: 'Cartão acumulado no ano', available: 'Cartão no período disponível',
      share: 'Participação no cartão de NA', transactions: 'Transações', monthly: 'Evolução mensal do cartão', monthlyDetail: 'Cartão por mês', categories: 'Categorias do cartão',
      category: 'Categoria', amount: 'Valor', month: 'Mês', total: 'Total', country: 'País', shareColumn: '% do cartão', previous: 'Mês anterior', current: 'Último mês selecionado', change: 'Variação',
      noPrevious: 'Sem mês anterior nesta fonte.', noPercentage: 'Sem base para variação percentual.', missing: 'Dados indisponíveis para este período.', categoriesMissing: 'O detalhamento por categoria não está disponível para este recorte.',
      categoriesIncomplete: 'O detalhe por categoria não concilia com o total do cartão neste recorte.', zero: 'Nenhum gasto de cartão registrado neste recorte.',
      lodging: 'Hospedagem no cartão', fuel: 'Combustível no cartão', comparison: 'EUA e Canadá · somente cartão', comparisonHint: 'Valores do mesmo período. Esta comparação não representa despesas totais ou resultado por país.',
      categoryHint: 'Categorias conciliadas com o cartão do país, incluindo créditos. Hospedagem paga por compras e reservas regionais permanece na P&L de NA.', monthlyHint: 'A série mostra os meses disponíveis; o destaque acompanha o período selecionado.',
      export: 'Exportar cartão (CSV)', source: 'Fonte', basis: 'Meses conforme o fechamento da planilha. Valores em USD.', inSelection: 'Selecionado', countrySummary: 'Visão do cartão por país',
      periodShare: 'No mesmo período', ytdPeriod: 'Até o último mês selecionado', monthlyChange: 'Último mês vs. anterior', cardTotal: 'Total do cartão', monthlyCount: 'Transações no mês',
      recordCoverage: 'Cobertura parcial; o total não foi calculado.', zeroCountry: 'Zero de cartão nesta base; outras despesas e atividade operacional não estão abertas por país.'
    },
    es: {
      scope: 'Vista del informe', totalNa: 'Total Norteamérica', consolidated: 'P&L consolidado', cardOnly: 'Solo tarjetas', cardSpend: 'Gastos de tarjeta',
      scopeHint: 'Ingresos, nómina y resultados permanecen en el P&L consolidado de Norteamérica.', selected: 'Período seleccionado', ytd: 'Tarjetas acumuladas del año', available: 'Tarjetas del período disponible',
      share: 'Participación en tarjetas de NA', transactions: 'Transacciones', monthly: 'Evolución mensual de tarjetas', monthlyDetail: 'Tarjetas por mes', categories: 'Categorías de tarjeta',
      category: 'Categoría', amount: 'Importe', month: 'Mes', total: 'Total', country: 'País', shareColumn: '% de tarjetas', previous: 'Mes anterior', current: 'Último mes seleccionado', change: 'Variación',
      noPrevious: 'No hay mes anterior en esta fuente.', noPercentage: 'Sin base para la variación porcentual.', missing: 'Datos no disponibles para este período.', categoriesMissing: 'El detalle por categoría no está disponible para esta selección.',
      categoriesIncomplete: 'El detalle por categoría no concilia con el total de tarjetas de esta selección.', zero: 'No hay gastos de tarjeta registrados en esta selección.',
      lodging: 'Alojamiento en tarjetas', fuel: 'Combustible en tarjetas', comparison: 'EE. UU. y Canadá · solo tarjetas', comparisonHint: 'Importes del mismo período. Esta comparación no representa gastos totales ni resultados por país.',
      categoryHint: 'Categorías conciliadas con las tarjetas del país, incluidos los créditos. El alojamiento pagado mediante compras y reservas regionales permanece en el P&L de NA.', monthlyHint: 'La serie muestra los meses disponibles; el resaltado indica el período seleccionado.',
      export: 'Exportar tarjetas (CSV)', source: 'Fuente', basis: 'Meses según el cierre de la hoja de cálculo. Importes en USD.', inSelection: 'Seleccionado', countrySummary: 'Vista de tarjetas por país',
      periodShare: 'En el mismo período', ytdPeriod: 'Hasta el último mes seleccionado', monthlyChange: 'Último mes frente al anterior', cardTotal: 'Total de tarjetas', monthlyCount: 'Transacciones del mes',
      recordCoverage: 'Cobertura parcial; no se calculó el total.', zeroCountry: 'Cero en tarjetas de esta base; otros gastos y la actividad operativa no están desglosados por país.'
    },
    en: {
      scope: 'Report view', totalNa: 'Total North America', consolidated: 'Consolidated P&L', cardOnly: 'Cards only', cardSpend: 'Card expenses',
      scopeHint: 'Revenue, payroll and profit remain in the consolidated North America P&L.', selected: 'Selected period', ytd: 'Year-to-date card expenses', available: 'Cards in available period',
      share: 'Share of NA card expenses', transactions: 'Transactions', monthly: 'Monthly card expenses', monthlyDetail: 'Cards by month', categories: 'Card categories',
      category: 'Category', amount: 'Amount', month: 'Month', total: 'Total', country: 'Country', shareColumn: '% of cards', previous: 'Previous month', current: 'Last selected month', change: 'Change',
      noPrevious: 'No previous month in this source.', noPercentage: 'No base for a percentage change.', missing: 'Data unavailable for this period.', categoriesMissing: 'Category detail is unavailable for this selection.',
      categoriesIncomplete: 'Category detail does not reconcile with the card total for this selection.', zero: 'No card expenses recorded for this selection.',
      lodging: 'Lodging on cards', fuel: 'Fuel on cards', comparison: 'United States and Canada · cards only', comparisonHint: 'Amounts cover the same period. This comparison does not represent total expenses or profit by country.',
      categoryHint: 'Categories reconcile with country cards, including credits. Lodging paid through regional procurement and bookings remains in the NA P&L.', monthlyHint: 'The series shows available months; highlighting follows the selected period.',
      export: 'Export cards (CSV)', source: 'Source', basis: 'Months follow the workbook close. Amounts are in USD.', inSelection: 'Selected', countrySummary: 'Country card overview',
      periodShare: 'For the same period', ytdPeriod: 'Through the last selected month', monthlyChange: 'Last month vs. previous', cardTotal: 'Card total', monthlyCount: 'Transactions in month',
      recordCoverage: 'Partial coverage; the total was not calculated.', zeroCountry: 'Zero card expenses in this source; other expenses and operations are not broken down by country.'
    }
  };
  let active = false;

  function enabled(data) {
    return data?.meta?.countryBreakdown === 'card-only' && Array.isArray(data.cardCountryRecords) && data.cardCountryRecords.length > 0;
  }
  function scopeCodes(data) {
    return (data?.meta?.scopeCountries || []).map(row => row.code).filter(code => typeof code === 'string' && /^[A-Z]{2}$/.test(code));
  }
  function isCountry(data, code) {
    return enabled(data) && code !== 'ALL' && scopeCodes(data).includes(code);
  }
  function text(context, key) { return (copy[context.lang] || copy.en)[key] || key; }
  function monthsFor(data, start, end) {
    return data.months.filter(row => row.month >= start && row.month <= end).map(row => row.month);
  }
  // Missing rows are unavailable, while an explicit zero remains a real zero.
  function sumCards(data, code, start, end) {
    const months = monthsFor(data, start, end);
    const countries = code === 'ALL' ? scopeCodes(data) : [code];
    const rows = data.cardCountryRecords.filter(row => countries.includes(row.countryCode) && months.includes(row.month));
    const complete = months.length > 0 && countries.length > 0 && countries.every(country => months.every(month => {
      const matches = rows.filter(row => row.countryCode === country && row.month === month);
      return matches.length === 1 && Number.isFinite(matches[0].amount) && Number.isInteger(matches[0].transactions) && matches[0].transactions >= 0;
    }));
    return { complete, amount: complete ? rows.reduce((sum, row) => sum + row.amount, 0) : null, transactions: complete ? rows.reduce((sum, row) => sum + row.transactions, 0) : null };
  }
  function categoriesFor(data, code, start, end, total) {
    if (!Array.isArray(data.cardCountryCategoryRecords)) return { status: 'missing', rows: [] };
    const source = data.cardCountryCategoryRecords.filter(row => row.countryCode === code && row.month >= start && row.month <= end);
    const months = monthsFor(data, start, end);
    const reconciled = total.complete && months.every(month => {
      const card = sumCards(data, code, month, month);
      const detail = source.filter(row => row.month === month);
      return card.complete && detail.every(row => Number.isFinite(row.amount) && Number.isInteger(row.transactions) && row.transactions >= 0 && typeof row.category === 'string') &&
        Math.abs(detail.reduce((sum, row) => sum + row.amount, 0) - card.amount) <= .05 && detail.reduce((sum, row) => sum + row.transactions, 0) === card.transactions;
    });
    if (!reconciled) return { status: 'incomplete', rows: [] };
    const grouped = new Map();
    source.forEach(row => {
      const group = grouped.get(row.category) || { category: row.category, amount: 0, transactions: 0 };
      group.amount += row.amount; group.transactions += row.transactions; grouped.set(row.category, group);
    });
    return { status: 'ready', rows: [...grouped.values()].sort((a, b) => b.amount - a.amount) };
  }
  function setTab(tab) {
    const host = document.getElementById('country-spend-detail');
    if (!host) return;
    host.hidden = !active || !panels.includes(tab);
    host.querySelectorAll('[data-spend-panel]').forEach(panel => { panel.hidden = !active || panel.dataset.spendPanel !== tab; });
  }
  function render(context) {
    const { data, state, esc, n, money, pct, signed, monthName, periodLabel, countryName, localized } = context;
    const $ = id => document.getElementById(id);
    const tr = key => text(context, key);
    const tabs = document.querySelector('.fr-tabs');
    active = isCountry(data, state.country);
    if (!enabled(data) || !tabs) {
      $('country-scope-strip')?.remove(); $('country-spend-detail')?.remove();
      active = false;
      return false;
    }
    let strip = $('country-scope-strip');
    if (!strip) { strip = document.createElement('section'); strip.id = 'country-scope-strip'; strip.className = 'csp-scope-strip'; tabs.before(strip); }
    const codes = scopeCodes(data);
    strip.setAttribute('aria-label', tr('scope'));
    strip.innerHTML = `<div class="csp-scope-label">${esc(tr('scope'))}</div><div class="csp-scope-options">${['ALL', ...codes].map(code => {
      const value = sumCards(data, code, state.start, state.end);
      const selected = code === 'ALL' ? !active : code === state.country;
      return `<button type="button" class="csp-scope-option${selected ? ' is-selected' : ''}" data-country="${esc(code)}" aria-pressed="${selected}"><span class="csp-scope-name">${esc(code === 'ALL' ? tr('totalNa') : countryName(code))}<small>${esc(code === 'ALL' ? tr('consolidated') : tr('cardOnly'))}</small></span><strong title="${esc(money(value.amount, true))}">${esc(money(value.amount))}</strong><span class="csp-scope-period">${esc(tr('cardSpend'))} · ${esc(periodLabel())}</span></button>`;
    }).join('')}</div>`;
    let host = $('country-spend-detail');
    if (!host) { host = document.createElement('div'); host.id = 'country-spend-detail'; tabs.after(host); }
    if (!active) { host.hidden = true; return false; }

    const first = data.meta.firstMonth;
    const selected = sumCards(data, state.country, state.start, state.end);
    const ytd = sumCards(data, state.country, first, state.end);
    const regional = sumCards(data, 'ALL', state.start, state.end);
    const share = selected.complete && regional.complete && regional.amount !== 0 ? selected.amount / regional.amount : null;
    const current = sumCards(data, state.country, state.end, state.end);
    const previous = state.end > first ? sumCards(data, state.country, state.end - 1, state.end - 1) : null;
    const detail = categoriesFor(data, state.country, state.start, state.end, selected);
    const metric = (label, value, note, primary = false, key = '', amount = null) => `<div class="csp-metric${primary ? ' csp-metric-primary' : ''}"${key ? ` data-spend-metric="${esc(key)}"${Number.isFinite(amount) ? ` data-amount="${amount}"` : ''}` : ''}><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`;
    const tableHead = labels => `<thead><tr>${labels.map(label => `<th scope="col">${esc(label)}</th>`).join('')}</tr></thead>`;
    const categoryName = category => localized(data.cardCategoryLabels?.[category]) || category;
    const coverageNote = selected.complete ? selected.amount === 0 && selected.transactions === 0 ? tr('zeroCountry') : '' : tr('recordCoverage');
    const source = `<p class="csp-source">${esc(tr('source'))}: ${esc(data.meta.sourceFile || '')} · ${esc(tr('basis'))}</p>`;
    const delta = previous?.complete && current.complete ? current.amount - previous.amount : null;
    const deltaPct = delta !== null && previous.amount !== 0 ? delta / Math.abs(previous.amount) : null;
    const movement = previous?.complete && current.complete ? `<div class="csp-movement-grid">${metric(tr('previous'), money(previous.amount), periodLabel(state.end - 1, state.end - 1))}${metric(tr('current'), money(current.amount), periodLabel(state.end, state.end))}${metric(tr('change'), signed(delta, money), deltaPct === null ? tr('noPercentage') : signed(deltaPct, pct))}</div>` : `<p class="fr-muted">${esc(tr('noPrevious'))}</p>`;
    const opening = `<section data-spend-panel="opening"><div class="csp-kpis">${metric(tr('selected'), money(selected.amount), periodLabel(), true, 'selected', selected.amount)}${metric(tr(first === 1 ? 'ytd' : 'available'), money(ytd.amount), periodLabel(first, state.end), false, 'ytd', ytd.amount)}${metric(tr('share'), pct(share), tr('periodShare'), false, 'share', share)}${metric(tr('transactions'), n(selected.transactions), periodLabel(), false, 'transactions', selected.transactions)}</div>${coverageNote ? `<p class="csp-coverage">${esc(coverageNote)}</p>` : ''}<article class="fr-card"><h2>${esc(tr('monthlyChange'))}</h2>${movement}</article></section>`;

    let categories;
    if (detail.status !== 'ready') {
      categories = `<p class="fr-muted">${esc(tr(detail.status === 'missing' ? 'categoriesMissing' : 'categoriesIncomplete'))}</p>`;
    } else if (!detail.rows.length) {
      categories = `<p class="fr-muted">${esc(tr('zero'))}</p>`;
    } else {
      const categoryTotal = detail.rows.reduce((sum, row) => sum + row.amount, 0);
      categories = `<div class="fr-table-scroll"><table class="fr-table">${tableHead([tr('category'), tr('transactions'), tr('amount'), tr('shareColumn')])}<tbody>${detail.rows.map(row => `<tr><th scope="row">${esc(categoryName(row.category))}</th><td>${n(row.transactions)}</td><td title="${esc(money(row.amount, true))}">${esc(money(row.amount))}</td><td>${pct(categoryTotal ? row.amount / categoryTotal : null)}</td></tr>`).join('')}</tbody><tfoot><tr><td>${esc(tr('total'))}</td><td>${n(selected.transactions)}</td><td>${esc(money(categoryTotal))}</td><td>${categoryTotal ? '100%' : '—'}</td></tr></tfoot></table></div>`;
    }
    const focusCosts = detail.status === 'ready' ? `<div class="csp-focus-costs">${[['Lodging', 'lodging'], ['Fuel and Gas', 'fuel']].map(([key, label]) => {
      const value = detail.rows.find(row => row.category === key)?.amount || 0;
      return metric(tr(label), money(value), selected.amount ? `${pct(value / selected.amount)} · ${tr('cardSpend')}` : tr('cardSpend'));
    }).join('')}</div>` : '';
    const costs = `<section data-spend-panel="costs" hidden><article class="fr-card"><div class="fr-card-head"><div><p class="fr-section-number">${esc(tr('cardOnly'))}</p><h2>${esc(tr('categories'))}</h2></div><span class="fr-tag">${esc(periodLabel())}</span></div>${focusCosts}${categories}<p class="fr-footnote">${esc(tr('categoryHint'))}</p></article></section>`;

    const series = data.months.map(({ month }) => ({ month, ...sumCards(data, state.country, month, month) }));
    const max = Math.max(...series.map(row => Math.abs(row.amount || 0)), 1);
    const trend = `<div class="csp-trend">${series.map(row => {
      const inRange = row.month >= state.start && row.month <= state.end;
      const label = `${monthName(row.month)}: ${money(row.amount, true)}`;
      return `<button type="button" class="csp-trend-row${inRange ? ' is-in-range' : ''}" data-month="${row.month}" aria-label="${esc(label)}"><span>${esc(monthName(row.month, true))}</span><span class="csp-trend-track"><i class="${row.amount < 0 ? 'is-credit' : ''}" style="width:${Math.abs(row.amount || 0) / max * 100}%"></i></span><strong>${esc(money(row.amount))}</strong></button>`;
    }).join('')}</div>`;
    const monthRows = series.map(row => `<tr class="${row.month >= state.start && row.month <= state.end ? 'csp-selected-row' : ''}"><th scope="row">${esc(monthName(row.month))}</th><td title="${esc(money(row.amount, true))}">${esc(money(row.amount))}</td><td>${n(row.transactions)}</td></tr>`).join('');
    const overview = `<section data-spend-panel="overview" hidden><article class="fr-card"><div class="fr-card-head"><h2>${esc(tr('monthly'))}</h2><span class="fr-tag">${esc(periodLabel(first, data.meta.lastMonth))}</span></div>${trend}<p class="fr-footnote">${esc(tr('monthlyHint'))}</p></article><article class="fr-card fr-spaced"><h2>${esc(tr('monthlyDetail'))}</h2><div class="fr-table-scroll"><table class="fr-table">${tableHead([tr('month'), tr('amount'), tr('transactions')])}<tbody>${monthRows}</tbody><tfoot><tr><td>${esc(tr('selected'))} · ${esc(periodLabel())}</td><td>${esc(money(selected.amount))}</td><td>${n(selected.transactions)}</td></tr></tfoot></table></div></article></section>`;

    const comparisonRows = codes.map(code => {
      const value = sumCards(data, code, state.start, state.end), cumulative = sumCards(data, code, first, state.end);
      const portion = value.complete && regional.complete && regional.amount !== 0 ? value.amount / regional.amount : null;
      return `<tr class="${code === state.country ? 'csp-selected-row' : ''}"><th scope="row"><button type="button" class="csp-country-link" data-country="${esc(code)}"${code === state.country ? ' aria-current="true"' : ''}>${esc(countryName(code))}</button>${code === state.country ? `<span class="csp-selected-label">${esc(tr('inSelection'))}</span>` : ''}</th><td>${esc(money(value.amount))}</td><td>${n(value.transactions)}</td><td>${pct(portion)}</td><td>${esc(money(cumulative.amount))}</td></tr>`;
    }).join('');
    const regionalYtd = sumCards(data, 'ALL', first, state.end);
    const countries = `<section data-spend-panel="countries" hidden><article class="fr-card"><div class="fr-card-head"><div><p class="fr-section-number">${esc(tr('cardOnly'))}</p><h2>${esc(tr('comparison'))}</h2></div><span class="fr-tag">${esc(periodLabel())}</span></div><p class="fr-muted">${esc(tr('comparisonHint'))}</p><div class="fr-table-scroll"><table class="fr-table">${tableHead([tr('country'), tr('selected'), tr('transactions'), tr('shareColumn'), tr(first === 1 ? 'ytd' : 'available')])}<tbody>${comparisonRows}</tbody><tfoot><tr><td>${esc(tr('totalNa'))} · ${esc(tr('cardOnly'))}</td><td>${esc(money(regional.amount))}</td><td>${n(regional.transactions)}</td><td>${regional.amount ? '100%' : '—'}</td><td>${esc(money(regionalYtd.amount))}</td></tr></tfoot></table></div><p class="fr-footnote">${esc(tr(first === 1 ? 'ytd' : 'available'))}: ${esc(periodLabel(first, state.end))}.</p></article></section>`;

    host.innerHTML = `<div class="csp-heading"><div><p class="fr-section-number">${esc(tr('cardSpend'))} / ${esc(tr('cardOnly'))}</p><h2>${esc(countryName(state.country))}</h2><p>${esc(periodLabel())}</p></div><button type="button" class="fr-btn no-print" data-spend-export>${esc(tr('export'))}</button></div><p class="csp-scope-note">${esc(tr('scopeHint'))}</p>${opening}${costs}${overview}${countries}${source}`;
    setTab(state.tab);
    return true;
  }
  window.FinancialCountrySpend = Object.freeze({ enabled, isCountry, render, setTab });
})();
