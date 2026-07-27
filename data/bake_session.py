"""Bake an OpenF1 session's fastest lap into static JSON for the browser app.

Stdlib only — no pip installs. Usage:
    python data/bake_session.py [session_key] [driver_number] [out_name]
Defaults: Monza 2024 race (9590), Verstappen (1), monza-2024.

Output schema (public/sessions/<name>.json):
{
  "meta": { session_key, driver_number, circuit, year, lap_number, lap_time_s },
  "dt": 0.1,                     # uniform resample step, seconds
  "x": [...], "z": [...],        # track-local meters, y-up world (z = north)
  "speed": [...],                # m/s
  "throttle": [...], "brake": [...],  # 0..1
  "gear": [...], "rpm": [...], "drs": [...]
}
"""
import json
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

API = "https://api.openf1.org/v1"


def get(endpoint: str, **params) -> list:
    url = f"{API}/{endpoint}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts)


def resample(times, values, t0, t1, dt):
    """Linear interpolation onto a uniform grid. times must be sorted."""
    out = []
    t = t0
    i = 0
    while t <= t1:
        while i + 1 < len(times) and times[i + 1] < t:
            i += 1
        if i + 1 >= len(times):
            out.append(values[-1])
        else:
            a, b = times[i], times[i + 1]
            f = 0.0 if b == a else max(0.0, min(1.0, (t - a) / (b - a)))
            out.append(values[i] + (values[i + 1] - values[i]) * f)
        t += dt
    return out


def main():
    session_key = int(sys.argv[1]) if len(sys.argv) > 1 else 9590
    driver = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    name = sys.argv[3] if len(sys.argv) > 3 else "monza-2024"
    dt = 0.1

    sess = get("sessions", session_key=session_key)[0]
    laps = get("laps", session_key=session_key, driver_number=driver)
    timed = [l for l in laps if l.get("lap_duration") and not l.get("is_pit_out_lap")]
    best = min(timed, key=lambda l: l["lap_duration"])
    t0 = iso(best["date_start"])
    t1 = t0 + timedelta(seconds=best["lap_duration"])
    pad = timedelta(seconds=2)
    window = {
        "session_key": session_key,
        "driver_number": driver,
        "date>": (t0 - pad).isoformat(),
        "date<": (t1 + pad).isoformat(),
    }

    loc = sorted(get("location", **window), key=lambda d: d["date"])
    car = sorted(get("car_data", **window), key=lambda d: d["date"])
    if not loc or not car:
        sys.exit("empty telemetry window — check session/driver")

    def rel(ts):
        return (iso(ts) - t0).total_seconds()

    lt = [rel(d["date"]) for d in loc]
    ct = [rel(d["date"]) for d in car]
    n_end = best["lap_duration"]

    # OpenF1 location is in ~1/10 m; convert to meters and center on the lap's centroid
    xs = [d["x"] / 10.0 for d in loc]
    ys = [d["y"] / 10.0 for d in loc]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    xs = [v - cx for v in xs]
    ys = [v - cy for v in ys]

    out = {
        "meta": {
            "session_key": session_key,
            "driver_number": driver,
            "circuit": sess["circuit_short_name"],
            "year": sess["year"],
            "lap_number": best["lap_number"],
            "lap_time_s": best["lap_duration"],
        },
        "dt": dt,
        "x": [round(v, 2) for v in resample(lt, xs, 0, n_end, dt)],
        "z": [round(v, 2) for v in resample(lt, ys, 0, n_end, dt)],
        "speed": [round(v / 3.6, 2) for v in resample(ct, [d["speed"] for d in car], 0, n_end, dt)],
        "throttle": [round(v / 100.0, 3) for v in resample(ct, [d["throttle"] for d in car], 0, n_end, dt)],
        "brake": [round(v / 100.0, 3) for v in resample(ct, [d["brake"] for d in car], 0, n_end, dt)],
        "gear": [round(v) for v in resample(ct, [d["n_gear"] for d in car], 0, n_end, dt)],
        "rpm": [round(v) for v in resample(ct, [d["rpm"] for d in car], 0, n_end, dt)],
        "drs": [round(v) for v in resample(ct, [d["drs"] for d in car], 0, n_end, dt)],
    }

    dest = f"public/sessions/{name}.json"
    with open(dest, "w") as f:
        json.dump(out, f)
    print(f"baked {dest}: {sess['circuit_short_name']} {sess['year']} "
          f"lap {best['lap_number']} ({best['lap_duration']}s), {len(out['x'])} samples")


if __name__ == "__main__":
    main()
