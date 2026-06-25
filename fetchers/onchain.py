#!/usr/bin/env python3
# ============================================================================
#  CSLC — onchain.py   (Sprint 1, fetcher 3)
#  Crypto Sander Liquidity Center — external pipeline
# ----------------------------------------------------------------------------
#  ONE QUESTION: is the market expensive or cheap vs its aggregate on-chain
#  cost basis — the valuation / fragility dimension?  -> MVRV + MVRV-Z.
#
#  Source (KEYLESS): CoinMetrics Community API (community-api.coinmetrics.io).
#    Metrics: CapMrktCurUSD (market cap) + CapMVRVCur (raw MVRV ratio).
#    Realized cap is derived: RV = MV / MVRV.
#
#  MVRV-Z is the CLASSIC valuation oscillator (NOT the system's 90d dual z):
#    mvrv_z = (MV - RV) / std_expanding(MV)
#  with EXPANDING-window std of market cap (all history to date), as per the
#  established methodology. Because MVRV-Z is already a normalized z-score,
#  the motor consumes it AS-IS (it is not re-normalized downstream).
#
#  Backfill is full from day one (CoinMetrics serves years of daily history),
#  so MVRV-Z is mature immediately.
#
#  Usage:
#    python onchain.py --test     # connectivity check, prints, no write
#    python onchain.py            # refresh full MVRV / MVRV-Z series
#
#  Anti-fabrication: documented public endpoint; values parsed defensively;
#    a missing metric degrades to NA rather than crashing.
# ============================================================================

import sys
import csv
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib import request as urlrequest
from urllib import parse as urlparse

OUT = Path(__file__).resolve().parent.parent / "data" / "onchain.csv"
TIMEOUT = 40
UA = "cslc-pipeline/1.0"
KEEP_DAYS = 420                # rows written per asset (z computed on full hist)
MIN_STD_N = 200               # need this many MV points before MVRV-Z is valid
ASSETS = ["btc", "eth"]
HOST = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
METRICS = "CapMrktCurUSD,CapMVRVCur"

# ---------------------------------------------------------------------------
# HTTP (stdlib only)
# ---------------------------------------------------------------------------
def _get(url):
    req = urlrequest.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urlrequest.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())

def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

def fetch_asset(asset):
    """Return list of (date_str, MV, mvrv) sorted ascending by date."""
    params = {"assets": asset, "metrics": METRICS, "frequency": "1d", "page_size": 10000}
    url = HOST + "?" + urlparse.urlencode(params)
    rows = []
    while url:
        d = _get(url)
        for row in d.get("data", []):
            day = row["time"][:10]
            mv = _f(row.get("CapMrktCurUSD"))
            mvrv = _f(row.get("CapMVRVCur"))
            rows.append((day, mv, mvrv))
        url = d.get("next_page_url")   # usually None for 1d full history
    rows.sort(key=lambda r: r[0])
    return rows

# ---------------------------------------------------------------------------
# MVRV-Z (classic: expanding-window std of market cap)
# ---------------------------------------------------------------------------
def compute_mvrv_z(rows):
    """Yield dict rows with mvrv, mvrv_z, market_cap, realized_cap."""
    n = 0
    s = 0.0       # running sum of MV
    ss = 0.0      # running sum of MV^2
    out = []
    for day, mv, mvrv in rows:
        if mv is not None:
            n += 1
            s += mv
            ss += mv * mv
        rv = (mv / mvrv) if (mv is not None and mvrv) else None
        mvrv_z = None
        if mv is not None and rv is not None and n >= MIN_STD_N:
            mean = s / n
            var = (ss - n * mean * mean) / (n - 1)
            std = math.sqrt(var) if var > 0 else None
            if std:
                mvrv_z = (mv - rv) / std
        out.append({
            "date": day,
            "mvrv": mvrv,
            "mvrv_z": mvrv_z,
            "market_cap_usd": mv,
            "realized_cap_usd": rv,
        })
    return out

# ---------------------------------------------------------------------------
# CSV (idempotent — full refresh each run, single source of truth)
# ---------------------------------------------------------------------------
COLS = ["date", "asset", "mvrv", "mvrv_z", "market_cap_usd", "realized_cap_usd"]

def write_csv(all_rows):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    all_rows = sorted(all_rows, key=lambda r: (r["date"], r["asset"]))
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        for r in all_rows:
            w.writerow({k: r.get(k, "") for k in COLS})

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def run_test():
    print("CSLC onchain — connectivity test (no CSV written)\n")
    for asset in ASSETS:
        rows = fetch_asset(asset)
        comp = compute_mvrv_z(rows)
        last = comp[-1]
        valid = [c for c in comp if c["mvrv_z"] is not None]
        print(f"[{asset.upper()}] history: {len(rows)} days  "
              f"({rows[0][0]} -> {rows[-1][0]})")
        print(f"  latest: MVRV={last['mvrv']}  MVRV-Z={last['mvrv_z']}")
        print(f"  market_cap=${(last['market_cap_usd'] or 0)/1e9:,.1f}B  "
              f"realized_cap=${(last['realized_cap_usd'] or 0)/1e9:,.1f}B")
        print(f"  MVRV-Z valid on {len(valid)}/{len(comp)} days\n")
        time.sleep(1)  # respect 10 req / 6s community limit

def run():
    all_rows = []
    for asset in ASSETS:
        rows = fetch_asset(asset)
        comp = compute_mvrv_z(rows)
        for c in comp[-KEEP_DAYS:]:
            c["asset"] = asset
            all_rows.append(c)
        last = comp[-1]
        print(f"  {asset.upper()} {last['date']}: MVRV={last['mvrv']}  "
              f"MVRV-Z={last['mvrv_z']}")
        time.sleep(1)
    write_csv(all_rows)
    print(f"Wrote {len(all_rows)} rows -> {OUT}")

if __name__ == "__main__":
    if "--test" in sys.argv:
        run_test()
    else:
        run()
