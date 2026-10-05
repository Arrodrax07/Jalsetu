"""Self-host the open 3D Earth tiles the landing page's descent to Beed uses, so the demo does not depend on the
public tile servers being fast (or reachable) on the day. Tiles not in the pack still load from the public servers.

    python -m scripts.fetch_landing_earth record http://localhost:5173 ../frontend/public/landing/earth
    python -m scripts.fetch_landing_earth fetch ../frontend/public/landing/earth

`record` (needs `pip install playwright` + `playwright install chromium` and the frontend running) scrolls the real
landing page through the descent at desktop and phone sizes, including a full look-around at the hold, and writes the
list of tiles it asked for to <out>/index.json. `fetch` downloads every tile in index.json into <out>:
  s2/{z}/{y}/{x}.jpg    Sentinel-2 cloudless 2016 by EOX IT Services GmbH
                        (contains modified Copernicus Sentinel data 2016), CC BY 4.0
  dem/{z}/{x}/{y}.png   Mapzen Terrarium elevation (SRTM and other public sources), AWS Open Data
  osm/{z}/{x}/{y}.pbf   OpenStreetMap contributors (ODbL) via OpenFreeMap vector tiles
  fonts/<stack>/<range>.pbf   OpenFreeMap glyphs (Noto Sans, OFL)
The same attributions are shown on the page.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote

import httpx

S2 = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"
DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OSM_TILEJSON = "https://tiles.openfreemap.org/planet"
FONT = "https://tiles.openfreemap.org/fonts/{stack}/{range}.pbf"
HOSTS = ("tiles.maps.eox.at", "elevation-tiles-prod", "tiles.openfreemap.org", "/landing/earth/")
# page progress of the chapter, as in frontend/src/components/landing/EarthDescent.tsx (EARTH)
IN0, OUT1, STREET, HOLD = 0.503, 0.66, 0.585, 0.612


def classify(url: str) -> tuple[str, str] | None:
    """A recorded request -> (source, key): public tile URLs and copies already in the pack."""
    url = unquote(url)
    if (m := re.search(r"/landing/earth/(s2|dem|osm)/(\d+/\d+/\d+)\.\w+$", url)):
        return m.group(1), m.group(2)
    if (m := re.search(r"/landing/earth/fonts/([^/]+/\d+-\d+)\.pbf$", url)):
        return "fonts", m.group(1)
    if "tiles.maps.eox.at" in url and (m := re.search(r"/(\d+)/(\d+)/(\d+)\.jpg$", url)):
        return "s2", "/".join(m.groups())                      # z/y/x
    if "terrarium" in url and (m := re.search(r"/(\d+)/(\d+)/(\d+)\.png$", url)):
        return "dem", "/".join(m.groups())                     # z/x/y
    if "/fonts/" in url and (m := re.search(r"/fonts/([^/]+)/(\d+-\d+)\.pbf$", url)):
        return "fonts", f"{m.group(1)}/{m.group(2)}"
    if "openfreemap" in url and (m := re.search(r"/(\d+)/(\d+)/(\d+)\.pbf$", url)):
        return "osm", "/".join(m.groups())                     # z/x/y
    return None


def record(base: str, out: Path) -> None:
    from playwright.sync_api import sync_playwright

    urls: set[str] = set()

    def wait_tiles(page, t: float = 6.0) -> None:
        end = time.time() + t
        while time.time() < end and not page.evaluate("() => !!(window.__earth && window.__earth.areTilesLoaded())"):
            time.sleep(0.1)
        time.sleep(0.15)

    def go(page, p: float) -> None:
        page.evaluate("p => window.scrollTo(0, p * (document.documentElement.scrollHeight - innerHeight))", p)
        time.sleep(0.9)
        wait_tiles(page)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--use-angle=d3d11", "--enable-gpu"])
        for vw, vh, mobile in [(1440, 900, False), (1920, 1080, False), (2560, 1440, False), (390, 844, True), (820, 1180, True)]:
            ctx = browser.new_context(viewport={"width": vw, "height": vh}, is_mobile=mobile, has_touch=mobile)
            page = ctx.new_page()
            page.on("request", lambda r: urls.add(r.url) if any(h in r.url for h in HOSTS) else None)
            page.goto(base.rstrip("/") + "/welcome?debug=expose", wait_until="networkidle")
            page.wait_for_function("() => !!window.__earth", timeout=90000)
            for i in range(61):
                go(page, IN0 - 0.01 + (OUT1 - IN0 + 0.01) * i / 60)
            go(page, (STREET + HOLD) / 2)
            cx, cy = vw / 2, vh / 2
            for _ in range(12):  # a full turn in 30 degree strokes, each sweeping the tilt range
                page.mouse.move(cx, cy)
                page.mouse.down()
                for dy in (0, -330, 80, 0):
                    page.mouse.move(cx - 120, cy + dy, steps=4)
                    time.sleep(0.3)
                    wait_tiles(page, 4)
                page.mouse.up()
            print(f"{vw}x{vh}: {len(urls)} requests so far", flush=True)
            ctx.close()
        browser.close()

    index: dict[str, list[str]] = {"s2": [], "dem": [], "osm": [], "fonts": []}
    for url in sorted(urls):
        if c := classify(url):
            index[c[0]].append(c[1])
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.json").write_text(json.dumps({k: sorted(set(v)) for k, v in index.items()}, separators=(",", ":")))
    print({k: len(v) for k, v in index.items()})


def fetch(out: Path) -> None:
    index = json.loads((out / "index.json").read_text())
    with httpx.Client(timeout=30, headers={"User-Agent": "JalSetu landing tile pack (one-off)"}, follow_redirects=True) as http:
        osm_tpl = http.get(OSM_TILEJSON).raise_for_status().json()["tiles"][0]
        jobs = []
        for key in index["s2"]:
            z, y, x = key.split("/")
            jobs.append((S2.format(z=z, y=y, x=x), out / "s2" / f"{key}.jpg"))
        for key in index["dem"]:
            z, x, y = key.split("/")
            jobs.append((DEM.format(z=z, x=x, y=y), out / "dem" / f"{key}.png"))
        for key in index["osm"]:
            z, x, y = key.split("/")
            jobs.append((osm_tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y), out / "osm" / f"{key}.pbf"))
        for key in index["fonts"]:
            stack, rng = key.split("/")
            jobs.append((FONT.format(stack=stack.replace(" ", "%20"), range=rng), out / "fonts" / stack / f"{rng}.pbf"))
        total = 0
        for i, (url, path) in enumerate(jobs, 1):
            if not path.exists():
                for attempt in range(4):
                    try:
                        r = http.get(url)
                        if r.status_code == 404:  # no tile there (open sea, outside coverage): the page shows nothing either
                            break
                        r.raise_for_status()
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(r.content)
                        break
                    except httpx.HTTPError:
                        time.sleep(1.5 * (attempt + 1))
                time.sleep(0.05)  # polite to the free servers
            total += path.stat().st_size if path.exists() else 0
            if i % 100 == 0:
                print(f"{i}/{len(jobs)}", flush=True)
    print(f"{len(jobs)} tiles, {total / 1e6:.1f} MB in {out}")


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "record":
        record(sys.argv[2], Path(sys.argv[3]))
    elif len(sys.argv) >= 3 and sys.argv[1] == "fetch":
        fetch(Path(sys.argv[2]))
    else:
        print(__doc__)
        sys.exit(2)
