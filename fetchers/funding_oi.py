#!/usr/bin/env python3
# ============================================================================
#  CSLC — funding_oi.py   (Sprint 1, fetcher 1)
#  Crypto Sander Liquidity Center — external pipeline
# ----------------------------------------------------------------------------
#  ONE QUESTION: how dislocated is the cross-exchange leverage plumbing, and
#  how fast is leverage building?  -> CEFDI + OFPR for BTC and ETH.
#
#  Venues (KEYLESS public market data; Binance EXCLUDED — CloudFront ASN wall):
#    Bybit · OKX · Deribit · Hyperliquid
#
#  Outputs (data/funding_oi.csv), one row per (date, asset):
#    date, asset, fund_bybit, fund_okx, fund_deribit, fund_hl, fund_mean,
#    cefdi, n_venues, oi_total_usd, oi_chg_pct, ofpr
#  Funding is ANNUALIZED % (comparable across venues with different intervals:
#    8h venues -> x3x365 ; Hyperliquid hourly -> x24x365).
#    CEFDI = stdev of per-venue annualized funding (the dispersion signal).
#    OFPR  = (ΔOI / OI_MA20) x fund_mean   (OI velocity x carry; warms ~3 wks).
#
#  Usage:
#    python funding_oi.py --test     # connectivity check, prints, no write
#    python funding_oi.py            # backfill if needed + append today's row
#
#  Anti-fabrication: every endpoint below is a documented public route. If a
#  venue fails, it degrades to NA (CEFDI uses the venues that responded).
# ============================================================================

import sys
import csv
import json
import math
import time
import statistics
from datetime import datetime, timezone
from pathlib import Path
from urllib import request as urlrequest
from urllib import parse as urlparse

OUT = Path(__file__).resolve().parent.parent / "data" / "funding_oi.csv"
ASSETS = ["BTC", "ETH"]
TIMEOUT = 20
UA = "cslc-pipeline/1.0"
MIN_VENUES = 3   # backfill coverage floor: drop dates measured on fewer venues

# annualization: funding rate -> annualized % = rate * periods_per_year * 100
PPY_8H = 3 * 365      # 8h venues
PPY_1H = 24 * 365     # hourly (Hyperliquid)

# symbol maps per venue
SYM = {
    "bybit":   {"BTC": "BTCUSDT",        "ETH": "ETHUSDT"},
    "okx":     {"BTC": "BTC-USDT-SWAP",  "ETH": "ETH-USDT-SWAP"},
    "deribit": {"BTC": "BTC-PERPETUAL",  "ETH": "ETH-PERPETUAL"},
    "hl":      {"BTC": "BTC",            "ETH": "ETH"},
}

# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only; no external deps required to RUN the fetch)
# ---------------------------------------------------------------------------
def _get(url, params=None):
    if params:
        url = url + "?" + urlparse.urlencode(params)
    req = urlrequest.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urlrequest.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())

def _post(url, body):
    data = json.dumps(body).encode()
    req = urlrequest.Request(url, data=data,
                             headers={"User-Agent": UA, "Content-Type": "application/json"})
    with urlrequest.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode())

def _ann(rate, ppy):
    return float(rate) * ppy * 100.0

# ---------------------------------------------------------------------------
# Per-venue CURRENT snapshots -> {"funding_ann": float, "oi_usd": float|None}
# ---------------------------------------------------------------------------
def snap_bybit(asset):
    d = _get("https://api.bybit.com/v5/market/tickers",
             {"category": "linear", "symbol": SYM["bybit"][asset]})
    t = d["result"]["list"][0]
    fund = _ann(t["fundingRate"], PPY_8H)
    oi_usd = float(t.get("openInterestValue") or 0) or None   # Bybit gives USD value
    return {"funding_ann": fund, "oi_usd": oi_usd}

def snap_okx(asset):
    inst = SYM["okx"][asset]
    fr = _get("https://www.okx.com/api/v5/public/funding-rate", {"instId": inst})
    fund = _ann(fr["data"][0]["fundingRate"], PPY_8H)
    oi = _get("https://www.okx.com/api/v5/public/open-interest",
              {"instType": "SWAP", "instId": inst})
    tk = _get("https://www.okx.com/api/v5/market/ticker", {"instId": inst})
    px = float(tk["data"][0]["last"])
    oi_ccy = float(oi["data"][0].get("oiCcy") or 0)           # OI in base coin
    oi_usd = oi_ccy * px if oi_ccy else None
    return {"funding_ann": fund, "oi_usd": oi_usd}

