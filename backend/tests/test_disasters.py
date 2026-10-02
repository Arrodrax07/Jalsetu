"""SACHET CAP parsing (fixture copied from the live feed format verified 2026-10-02) and impact computation."""
from app.ingestion.sachet import normalise_event, parse_cap, parse_polygon_rings, rings_to_geometry

CAP = """<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
<cap:identifier>IN-TEST-1_1</cap:identifier><cap:sender>CWC</cap:sender><cap:sent>2026-10-02T16:19:08+05:30</cap:sent>
<cap:status>Actual</cap:status><cap:msgType>Alert</cap:msgType><cap:scope>Public</cap:scope>
<cap:info><cap:language>en-IN</cap:language><cap:category>Met</cap:category><cap:event>Flood Situation</cap:event>
<cap:urgency>Immediate</cap:urgency><cap:severity>Severe</cap:severity><cap:certainty>Likely</cap:certainty>
<cap:effective>2026-10-02T16:15:00+05:30</cap:effective><cap:onset>2026-10-02T16:19:56+05:30</cap:onset>
<cap:expires>2099-10-02T19:00:00+05:30</cap:expires>
<cap:headline>River above danger level near test district</cap:headline><cap:description/><cap:instruction>Move to higher ground.</cap:instruction>
<cap:parameter><cap:valueName>Polygon URL</cap:valueName><cap:value>https://example.invalid/poly</cap:value></cap:parameter>
<cap:area><cap:areaDesc>Mumbai Suburban district of Maharashtra</cap:areaDesc>
<cap:geocode><cap:valueName>LGD District Code</cap:valueName><cap:value>519</cap:value></cap:geocode></cap:area>
</cap:info></cap:alert>"""

POLY = "<alert><identifier>IN-TEST-1_1</identifier><polygon>19.03,72.85 19.03,72.95 19.10,72.95 19.10,72.85 19.03,72.85</polygon></alert>"


def test_parse_cap_fields_and_utc():
    c = parse_cap(CAP)
    assert c["identifier"] == "IN-TEST-1_1" and c["severity"] == "Severe" and c["urgency"] == "Immediate"
    assert c["event_type"] == "flood" and c["lgd_codes"] == ["519"] and c["polygon_url"]
    assert c["onset"].isoformat() == "2026-10-02T10:49:56"   # +05:30 converted to UTC


def test_event_normalisation():
    assert normalise_event("Moderate Rain", "Light to Moderate Rain with lightning") == "thunderstorm_lightning"
    assert normalise_event("Heavy Rainfall", "") == "heavy_rainfall"
    assert normalise_event("Flash Flood Guidance", "") == "flash_flood"
    assert normalise_event("Something new", "") == "other"


def test_polygon_rings():
    g = rings_to_geometry(parse_polygon_rings(POLY))
    assert g is not None and g.contains(__import__("shapely.geometry", fromlist=["Point"]).Point(72.9, 19.06))


def test_impact_uses_only_database_facts(client, admin):
    from app.db import SessionLocal
    from app.ingestion.sachet import _apply_geometry
    from app.models import DisasterEvent

    with SessionLocal() as db:
        c = parse_cap(CAP)
        e = DisasterEvent(source="ndma_sachet", external_id=c["identifier"], provider="CWC", source_url="https://example.invalid/cap",
                          event_type=c["event_type"], severity=c["severity"], urgency=c["urgency"], certainty=c["certainty"],
                          headline=c["headline"], area_desc=c["area_desc"], lgd_district_codes=c["lgd_codes"],
                          onset_at=c["onset"], expires_at=c["expires"])
        _apply_geometry(e, rings_to_geometry(parse_polygon_rings(POLY)))
        db.add(e)
        db.commit()
        eid = e.id
    imp = client.get(f"/api/disasters/{eid}/impact", headers=admin).json()
    names = {x["name"] for x in imp["communities"]}
    assert {"Shivaji Nagar", "Kurla East", "Govandi"} <= names and "Wadala" not in names   # Wadala lies south of the polygon
    rec = imp["recommendation"]
    assert rec["kind"] == "RULE-BASED" and any(f["source"] == "JalSetu database" for f in rec["factors"])
    lst = client.get("/api/disasters", headers=admin).json()
    assert any(x["id"] == eid and x["status"] == "active" and x["sourceUrl"] for x in lst)
    gj = client.get("/api/disasters/geojson", headers=admin).json()
    assert any(f["properties"]["id"] == eid for f in gj["features"])
    ov = client.get("/api/overview", headers=admin).json()
    assert ov["activeAlerts"] >= 1 and ov["communitiesAffected"] >= 3


def test_health_reports_sources_honestly(client, admin):
    from app.db import SessionLocal
    from app.ingestion.probes import probe_static

    with SessionLocal() as db:
        probe_static(db)
    h = client.get("/api/system/health", headers=admin).json()
    by = {s["key"]: s for s in h["sources"]}
    assert by["vltd"]["status"] == "awaiting_credentials" and by["cwc_flood"]["status"] == "awaiting_credentials"
    assert h["database"]["status"] == "healthy"
