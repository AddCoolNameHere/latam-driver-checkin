"""Extract the supplied Street View North America close without changing it.

Revenue, payroll and procurement are regional totals. Card transactions identify
US and Canada, but do not support allocating the full P&L between those countries.
The primary records therefore use the consolidated NA scope. Only country/month
card aggregates are exported separately. No employee, merchant or vendor names,
individual transactions, or Waymo data are published.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "SV-NA (Jan-Sep).xlsx"
OUTPUT = HERE / "financial-na-data.json"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September"]
FIELDS = ["income", "billables", "managementFees", "revenue", "expenses", "profit"]
COSTS = ["card", "payroll", "procurement", "otherIndirect", "nonBillablePayroll"]
COST_COLUMNS = {"card": "N", "payroll": "P", "procurement": "M", "otherIndirect": "O", "nonBillablePayroll": "Q"}
CARD_COUNTRIES = {"SV USA": "US", "SV Canada": "CA"}
TOLERANCE = .00001


def labels(pt, es, en):
    return {"pt": pt, "es": es, "en": en}


def num(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def tidy(value):
    if isinstance(value, float):
        return round(value, 8)
    if isinstance(value, dict):
        return {key: tidy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [tidy(item) for item in value]
    return value


def check(actual, expected, context):
    difference = actual - expected
    if abs(difference) >= TOLERANCE:
        raise ValueError(f"Reconciliation failed: {context}: {difference}")
    return difference


def parse_card_date(value, month_name):
    if isinstance(value, datetime):
        return value
    candidates = set()
    for pattern in ["%m/%d/%Y", "%d/%m/%Y", "%m/%d/%y", "%d/%m/%y", "%Y-%m-%d"]:
        try:
            candidate = datetime.strptime(str(value), pattern)
        except ValueError:
            continue
        if candidate.strftime("%B") == month_name:
            candidates.add(candidate)
    if len(candidates) != 1:
        raise ValueError("Ambiguous or invalid text transaction date")
    return next(iter(candidates))


def aggregate(rows):
    result = {key: sum(row[key] for row in rows) for key in FIELDS}
    result["costs"] = {key: sum(row["costs"][key] for row in rows) for key in COSTS}
    for key in ["allocatedOverhead", "localExpenses", "contributionProfit", "kms"]:
        result[key] = sum(row[key] for row in rows)
    result["margin"] = result["profit"] / result["revenue"] if result["revenue"] else None
    result["returnOnCost"] = result["profit"] / result["expenses"] if result["expenses"] else None
    result["contributionMargin"] = result["contributionProfit"] / result["revenue"] if result["revenue"] else None
    return result


def main():
    values = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
    formulas = openpyxl.load_workbook(SOURCE, read_only=True, data_only=False)
    try:
        pl, costs, payroll = values["Revenue"], values["IDC Expenses"], values["DC Expenses"]
        assert payroll["F3"].value == "SV - NA - 2026 - MoM Payroll"
        year = 2026  # Explicitly identified by the source payroll heading.
        assert pl["A2"].value == "Month" and pl["H2"].value == "P&L"
        assert formulas["IDC Expenses"]["H12"].value == "=H11/9"
        errors = [{"sheet": sheet.title, "cell": cell.coordinate, "error": cell.value}
                  for sheet in values for row in sheet.iter_rows() for cell in row if cell.data_type == "e"]
        if errors:
            raise ValueError("Source workbook contains cached spreadsheet errors")

        records, component_differences, income_differences = [], [], []
        for month, month_name in enumerate(MONTHS, 1):
            r, cr = month + 2, month + 3
            assert pl.cell(r, 1).value == month_name
            record = {"country": "North America (consolidated)", "countryCode": "NA", "month": month,
                      "period": f"{year}-{month:02d}", "kms": pl.cell(r, 2).value}
            for col, key in enumerate(FIELDS, 3):
                value = pl.cell(r, col).value
                assert num(value), (key, month)
                record[key] = value
            # The fee is explicit in Revenue E3:E11; it is not inherited from LATAM.
            assert formulas["Revenue"].cell(r, 5).value == f"=D{r}*7.8%"
            check(record["managementFees"], record["billables"] * .078, f"fee month {month}")
            check(record["revenue"], record["income"] + record["billables"] + record["managementFees"], f"revenue month {month}")
            check(record["profit"], record["revenue"] - record["expenses"], f"profit month {month}")
            refs = {key: f"{column}{cr}" for key, column in COST_COLUMNS.items()}
            record["costs"] = {key: costs[ref].value for key, ref in refs.items()}
            assert all(num(value) for value in record["costs"].values())
            component_differences.append(check(sum(record["costs"].values()), record["expenses"], f"cost components month {month}"))
            check(record["expenses"], costs[f"R{cr}"].value, f"expense close month {month}")
            check(record["costs"]["payroll"], payroll.cell(month+4, 7).value, f"monthly payroll {month}")
            check(record["costs"]["otherIndirect"], costs["H12"].value, f"monthly services {month}")
            # Only services have an explicit Jan-Sep amount / 9 in the source.
            # Procurement and both payroll lines retain their actual monthly totals.
            record["allocatedOverhead"] = record["costs"]["otherIndirect"]
            record["localExpenses"] = record["expenses"] - record["allocatedOverhead"]
            record["contributionProfit"] = record["revenue"] - record["localExpenses"]
            record["margin"] = record["profit"] / record["revenue"] if record["revenue"] else None
            record["returnOnCost"] = record["profit"] / record["expenses"] if record["expenses"] else None
            record["contributionMargin"] = record["contributionProfit"] / record["revenue"] if record["revenue"] else None
            record["source"] = {"sheet": "Revenue", "range": f"A{r}:H{r}", "costSheet": "IDC Expenses",
                                "costCells": refs, "kmsCell": f"B{r}"}
            records.append(record)
            income_differences.append({"month": month, "sourceCell": f"DC Expenses!H{month+4}",
                                       "auxiliaryIncome": payroll.cell(month+4, 8).value,
                                       "pnlIncome": record["income"],
                                       "difference": payroll.cell(month+4, 8).value-record["income"]})
        totals = aggregate(records)
        source_total_differences = [check(totals[key], pl.cell(12, col).value, f"Revenue total {key}")
                                    for col, key in enumerate(FIELDS, 3)]
        check(totals["kms"], pl["B12"].value, "source KMS total")
        check(totals["expenses"], costs["R13"].value, "IDC expense control")

        aliases = {"Fuel and gas": "Fuel and Gas", "Government services": "Government Services",
                   "Car services": "Car Services", "Phone and Internet": "Internet and Phone",
                   "Vehicle Maintanence": "Vehicle Maintenance"}
        category_labels = {
            "Airlines": labels("Passagens aéreas", "Pasajes aéreos", "Airlines"),
            "Alcohol and Bars": labels("Bares e bebidas", "Bares y bebidas", "Alcohol and bars"),
            "Books and Newspapers": labels("Livros e jornais", "Libros y periódicos", "Books and newspapers"),
            "Car Rental": labels("Aluguel de veículos", "Alquiler de vehículos", "Car rental"),
            "Car Services": labels("Serviços de veículos", "Servicios de vehículos", "Vehicle services"),
            "Education": labels("Educação", "Educación", "Education"),
            "Electronics": labels("Eletrônicos", "Electrónica", "Electronics"),
            "Entertainment": labels("Entretenimento", "Entretenimiento", "Entertainment"),
            "Freight, Moving and Delivery Services": labels("Fretes e entregas", "Fletes y entregas", "Freight and delivery"),
            "Fuel and Gas": labels("Combustível", "Combustible", "Fuel and gas"),
            "General Merchandise": labels("Mercadorias em geral", "Mercancías generales", "General merchandise"),
            "Government Services": labels("Serviços públicos", "Servicios gubernamentales", "Government services"),
            "Insurance": labels("Seguros", "Seguros", "Insurance"),
            "Internet and Phone": labels("Internet e telefone", "Internet y teléfono", "Internet and phone"),
            "Laundry": labels("Lavanderia", "Lavandería", "Laundry"),
            "Legal": labels("Jurídico", "Legal", "Legal"),
            "Lodging": labels("Hospedagem", "Alojamiento", "Lodging"),
            "Medical": labels("Saúde", "Salud", "Medical"),
            "Office supplies and cleaning": labels("Escritório e limpeza", "Oficina y limpieza", "Office supplies and cleaning"),
            "Other": labels("Outros", "Otros", "Other"),
            "Parking": labels("Estacionamento", "Estacionamiento", "Parking"),
            "Professional Services": labels("Serviços profissionais", "Servicios profesionales", "Professional services"),
            "Restaurants": labels("Restaurantes", "Restaurantes", "Restaurants"),
            "SaaS / Software": labels("Software e SaaS", "Software y SaaS", "Software and SaaS"),
            "Shipping": labels("Envios", "Envíos", "Shipping"),
            "Storage": labels("Armazenamento", "Almacenamiento", "Storage"),
            "Supermarkets and Grocery Stores": labels("Supermercados", "Supermercados", "Supermarkets and groceries"),
            "Taxi and Rideshare": labels("Táxi e aplicativos", "Taxi y aplicaciones", "Taxi and rideshare"),
            "Travel Misc": labels("Outras viagens", "Otros viajes", "Other travel"),
            "Vehicle Maintenance": labels("Manutenção de veículos", "Mantenimiento de vehículos", "Vehicle maintenance"),
        }
        card_rows = list(values["Card Raw"].iter_rows(values_only=True))
        assert card_rows[0] == ("Transaction Date", "User", "Merchant Name", "Ramp Category", "Ramp Department", "Statement Amount", "Month")
        category_groups = defaultdict(lambda: {"amount": 0.0, "transactions": 0})
        country_groups = defaultdict(lambda: {"amount": 0.0, "transactions": 0})
        category_originals = defaultdict(set)
        date_month_mismatches = defaultdict(lambda: {"count": 0, "amount": 0.0})
        excluded_text = Counter()
        excluded_text_amount = 0.0
        dated, out_of_year, negative_count, negative_amount = [], [], 0, 0.0
        for rn, row in enumerate(card_rows[1:], 2):
            transaction_date, _, _, original_category, department, amount, month_name = row
            if department not in CARD_COUNTRIES or month_name not in MONTHS:
                raise ValueError("Unexpected card scope: review before publishing")
            country_code, month = CARD_COUNTRIES[department], MONTHS.index(month_name)+1
            dt = parse_card_date(transaction_date, month_name)
            dated.append(dt)
            if dt.year != year:
                out_of_year.append({"sourceCell": f"A{rn}", "recordedYear": dt.year, "sourceMonth": month})
            if dt.strftime("%B") != month_name:
                entry = date_month_mismatches[(dt.strftime("%Y-%m"), month)]
                entry["count"] += 1
                if num(amount):
                    entry["amount"] += amount
            if not num(amount):
                excluded_text[(country_code, month)] += 1
                excluded_text_amount += float(amount)
                continue  # The supplied numeric pivot excludes this text amount.
            category = aliases.get(original_category, original_category)
            assert category in category_labels, category
            category_originals[category].add(original_category)
            for group in [category_groups[(month, category)], country_groups[(country_code, month)]]:
                group["amount"] += amount
                group["transactions"] += 1
            if amount < 0:
                negative_count += 1
                negative_amount += amount
        card_records = [{"countryCode": "NA", "month": month, "category": category, **value}
                        for (month, category), value in sorted(category_groups.items())]
        card_country_records = [{"countryCode": code, "month": month, **country_groups[(code, month)]}
                                for code in ["US", "CA"] for month in range(1, 10)]
        card_differences = []
        for row in records:
            card_differences.append(check(sum(c["amount"] for c in card_records if c["month"] == row["month"]), row["costs"]["card"], f"card month {row['month']}"))
            check(sum(c["amount"] for c in card_country_records if c["month"] == row["month"]), row["costs"]["card"], f"card country month {row['month']}")
        check(totals["costs"]["card"], costs["E38"].value, "card pivot total")
        check(totals["costs"]["card"], values["Sheet6"]["B36"].value, "second card pivot total")
        check(totals["costs"]["card"], values["PPT Slides"]["H23"].value, "PPT card summary")

        procurement_rows = list(values["Proc Raw"].iter_rows(values_only=True))
        assert procurement_rows[0] == ("Month", "Category", "Project", "Vendor", "Actual Spent")
        procurement_groups = defaultdict(lambda: {"amount": 0.0, "transactions": 0})
        procurement_labels = {
            "Depot Consumables": labels("Consumíveis de depósito", "Consumibles de depósito", "Depot consumables"),
            "Flight": labels("Passagens aéreas", "Pasajes aéreos", "Flights"),
            "Hotel": labels("Hospedagem", "Alojamiento", "Hotels"),
            "Parking": labels("Estacionamento", "Estacionamiento", "Parking"),
            "Rental": labels("Locação", "Alquiler", "Rental"),
            "Services": labels("Serviços", "Servicios", "Services"),
            "Train": labels("Trem", "Tren", "Train"),
            "Travel Desk Serivce Fee": labels("Taxa de agência de viagens", "Tarifa de agencia de viajes", "Travel desk service fee"),
        }
        for month_name, category, project, _, amount in procurement_rows[1:]:
            if project != "SV-NA" or month_name not in MONTHS or not num(amount):
                raise ValueError("Unexpected procurement scope or amount")
            assert category in procurement_labels
            entry = procurement_groups[(MONTHS.index(month_name)+1, category)]
            entry["amount"] += amount
            entry["transactions"] += 1
        procurement_records = [{"countryCode": "NA", "month": month, "category": category, **value}
                               for (month, category), value in sorted(procurement_groups.items())]
        procurement_differences = [check(sum(p["amount"] for p in procurement_records if p["month"] == row["month"]), row["costs"]["procurement"], f"procurement month {row['month']}") for row in records]
        check(totals["costs"]["procurement"], values["PPT Slides"]["K13"].value, "PPT procurement summary")
        check(totals["costs"]["otherIndirect"], costs["H11"].value, "other services total")
        ppt_differences = []
        for row in records:
            rr = row["month"] + 3
            for column, key in [(18,"kms"),(19,"income"),(20,"billables"),(21,"revenue"),(22,"expenses"),(23,"profit")]:
                ppt_differences.append(check(row[key], values["PPT Slides"].cell(rr,column).value, f"PPT close month {row['month']} {key}"))

        auxiliary_income_delta = payroll["H17"].value - totals["income"]
        biweekly_payroll_delta = payroll["B33"].value - totals["costs"]["payroll"]
        payroll_summary_delta = payroll["G17"].value - totals["costs"]["payroll"]
        support_delta = payroll["L6"].value - totals["costs"]["nonBillablePayroll"]
        mismatch_count = sum(v["count"] for v in date_month_mismatches.values())
        issues = [
            {"id": "na_consolidated_scope", "severity": "info", "status": "documented",
             "title": labels("Resultado regional consolidado", "Resultado regional consolidado", "Consolidated regional result"),
             "detail": labels("A planilha identifica Estados Unidos e Canadá no cartão, mas não divide receita, folha e os demais custos entre países. A P&L é exibida como América do Norte consolidada; somente o cartão tem abertura por país.", "La hoja identifica Estados Unidos y Canadá en las tarjetas, pero no separa ingresos, nómina y otros gastos por país. P&L se presenta para Norteamérica consolidada; solo las tarjetas tienen desglose por país.", "The workbook identifies the United States and Canada in card transactions but does not split revenue, payroll or the remaining costs by country. P&L is shown for consolidated North America; only card costs have a country breakdown."),
             "source": {"sheet": "Revenue", "range": "A2:H12"}},
            {"id": "na_card_period_labels", "severity": "warning", "status": "open", "count": mismatch_count,
             "title": labels("Datas diferentes do mês do fechamento", "Fechas distintas del mes de cierre", "Dates differ from the closing month"),
             "detail": labels(f"{mismatch_count} datas de cartão diferem da coluna Month e {len(out_of_year)} data registra outro ano. Os totais usam Month, como o pivô e a P&L da fonte. Nenhuma data foi corrigida ou movimentada entre meses.", f"{mismatch_count} fechas de tarjeta difieren de la columna Month y {len(out_of_year)} fecha corresponde a otro año. Los totales usan Month, como la tabla dinámica y P&L de origen. No se corrigieron fechas ni se trasladaron gastos entre meses.", f"{mismatch_count} card dates differ from the Month column and {len(out_of_year)} date records another year. Totals use Month, matching the source pivot and P&L. No dates were corrected or expenses shifted between months."),
             "source": {"sheet": "Card Raw", "range": "A2:G12605"},
             "bySourcePeriod": [{"transactionMonth": period, "sourceMonth": month, **entry} for (period,month),entry in sorted(date_month_mismatches.items())], "outOfYearCount": len(out_of_year), "outOfYearReferences": out_of_year},
            {"id": "na_text_card_amount", "severity": "warning", "status": "open", "count": sum(excluded_text.values()), "amount": excluded_text_amount,
             "title": labels("Valor de cartão armazenado como texto", "Importe de tarjeta guardado como texto", "Card amount stored as text"),
             "detail": labels("Um valor de USD 37,02 de julho, no Canadá, está como texto e fica fora do pivô. O relatório preserva o fechamento da fonte e não o adiciona às despesas.", "Un importe de USD 37,02 de julio en Canadá está guardado como texto y queda fuera de la tabla dinámica. El informe conserva el cierre de origen y no lo añade a los gastos.", "One July Canada amount of USD 37.02 is stored as text and excluded from the pivot. The report preserves the source close and does not add it to expenses."),
             "source": {"sheet": "Card Raw", "range": "F9640"}},
            {"id": "na_auxiliary_income_difference", "severity": "warning", "status": "open", "amount": auxiliary_income_delta,
             "title": labels("Faturamento auxiliar difere da receita", "Facturación auxiliar distinta de los ingresos", "Auxiliary invoicing differs from income"),
             "detail": labels("A coluna Invoiced do resumo de folha soma USD 954,19 a menos que Income. Abril explica USD 954,22; janeiro e agosto têm diferenças menores. O relatório usa Revenue, que confere com PPT Slides.", "La columna Invoiced del resumen de nómina suma USD 954,19 menos que Income. Abril explica USD 954,22; enero y agosto presentan diferencias menores. El informe usa Revenue, que coincide con PPT Slides.", "The payroll summary's Invoiced column totals USD 954.19 less than Income. April accounts for USD 954.22, with smaller January and August differences. The report uses Revenue, which matches PPT Slides."),
             "source": {"sheet": "DC Expenses", "range": "F5:H17"}, "byMonth": income_differences},
            {"id": "na_payroll_auxiliary_difference", "severity": "warning", "status": "open", "amount": biweekly_payroll_delta,
             "title": labels("Listagem quinzenal não fecha com a mensal", "Lista quincenal distinta del cierre mensual", "Biweekly listing differs from monthly payroll"),
             "detail": labels("A listagem quinzenal soma USD 1.106.358,80, enquanto a folha mensal usada no fechamento soma USD 1.024.088,59: diferença de USD 82.270,21. Não foram somadas as duas visões nem feitas correções automáticas. O relatório segue os valores mensais da P&L.", "La lista quincenal suma USD 1.106.358,80 y la nómina mensual del cierre suma USD 1.024.088,59: una diferencia de USD 82.270,21. No se sumaron ambas vistas ni se hicieron ajustes automáticos. El informe sigue los importes mensuales de P&L.", "The biweekly listing totals USD 1,106,358.80 while monthly payroll in the close totals USD 1,024,088.59, a USD 82,270.21 difference. The two views were not added together or automatically adjusted. The report follows the monthly P&L amounts."),
             "source": {"sheet": "DC Expenses", "range": "A3:I33"}},
            {"id": "na_payroll_rounding", "severity": "info", "status": "documented", "amount": support_delta,
             "title": labels("Centavos nos totais auxiliares de folha", "Centavos en totales auxiliares de nómina", "Small payroll summary differences"),
             "detail": labels("O total Paid auxiliar fica USD 0,01 acima da soma mensal. O resumo de apoio soma USD 123.298,29 e a linha mensal Other NB DC soma USD 123.298,32. O relatório mantém as linhas mensais que reconciliam com a P&L.", "El total auxiliar Paid supera en USD 0,01 la suma mensual. El resumen de apoyo suma USD 123.298,29 y las líneas mensuales Other NB DC suman USD 123.298,32. El informe mantiene las líneas mensuales que concilian con P&L.", "The auxiliary Paid total is USD 0.01 above its monthly sum. The support summary totals USD 123,298.29 while monthly Other NB DC totals USD 123,298.32. The report keeps the monthly lines that reconcile with P&L."),
             "source": {"sheet": "DC Expenses", "range": "G17,L4:L6"}, "payrollSummaryDifference": payroll_summary_delta},
        ]
        scope_countries = [
            {"code": "US", "name": "United States", "label": labels("Estados Unidos", "Estados Unidos", "United States")},
            {"code": "CA", "name": "Canada", "label": labels("Canadá", "Canadá", "Canada")},
        ]
        region_country = {"code": "NA", "name": "North America (consolidated)",
                          "label": labels("América do Norte (consolidado)", "Norteamérica (consolidado)", "North America (consolidated)")}
        result = {
            "schemaVersion": 1,
            "meta": {"title": "North America Financial Report", "region": "na", "year": year, "firstMonth": 1, "lastMonth": 9,
                     "currency": "USD", "currencySymbol": "$", "currencyStatus": "confirmed_by_user", "unit": "currency_units",
                     "currencyConfirmation": labels("Lucas confirmou que os valores financeiros são sempre em USD. Nenhuma conversão cambial foi aplicada.", "Lucas confirmó que los importes financieros están siempre en USD. No se aplicó conversión de divisas.", "Lucas confirmed that financial amounts are always in USD. No currency conversion was applied."),
                     "sourceFile": SOURCE.name, "sourceType": "workbook_snapshot", "pnlSheet": "Revenue",
                     "sourceModifiedAt": values.properties.modified.isoformat(), "extractedAt": datetime.now(timezone.utc).isoformat(),
                     "sourceSha256": sha256(SOURCE.read_bytes()).hexdigest(), "dateRange": {"from": "2026-01-01", "to": "2026-09-30"},
                     "dateRangeBasis": "Closing month labels; source transaction dates contain documented inconsistencies.",
                     "recordCount": len(records), "countryCount": 1, "scopeCountries": scope_countries, "countryBreakdown": "card-only",
                     "scopeNote": labels("O fechamento fornecido é consolidado para América do Norte. Estados Unidos e Canadá estão identificados apenas nas despesas de cartão; receita, folha e outros custos não têm divisão por país.", "El cierre proporcionado es consolidado para Norteamérica. Estados Unidos y Canadá solo están identificados en los gastos de tarjeta; los ingresos, la nómina y otros gastos no tienen desglose por país.", "The supplied close is consolidated for North America. The United States and Canada are identified only in card expenses; revenue, payroll and other costs are not split by country."),
                     "transactionCount": len(card_rows)-1, "includedTransactionCount": sum(c["transactions"] for c in card_records),
                     "procurementTransactionCount": len(procurement_rows)-1, "managementFeeRate": .078, "financialsLive": False,
                     "basis": labels("Valores salvos no fechamento SV-NA. O cabeçalho de folha identifica 2026. O período segue Month, preservando o pivô e a P&L fornecidos.", "Valores guardados en el cierre SV-NA. El encabezado de nómina identifica 2026. El período sigue Month, conservando la tabla dinámica y P&L originales.", "Cached values from the SV-NA close. The payroll heading identifies 2026. Reporting periods follow Month, preserving the supplied pivot and P&L.")},
            "countries": [region_country],
            "months": [{"month": m, "period": f"{year}-{m:02d}", "label": name} for m,name in enumerate(MONTHS,1)],
            "records": records, "totals": totals,
            "monthly": [{"month": row["month"], "period": row["period"], **aggregate([row])} for row in records],
            "countryTotals": [{"countryCode": "NA", "country": region_country["name"], **totals}],
            "costCategories": [
                {"id": "card", "label": labels("Cartão corporativo", "Tarjeta corporativa", "Corporate card")},
                {"id": "payroll", "label": labels("Folha operacional", "Nómina operativa", "Operating payroll")},
                {"id": "procurement", "label": labels("Compras e reservas", "Compras y reservas", "Procurement and bookings")},
                {"id": "otherIndirect", "label": labels("Outros serviços indiretos", "Otros servicios indirectos", "Other indirect services")},
                {"id": "nonBillablePayroll", "label": labels("Outros custos diretos não faturáveis", "Otros costos directos no facturables", "Other non-billable direct costs")},
            ],
            "cardCategoryRecords": card_records, "cardCategoryLabels": category_labels,
            "cardCategoryAliases": {key: sorted(items) for key,items in sorted(category_originals.items())},
            "cardCountryRecords": card_country_records,
            "procurementCategoryRecords": procurement_records, "procurementCategoryLabels": procurement_labels,
            "methodology": {
                "revenueFormula": "income + billables + managementFees", "profitFormula": "revenue - expenses",
                "marginFormula": "profit / revenue", "returnOnCostFormula": "profit / expenses", "managementFeesFormula": "billables * 7.8% (Revenue!E3:E11)",
                "overheadCostKeys": ["otherIndirect"], "allocatedOverheadFormula": "otherIndirect",
                "localExpensesFormula": "expenses - otherIndirect", "contributionProfitFormula": "revenue - localExpenses",
                "contributionMarginFormula": "contributionProfit / revenue",
                "costAllocation": "Only other indirect services are spread equally across the nine months, as IDC Expenses!H12 = H11/9. No country allocation is applied. Procurement and both direct payroll lines retain their source monthly amounts.",
                "costAllocationLabels": labels("Somente os outros serviços indiretos são distribuídos por nove meses na fonte (H11/9). Não há rateio entre países. Compras e as duas linhas de custos diretos mantêm os valores mensais do fechamento.", "Solo los otros servicios indirectos se distribuyen entre nueve meses en la fuente (H11/9). No hay reparto entre países. Compras y ambas líneas de costos directos mantienen los importes mensuales del cierre.", "Only other indirect services are spread over nine months in the source (H11/9). No country allocation is applied. Procurement and both direct-cost lines keep their monthly close amounts."),
                "cardBasis": "Numeric Statement Amount values, grouped by the source Month column. Negative credits remain negative. The country breakdown uses only Ramp Department SV USA and SV Canada; it is not a country P&L.",
                "cardCountryLabels": labels("Abertura exclusiva de cartão por país; não representa lucro, receita ou despesa total de cada país.", "Desglose exclusivo de tarjetas por país; no representa beneficios, ingresos ni gastos totales de cada país.", "Card-only country breakdown; it does not represent country profit, revenue or total expenses."),
                "blankComponents": [],
                "sourceRanges": {"pnl": ["Revenue!A3:H12"], "expenseControl": "IDC Expenses!L3:R13", "cardTransactions": "Card Raw!A1:G12605", "procurementTransactions": "Proc Raw!A1:E936", "payroll": "DC Expenses!F4:I17", "otherIndirect": "IDC Expenses!G3:I12", "presentationControl": "PPT Slides!Q3:W13"}},
            "reconciliation": {
                "checks": {"revenueAndProfitFormulasMatch": True, "costComponentsMatchPnl": True, "countryTotalsMatchSource": True,
                           "cardCategoriesMatchPivot": True, "cardCountryTotalsMatchPivot": True, "procurementCategoriesMatchPnl": True,
                           "presentationTotalsMatchSource": True, "transactionDatesMatchMonths": mismatch_count == 0,
                           "allTransactionYearsMatchReport": len(out_of_year) == 0, "cachedFormulaErrorCount": len(errors),
                           "maxCostComponentDifference": max(abs(x) for x in component_differences),
                           "maxCardPivotDifference": max(abs(x) for x in card_differences),
                           "maxProcurementDifference": max(abs(x) for x in procurement_differences),
                           "maxSourceTotalDifference": max(abs(x) for x in source_total_differences),
                           "maxPresentationDifference": max(abs(x) for x in ppt_differences)},
                "numericCardTotal": totals["costs"]["card"], "excludedTextCardAmount": excluded_text_amount,
                "allParsedCardAmounts": totals["costs"]["card"] + excluded_text_amount,
                "negativeCardTransactionCount": negative_count, "negativeCardAmount": negative_amount,
                "auxiliaryIncomeTotal": payroll["H17"].value, "pnlIncomeTotal": totals["income"], "auxiliaryIncomeDifference": auxiliary_income_delta,
                "biweeklyPayrollTotal": payroll["B33"].value, "monthlyPayrollTotal": totals["costs"]["payroll"], "biweeklyPayrollDifference": biweekly_payroll_delta,
                "nonBillableSummaryDifference": support_delta, "issues": issues},
        }
        OUTPUT.write_text(json.dumps(tidy(result), ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        print(json.dumps({"output": OUTPUT.name, "records": len(records), "countryScopes": ["NA"],
                          "cardCountryRecords": len(card_country_records), "cardCategoryRecords": len(card_records),
                          "procurementCategoryRecords": len(procurement_records), "totals": tidy(totals),
                          "checks": tidy(result["reconciliation"]["checks"]), "issues": [i["id"] for i in issues]}, ensure_ascii=True, indent=2))
    finally:
        values.close()
        formulas.close()


if __name__ == "__main__":
    main()
