"""Export anonymous monthly downtime from dated CTS records.

Read-only workbook extraction, or --online for the existing CTS endpoint.
No driver names, emails or vehicle identifiers
are written to the output. A missing country/month remains missing, not zero.
Definition matches financial-idle.js and the existing getCtsTimesheet endpoint.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from hashlib import sha256
import argparse
import calendar
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlencode
from urllib.request import Request, urlopen


HERE = Path(__file__).resolve().parent
SOURCE = HERE / "LATAM MASTERSHEET - Google Street View.xlsx"
OUTPUT = HERE / "financial-idle-data.json"
CODES = ["AR", "BR", "CL", "CO", "MX", "PE"]
ALIASES = {"argentina": "AR", "ar": "AR", "brazil": "BR", "brasil": "BR", "br": "BR",
           "chile": "CL", "cl": "CL", "colombia": "CO", "co": "CO",
           "mexico": "MX", "mx": "MX", "peru": "PE", "pe": "PE"}
METRICS = ["techDays", "mechDays", "weatherDays", "idleDays", "otherDownDays",
           "unclassifiedDays", "mappingDays", "multiCauseDays"]


def normalize(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    return "".join(c for c in text if not unicodedata.combining(c)).strip().lower()


def numeric(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def mapped(status, hours, tkm):
    if "⬆" in status:
        return True
    if "⬇" in status:
        return False
    return "mapping" in status.lower() or numeric(hours) > 0 or numeric(tkm) > 0


def causes(statuses):
    selected = set()
    explicit_other = False
    for raw in statuses:
        if "⬆" in raw:
            continue
        text = re.sub(r"^[^a-z]+", "", normalize(raw)).rstrip(". ")
        if text in ("tech", "mech", "weather"):
            selected.add(text)
        elif "⬇" in raw or text in ("personal", "disks", "disk", "travelling", "traveling", "holiday", "idle with driver"):
            explicit_other = True
    return selected, explicit_other


def add_day(aggregated, code, day, record):
    year, month = int(day[:4]), int(day[5:7])
    group = aggregated.setdefault((year, month, code), {**{key: 0 for key in METRICS}, "observedDriverDays": 0, "dates": set()})
    group["observedDriverDays"] += 1
    group["dates"].add(day)
    if record["mapped"]:
        group["mappingDays"] += 1
        return
    selected, other = causes(record["statuses"])
    for cause in selected:
        group[cause + "Days"] += 1
    if selected:
        group["idleDays"] += 1
        group["multiCauseDays"] += len(selected) > 1
    elif other:
        group["otherDownDays"] += 1
    else:
        group["unclassifiedDays"] += 1


def from_workbook():
    import openpyxl

    workbook = openpyxl.load_workbook(SOURCE, read_only=True, data_only=True)
    sheet = workbook["RAW CTS DATA"]
    rows = sheet.iter_rows(values_only=True)
    headers = list(next(rows))
    ix = {name: headers.index(name) for name in ["country", "drive_date", "email", "status", "mapping_hours", "TKM"]}
    days = {}
    country_by_driver_quarter = {}
    discarded = defaultdict(int)
    dates = []
    for row in rows:
        email = str(row[ix["email"]] or "").strip().lower()
        if "@" not in email:
            discarded["withoutDriver"] += 1
            continue
        raw_date = row[ix["drive_date"]]
        if isinstance(raw_date, datetime):
            day = raw_date.date().isoformat()
        else:
            match = re.match(r"^(\d{4}-\d{2}-\d{2})", str(raw_date or ""))
            if not match:
                discarded["invalidDate"] += 1
                continue
            day = match.group(1)
            datetime.strptime(day, "%Y-%m-%d")
        code = ALIASES.get(normalize(row[ix["country"]]))
        if not code:
            discarded["unknownCountry"] += 1
            continue
        year, month = int(day[:4]), int(day[5:7])
        quarter_driver = (year, (month - 1) // 3, email)
        country_by_driver_quarter.setdefault(quarter_driver, code)
        key = (quarter_driver, day)
        record = days.setdefault(key, {"mapped": False, "statuses": []})
        status = str(row[ix["status"]] or "").strip()
        record["mapped"] = record["mapped"] or mapped(status, row[ix["mapping_hours"]], row[ix["TKM"]])
        if status and status not in record["statuses"]:
            record["statuses"].append(status)
        dates.append(day)
    workbook.close()
    if not dates:
        raise ValueError("No dated driver records in RAW CTS DATA")
    through = max(dates)
    aggregated = {}
    for (quarter_driver, day), record in days.items():
        code = country_by_driver_quarter[quarter_driver]
        add_day(aggregated, code, day, record)
    periods = sorted({(year, month) for year, month, _ in aggregated})
    metadata = {"source": "mastersheet-snapshot", "sourceFile": SOURCE.name, "sourceSheet": "RAW CTS DATA",
                "sourceSha256": sha256(SOURCE.read_bytes()).hexdigest(), "excludedRows": dict(discarded)}
    cutoffs = {period: through for period in periods}
    return aggregated, periods, cutoffs, metadata


def from_online(year, end_month):
    # Reuse the frontend's existing endpoint; this script does not maintain a
    # second backend configuration. GET responses never touch the filesystem.
    frontend = (HERE.parent / "financial-operations.js").read_text(encoding="utf-8")
    match = re.search(r"const scriptUrl = '([^']+)'", frontend)
    if not match:
        raise ValueError("Existing FinancialOperations endpoint was not found")
    endpoint = match.group(1)
    aggregated, cutoffs, requests = {}, {}, []
    excluded = 0
    for first in range(1, end_month + 1, 3):
        last = min(first + 2, end_month)
        start = f"{year:04d}-{first:02d}-01"
        end = f"{year:04d}-{last:02d}-{calendar.monthrange(year, last)[1]:02d}"
        url = endpoint + "?" + urlencode({"action": "getCtsTimesheet", "startDate": start, "endDate": end})
        with urlopen(Request(url, headers={"Accept": "application/json"}), timeout=60) as response:
            payload = json.load(response)
        if payload.get("success") is not True or payload.get("period") != {"start": start, "end": end} or not isinstance(payload.get("drivers"), list):
            raise ValueError("Online response period or schema mismatch")
        through = payload.get("lastDataDate")
        if not isinstance(through, str) or datetime.strptime(through, "%Y-%m-%d").strftime("%Y-%m-%d") != through:
            raise ValueError("Online response has no valid lastDataDate")
        seen = set()
        for driver in payload["drivers"]:
            code = ALIASES.get(normalize(driver.get("country")))
            if not code:
                excluded += 1
                continue
            email = str(driver.get("email") or "").strip().lower()
            if "@" not in email or not isinstance(driver.get("days"), dict):
                raise ValueError("Online response contains invalid driver days")
            for day, value in driver["days"].items():
                if not isinstance(day, str) or not start <= day <= end or datetime.strptime(day, "%Y-%m-%d").strftime("%Y-%m-%d") != day or not isinstance(value.get("mapped"), bool):
                    raise ValueError("Online response contains an invalid dated record")
                identity = (email, day)
                if identity in seen:
                    raise ValueError("Online response contains a duplicate driver day")
                seen.add(identity)
                add_day(aggregated, code, day, {"mapped": value["mapped"],
                        "statuses": re.split(r"\s+/\s+", str(value.get("status") or ""))})
        for month in range(first, last + 1):
            cutoffs[(year, month)] = through
        requests.append({"startDate": start, "endDate": end, "lastDataDate": through,
                         "retrievedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                         "version": payload.get("version")})
        print(json.dumps({"window": {"start": start, "end": end}, "lastDataDate": through,
                          "status": "aggregated"}), flush=True)
    metadata = {"source": "online-snapshot", "sourceEndpoint": endpoint, "sourceAction": "getCtsTimesheet",
                "requests": requests, "excludedRows": {"unknownCountryRecords": excluded}}
    return aggregated, [(year, month) for month in range(1, end_month + 1)], cutoffs, metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--online", action="store_true", help="Read current dated CTS records using quarterly GET requests.")
    parser.add_argument("--year", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--end-month", type=int, default=9)
    args = parser.parse_args()
    if not 2000 <= args.year <= 2100 or not 1 <= args.end_month <= 12:
        parser.error("year must be 2000–2100 and end-month must be 1–12")
    aggregated, periods, cutoffs, metadata = from_online(args.year, args.end_month) if args.online else from_workbook()
    months = []
    extracted_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for year, month in periods:
        through = cutoffs[(year, month)]
        end = f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"
        countries = []
        for code in CODES:
            raw = aggregated.get((year, month, code))
            recorded_dates = sorted(raw["dates"]) if raw else []
            item = {"countryCode": code, **{key: raw[key] if raw else None for key in METRICS},
                    "observedDriverDays": raw["observedDriverDays"] if raw else 0,
                    "observedDates": len(recorded_dates), "dates": recorded_dates,
                    "firstDate": recorded_dates[0] if recorded_dates else None,
                    "lastDate": recorded_dates[-1] if recorded_dates else None,
                    "coverage": "missing" if not raw else "partial" if through < end else "recorded"}
            if raw:
                assert raw["mappingDays"] + raw["idleDays"] + raw["otherDownDays"] + raw["unclassifiedDays"] == raw["observedDriverDays"]
                assert max(raw["techDays"], raw["mechDays"], raw["weatherDays"]) <= raw["idleDays"]
            countries.append(item)
        months.append({"year": year, "month": month, "status": "snapshot", "source": metadata["source"],
                       "asOf": extracted_at, "snapshotExtractedAt": extracted_at,
                       "dataThrough": through, "lastDataDate": through, "countries": countries})
    through = min(cutoffs.values())
    result = {"schemaVersion": 1, "definitionVersion": 1, "unit": "driver-days",
              **metadata, "extractedAt": extracted_at, "snapshotExtractedAt": extracted_at,
              "dataThrough": through, "lastDataDate": through,
              "definition": "Distinct driver/date without mapping and explicit Tech/Mech/Weather status. Idle is their union; other explicit down statuses and unclassified records are separate. Missing dates are not inferred.",
              "months": months}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    ytd = [c for m in months if m["year"] == 2026 and m["month"] <= 9 for c in m["countries"] if c["coverage"] != "missing"]
    print(json.dumps({"output": OUTPUT.name, "source": metadata["source"], "months": len(months), "dataThrough": through,
                      "ytd2026JanSep": {key: sum(c[key] for c in ytd) for key in METRICS},
                      "missingCountryMonths": [(m["month"], c["countryCode"]) for m in months for c in m["countries"] if c["coverage"] == "missing"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
