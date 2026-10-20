/*
 * Financial Report — Mastersheet Idle Day Count, aggregated by country/month.
 * Unit: status records, matching COUNTIFS rows, not distinct driver/vehicle days.
 * Exclude weekends first, then Holiday; count only exact down Tech./Mech./Weather.
 * Queries return country/date/status/count only, never identities. Visualization
 * omits hidden/filtered rows: compare its raw date counts to a dates-ONLY CSV.
 * Reject incomplete months and use their dated aggregate snapshot/cache.
 */
(function () {
  'use strict';
  const codes = ['AR', 'BR', 'CL', 'CO', 'MX', 'PE'];
  const aliases = { ar: 'AR', argentina: 'AR', br: 'BR', brasil: 'BR', brazil: 'BR',
    cl: 'CL', chile: 'CL', co: 'CO', colombia: 'CO', mx: 'MX', mexico: 'MX', pe: 'PE', peru: 'PE' };
  const metrics = ['techDays', 'mechDays', 'weatherDays', 'idleDays', 'mappingRecords',
    'otherDownRecords', 'unclassifiedRecords', 'weekendRecords', 'holidayRecords',
    'eligibleRecords', 'observedRecords'];
  const source = 'mastersheet-idle-day-count';
  const sheetBase = 'https://docs.google.com/spreadsheets/d/1hwRnvbIKHWMRVY84lT6svbCg5BcMKkIJ7iaKpnNOGjg';
  const cachePrefix = 'AC_CACHE_FINANCIAL_IDLE_V2_';
  const cacheTtl = 10 * 60 * 1000;
  const timeoutMs = 30000;
  const pending = new Map();
  let snapshotPromise;

  function normal(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }
  function monthStart(year, month) { return year + '-' + String(month).padStart(2, '0') + '-01'; }
  function monthEnd(year, month) {
    return year + '-' + String(month).padStart(2, '0') + '-' + new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
  function isDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
  }
  function timestamp(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null; }
  function fail(code) { const error = new Error(code); error.code = code; return error; }
  function emptyCountry(countryCode) {
    return Object.assign({ countryCode: countryCode }, Object.fromEntries(metrics.map(key => [key, null])), {
      observedRecords: 0, observedDates: 0, dates: [], firstDate: null, lastDate: null, coverage: 'missing',
    });
  }
  function emptyMonth(year, month, error) {
    return { year: year, month: month, status: 'unavailable', source: null, asOf: null, dataThrough: null,
      error: error || null, countries: codes.map(emptyCountry) };
  }

  function countStatus(country, date, status, count) {
    if (!country.observedRecords) metrics.forEach(key => { country[key] = 0; });
    country.observedRecords += count;
    if (!country.dates.includes(date)) country.dates.push(date);
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    if (weekday === 0 || weekday === 6) { country.weekendRecords += count; return; }
    const token = String(status || '').toLowerCase();
    if (token === '⬆holiday' || token === '⬇holiday') { country.holidayRecords += count; return; }
    country.eligibleRecords += count;
    const reason = { '⬇tech.': 'techDays', '⬇mech.': 'mechDays', '⬇weather': 'weatherDays' }[token];
    if (reason) { country[reason] += count; country.idleDays += count; }
    else if (token.startsWith('⬆')) country.mappingRecords += count;
    else if (token.startsWith('⬇')) country.otherDownRecords += count;
    else country.unclassifiedRecords += count;
  }

  function aggregate(rows) {
    const present = rows.filter(row => row.observedRecords > 0);
    const dates = [...new Set(present.flatMap(row => row.dates))].sort();
    return Object.assign(Object.fromEntries(metrics.map(key => [key,
      present.length ? present.reduce((sum, row) => sum + row[key], 0) : null])), {
      observedRecords: present.reduce((sum, row) => sum + row.observedRecords, 0),
      observedDates: dates.length, dates: dates, firstDate: dates[0] || null, lastDate: dates.at(-1) || null,
      coverage: !present.length ? 'missing' : rows.some(row => row.coverage !== 'recorded') ? 'partial' : 'recorded',
      coveredCountryMonths: present.length, requestedCountryMonths: rows.length,
    });
  }

  // Allowlist all persisted/public fields; v1 records never enter this definition.
  function cleanMonth(raw, status) {
    if (!raw || !Number.isInteger(raw.year) || !Number.isInteger(raw.month) || raw.month < 1 || raw.month > 12 || !Array.isArray(raw.countries)) throw fail('INVALID_AGGREGATE');
    const month = emptyMonth(raw.year, raw.month, raw.error || null);
    month.status = status || raw.status;
    month.source = raw.source || null;
    month.asOf = timestamp(raw.asOf);
    month.dataThrough = isDate(raw.dataThrough) ? raw.dataThrough : null;
    month.lastDataDate = month.dataThrough;
    month.snapshotExtractedAt = timestamp(raw.snapshotExtractedAt);
    month.sourceModifiedAt = timestamp(raw.sourceModifiedAt);
    if (raw.coverageCheck === 'date-counts-match') month.coverageCheck = raw.coverageCheck;
    const seen = new Set();
    raw.countries.forEach(row => {
      if (!row || !codes.includes(row.countryCode) || seen.has(row.countryCode)) throw fail('INVALID_AGGREGATE');
      seen.add(row.countryCode);
      if (!Number.isSafeInteger(row.observedRecords) || row.observedRecords < 0) throw fail('INVALID_AGGREGATE');
      if (row.observedRecords === 0) return;
      if (!metrics.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0) || !Array.isArray(row.dates)) throw fail('INVALID_AGGREGATE');
      const dates = [...new Set(row.dates)].sort();
      if (!dates.length || dates.length > row.observedRecords || dates.some(day => !isDate(day) || day < monthStart(raw.year, raw.month) || day > monthEnd(raw.year, raw.month))) throw fail('INVALID_AGGREGATE');
      if (row.techDays + row.mechDays + row.weatherDays !== row.idleDays ||
          row.mappingRecords + row.idleDays + row.otherDownRecords + row.unclassifiedRecords !== row.eligibleRecords ||
          row.eligibleRecords + row.weekendRecords + row.holidayRecords !== row.observedRecords) throw fail('INVALID_AGGREGATE');
      month.countries[codes.indexOf(row.countryCode)] = Object.assign(emptyCountry(row.countryCode),
        Object.fromEntries(metrics.map(key => [key, row[key]])), {
          observedDates: dates.length, dates: dates, firstDate: dates[0], lastDate: dates.at(-1),
          coverage: !month.dataThrough || month.dataThrough < monthEnd(raw.year, raw.month) ? 'partial' : 'recorded',
        });
    });
    return month;
  }

  async function fetchText(url, forceRefresh) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => { if (controller) controller.abort(); reject(fail('TIMEOUT')); }, timeoutMs);
    });
    try {
      return await Promise.race([fetch(url, Object.assign({}, controller ? { signal: controller.signal } : {},
        forceRefresh ? { cache: 'no-store' } : {})).then(response => {
        if (!response.ok) throw fail('HTTP_ERROR');
        return response.text();
      }), timeout]);
    } finally { clearTimeout(timer); }
  }

  function gvizUrl(query) {
    return sheetBase + '/gviz/tq?' + new URLSearchParams({ sheet: 'RAW CTS DATA', range: 'A:U', headers: '1',
      tqx: 'out:json;responseHandler:financialIdleResponse', tq: query });
  }
  function readGviz(text, expectedColumns) {
    const match = String(text).match(/^\s*(?:\/\*O_o\*\/\s*)?financialIdleResponse\(([\s\S]*)\);?\s*$/);
    if (!match) throw fail('INVALID_QUERY_RESPONSE');
    let payload;
    try { payload = JSON.parse(match[1]); } catch (error) { throw fail('INVALID_QUERY_RESPONSE'); }
    if (!payload || payload.status !== 'ok' || !payload.table || !Array.isArray(payload.table.cols) || !Array.isArray(payload.table.rows)) throw fail('QUERY_FAILED');
    if (payload.table.cols.length !== expectedColumns.length || expectedColumns.some((column, i) =>
      payload.table.cols[i].id !== column[0] || payload.table.cols[i].type !== column[1])) throw fail('QUERY_SCHEMA_MISMATCH');
    return payload.table.rows.map(row => {
      if (!row || !Array.isArray(row.c) || row.c.length !== expectedColumns.length) throw fail('QUERY_SCHEMA_MISMATCH');
      return row.c.map(cell => cell ? cell.v : null);
    });
  }
  function gvizDate(value) {
    const match = String(value || '').match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)$/);
    if (!match) throw fail('INVALID_SOURCE_DATE');
    const date = match[1] + '-' + String(Number(match[2]) + 1).padStart(2, '0') + '-' + match[3].padStart(2, '0');
    if (!isDate(date)) throw fail('INVALID_SOURCE_DATE');
    return date;
  }
  function positiveCount(value) {
    if (!Number.isSafeInteger(value) || value <= 0) throw fail('INVALID_SOURCE_COUNT');
    return value;
  }
  function csvDateCounts(text) {
    // Column G is verified to export ISO yyyy-MM-dd. Never guess ambiguous
    // locale dates; a formatting/schema change must use an explicit fallback.
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
    const unquote = value => /^"[^"\r\n]*"$/.test(value) ? value.slice(1, -1) : value;
    if (unquote(lines.shift() || '').trim() !== 'drive_date') throw fail('DATE_CSV_SCHEMA_MISMATCH');
    const counts = new Map();
    lines.forEach(line => {
      if (!line.trim()) return;
      const date = unquote(line).trim();
      if (!isDate(date)) throw fail('DATE_CSV_FORMAT_CHANGED');
      counts.set(date, (counts.get(date) || 0) + 1);
    });
    if (!counts.size) throw fail('EMPTY_SOURCE');
    return counts;
  }

  function normalizeResponses(statusText, countText, dateText, year, startMonth, endMonth) {
    const start = monthStart(year, startMonth), end = monthEnd(year, endMonth);
    const expected = csvDateCounts(dateText);
    const visible = new Map();
    readGviz(countText, [['G', 'date'], ['count-G', 'number']]).forEach(row => {
      const date = gvizDate(row[0]);
      if (date < start || date > end || visible.has(date)) throw fail('QUERY_PERIOD_MISMATCH');
      visible.set(date, positiveCount(row[1]));
    });
    const asOf = new Date().toISOString(), through = [...expected.keys()].sort().at(-1);
    const months = [];
    for (let month = startMonth; month <= endMonth; month++) {
      const first = monthStart(year, month), last = monthEnd(year, month);
      const sourceDates = [...expected.keys()].filter(date => date >= first && date <= last);
      const queryDates = [...visible.keys()].filter(date => date >= first && date <= last);
      const entry = emptyMonth(year, month);
      if (!sourceDates.length) entry.error = 'NO_SOURCE_RECORDS';
      else if (sourceDates.length !== queryDates.length || sourceDates.some(date => visible.get(date) !== expected.get(date))) entry.error = 'SOURCE_COVERAGE_MISMATCH';
      else Object.assign(entry, { status: 'live', source: source, asOf: asOf, dataThrough: through,
        coverageCheck: 'date-counts-match' });
      months.push(entry);
    }
    const rosterCounts = new Map(), seen = new Set();
    readGviz(statusText, [['D', 'string'], ['G', 'date'], ['M', 'string'], ['count-K', 'number']]).forEach(row => {
      const date = gvizDate(row[1]), count = positiveCount(row[3]);
      if (date < start || date > end) throw fail('QUERY_PERIOD_MISMATCH');
      const key = JSON.stringify(row.slice(0, 3));
      if (seen.has(key)) throw fail('DUPLICATE_SOURCE_GROUP');
      seen.add(key);
      rosterCounts.set(date, (rosterCounts.get(date) || 0) + count);
      if (rosterCounts.get(date) > (visible.get(date) || 0)) throw fail('SOURCE_COUNTS_CHANGED');
      const entry = months[Number(date.slice(5, 7)) - startMonth];
      if (entry.error) return;
      const countryCode = aliases[normal(row[0])];
      if (!countryCode) { entry.error = 'UNKNOWN_COUNTRY_RECORDS'; return; }
      countStatus(entry.countries[codes.indexOf(countryCode)], date, row[2], count);
    });
    return months.map(month => month.error ? emptyMonth(year, month.month, month.error) : cleanMonth(month, 'live'));
  }

  function cacheKey(year, month) { return cachePrefix + year + '_' + month; }
  function readCache(year, month) {
    try {
      const entry = JSON.parse(localStorage.getItem(cacheKey(year, month)) || 'null');
      if (!entry || entry.schemaVersion !== 2 || entry.definitionVersion !== 2 || entry.unit !== 'status-records' ||
          !Number.isFinite(entry.at) || !entry.month || entry.month.year !== year || entry.month.month !== month ||
          entry.month.source !== source || entry.month.coverageCheck !== 'date-counts-match') return null;
      return { at: entry.at, month: cleanMonth(entry.month, 'cache') };
    } catch (error) { return null; }
  }
  function saveCache(month) {
    try { localStorage.setItem(cacheKey(month.year, month.month), JSON.stringify({ at: Date.now(),
      schemaVersion: 2, definitionVersion: 2, unit: 'status-records', month: month })); } catch (error) { /* Optional cache. */ }
  }
  function loadSnapshot(forceRefresh) {
    if (forceRefresh) snapshotPromise = null;
    if (!snapshotPromise) snapshotPromise = fetchText('Financial%20Reports/financial-idle-data.json?v=20261020idle2', forceRefresh).then(text => {
      const payload = JSON.parse(text);
      if (!payload || payload.schemaVersion !== 2 || payload.definitionVersion !== 2 || payload.unit !== 'status-records' || !Array.isArray(payload.months)) throw fail('INVALID_SNAPSHOT');
      return payload.months.map(month => cleanMonth(month, 'snapshot'));
    }).catch(error => { console.warn('[Financial Report] Idle snapshot unavailable:', error.code || error.message); return []; });
    return snapshotPromise;
  }

  async function loadWindow(year, startMonth, endMonth, forceRefresh) {
    const key = year + '_' + startMonth + '_' + endMonth;
    const cached = Array.from({ length: endMonth - startMonth + 1 }, (_, i) => readCache(year, startMonth + i));
    if (!forceRefresh && cached.every(entry => entry && Date.now() >= entry.at && Date.now() - entry.at < cacheTtl)) return cached.map(entry => entry.month);
    if (!forceRefresh && pending.has(key)) return pending.get(key);
    const job = (async () => {
      let months;
      try {
        const period = "G >= date '" + monthStart(year, startMonth) + "' and G <= date '" + monthEnd(year, endMonth) + "'";
        const responses = await Promise.all([
          fetchText(gvizUrl("select D,G,M,count(K) where K contains '@' and " + period + ' group by D,G,M'), forceRefresh),
          fetchText(gvizUrl('select G,count(G) where ' + period + ' group by G'), forceRefresh),
          fetchText(sheetBase + '/export?' + new URLSearchParams({ format: 'csv', gid: '752215658', range: 'G1:G' }), forceRefresh),
        ]);
        months = normalizeResponses(responses[0], responses[1], responses[2], year, startMonth, endMonth);
      } catch (error) {
        const code = error.code || (error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
        console.warn('[Financial Report] Idle online refresh:', code);
        months = Array.from({ length: endMonth - startMonth + 1 }, (_, i) => emptyMonth(year, startMonth + i, code));
      }
      const snapshot = months.some(month => month.status !== 'live') ? await loadSnapshot(forceRefresh) : [];
      return months.map((month, i) => {
        if (month.status === 'live') { saveCache(month); return month; }
        // An unsuccessful refresh must never relabel cached/snapshot data live.
        if (cached[i]) return Object.assign(cleanMonth(cached[i].month, 'stale'), { error: month.error });
        const fallback = snapshot.find(row => row.year === year && row.month === month.month);
        return fallback ? Object.assign(cleanMonth(fallback, 'snapshot'), { error: month.error }) : month;
      });
    })().finally(() => { if (pending.get(key) === job) pending.delete(key); });
    pending.set(key, job);
    return job;
  }

  function summarize(allMonths, year, startMonth, endMonth, countryCode) {
    const months = allMonths.filter(month => month.year === year && month.month >= startMonth && month.month <= endMonth).map(raw => {
      const month = cleanMonth(raw);
      if (countryCode !== 'ALL') month.countries = month.countries.filter(country => country.countryCode === countryCode);
      month.totals = aggregate(month.countries);
      month.missingCountries = month.countries.filter(row => row.coverage === 'missing').map(row => row.countryCode);
      return month;
    });
    const selectedCodes = countryCode === 'ALL' ? codes : [countryCode];
    const countries = selectedCodes.map(code => {
      const rows = months.map(month => month.countries.find(row => row.countryCode === code));
      return Object.assign({ countryCode: code }, aggregate(rows), {
        missingMonths: months.filter((month, i) => rows[i].coverage === 'missing').map(month => month.month),
      });
    });
    const totals = aggregate(months.flatMap(month => month.countries));
    const sources = [...new Set(months.map(month => month.source).filter(Boolean))];
    const statuses = [...new Set(months.map(month => month.status))];
    let status = statuses.length === 1 ? statuses[0] : 'partial';
    if (totals.coverage === 'missing') status = 'unavailable';
    else if (statuses.includes('stale')) status = 'stale';
    else if (statuses.includes('snapshot')) status = 'snapshot';
    else if (totals.coverage === 'partial') status = 'partial';
    const warnings = ['STATUS_RECORDS_NOT_DISTINCT_DAYS', 'ONLY_RECORDED_DATES',
      'WEEKENDS_AND_HOLIDAY_EXCLUDED', 'MASTERSHEET_COUNTIFS_STATUS_RULE'];
    if (totals.coverage !== 'recorded') warnings.push('INCOMPLETE_COUNTRY_MONTH_COVERAGE');
    if (statuses.includes('snapshot')) warnings.push('LOCAL_SNAPSHOT_FALLBACK');
    if (statuses.includes('stale')) warnings.push('STALE_CACHE_FALLBACK');
    if (months.some(month => month.error === 'SOURCE_COVERAGE_MISMATCH')) warnings.push('HIDDEN_OR_FILTERED_SOURCE_ROWS');
    if (months.some(month => month.error)) warnings.push('LIVE_REFRESH_FAILED_OR_INCOMPLETE');
    return {
      status: status, source: sources.length === 1 ? sources[0] : sources.length ? 'mixed' : null,
      asOf: months.map(month => month.asOf).filter(Boolean).sort()[0] || null,
      dataThrough: months.map(month => month.dataThrough).filter(Boolean).sort()[0] || null,
      lastDataDate: months.map(month => month.dataThrough).filter(Boolean).sort()[0] || null,
      snapshotExtractedAt: months.map(month => month.snapshotExtractedAt).filter(Boolean).sort().at(-1) || null,
      sourceUpdatedAt: null, unit: 'status-records', schemaVersion: 2, definitionVersion: 2,
      period: { year: year, startMonth: startMonth, endMonth: endMonth }, countryCode: countryCode,
      months: months, countries: countries, totals: totals, warnings: warnings,
      missingMonths: months.filter(month => month.totals.coverage === 'missing').map(month => month.month),
      missingCountries: countries.filter(country => country.coverage === 'missing').map(country => country.countryCode),
    };
  }

  /** Read only: two anonymous grouped queries plus one dates-only CSV. */
  async function load(options) {
    const opts = options || {};
    const year = Number(opts.year), startMonth = Number(opts.startMonth || 1), endMonth = Number(opts.endMonth);
    const countryCode = String(opts.countryCode || 'ALL').toUpperCase();
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(startMonth) ||
        !Number.isInteger(endMonth) || startMonth < 1 || endMonth > 12 || startMonth > endMonth ||
        (countryCode !== 'ALL' && !codes.includes(countryCode))) {
      return { status: 'unavailable', source: null, asOf: null, dataThrough: null, unit: 'status-records',
        schemaVersion: 2, definitionVersion: 2,
        period: { year: year, startMonth: startMonth, endMonth: endMonth }, months: [], countries: [],
        totals: aggregate([]), warnings: ['INVALID_REQUEST'], missingMonths: [], missingCountries: [] };
    }
    const months = await loadWindow(year, startMonth, endMonth, !!opts.forceRefresh);
    const result = summarize(months, year, startMonth, endMonth, countryCode);
    if (typeof opts.onProgress === 'function') {
      try { opts.onProgress(result); } catch (error) { /* UI observers cannot break a fetch. */ }
    }
    return result;
  }

  window.FinancialIdle = Object.freeze({ load: load });
})();
