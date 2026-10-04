"""Fetch the real ground the landing page descends to: Sentinel-2 imagery and elevation around one point.

    python -m scripts.fetch_landing_ground 75.79 18.97 ../frontend/public/landing

Writes, for a wide patch (~48 km, zoom 12) and a sharp patch (~12 km, zoom 14) centred on the point:
  ground-mid.jpg / ground-hi.jpg   Sentinel-2 cloudless 2016 by EOX IT Services GmbH
                                   (contains modified Copernicus Sentinel data 2016), CC BY 4.0
  height-mid.png / height-hi.png   elevation, 8-bit grey, decoded with min/max from ground.json
                                   (Mapzen terrain tiles: SRTM and other public sources)
  ground.json                      exact lng/lat bounds of every image, elevation range, attribution
"""
from __future__ import annotations

import io
import json
import math
import sys
import time
from pathlib import Path

import httpx
from PIL import Image

IMG = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"
DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_xy(lng: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    x = (lng + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile_lnglat(x: float, y: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    lng = x / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lng, lat


def mosaic(client: httpx.Client, url: str, lng: float, lat: float, z: int, half_km: float, mode: str):
    cx, cy = tile_xy(lng, lat, z)
    km_per_tile = 40075 * math.cos(math.radians(lat)) / 2 ** z
    r = half_km / km_per_tile
    x0, x1, y0, y1 = math.floor(cx - r), math.floor(cx + r), math.floor(cy - r), math.floor(cy + r)
    out = Image.new(mode, ((x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256))
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            for attempt in range(4):
                try:
                    res = client.get(url.format(z=z, x=tx, y=ty))
                    res.raise_for_status()
                    break
                except httpx.HTTPError:
                    if attempt == 3:
                        raise
                    time.sleep(1.5 * (attempt + 1))
            out.paste(Image.open(io.BytesIO(res.content)).convert(mode), ((tx - x0) * 256, (ty - y0) * 256))
            time.sleep(0.05)  # polite
    w, n = tile_lnglat(x0, y0, z)
    e, s = tile_lnglat(x1 + 1, y1 + 1, z)
    return out, {"w": w, "e": e, "s": s, "n": n}


def heights(img: Image.Image):
    px = img.load()
    w, h = img.size
    vals = [[(px[i, j][0] * 256 + px[i, j][1] + px[i, j][2] / 256) - 32768 for i in range(w)] for j in range(h)]
    return vals


def save_height(vals, path: Path, size: int):
    lo = min(min(r) for r in vals)
    hi = max(max(r) for r in vals)
    h, w = len(vals), len(vals[0])
    g = Image.new("L", (w, h))
    g.putdata([int(round(255 * (v - lo) / max(1e-6, hi - lo))) for r in vals for v in r])
    g = g.resize((size, size), Image.BILINEAR)
    g.save(path, optimize=True)
    return lo, hi


def main(lng: float, lat: float, out: str) -> None:
    dst = Path(out)
    dst.mkdir(parents=True, exist_ok=True)
    meta = {"centre": [lng, lat],
            "imagery": "Sentinel-2 cloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0",
            "elevation": "Mapzen terrain tiles (SRTM and other public sources), via AWS Open Data"}
    with httpx.Client(timeout=40, headers={"User-Agent": "JalSetu landing asset fetch"}) as client:
        for name, z_img, z_dem, half, img_px, dem_px in (("mid", 12, 11, 24, 1536, 192), ("hi", 14, 13, 6, 1536, 160)):
            img, b = mosaic(client, IMG, lng, lat, z_img, half, "RGB")
            img = img.resize((img_px, img_px), Image.LANCZOS)
            img.save(dst / f"ground-{name}.jpg", quality=84, optimize=True, progressive=True)
            dem, db = mosaic(client, DEM, lng, lat, z_dem, half, "RGB")
            # crop the DEM mosaic to the imagery bounds
            dx0, dy0 = tile_xy(db["w"], db["n"], z_dem)
            ix0, iy0 = tile_xy(b["w"], b["n"], z_dem)
            ix1, iy1 = tile_xy(b["e"], b["s"], z_dem)
            crop = dem.crop((int((ix0 - dx0) * 256), int((iy0 - dy0) * 256), int((ix1 - dx0) * 256), int((iy1 - dy0) * 256)))
            lo, hi = save_height(heights(crop), dst / f"height-{name}.png", dem_px)
            meta[name] = {"bounds": b, "heightMin": round(lo, 1), "heightMax": round(hi, 1)}
            print(name, b, f"elevation {lo:.0f}..{hi:.0f} m")
    (dst / "ground.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(float(a[0]) if a else 75.79, float(a[1]) if len(a) > 1 else 18.97, a[2] if len(a) > 2 else "../frontend/public/landing")
