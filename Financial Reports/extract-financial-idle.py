"""Export anonymous Idle Day Count from the canonical Mastersheet workbook.

Read-only source: RAW CTS DATA in the local Mastersheet copy. This deliberately
does not use getCtsTimesheet or the CTS Mirror, whose statuses differ from the
Mastersheet's TKM Monthly Drivers Report. No names, emails, vehicle identifiers
or individual source rows are written to the snapshot.

The source COUNTIFS counts status rows, not distinct driver-days. The same driver
can have both mapping and idle rows on one date; both rows retain their meaning.
Saturday/Sunday rows are excluded first, then explicit up/down Holiday statuses.
Only exact down-arrow Tech., Mech. and Weather statuses count as full idle.
Matching is case-insensitive, as in COUNTIFS. Partial up-arrow statuses stay in
mappingRecords. Neither mapping hours nor TKM changes the status classification.

A zero means records exist but no eligible full-idle status matches. It does not
infer that an absent date was worked, or that the historical status conventions
were unchanged. In the supplied copy, Jan-Aug has source records but no matching
full-idle statuses; the 29 Jan-Sep matches are all in September. Missing
country-months remain null/missing rather than being filled with zero.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timezone
from hashlib import sha256
import argparse
import calendar
import json
from pathlib import Path
import unicodedata

import openpyxl


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "LATAM MASTERSHEET - Google Street View.xlsx"
OUTPUT = HERE / "financial-idle-data.json"
SOURCE_NAME = "mastersheet-idle-day-count"
CODES = ["AR", "BR", "CL", "CO", "MX", "PE"]
ALIASES = {"argentina": "AR", "ar": "AR", "brazil": "BR", "brasil": "BR", "br": "BR",
           "chile": "CL", "cl": "CL", "colombia": "CO", "co": "CO",
           "mexico": "MX", "mx": "MX", "peru": "PE", "pe": "PE"}
METRICS = ["techDays", "mechDays", "weatherDays", "idleDays", "mappingRecords",
           "otherDownRecords", "unclassifiedRecords", "weekendRecords",
           "holidayRecords", "eligibleRecords", "observedRecords"]
IDLE_STATUSES = {"⬇tech.": "techDays", "⬇mech.": "mechDays", "⬇weather": "weatherDays"}
HOLIDAY_STATUSES = {"⬆holiday", "⬇holiday"}


def normalize_country(value):
    value = unicodedata.normalize("NFD", str(value or ""))
    return "".join(c for c in value if not unicodedata.combining(c)).strip().casefold()


def parse_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def utc_timestamp(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def add_record(group, day, status):
    """Classify one eligible-source row; never deduplicate or veto its status."""
    group["observedRecords"] += 1
    group["dates"].add(day.isoformat())
    if day.weekday() >= 5:
        group["weekendRecords"] += 1
        return
    status = str(status or "").casefold()
    if status in HOLIDAY_STATUSES:
        group["holidayRecords"] += 1
        return
    group["eligibleRecords"] += 1
    metric = IDLE_STATUSES.get(status)
    if metric:
        group[metric] += 1
        group["idleDays"] += 1
    elif status.startswith("⬆"):
        group["mappingRecords"] += 1
    elif status.startswith("⬇"):
        group["otherDownRecords"] += 1
    else:
        group["unclassifiedRecords"] += 1


def extract(source, year, end_month):
    workbook = openpyxl.load_workbook(source, read_only=True, data_only=True)
    groups, excluded = {}, Counter()
    latest_date = None
    period_checked = 0
    try:
        rows = workbook["RAW CTS DATA"].iter_rows(values_only=True)
        headers = list(next(rows))
        required = ["Month", "country", "drive_date", "email", "status"]
        if any(headers.count(name) != 1 for name in required):
            raise ValueError("RAW CTS DATA must contain one of each required header")
        ix = {name: headers.index(name) for name in required}
        for row in rows:
            if not any(value is not None for value in row):
                continue
            day = parse_date(row[ix["drive_date"]])
            if day is None:
                excluded["invalidDate"] += 1
                continue
            latest_date = max(latest_date, day) if latest_date else day
            # COUNTIFS selects Month in A. Check that grouping by date in G is
            # equivalent instead of silently changing the worksheet's period.
            if str(row[ix["Month"]]) != f"{day.month}.{day.year}":
                raise ValueError("RAW CTS DATA Month does not match drive_date")
            period_checked += 1
            if day.year != year or not 1 <= day.month <= end_month:
                continue
            # This criterion was reconciled to TKM B21:C127 in the supplied
            # workbook: no valid-email idle row was orphaned or double matched.
            if "@" not in str(row[ix["email"]] or ""):
                excluded["withoutDriverInSelectedPeriod"] += 1
                continue
            code = ALIASES.get(normalize_country(row[ix["country"]]))
            if code is None:
                excluded["unknownCountryInSelectedPeriod"] += 1
                continue
            group = groups.setdefault((day.month, code), {**{key: 0 for key in METRICS}, "dates": set()})
            add_record(group, day, row[ix["status"]])
    finally:
        workbook.close()
    if latest_date is None:
        raise ValueError("No dated records in RAW CTS DATA")
    extracted_at = utc_timestamp(datetime.now(timezone.utc))
    source_modified_at = utc_timestamp(datetime.fromtimestamp(source.stat().st_mtime, timezone.utc))
    through = latest_date.isoformat()
    months = []
    for month in range(1, end_month + 1):
        month_end = date(year, month, calendar.monthrange(year, month)[1]).isoformat()
        countries = []
        for code in CODES:
            group = groups.get((month, code))
            dates = sorted(group["dates"]) if group else []
            item = {"countryCode": code, **{key: group[key] if group else None for key in METRICS},
                    "observedRecords": group["observedRecords"] if group else 0,
                    "observedDates": len(dates), "dates": dates,
                    "firstDate": dates[0] if dates else None, "lastDate": dates[-1] if dates else None,
                    "coverage": "missing" if group is None else "partial" if through < month_end else "recorded"}
            if group:
                assert item["idleDays"] == item["techDays"] + item["mechDays"] + item["weatherDays"]
                assert item["eligibleRecords"] == item["observedRecords"] - item["weekendRecords"] - item["holidayRecords"]
                assert item["eligibleRecords"] == sum(item[key] for key in ["mappingRecords", "idleDays", "otherDownRecords", "unclassifiedRecords"])
            countries.append(item)
        months.append({"year": year, "month": month, "status": "snapshot", "source": SOURCE_NAME,
                       "asOf": source_modified_at, "snapshotExtractedAt": extracted_at,
                       "dataThrough": through, "lastDataDate": through, "countries": countries})
    return {"schemaVersion": 2, "definitionVersion": 2, "unit": "status-records",
            "status": "snapshot", "source": SOURCE_NAME, "sourceFile": source.name,
            "sourceSheet": "RAW CTS DATA", "sourceSha256": sha256(source.read_bytes()).hexdigest(),
            "sourceModifiedAt": source_modified_at, "asOf": source_modified_at,
            "extractedAt": extracted_at, "snapshotExtractedAt": extracted_at,
            "dataThrough": through, "lastDataDate": through, "year": year,
            "firstMonth": 1, "lastMonth": end_month, "excludedRows": dict(excluded),
            "periodConsistencyCheckedRows": period_checked,
            "definition": "Count canonical Mastersheet status rows with a driver email containing @. Exclude Saturday/Sunday first, then explicit up/down Holiday statuses. Full idle is exact case-insensitive down-arrow Tech., Mech. or Weather. Do not deduplicate rows or veto idle because another row has mapping. Missing country-months remain unavailable.",
            "historicalStatusNote": "Zero means no matching full-idle status among observed eligible records, not proof that no operational interruption occurred. Historical up-arrow statuses remain mapping records, including partial Tech/Mech/Weather.",
            "formulaSource": {"sheet": "TKM Monthly Drivers Report", "range": "AB21:AD127",
                              "summaryRange": "AB11:AD16", "rawColumns": "A,D,G,K,M",
                              "additionalCalendarRule": "Exclude Saturday and Sunday as requested; Holiday statuses are outside the source idle criteria."},
            "months": months}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=SOURCE, help="Canonical Mastersheet .xlsx copy.")
    parser.add_argument("--year", type=int, default=2026)
    parser.add_argument("--end-month", type=int, default=9)
    args = parser.parse_args()
    if not 2000 <= args.year <= 2100 or not 1 <= args.end_month <= 12:
        parser.error("year must be 2000-2100 and end-month must be 1-12")
    result = extract(args.input, args.year, args.end_month)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    records = [c for m in result["months"] for c in m["countries"] if c["coverage"] != "missing"]
    print(json.dumps({"output": OUTPUT.name, "source": SOURCE_NAME, "year": args.year,
                      "endMonth": args.end_month, "dataThrough": result["dataThrough"],
                      "totals": {key: sum(c[key] for c in records) for key in METRICS},
                      "missingCountryMonths": [[m["month"], c["countryCode"]] for m in result["months"] for c in m["countries"] if c["coverage"] == "missing"],
                      "excludedRows": result["excludedRows"]}, ensure_ascii=True))


if __name__ == "__main__":
    main()
