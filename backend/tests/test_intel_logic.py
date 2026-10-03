"""Pure logic behind the Maharashtra import, crisis signals, depot siting and auto-dispatch (no network)."""
from datetime import date, datetime, timedelta
from types import SimpleNamespace as NS

from app.ingestion import crisis as ic
from app.ingestion import maharashtra as mh
from app.services import crisis, depots, dispatch, supply


# --------------------------------------------------------------------------- OpenStreetMap mapping
def test_community_fields_uses_population_and_official_norms():
    el = {"type": "node", "id": 42, "lat": 18.99, "lon": 75.76, "tags": {"place": "town", "name": "Beed", "population": "146,700"}}
    f = mh.community_fields(el)
    assert f["id"] == "osm-n42" and f["external_id"] == "osm:node/42"
    assert f["population"] == 146700 and f["daily_demand"] == 146700 * 70
    assert "CPHEEO" in f["demand_basis"] and f["source_url"] == "https://www.openstreetmap.org/node/42"


def test_community_fields_skips_unusable_places():
    base = {"type": "node", "id": 1, "lat": 19.0, "lon": 73.0}
    assert mh.community_fields({**base, "tags": {"place": "village", "name": "X"}}) is None            # no population
    assert mh.community_fields({**base, "tags": {"place": "village", "name": "X", "population": "10lakh"}}) is None
    assert mh.community_fields({**base, "tags": {"place": "village", "name": "X", "population": "12"}}) is None  # < 100
    assert mh.community_fields({**base, "tags": {"place": "locality", "name": "X", "population": "900"}}) is None
    assert mh.community_fields({**base, "tags": {"place": "village", "name": "Wadi", "population": "900"}})["daily_demand"] == 900 * 55


def test_water_source_fields_keeps_named_filling_points_only():
    ww = mh.water_source_fields({"type": "way", "id": 7, "center": {"lat": 18.5, "lon": 73.8}, "tags": {"man_made": "water_works"}})
    assert ww["kind"] == "treatment_plant" and "unnamed" in ww["name"]
    assert mh.water_source_fields({"type": "node", "id": 8, "lat": 1, "lon": 2, "tags": {"man_made": "water_tower", "name": "T"}}) is None
    assert mh.water_source_fields({"type": "way", "id": 9, "center": {"lat": 1, "lon": 2}, "tags": {"waterway": "dam"}}) is None


# --------------------------------------------------------------------------- news matching
def _c(cid, name, kind="town", district=1, pop=50_000):
    return NS(id=cid, name=name, settlement_type=kind, district_id=district, population=pop)


def _matcher():
    districts = [NS(id=1, name="Bid"), NS(id=2, name="Thane"), NS(id=3, name="Mumbai"), NS(id=4, name="Latur")]
    comms = [_c("beed", "Beed", pop=146_700), _c("parli", "Parli"), _c("v1", "Sonwadi", "village", 1, 900), _c("v2", "Sonwadi", "village", 4, 900),
             _c("nm", "Navi Mumbai", "city", 2, 1_100_000), _c("ganesh", "Ganesh", "village", 1, 500)]
    return ic.PlaceMatcher(comms, districts)


def test_matcher_finds_towns_and_former_district_names():
    cids, dids, terms = _matcher().match("Beed: tankers deployed as Parli taps run dry")
    assert set(cids) == {"beed", "parli"} and dids == [1]
    assert {"term": "Beed", "scope": "district"} in terms


def test_matcher_skips_short_names_of_small_towns():
    m = ic.PlaceMatcher([_c("w", "Wani", pop=58_000)], [NS(id=1, name="Bid")])
    assert m.match("Wani taps dry")[0] == []  # 4-letter names only for towns >= 100,000


def test_matcher_requires_district_for_village_names_and_skips_stopwords():
    m = _matcher()
    assert m.match("Sonwadi villagers walk 3 km for water")[0] == []
    cids, _, _ = m.match("Sonwadi in Beed district gets tanker")
    assert cids == ["v1"]  # the Beed Sonwadi, not the Latur one
    assert "ganesh" not in m.match("Ganesh mandal in Beed distributes water")[0]


def test_matcher_marathi_regions_and_navi_mumbai():
    m = _matcher()
    assert m.match("बीड जिल्ह्यात पाणीटंचाई")[1] == [1]
    cids, dids, terms = m.match("Navi Mumbai faces water cut")
    assert cids == ["nm"] and 3 not in dids
    _, dids, terms = m.match("Drought tightens grip on Marathwada")
    assert set(dids) == {1, 4} and terms == [{"term": "Marathwada", "scope": "region"}]


def test_severity_and_neutral_stock_reports():
    assert ic.severity_of("Villages depend on tankers") == "Severe"
    assert ic.severity_of("City faces water shortage") == "Moderate"
    assert ic.severity_of("Mumbai water stock at 95.84% as lakes fill") is None


