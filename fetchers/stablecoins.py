#!/usr/bin/env python3
# ============================================================================
#  CSLC — stablecoins.py   (Sprint 1, fetcher 2)
#  Crypto Sander Liquidity Center — external pipeline
# ----------------------------------------------------------------------------
#  ONE QUESTION: how fast is shadow money (stablecoin supply) being minted or
#  burned — the PRIMARY liquidity driver (MMT/Pozsar) — and WHO is issuing it?
#  -> SIVI (Stablecoin Issuance Velocity Index) + per-issuer breakdown.
#
#  Source (KEYLESS): DefiLlama stablecoins API (stablecoins.llama.fi).
#    - stablecoincharts/all -> full daily history of TOTAL circulating USD
#      (backfilled: aggregate SIVI is warm from day one).
#    - stablecoins          -> current circulating per issuer (the WHO).
#
#  SIVI (single-source, no endogeneity): 30-day net issuance normalized by the
#    LAGGED 90-day average supply.  sivi = (S_t - S_{t-30}) / MA90(S) * 100.
#    Lagged denominator breaks the numerator/denominator simultaneity that a
#    spot-mcap normalization would suffer.  (TOTAL2ES-base normalization is a
#    documented v1.1 refinement requiring a market-cap source e.g. CoinGecko.)
#
#  Per-issuer circulating is snapshotted daily (warms a "who-leads-issuance"
#    read over ~30d, computed downstream by the motor).
#
#  Usage:
#    python stablecoins.py --test     # connectivity check, prints, no write
#    python stablecoins.py            # refresh aggregate+SIVI + today's snapshot
#
#  Anti-fabrication: documented public endpoints; defensive field parsing;
#    if a piece fails it degrades to NA rather than crashing.
# ============================================================================

import sys
import csv
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path
from urllib import request as urlrequest

OUT = Path(__file__).resolve().parent.parent / "data" / "stablecoins.csv"
TIMEOUT = 30
UA = "cslc-pipeline/1.0"
KEEP_DAYS = 420                 # cap CSV length (z_slow=90d needs <<this)
ROC_DAYS = 30                  # net-issuance window
MA_DAYS = 90                   # lagged normalization base
ISSUERS = ["USDT", "USDC", "USDe", "USDS", "DAI"]   # tracked; rest -> others

HOST = "https://stablecoins.llama.fi"

# ---------------------------------------------------------------------------
# HTTP (stdlib only)
# ---------------------------------------------------------------------------
def _get(url):
    req = urlrequest.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urlrequest.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())

def _daystr(unix):
    return datetime.fromtimestamp(int(float(unix)), tz=timezone.utc).strftime("%Y-%m-%d")

def _peg(d):
    """Extract peggedUSD from a {peggedUSD: x} or nested wrapper, NA-safe."""
    if d is None:
        return None
    if isinstance(d, dict):
        return d.get("peggedUSD")
    try:
        return float(d)
    except (TypeError, ValueError):
        return None

# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------
def fetch_total_history():
    """date_str -> total circulating USD (full daily history)."""
    data = _get(f"{HOST}/stablecoincharts/all")
    out = {}
    for row in data:
        v = _peg(row.get("totalCirculatingUSD")) or _peg(row.get("totalCirculating"))
        if v:
            out[_daystr(row["date"])] = float(v)
    return out

def fetch_issuer_snapshot():
    """symbol -> current circulating USD, for tracked issuers + 'others'."""
    data = _get(f"{HOST}/stablecoins?includePrices=false")
    assets = data.get("peggedAssets", data if isinstance(data, list) else [])
    snap = {k: 0.0 for k in ISSUERS}
    others = 0.0
    for a in assets:
        sym = (a.get("symbol") or "").upper()
        circ = _peg(a.get("circulating"))
        if not circ:
            continue
        matched = next((k for k in ISSUERS if k.upper() == sym), None)
        if matched:
            snap[matched] += float(circ)
        else:
            others += float(circ)
    snap["others"] = others
    return snap

