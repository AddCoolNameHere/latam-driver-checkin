/*
 * Financial Report — dated CTS downtime, aggregated to country/month.
 * Unit: distinct driver-days (not vehicle-days, hours or calendar days).
 * A day with any mapping is excluded from full-day downtime. Idle is the
 * union of explicit Tech/Mech/Weather days. Other explicit down statuses and
 * unclassified non-mapping records are separate; absent dates are never idle.
 * Raw driver records exist only while aggregating a response and are never
 * exposed by this module or persisted. Cache and snapshot contain aggregates.
 */
(function () {
  'use strict';
  const codes = ['AR', 'BR', 'CL', 'CO', 'MX', 'PE'];
  const aliases = { ar: 'AR', argentina: 'AR', br: 'BR', brasil: 'BR', brazil: 'BR',
    cl: 'CL', chile: 'CL', co: 'CO', colombia: 'CO', mx: 'MX', mexico: 'MX', pe: 'PE', peru: 'PE' };
  const metrics = ['techDays', 'mechDays', 'weatherDays', 'idleDays', 'otherDownDays',
    'unclassifiedDays', 'mappingDays', 'multiCauseDays'];
  const cachePrefix = 'AC_CACHE_FINANCIAL_IDLE_V1_';
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
  function fail(code) { const error = new Error(code); error.code = code; return error; }
  function emptyCountry(countryCode) {
    return Object.assign({ countryCode: countryCode }, Object.fromEntries(metrics.map(key => [key, null])), {
      observedDriverDays: 0, observedDates: 0, dates: [], firstDate: null, lastDate: null, coverage: 'missing',
    });
  }
  function emptyMonth(year, month, error) {
    return { year: year, month: month, status: 'unavailable', source: null, asOf: null, dataThrough: null,
      error: error || null, countries: codes.map(emptyCountry) };
  }

  function classify(status) {
    const reasons = new Set();
    let other = false;
    String(status || '').split(/\s+\/\s+/).forEach(raw => {
      if (raw.includes('⬆')) return;
      const token = normal(raw).replace(/^[^a-z]+/, '').replace(/[.\s]+$/, '');
      if (['tech', 'mech', 'weather'].includes(token)) reasons.add(token);
      else if (raw.includes('⬇') || ['personal', 'disks', 'disk', 'travelling', 'traveling', 'holiday', 'idle with driver'].includes(token)) other = true;
    });
    return { reasons: reasons, other: other };
  }

  function aggregate(rows) {
    const present = rows.filter(row => row.observedDriverDays > 0);
    const dates = [...new Set(present.flatMap(row => row.dates))].sort();
    const result = Object.fromEntries(metrics.map(key => [key, present.length ? present.reduce((sum, row) => sum + row[key], 0) : null]));
    return Object.assign(result, {
      observedDriverDays: present.reduce((sum, row) => sum + row.observedDriverDays, 0),
      observedDates: dates.length, dates: dates, firstDate: dates[0] || null, lastDate: dates.at(-1) || null,
      coverage: !present.length ? 'missing' : rows.some(row => row.coverage !== 'recorded') ? 'partial' : 'recorded',
      coveredCountryMonths: present.length, requestedCountryMonths: rows.length,
    });
  }

  // Rebuild every cached/snapshot record from an allowlist, rather than exposing
  // arbitrary fields from JSON or retaining personal data in the public result.
  function cleanMonth(raw, status) {
    if (!raw || !Number.isInteger(raw.year) || !Number.isInteger(raw.month) || raw.month < 1 || raw.month > 12 || !Array.isArray(raw.countries)) throw fail('INVALID_AGGREGATE');
    const month = emptyMonth(raw.year, raw.month, raw.error || null);
    month.status = status || raw.status;
    month.source = raw.source || null;
    month.asOf = typeof raw.asOf === 'string' && Number.isFinite(Date.parse(raw.asOf)) ? raw.asOf : null;
    month.dataThrough = isDate(raw.dataThrough) ? raw.dataThrough : null;
    month.lastDataDate = month.dataThrough;
    month.snapshotExtractedAt = typeof raw.snapshotExtractedAt === 'string' && Number.isFinite(Date.parse(raw.snapshotExtractedAt)) ? raw.snapshotExtractedAt : null;
    const seen = new Set();
    raw.countries.forEach(row => {
      if (!row || !codes.includes(row.countryCode) || seen.has(row.countryCode)) throw fail('INVALID_AGGREGATE');
      seen.add(row.countryCode);
      if (!Number.isInteger(row.observedDriverDays) || row.observedDriverDays < 0) throw fail('INVALID_AGGREGATE');
      if (row.observedDriverDays === 0) return;
      if (!metrics.every(key => Number.isInteger(row[key]) && row[key] >= 0) || !Array.isArray(row.dates)) throw fail('INVALID_AGGREGATE');
      const dates = [...new Set(row.dates)].sort();
      if (!dates.length || dates.some(day => !isDate(day) || day < monthStart(raw.year, raw.month) || day > monthEnd(raw.year, raw.month))) throw fail('INVALID_AGGREGATE');
      if (row.mappingDays + row.idleDays + row.otherDownDays + row.unclassifiedDays !== row.observedDriverDays ||
          Math.max(row.techDays, row.mechDays, row.weatherDays) > row.idleDays ||
          row.techDays + row.mechDays + row.weatherDays < row.idleDays) throw fail('INVALID_AGGREGATE');
      const clean = Object.assign(emptyCountry(row.countryCode), Object.fromEntries(metrics.map(key => [key, row[key]])), {
        observedDriverDays: row.observedDriverDays, observedDates: dates.length, dates: dates,
        firstDate: dates[0], lastDate: dates.at(-1),
        coverage: !month.dataThrough || month.dataThrough < monthEnd(raw.year, raw.month) ? 'partial' : 'recorded',
      });
      month.countries[codes.indexOf(row.countryCode)] = clean;
    });
    return month;
  }

  function normalizeResponse(payload, year, startMonth, endMonth) {
    const start = monthStart(year, startMonth), end = monthEnd(year, endMonth);
    if (!payload || payload.success !== true || !payload.period || payload.period.start !== start || payload.period.end !== end || !Array.isArray(payload.drivers)) throw fail('PERIOD_OR_SCHEMA_MISMATCH');
    const through = isDate(payload.lastDataDate) ? payload.lastDataDate : null;
    const asOf = new Date().toISOString();
    const months = [];
    for (let month = startMonth; month <= endMonth; month++) {
      const entry = emptyMonth(year, month);
      Object.assign(entry, { status: 'live', source: 'cts-dated-records', asOf: asOf, dataThrough: through });
      months.push(entry);
    }
    const seen = new Set();
    let excludedRecords = 0;
    payload.drivers.forEach(driver => {
      const code = aliases[normal(driver && driver.country)];
      if (!code) { excludedRecords++; return; }
      const identity = String(driver.email || '').trim().toLowerCase();
      if (!identity.includes('@') || !driver.days || typeof driver.days !== 'object' || Array.isArray(driver.days)) throw fail('INVALID_DRIVER_DAYS');
      Object.entries(driver.days).forEach(([date, value]) => {
        if (!isDate(date) || date < start || date > end || !value || typeof value.mapped !== 'boolean') throw fail('INVALID_DATED_RECORD');
        const identityDay = identity + '|' + date;
        if (seen.has(identityDay)) throw fail('DUPLICATE_DRIVER_DAY');
        seen.add(identityDay);
        const month = months[Number(date.slice(5, 7)) - startMonth];
        const country = month.countries[codes.indexOf(code)];
        if (country.observedDriverDays === 0) metrics.forEach(key => { country[key] = 0; });
        country.observedDriverDays++;
        if (!country.dates.includes(date)) country.dates.push(date);
        if (value.mapped) { country.mappingDays++; return; }
        const cause = classify(value.status);
        cause.reasons.forEach(reason => { country[reason + 'Days']++; });
        if (cause.reasons.size) {
          country.idleDays++;
          if (cause.reasons.size > 1) country.multiCauseDays++;
        } else if (cause.other) country.otherDownDays++;
        else country.unclassifiedDays++;
      });
    });
    return { months: months.map(month => cleanMonth(month, 'live')), excludedRecords: excludedRecords };
  }

  async function fetchJson(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => { if (controller) controller.abort(); reject(fail('TIMEOUT')); }, timeoutMs);
    });
    try {
      return await Promise.race([fetch(url, controller ? { signal: controller.signal } : {}).then(response => {
        if (!response.ok) throw fail('HTTP_ERROR');
        return response.json();
      }), timeout]);
    } finally { clearTimeout(timer); }
  }

  function readCache(key) {
    try {
      const entry = JSON.parse(localStorage.getItem(key) || 'null');
      if (!entry || !Number.isFinite(entry.at) || !Array.isArray(entry.months)) return null;
      return { at: entry.at, months: entry.months.map(month => cleanMonth(month, 'cache')) };
    } catch (error) { return null; }
  }
  function saveCache(key, months) {
    try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), months: months })); } catch (error) { /* Optional cache. */ }
  }
  function loadSnapshot() {
    if (!snapshotPromise) snapshotPromise = fetchJson('Financial%20Reports/financial-idle-data.json?v=20261020').then(payload => {
      if (!payload || payload.schemaVersion !== 1 || payload.definitionVersion !== 1 || payload.unit !== 'driver-days' || !Array.isArray(payload.months)) throw fail('INVALID_SNAPSHOT');
      return payload.months.map(month => cleanMonth(month, 'snapshot'));
    }).catch(error => { console.warn('[Financial Report] Idle snapshot unavailable:', error.code || error.message); return []; });
    return snapshotPromise;
  }

  async function loadWindow(year, startMonth, endMonth, forceRefresh) {
    const key = cachePrefix + year + '_' + startMonth + '_' + endMonth;
    const cached = readCache(key);
    if (!forceRefresh && cached && Date.now() - cached.at < cacheTtl) return cached.months;
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      try {
        const endpoint = window.FinancialOperations && window.FinancialOperations.sourceUrl;
        if (!endpoint) throw fail('ENDPOINT_UNAVAILABLE');
        const payload = await fetchJson(endpoint + '?action=getCtsTimesheet&startDate=' + monthStart(year, startMonth) + '&endDate=' + monthEnd(year, endMonth));
        const parsed = normalizeResponse(payload, year, startMonth, endMonth);
        if (parsed.excludedRecords) parsed.months.forEach(month => { month.error = 'UNKNOWN_COUNTRY_RECORDS_EXCLUDED'; });
        saveCache(key, parsed.months);
        return parsed.months;
      } catch (error) {
        const code = error.code || (error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
        console.warn('[Financial Report] Idle online refresh:', code);
        if (cached) return cached.months.map(month => Object.assign(month, { status: 'stale', error: code }));
        const snapshot = await loadSnapshot();
        const months = [];
        for (let month = startMonth; month <= endMonth; month++) {
          const fallback = snapshot.find(row => row.year === year && row.month === month);
          months.push(fallback ? Object.assign(cleanMonth(fallback, 'snapshot'), { error: code }) : emptyMonth(year, month, code));
        }
        return months;
      }
    })().finally(() => pending.delete(key));
    pending.set(key, job);
    return job;
  }

  function summarize(allMonths, year, startMonth, endMonth, countryCode) {
    const months = allMonths.filter(month => month.month >= startMonth && month.month <= endMonth).map(raw => {
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
    // Preserve fallback freshness when only some quarterly requests succeed.
    // Coverage remains independent in totals/countries/months.
    else if (statuses.includes('stale')) status = 'stale';
    else if (statuses.includes('snapshot')) status = 'snapshot';
    else if (totals.coverage === 'partial') status = 'partial';
    const warnings = ['DRIVER_DAYS_NOT_VEHICLE_DAYS', 'ONLY_RECORDED_DATES', 'MAPPED_DAYS_EXCLUDED'];
    if (totals.coverage !== 'recorded') warnings.push('INCOMPLETE_COUNTRY_MONTH_COVERAGE');
    if (totals.multiCauseDays > 0) warnings.push('CAUSE_COUNTS_OVERLAP');
    if (statuses.includes('snapshot')) warnings.push('LOCAL_SNAPSHOT_FALLBACK');
    if (statuses.includes('stale')) warnings.push('STALE_CACHE_FALLBACK');
    if (months.some(month => month.error)) warnings.push('LIVE_REFRESH_FAILED_OR_INCOMPLETE');
    return {
      status: status, source: sources.length === 1 ? sources[0] : sources.length ? 'mixed' : null,
      // A fresh quarter must not make older components appear freshly retrieved.
      asOf: months.map(month => month.asOf).filter(Boolean).sort()[0] || null,
      dataThrough: months.map(month => month.dataThrough).filter(Boolean).sort()[0] || null,
      lastDataDate: months.map(month => month.dataThrough).filter(Boolean).sort()[0] || null,
      snapshotExtractedAt: months.map(month => month.snapshotExtractedAt).filter(Boolean).sort().at(-1) || null,
      sourceUpdatedAt: null, unit: 'driver-days', definitionVersion: 1,
      period: { year: year, startMonth: startMonth, endMonth: endMonth }, countryCode: countryCode,
      months: months, countries: countries, totals: totals, warnings: warnings,
      missingMonths: months.filter(month => month.totals.coverage === 'missing').map(month => month.month),
      missingCountries: countries.filter(country => country.coverage === 'missing').map(country => country.countryCode),
    };
  }

  /** Exact dated records, read only. Up to four quarterly GETs, each below 120 days. */
  async function load(options) {
    const opts = options || {};
    const year = Number(opts.year), startMonth = Number(opts.startMonth || 1), endMonth = Number(opts.endMonth);
    const countryCode = String(opts.countryCode || 'ALL').toUpperCase();
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(startMonth) ||
        !Number.isInteger(endMonth) || startMonth < 1 || endMonth > 12 || startMonth > endMonth ||
        (countryCode !== 'ALL' && !codes.includes(countryCode))) {
      return { status: 'unavailable', source: null, asOf: null, dataThrough: null, unit: 'driver-days',
        period: { year: year, startMonth: startMonth, endMonth: endMonth }, months: [], countries: [],
        totals: aggregate([]), warnings: ['INVALID_REQUEST'], missingMonths: [], missingCountries: [] };
    }
    const months = [];
    for (let quarter = Math.floor((startMonth - 1) / 3); quarter <= Math.floor((endMonth - 1) / 3); quarter++) {
      const first = quarter * 3 + 1, last = Math.min(first + 2, endMonth);
      months.push(...await loadWindow(year, first, last, !!opts.forceRefresh));
      if (typeof opts.onProgress === 'function') {
        const partialMonths = months.concat(Array.from({ length: endMonth - last }, (_, i) => emptyMonth(year, last + i + 1, 'PENDING')));
        try { opts.onProgress(summarize(partialMonths, year, startMonth, endMonth, countryCode)); } catch (error) { /* UI observers cannot break a fetch. */ }
      }
    }
    return summarize(months, year, startMonth, endMonth, countryCode);
  }

  window.FinancialIdle = Object.freeze({ load: load });
})();
