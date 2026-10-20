// Package geoquery defines bounded original-WGS84 media selections; no map Provider.
package geoquery

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	EarthRadiusKM = 6371.0088
	MaxRadiusKM   = 200.0
	MaxBBoxSpan   = 20.0
)

type Nearby struct {
	Latitude  float64
	Longitude float64
	RadiusKM  float64
}

type Bounds struct {
	West  float64
	South float64
	East  float64
	North float64
}

type Selection struct {
	Nearby *Nearby
	BBox   *Bounds
}

func parseFiniteCSV(raw string, count int) ([]float64, error) {
	if raw == "" || len(raw) > 160 || strings.TrimSpace(raw) != raw {
		return nil, fmt.Errorf("invalid geographic selection")
	}
	parts := strings.Split(raw, ",")
	if len(parts) != count {
		return nil, fmt.Errorf("invalid coordinate count")
	}
	values := make([]float64, count)
	for i, part := range parts {
		if part == "" || strings.TrimSpace(part) != part {
			return nil, fmt.Errorf("invalid coordinate")
		}
		value, err := strconv.ParseFloat(part, 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, fmt.Errorf("invalid coordinate")
		}
		values[i] = value
	}
	return values, nil
}

func (b Bounds) LongitudeSpan() float64 {
	if b.West < b.East {
		return b.East - b.West
	}
	return 360 - (b.West - b.East)
}

func (b Bounds) Valid() bool {
	for _, v := range []float64{b.West, b.South, b.East, b.North} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return b.West >= -180 && b.West <= 180 &&
		b.East >= -180 && b.East <= 180 &&
		b.South >= -90 && b.North <= 90 &&
		b.South < b.North && b.West != b.East &&
		!(b.West == 180 && b.East == -180) &&
		b.North-b.South <= MaxBBoxSpan &&
		b.LongitudeSpan() > 0 && b.LongitudeSpan() <= MaxBBoxSpan
}

// Exactly one mode. Empty means no geo filter; callers reject present-but-empty.
func Parse(nearby, bbox string) (*Selection, error) {
	if nearby == "" && bbox == "" {
		return nil, nil
	}
	if nearby != "" && bbox != "" {
		return nil, fmt.Errorf("geographic modes are mutually exclusive")
	}
	if nearby != "" {
		values, err := parseFiniteCSV(nearby, 3)
		if err != nil {
			return nil, err
		}
		lat, lng, radius := values[0], values[1], values[2]
		if lat < -90 || lat > 90 || lng < -180 || lng > 180 ||
			radius < 0.1 || radius > MaxRadiusKM {
			return nil, fmt.Errorf("invalid nearby radius")
		}
		return &Selection{Nearby: &Nearby{
			Latitude: lat, Longitude: lng, RadiusKM: radius,
		}}, nil
	}
	values, err := parseFiniteCSV(bbox, 4)
	if err != nil {
		return nil, err
	}
	b := Bounds{West: values[0], South: values[1], East: values[2], North: values[3]}
	if !b.Valid() {
		return nil, fmt.Errorf("bbox is not a bounded WGS84 range")
	}
	return &Selection{BBox: &b}, nil
}

// Bounding filter for SQL only; exact radius is checked via great-circle SQL.
func (n Nearby) RadiusBounds() (south, north, west, east float64, allLongitudes bool) {
	angular := n.RadiusKM / EarthRadiusKM
	latitudeRadians := n.Latitude * math.Pi / 180
	south = math.Max(-90, n.Latitude-angular*180/math.Pi)
	north = math.Min(90, n.Latitude+angular*180/math.Pi)
	if south <= -90 || north >= 90 {
		return south, north, -180, 180, true
	}
	delta := math.Asin(math.Min(1, math.Sin(angular)/math.Cos(latitudeRadians))) * 180 / math.Pi
	if delta >= 180 {
		return south, north, -180, 180, true
	}
	normalize := func(lng float64) float64 {
		return math.Mod(math.Mod(lng+180, 360)+360, 360) - 180
	}
	return south, north, normalize(n.Longitude - delta), normalize(n.Longitude + delta), false
}