def snap_deribit(asset):
    inst = SYM["deribit"][asset]
    d = _get("https://www.deribit.com/api/v2/public/ticker", {"instrument_name": inst})
    r = d["result"]
    fund = _ann(r["funding_8h"], PPY_8H)
    oi_usd = float(r.get("open_interest") or 0) or None        # Deribit perp OI in USD
    return {"funding_ann": fund, "oi_usd": oi_usd}

def snap_hl(asset):
    d = _post("https://api.hyperliquid.xyz/info", {"type": "metaAndAssetCtxs"})
    universe = d[0]["universe"]
    ctxs = d[1]
    coin = SYM["hl"][asset]
    idx = next(i for i, u in enumerate(universe) if u["name"] == coin)
    c = ctxs[idx]
    fund = _ann(c["funding"], PPY_1H)                          # HL funding is HOURLY
    oi_coin = float(c.get("openInterest") or 0)
    mark = float(c.get("markPx") or 0)
    oi_usd = oi_coin * mark if (oi_coin and mark) else None
    return {"funding_ann": fund, "oi_usd": oi_usd}

SNAPPERS = {"bybit": snap_bybit, "okx": snap_okx, "deribit": snap_deribit, "hl": snap_hl}

# ---------------------------------------------------------------------------
# Funding HISTORY (backfill) -> {date_str: funding_ann}
# ---------------------------------------------------------------------------
def _daystr(ms):
    return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")

def hist_bybit(asset):
    d = _get("https://api.bybit.com/v5/market/funding/history",
             {"category": "linear", "symbol": SYM["bybit"][asset], "limit": 200})
    out = {}
    for row in d["result"]["list"]:
        out[_daystr(row["fundingRateTimestamp"])] = _ann(row["fundingRate"], PPY_8H)
    return out

def hist_okx(asset):
    d = _get("https://www.okx.com/api/v5/public/funding-rate-history",
             {"instId": SYM["okx"][asset], "limit": 100})
    out = {}
    for row in d["data"]:
        out[_daystr(row["fundingTime"])] = _ann(row["fundingRate"], PPY_8H)
    return out

def hist_deribit(asset):
    now = int(time.time() * 1000)
    start = now - 120 * 24 * 3600 * 1000   # ~120 days
    d = _get("https://www.deribit.com/api/v2/public/get_funding_rate_history",
             {"instrument_name": SYM["deribit"][asset], "start_timestamp": start,
              "end_timestamp": now})
    out = {}
    for row in d["result"]:
        out[_daystr(row["timestamp"])] = _ann(row["interest_8h"], PPY_8H)
    return out

def hist_hl(asset):
    start = int((time.time() - 120 * 24 * 3600) * 1000)
    d = _post("https://api.hyperliquid.xyz/info",
              {"type": "fundingHistory", "coin": SYM["hl"][asset], "startTime": start})
    out = {}
    for row in d:
        out[_daystr(row["time"])] = _ann(row["fundingRate"], PPY_1H)
    return out

HISTERS = {"bybit": hist_bybit, "okx": hist_okx, "deribit": hist_deribit, "hl": hist_hl}

# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
def cefdi_and_mean(per_venue):
    vals = [v for v in per_venue.values() if v is not None and not math.isnan(v)]
    if len(vals) < 2:
        return (None, (vals[0] if vals else None), len(vals))
    return (statistics.stdev(vals), statistics.mean(vals), len(vals))

# ---------------------------------------------------------------------------
# CSV (idempotent, stdlib)
# ---------------------------------------------------------------------------
COLS = ["date", "asset", "fund_bybit", "fund_okx", "fund_deribit", "fund_hl",
        "fund_mean", "cefdi", "n_venues", "oi_total_usd", "oi_chg_pct", "ofpr"]

def read_csv():
    if not OUT.exists():
        return []
    with open(OUT, newline="") as f:
        return list(csv.DictReader(f))

def write_csv(rows):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    rows = sorted(rows, key=lambda r: (r["date"], r["asset"]))
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in COLS})

def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None

