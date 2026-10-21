# latam-driver-checkin
Daily check-in portal for LATAM Street View drivers

## Financial reports

The financial report uses the shared Aceolution layout and provides September MBR, monthly and YTD views in USD, with Portuguese, Spanish and English translations.

- `financial-report.html`: LATAM, with the existing Mastersheet operational integration.
- `financial-report-na.html`: North America. The source provides consolidated USA/Canada P&L; only card expenses can be compared by country.
- `financial-report-apac.html`: Asia-Pacific, with country and regional P&L for Thailand, Australia, Taiwan and New Zealand.

Regional navigation appears inside the financial reports. The North America and APAC reports are not added to the dashboard sidebar. Customizations and imported datasets are stored separately for each region.

North America and APAC use the January–September workbook snapshots in `Financial Reports/`. They have no connected operational/idle-day source. Missing operational figures are shown as unavailable. APAC includes billed kilometres where supplied; incomplete totals are marked and do not produce a cost-per-kilometre figure.

To refresh the aggregate datasets, run `Financial Reports/extract-financial-na.py` and `Financial Reports/extract-financial-apac.py` with Python and openpyxl. The scripts read the local workbooks and reconcile the original P&L before writing their JSON files. Keep source workbooks and presentations local; only aggregate JSON is published. The Sources tab records the source files, accounting definitions and reconciliation differences, including APAC's USD 0.05 source adjustment and India seat charges omitted from the workbook P&L.

Before publishing, check JavaScript syntax with `node --check` (including inline HTML scripts), review the monthly/YTD totals and country filters, and verify the three languages and presentation mode. Frontend deployment is a push to `main` through GitHub Pages.