def test_parse_rss_strips_publisher_suffix():
    xml = ("<rss><channel><item><title>Beed runs dry - Lokmat</title><link>https://x/1</link>"
           "<pubDate>Fri, 02 Oct 2026 08:00:00 GMT</pubDate><source url='https://lokmat.com'>Lokmat</source>"
           "<description>&lt;a&gt;Beed&lt;/a&gt; tankers</description></item></channel></rss>")
    (it,) = ic.parse_rss(xml)
    assert it["title"] == "Beed runs dry" and it["publisher"] == "Lokmat" and it["summary"] == "Beed tankers"
    assert it["published"] == datetime(2026, 10, 2, 8, 0)


# --------------------------------------------------------------------------- rainfall
def test_rainfall_deviation_against_previous_ten_years():
    times, mm = [], []
    for y in range(2016, 2027):
        for d in range(1, 31):  # 30 June days, 10 mm/day in normal years, 4 mm/day in 2026
            times.append(f"{y}-06-{d:02d}")
            mm.append(4.0 if y == 2026 else 10.0)
        times.append(f"{y}-12-01")
        mm.append(500.0)  # outside the window, ignored
    dev = ic.deviation(times, mm, (date(2026, 6, 1), date(2026, 6, 30)))
    assert dev == -60.0 and ic.rain_severity(dev) == "Severe"
    assert ic.rain_severity(-20) == "Minor" and ic.rain_severity(-5) is None
    assert ic.monsoon_window(date(2026, 10, 3)) == (date(2026, 6, 1), date(2026, 9, 27))  # archive lags ~6 days
    assert ic.monsoon_window(date(2026, 12, 1)) == (date(2026, 6, 1), date(2026, 9, 30))
    assert ic.monsoon_window(date(2026, 3, 1)) == (date(2025, 6, 1), date(2025, 9, 30))


# --------------------------------------------------------------------------- crisis scoring
def _sig(i, kind, sev, cids=(), dids=(), status="unverified", scope="district"):
    return NS(id=i, kind=kind, severity=sev, community_ids=list(cids), district_ids=list(dids), status=status,
              matched_terms=[{"term": "x", "scope": scope}])


def test_crisis_scores_combine_and_cap():
    comms = [NS(id="a", district_id=1), NS(id="b", district_id=1), NS(id="c", district_id=2)]
    sigs = [_sig(1, "rainfall_deficit", "Severe", dids=[1]), _sig(2, "news", "Severe", cids=["a"], dids=[1]),
            _sig(3, "news", "Severe", cids=["a"]), _sig(4, "news", "Moderate", dids=[2], scope="region"),
            _sig(5, "news", "Severe", cids=["c"], status="dismissed")]
    s = crisis.scores(comms, sigs)
    assert s["a"][0] == 30 + 45          # rain + community news capped at 45 (district part excludes direct hits)
    assert s["b"][0] == 30 + 20          # rain + district news from signal 2
    assert s["c"][0] == 6                # region-only counts half; dismissed counts nothing
    assert 5 not in s["c"][1]


def test_supply_balance_uses_piped_baseline():
    c = NS(daily_demand=10_000, baseline_supply=6_000, allocated_water=1_000)
    assert supply.available(c) == 7_000 and supply.shortfall(c) == 3_000 and supply.tanker_need(c) == 4_000
    assert supply.coverage_pct(c) == 70


# --------------------------------------------------------------------------- depots & dispatch
def test_depot_choice_covers_separate_clusters():
    cands = [(1, 19.0, 73.0), (2, 19.0, 73.02), (3, 21.1, 79.0)]
    demand = [("a", 19.0, 73.01, 10.0), ("b", 19.01, 73.0, 10.0), ("c", 21.1, 79.01, 5.0)]
    chosen = depots.choose(cands, demand, 2)
    assert 3 in chosen and len(chosen) == 2
    assert depots.usable(NS(name="BMC Deonar Sewage Pumping Station")) is False
    assert depots.usable(NS(name="Lendi Talav")) is True


def test_dispatch_plan_prefers_close_high_impact_and_fills_capacity():
    cfg = {"maxDistanceKm": 150, "clusterRadiusKm": 15, "maxStops": 3}
    tankers = [{"id": "T1", "capacity": 10_000, "lat": 19.0, "lng": 75.0}]
    village = {"id": "v", "name": "V", "priorityScore": 60, "crisisScore": 50, "shortfall": 4_000, "lat": 19.01, "lng": 75.0}
    near = {"id": "n", "name": "N", "priorityScore": 50, "crisisScore": 50, "shortfall": 3_000, "lat": 19.05, "lng": 75.0}
    city = {"id": "city", "name": "City", "priorityScore": 75, "crisisScore": 50, "shortfall": 200_000_000, "lat": 19.0, "lng": 75.01}
    far = {"id": "far", "name": "Far", "priorityScore": 99, "crisisScore": 99, "shortfall": 5_000, "lat": 22.0, "lng": 75.0}
    (p,) = dispatch.plan(tankers, [city, village, near, far], cfg)
    assert p["first"]["id"] == "v"                       # one load matters more to the village than to the city
    # spare 6,000 L goes to the highest-priority place within 15 km of the first stop
    assert [(s["id"], s["litres"]) for s in p["stops"]] == [("v", 4_000), ("city", 6_000)]
    assert all(s["id"] != "far" for s in p["stops"])     # beyond maxDistanceKm
