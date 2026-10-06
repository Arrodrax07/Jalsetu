"""The fleet list (GET /api/tracking/vehicles) carries what the Fleet page shows: capacity and home depot."""


def test_vehicle_list_has_capacity_and_depot(client, operator):
    vehicles = client.get("/api/tracking/vehicles", headers=operator).json()["vehicles"]
    assert vehicles, "seeded fleet expected"
    for v in vehicles:
        assert isinstance(v["capacity"], int) and v["capacity"] > 0, v["vehicleId"]
        assert "depot" in v
        if v["depot"] is not None:
            assert v["depot"]["name"] and isinstance(v["depot"]["lat"], float)