def compute_ofpr(rows, asset, oi_today):
    """OFPR = (ΔOI / OI_MA20) * fund_mean, from accumulated history."""
    hist = [r for r in rows if r["asset"] == asset and _f(r.get("oi_total_usd"))]
    if oi_today is None or len(hist) < 5:
        return None, None
    ois = [_f(r["oi_total_usd"]) for r in hist[-20:]]
    oi_ma = statistics.mean(ois)
    oi_prev = ois[-1]
    if not oi_ma:
        return None, None
    oi_chg_pct = (oi_today - oi_prev) / oi_prev * 100.0 if oi_prev else None
    fund_mean = _f([r for r in hist if r["asset"] == asset][-1].get("fund_mean"))
    ofpr = ((oi_today - oi_prev) / oi_ma) * (fund_mean or 0) if oi_ma else None
    return oi_chg_pct, ofpr

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def gather_snapshot(asset, verbose=False):
    per = {}
    oi = {}
    for venue, fn in SNAPPERS.items():
        try:
            s = fn(asset)
            per[venue] = s["funding_ann"]
            oi[venue] = s["oi_usd"]
            if verbose:
                print(f"  {venue:8s} {asset}: funding={s['funding_ann']:+.2f}%/yr  "
                      f"OI=${(s['oi_usd'] or 0)/1e6:,.0f}M")
        except Exception as e:
            per[venue] = None
            oi[venue] = None
            if verbose:
                print(f"  {venue:8s} {asset}: FAILED -> {e}")
    return per, oi

def run_test():
    print("CSLC funding_oi — connectivity test (no CSV written)\n")
    for asset in ASSETS:
        print(f"[{asset}]")
        per, oi = gather_snapshot(asset, verbose=True)
        cefdi, mean, n = cefdi_and_mean(per)
        oi_total = sum(v for v in oi.values() if v) or None
        print(f"  => fund_mean={mean}  CEFDI={cefdi}  venues={n}  "
              f"OI_total=${(oi_total or 0)/1e9:,.2f}B\n")

def run_backfill_and_today():
    rows = read_csv()
    have_dates = {(r["date"], r["asset"]) for r in rows}

    # ---- backfill funding history (warms CEFDI) if CSV is thin ----
    if len(rows) < 30:
        print("Backfilling funding history (warming CEFDI)...")
        for asset in ASSETS:
            venue_hist = {}
            for venue, fn in HISTERS.items():
                try:
                    venue_hist[venue] = fn(asset)
                except Exception as e:
                    venue_hist[venue] = {}
                    print(f"  backfill {venue} {asset} FAILED -> {e}")
            all_dates = sorted({d for h in venue_hist.values() for d in h})
            kept, dropped = 0, 0
            for d in all_dates:
                if (d, asset) in have_dates:
                    continue
                per = {v: venue_hist[v].get(d) for v in HISTERS}
                cefdi, mean, n = cefdi_and_mean(per)
                # COVERAGE COHERENCE: a CEFDI measured on <MIN_VENUES venues is
                # not "low dispersion", it is absence of measurement. Dropping
                # thin-coverage history keeps z_slow unbiased (clean > deep).
                if n < MIN_VENUES:
                    dropped += 1
                    continue
                rows.append({
                    "date": d, "asset": asset,
                    "fund_bybit": per.get("bybit"), "fund_okx": per.get("okx"),
                    "fund_deribit": per.get("deribit"), "fund_hl": per.get("hl"),
                    "fund_mean": mean, "cefdi": cefdi, "n_venues": n,
                    "oi_total_usd": None, "oi_chg_pct": None, "ofpr": None,
                })
                have_dates.add((d, asset))
                kept += 1
            print(f"  {asset}: kept {kept} dates (>={MIN_VENUES} venues), "
                  f"dropped {dropped} thin-coverage")

    # ---- today's live snapshot (funding + OI) ----
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = [r for r in rows if not (r["date"] == today)]  # replace today (idempotent)
    for asset in ASSETS:
        per, oi = gather_snapshot(asset, verbose=True)
        cefdi, mean, n = cefdi_and_mean(per)
        oi_total = sum(v for v in oi.values() if v) or None
        oi_chg_pct, ofpr = compute_ofpr(rows, asset, oi_total)
        rows.append({
            "date": today, "asset": asset,
            "fund_bybit": per.get("bybit"), "fund_okx": per.get("okx"),
            "fund_deribit": per.get("deribit"), "fund_hl": per.get("hl"),
            "fund_mean": mean, "cefdi": cefdi, "n_venues": n,
            "oi_total_usd": oi_total, "oi_chg_pct": oi_chg_pct, "ofpr": ofpr,
        })

    write_csv(rows)
    print(f"\nWrote {len(rows)} rows -> {OUT}")

if __name__ == "__main__":
    if "--test" in sys.argv:
        run_test()
    else:
        run_backfill_and_today()
