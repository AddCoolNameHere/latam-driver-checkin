/*
 * Financial Report — read-only operational context.
 *
 * The existing MBR endpoint mixes month-specific CTS mirror data with the
 * currently selected Mastersheet calendar. Only tkmDone/kmDriven are safe
 * for a requested historical month when ctsSource === 'mirror'. Fleet,
 * mapping days, idle days, targets and QC are deliberately not inferred.
 * asOf is the retrieval time, not the source's last-update timestamp.
 * Only anonymous country aggregates are cached; raw response is discarded.
 */
(function () {
  'use strict';

  const scriptUrl = 'https://script.google.com/macros/s/AKfycbzNgMr7RXi4d1rhF3xBJVUk0EvAgYgRXGNgW_QBEAp-eI2jqahRynmQPwd6Q4m5EsSv/exec';
  const cachePrefix = 'AC_CACHE_FINANCIAL_OPERATIONS_V1_';
  const cacheTtlMs = 5 * 60 * 1000;
  const timeoutMs = 30000;
  const countryNames = {
    AR: 'Argentina', BR: 'Brazil', CL: 'Chile',
    CO: 'Colombia', MX: 'Mexico', PE: 'Peru',
  };
  const countryCodes = Object.keys(countryNames);
  const aliases = {
    argentina: 'AR', arg: 'AR', ar: 'AR',
    brazil: 'BR', brasil: 'BR', bra: 'BR', br: 'BR',
    chile: 'CL', chl: 'CL', cl: 'CL',
    colombia: 'CO', col: 'CO', co: 'CO',
    mexico: 'MX', mex: 'MX', mx: 'MX',
    peru: 'PE', per: 'PE', pe: 'PE',
  };
  const pending = new Map();

  function normalizeCountry(value) {
    const key = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    return aliases[key] || null;
  }

  function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  }

  function emptyMetrics() {
    return { tkm: null, kmDriven: null, efficiency: null, mappingDays: null, vehicles: null };
  }

  function emptyCountry(code) {
    return Object.assign({ countryCode: code, country: countryNames[code] }, emptyMetrics());
  }

  function failure(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function blankResult(month, year, status, error) {
    return {
      status: status,
      source: null,
      sourceUrl: scriptUrl,
      asOf: null,
      sourceUpdatedAt: null,
      period: { month: month, year: year },
      periodVerified: false,
      countries: countryCodes.map(emptyCountry),
      totals: emptyMetrics(),
      warnings: [],
      error: error || null,
    };
  }

  function addTotals(result) {
    const rows = result.countries;
    const complete = rows.length > 0 && rows.every(row => row.tkm !== null && row.kmDriven !== null);
    const totals = emptyMetrics();
    if (complete) {
      totals.tkm = rows.reduce((sum, row) => sum + row.tkm, 0);
      totals.kmDriven = rows.reduce((sum, row) => sum + row.kmDriven, 0);
      totals.efficiency = totals.kmDriven > 0 ? totals.tkm / totals.kmDriven : null;
    }
    result.totals = totals;
    return result;
  }

  function selectCountry(result, code) {
    // Return a detached object so consumers cannot mutate the shared cache.
    const selected = JSON.parse(JSON.stringify(result));
    if (code !== 'ALL') selected.countries = selected.countries.filter(row => row.countryCode === code);
    selected.countryCode = code;
    return addTotals(selected);
  }

  function cacheKey(month, year) {
    return cachePrefix + year + '_' + String(month).padStart(2, '0');
  }

  function readCache(month, year) {
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey(month, year)) || 'null');
      const data = cached && cached.data;
      if (!data || data.source !== 'cts-mirror' || data.periodVerified !== true ||
          !data.period || data.period.month !== month || data.period.year !== year ||
          !Number.isFinite(cached.fetchedAt) || !Array.isArray(data.countries) ||
          data.countries.length !== countryCodes.length || !data.asOf) return null;
      // Rebuild cached entries from an allowlist, preserving the anonymous contract.
      const seen = new Set();
      const countries = data.countries.map(row => {
        if (!countryNames[row.countryCode] || seen.has(row.countryCode)) throw failure('INVALID_CACHE');
        seen.add(row.countryCode);
        const tkm = numberOrNull(row.tkm);
        const kmDriven = numberOrNull(row.kmDriven);
        return Object.assign(emptyCountry(row.countryCode), {
          tkm: tkm, kmDriven: kmDriven,
          efficiency: tkm !== null && kmDriven > 0 ? tkm / kmDriven : null,
        });
      });
      const clean = blankResult(month, year, 'cache', null);
      clean.source = 'cts-mirror';
      clean.periodVerified = true;
      clean.asOf = new Date(cached.fetchedAt).toISOString();
      clean.countries = countries;
      clean.warnings = ['SOURCE_UPDATE_TIME_UNAVAILABLE', 'DAYS_AND_FLEET_PERIOD_UNVERIFIED'];
      if (countries.some(row => row.tkm === null || row.kmDriven === null)) clean.warnings.push('INCOMPLETE_COUNTRY_DATA');
      return { data: addTotals(clean), fetchedAt: cached.fetchedAt };
    } catch (error) {
      return null;
    }
  }

  function saveCache(result) {
    try {
      localStorage.setItem(cacheKey(result.period.month, result.period.year), JSON.stringify({
        data: result, fetchedAt: Date.parse(result.asOf),
      }));
    } catch (error) { /* Cache storage is optional. */ }
  }

  function normalizeResponse(payload, month, year) {
    if (!payload || payload.success !== true || !payload.data) throw failure('INVALID_RESPONSE');
    const data = payload.data;
    if (Number(data.month) !== month || Number(data.year) !== year) throw failure('PERIOD_MISMATCH');
    if (data.ctsSource !== 'mirror') {
      const unavailable = blankResult(month, year, 'unverified', 'PERIOD_UNVERIFIED');
      unavailable.source = data.ctsSource === 'mastersheet' ? 'mastersheet' : null;
      unavailable.warnings = ['PERIOD_UNVERIFIED'];
      return unavailable;
    }
    if (!Array.isArray(data.tkmReport) || !data.tkmReport.length) throw failure('EMPTY_RESPONSE');
    const byCountry = new Map();
    data.tkmReport.forEach(row => {
      const code = normalizeCountry(row && row.country);
      if (!code) return;
      if (byCountry.has(code)) throw failure('DUPLICATE_COUNTRY');
      const tkm = numberOrNull(row.tkmDone);
      const kmDriven = numberOrNull(row.kmDriven);
      byCountry.set(code, Object.assign(emptyCountry(code), {
        tkm: tkm, kmDriven: kmDriven,
        efficiency: tkm !== null && kmDriven > 0 ? tkm / kmDriven : null,
      }));
    });
    if (!byCountry.size) throw failure('EMPTY_RESPONSE');
    const result = blankResult(month, year, 'live', null);
    result.source = 'cts-mirror';
    result.periodVerified = true;
    result.asOf = new Date().toISOString();
    result.countries = countryCodes.map(code => byCountry.get(code) || emptyCountry(code));
    result.warnings = ['SOURCE_UPDATE_TIME_UNAVAILABLE', 'DAYS_AND_FLEET_PERIOD_UNVERIFIED'];
    if (result.countries.some(row => row.tkm === null || row.kmDriven === null)) result.warnings.push('INCOMPLETE_COUNTRY_DATA');
    return addTotals(result);
  }

  async function fetchPeriod(month, year) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        reject(failure('TIMEOUT'));
      }, timeoutMs);
    });
    try {
      const responsePromise = fetch(scriptUrl + '?action=getMonthlyReportData&month=' + month + '&year=' + year,
        controller ? { signal: controller.signal } : {}).then(response => {
        if (!response.ok) throw failure('HTTP_ERROR');
        return response.json();
      });
      const payload = await Promise.race([responsePromise, timeout]);
      return normalizeResponse(payload, month, year);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * load({ month, year, countryCode: 'ALL'|'AR'|'BR'|'CL'|'CO'|'MX'|'PE', forceRefresh })
   * status: live | cache | stale | unverified | unavailable.
   * Financial statement values are never fetched or changed by this module.
   */
  async function load(options) {
    const opts = options || {};
    const month = Number(opts.month);
    const year = Number(opts.year);
    const countryCode = String(opts.countryCode || 'ALL').toUpperCase();
    if (!Number.isInteger(month) || month < 1 || month > 12 ||
        !Number.isInteger(year) || year < 2000 || year > 2100 ||
        (countryCode !== 'ALL' && !countryNames[countryCode])) {
      return blankResult(month, year, 'unavailable', 'INVALID_REQUEST');
    }
    const cached = readCache(month, year);
    if (!opts.forceRefresh && cached && Date.now() - cached.fetchedAt < cacheTtlMs) {
      return selectCountry(cached.data, countryCode);
    }
    const key = cacheKey(month, year);
    try {
      if (!pending.has(key)) {
        pending.set(key, fetchPeriod(month, year).finally(() => pending.delete(key)));
      }
      const result = await pending.get(key);
      if (result.status === 'live') {
        saveCache(result);
        return selectCountry(result, countryCode);
      }
      if (!cached) return selectCountry(result, countryCode);
      const stale = selectCountry(cached.data, countryCode);
      stale.status = 'stale';
      stale.error = result.error;
      stale.warnings.push('LIVE_REFRESH_UNVERIFIED');
      return stale;
    } catch (error) {
      const errorCode = error && error.code || (error && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
      console.warn('[Financial Report] Operational data:', errorCode);
      if (cached) {
        const stale = selectCountry(cached.data, countryCode);
        stale.status = 'stale';
        stale.error = errorCode;
        stale.warnings.push('LIVE_REFRESH_FAILED');
        return stale;
      }
      return selectCountry(blankResult(month, year, 'unavailable', errorCode), countryCode);
    }
  }

  window.FinancialOperations = Object.freeze({ load: load, sourceUrl: scriptUrl });
})();
