/* Financial report entry points. Countries and accounting definitions come from each dataset. */
(function () {
  'use strict';
  const regions = Object.freeze({
    latam: Object.freeze({
      code: 'latam', shortLabel: 'LATAM', labelKey: 'regionLatam', brandKey: 'brandLatam',
      subtitleKey: 'subtitle', allCountriesKey: 'allCountries', statementScopeKey: 'statementScope',
      dataUrl: 'Financial%20Reports/financial-data.json?v=20261021editorial',
      storageNamespace: 'AC_FINANCIAL', operationsEnabled: true, reportUrl: 'financial-report.html'
    }),
    na: Object.freeze({
      code: 'na', shortLabel: 'NA', labelKey: 'regionNa', brandKey: 'brandNa',
      subtitleKey: 'subtitleNa', allCountriesKey: 'allCountriesNa', statementScopeKey: 'statementScopeRegional',
      dataUrl: 'Financial%20Reports/financial-na-data.json?v=20261022countries',
      storageNamespace: 'AC_FINANCIAL_NA', operationsEnabled: false, reportUrl: 'financial-report-na.html'
    }),
    apac: Object.freeze({
      code: 'apac', shortLabel: 'APAC', labelKey: 'regionApac', brandKey: 'brandApac',
      subtitleKey: 'subtitleApac', allCountriesKey: 'allCountriesApac', statementScopeKey: 'statementScopeRegional',
      dataUrl: 'Financial%20Reports/financial-apac-data.json?v=20261021editorial',
      storageNamespace: 'AC_FINANCIAL_APAC', operationsEnabled: false, reportUrl: 'financial-report-apac.html'
    })
  });
  const requested = document.body?.dataset.financialRegion || 'latam';
  const current = regions[requested] || regions.latam;
  function localized(key, lang = 'pt') {
    return window.FINANCIAL_I18N?.[lang]?.[key] ?? window.FINANCIAL_I18N?.en?.[key] ?? key;
  }
  window.FinancialRegion = Object.freeze({ current, regions, localized });
})();