# ---------------------------------------------------------------------------
# SIVI
# ---------------------------------------------------------------------------
def compute_sivi(dates_sorted, total_by_date):
    """Return {date: (chg30_pct, sivi)} using lagged MA90 normalization."""
    out = {}
    vals = [total_by_date[d] for d in dates_sorted]
    for i, d in enumerate(dates_sorted):
        if i < ROC_DAYS or i < MA_DAYS - 1:
            out[d] = (None, None)
            continue
        s_t = vals[i]
        s_prev = vals[i - ROC_DAYS]
        ma = statistics.mean(vals[i - MA_DAYS + 1:i + 1])
        chg_pct = (s_t - s_prev) / s_prev * 100.0 if s_prev else None
        sivi = (s_t - s_prev) / ma * 100.0 if ma else None
        out[d] = (chg_pct, sivi)
    return out

# ---------------------------------------------------------------------------
# CSV (idempotent)
# ---------------------------------------------------------------------------
COLS = ["date", "total_usd", "total_chg_30d_pct", "sivi",
        "usdt_usd", "usdc_usd", "usde_usd", "usds_usd", "dai_usd", "others_usd"]

def read_csv():
    if not OUT.exists():
        return {}
    with open(OUT, newline="") as f:
        return {r["date"]: r for r in csv.DictReader(f)}

def write_csv(rows):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = sorted(rows, key=lambda r: r["date"])[-KEEP_DAYS:]
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in COLS})

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def run_test():
    print("CSLC stablecoins — connectivity test (no CSV written)\n")
    hist = fetch_total_history()
    dates = sorted(hist)
    print(f"  total history: {len(dates)} days  ({dates[0]} -> {dates[-1]})")
    print(f"  latest total supply: ${hist[dates[-1]]/1e9:,.1f}B")
    sivi = compute_sivi(dates, hist)
    c, s = sivi[dates[-1]]
    print(f"  latest 30d change: {c:+.2f}%   SIVI: {s:+.3f}")
    print("\n  issuer snapshot:")
    snap = fetch_issuer_snapshot()
    for k in ISSUERS + ["others"]:
        print(f"    {k:7s}: ${snap.get(k,0)/1e9:,.1f}B")

def run():
    hist = fetch_total_history()
    dates = sorted(hist)
    sivi = compute_sivi(dates, hist)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if today not in hist and dates:
        # DefiLlama chart may lag a day; carry last to today for the snapshot row
        hist[today] = hist[dates[-1]]
        dates = sorted(hist)
        sivi = compute_sivi(dates, hist)

    snap = fetch_issuer_snapshot()
    existing = read_csv()   # preserve prior per-issuer snapshots

    rows = []
    for d in dates:
        c, s = sivi.get(d, (None, None))
        prev = existing.get(d, {})
        row = {
            "date": d,
            "total_usd": hist[d],
            "total_chg_30d_pct": c,
            "sivi": s,
            "usdt_usd": prev.get("usdt_usd", ""),
            "usdc_usd": prev.get("usdc_usd", ""),
            "usde_usd": prev.get("usde_usd", ""),
            "usds_usd": prev.get("usds_usd", ""),
            "dai_usd": prev.get("dai_usd", ""),
            "others_usd": prev.get("others_usd", ""),
        }
        if d == today:   # today's live per-issuer snapshot
            row["usdt_usd"] = snap.get("USDT")
            row["usdc_usd"] = snap.get("USDC")
            row["usde_usd"] = snap.get("USDe")
            row["usds_usd"] = snap.get("USDS")
            row["dai_usd"] = snap.get("DAI")
            row["others_usd"] = snap.get("others")
        rows.append(row)

    write_csv(rows)
    c, s = sivi.get(today, (None, None))
    print(f"Wrote {min(len(rows), KEEP_DAYS)} rows -> {OUT}")
    print(f"  today {today}: total=${hist[today]/1e9:,.1f}B  "
          f"chg30={c}  SIVI={s}")

if __name__ == "__main__":
    if "--test" in sys.argv:
        run_test()
    else:
        run()
