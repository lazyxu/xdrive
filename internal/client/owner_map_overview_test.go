package client

import (
    "math"
    "strings"
    "testing"
)

func ownerMapFixture(aggregate bool) MediaPlacesMapOverview {
    item := MediaPlaceFacet{ID:"place:3550:13970",Name:"真实地点",
        SampleLatitude:35.505,SampleLongitude:139.706,
        Latitude:35.5,Longitude:139.7,CoordinateKind:"grid_cell_center",ItemCount:3}
    if aggregate {
        item.ID = "map-region:q:-180:-90:180:90:1:2"
        item.CoordinateKind = "map_region_sample"
        item.Name = "Server aggregation"
    }
    return MediaPlacesMapOverview{Items:[]MediaPlaceFacet{item},TotalPhotoCount:3,Aggregated:aggregate}
}
func TestOwnerGPSMapExactVsAggregatedCannotConfusePlaceSelectors(t *testing.T) {
    world := MediaPlacesViewportBounds{West:-180,South:-90,East:180,North:90}
    for _, aggregated := range []bool{false,true} {
        page,err := ProjectOwnerMapOverview(ownerMapFixture(aggregated),world)
        if err != nil || !ValidOwnerMapOverview(page,world) {
            t.Fatalf("valid GPS map rejected: %+v %v",page,err)
        }
        p := page.Items[0]
        if p.Latitude != 35.505 || p.Longitude != 139.706 ||
            p.ItemCount != 3 || page.TotalPhotoCount != 3 {
            t.Fatalf("GPS/count altered: %+v",page)
        }
        if aggregated {
            if ValidOwnerPlaceID(p.ID) || p.ID != "map-region:1" ||
                p.CoordinateKind != "map_region_sample" ||
                strings.Contains(p.ID,"13970") {
                t.Fatal("synthetic region obtained a real place authority")
            }
        } else if p.ID != "place:3550:13970" || !ValidOwnerPlaceID(p.ID) {
            t.Fatalf("exact place identity lost: %+v",p)
        }
    }
}
func TestOwnerGPSMapBoundingAndCountsFailClosed(t *testing.T) {
    world := MediaPlacesViewportBounds{West:-180,South:-90,East:180,North:90}
    for _, bad := range []MediaPlacesViewportBounds{
        {West:-180,South:-90,East:-180,North:90},
        {West:181,South:-90,East:180,North:90},
        {West:-180,South:90,East:180,North:90},
        {West:math.NaN(),South:-90,East:180,North:90},
    } {
        if ValidOwnerMapBounds(bad) { t.Fatal("invalid bounds admitted") }
    }
    for _, invalid := range []string{
        "west=-180&south=-90&east=180",
        "west=-180&south=-90&east=180&north=90&owner=1",
        "west=-180&south=-90&east=180&north=90&north=89",
        "west=-180&south=-90&east=+180&north=90",
        "west=-180&south=-90&east=180&north=NaN",
        "west=-180&south=-90&east=180&north=90;bad=1",
    } {
        if _,err := ParseOwnerMapBoundsQuery(invalid); err == nil {
            t.Fatalf("invalid map query admitted: %s",invalid)
        }
    }
    if parsed,err := ParseOwnerMapBoundsQuery(OwnerMapBoundsQuery(world));err != nil || parsed != world {
        t.Fatalf("Owner bounds cannot round trip: %+v %v",parsed,err)
    }
    for _, mutate := range []func(*MediaPlacesMapOverview){
        func(x *MediaPlacesMapOverview){x.TotalPhotoCount = 2},
        func(x *MediaPlacesMapOverview){x.Items = append(x.Items,x.Items[0])},
        func(x *MediaPlacesMapOverview){x.Items[0].SampleLatitude = 91},
        func(x *MediaPlacesMapOverview){x.Items[0].SampleLongitude = math.Inf(1)},
        func(x *MediaPlacesMapOverview){x.Items[0].ItemCount = -1},
        func(x *MediaPlacesMapOverview){x.Items[0].ID = "place:01:02"},
        func(x *MediaPlacesMapOverview){x.Items[0].CoordinateKind = "map_region_sample"},
        func(x *MediaPlacesMapOverview){x.Items = nil},
    } {
        raw := ownerMapFixture(false)
        mutate(&raw)
        if p,err := ProjectOwnerMapOverview(raw,world);err == nil {
            t.Fatalf("invalid Server GPS map accepted: %+v",p)
        }
    }
    north := MediaPlacesViewportBounds{West:130,South:30,East:150,North:40}
    page,err := ProjectOwnerMapOverview(ownerMapFixture(false),north)
    if err != nil || !ValidOwnerMapOverview(page,north) {
        t.Fatalf("valid narrow viewport rejected: %v",err)
    }
    wrapped := MediaPlacesViewportBounds{West:170,South:30,East:-170,North:40}
    if !ValidOwnerMapBounds(wrapped) || !ownerMapContains(wrapped,35,-179) ||
        ownerMapContains(wrapped,35,140) {
        t.Fatal("antimeridian WGS84 viewport invalid")
    }
    if _,err := ProjectOwnerMapOverview(ownerMapFixture(false),wrapped);err == nil {
        t.Fatal("out-of-viewport GPS accepted")
    }
}
