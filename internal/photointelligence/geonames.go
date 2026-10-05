package photointelligence

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const GeoNamesResolverName = "geonames-cities500"
const GeoNamesAttribution = "GeoNames (CC BY 4.0)"
const geoNamesAlgorithmVersion = "v1"
const defaultGeoNamesMaxDistance = 100.0

type PlaceLabel struct {
	CountryCode string
	Country     string
	Region      string
	City        string
	District    string
	Locality    string
	Formatted   string
	DistanceKM  float64
}

type PlaceResolver interface {
	Name() string
	Version() string
	Resolve(latitude, longitude float64) (PlaceLabel, bool, error)
}

type geoNamesCell struct {
	Latitude  int
	Longitude int
}

type geoNamesPlace struct {
	ID          int64
	Name        string
	Latitude    float64
	Longitude   float64
	CountryCode string
	Admin1Code  string
	Population  int64
}

type GeoNamesResolver struct {
	version       string
	maxDistanceKM float64
	buckets       map[geoNamesCell][]geoNamesPlace
	countries     map[string]string
	admin1        map[string]string
}

func LoadGeoNamesResolver(dir string, maxDistanceKM float64) (*GeoNamesResolver, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, fmt.Errorf("GeoNames directory is required")
	}
	if maxDistanceKM <= 0 {
		maxDistanceKM = defaultGeoNamesMaxDistance
	}
	if maxDistanceKM > 500 {
		return nil, fmt.Errorf("GeoNames maximum distance must be <= 500 km")
	}

	resolver := &GeoNamesResolver{
		maxDistanceKM: maxDistanceKM,
		buckets:       make(map[geoNamesCell][]geoNamesPlace),
		countries:     make(map[string]string),
		admin1:        make(map[string]string),
	}

	countryHash, err := scanGeoNamesFile(
		filepath.Join(dir, "countryInfo.txt"),
		func(fields []string) error {
			if len(fields) < 5 {
				return fmt.Errorf("expected at least 5 columns")
			}
			code := strings.Clone(strings.TrimSpace(fields[0]))
			name := strings.Clone(strings.TrimSpace(fields[4]))
			if code != "" && name != "" {
				resolver.countries[code] = name
			}
			return nil
		},
	)
	if err != nil {
		return nil, err
	}

	adminHash, err := scanGeoNamesFile(
		filepath.Join(dir, "admin1CodesASCII.txt"),
		func(fields []string) error {
			if len(fields) < 2 {
				return fmt.Errorf("expected at least 2 columns")
			}
			code := strings.Clone(strings.TrimSpace(fields[0]))
			name := strings.Clone(strings.TrimSpace(fields[1]))
			if code != "" && name != "" {
				resolver.admin1[code] = name
			}
			return nil
		},
	)
	if err != nil {
		return nil, err
	}

	citiesHash, err := scanGeoNamesFile(
		filepath.Join(dir, "cities500.txt"),
		func(fields []string) error {
			if len(fields) < 15 {
				return fmt.Errorf("expected at least 15 columns")
			}
			id, err := strconv.ParseInt(strings.TrimSpace(fields[0]), 10, 64)
			if err != nil || id <= 0 {
				return fmt.Errorf("invalid geoname id %q", fields[0])
			}
			latitude, err := strconv.ParseFloat(strings.TrimSpace(fields[4]), 64)
			if err != nil || latitude < -90 || latitude > 90 {
				return fmt.Errorf("invalid latitude %q", fields[4])
			}
			longitude, err := strconv.ParseFloat(strings.TrimSpace(fields[5]), 64)
			if err != nil || longitude < -180 || longitude > 180 {
				return fmt.Errorf("invalid longitude %q", fields[5])
			}
			population := int64(0)
			if raw := strings.TrimSpace(fields[14]); raw != "" {
				population, err = strconv.ParseInt(raw, 10, 64)
				if err != nil || population < 0 {
					return fmt.Errorf("invalid population %q", fields[14])
				}
			}
			name := strings.Clone(strings.TrimSpace(fields[1]))
			if name == "" {
				return fmt.Errorf("place name is empty")
			}
			place := geoNamesPlace{
				ID:          id,
				Name:        name,
				Latitude:    latitude,
				Longitude:   longitude,
				CountryCode: strings.Clone(strings.TrimSpace(fields[8])),
				Admin1Code:  strings.Clone(strings.TrimSpace(fields[10])),
				Population:  population,
			}
			cell := geoNamesCellFor(latitude, longitude)
			resolver.buckets[cell] = append(resolver.buckets[cell], place)
			return nil
		},
	)
	if err != nil {
		return nil, err
	}
	if len(resolver.buckets) == 0 {
		return nil, fmt.Errorf("GeoNames cities500.txt contained no places")
	}

	versionSeed := strings.Join([]string{
		geoNamesAlgorithmVersion,
		"max_distance_km=" + strconv.FormatFloat(maxDistanceKM, 'g', -1, 64),
		citiesHash,
		adminHash,
		countryHash,
	}, "\n")
	sum := sha256.Sum256([]byte(versionSeed))
	resolver.version = geoNamesAlgorithmVersion + ":" + hex.EncodeToString(sum[:])
	return resolver, nil
}

func (r *GeoNamesResolver) Name() string {
	return GeoNamesResolverName
}

func (r *GeoNamesResolver) Version() string {
	if r == nil {
		return ""
	}
	return r.version
}

func (r *GeoNamesResolver) Resolve(
	latitude, longitude float64,
) (PlaceLabel, bool, error) {
	if r == nil || len(r.buckets) == 0 {
		return PlaceLabel{}, false, fmt.Errorf("GeoNames resolver is not loaded")
	}
	if math.IsNaN(latitude) || math.IsInf(latitude, 0) ||
		math.IsNaN(longitude) || math.IsInf(longitude, 0) ||
		latitude < -90 || latitude > 90 ||
		longitude < -180 || longitude > 180 {
		return PlaceLabel{}, false, fmt.Errorf("invalid GPS coordinate")
	}

	base := geoNamesCellFor(latitude, longitude)
	latRadius := int(math.Ceil(r.maxDistanceKM/110.574)) + 1
	kmPerLonDegree := 111.320 * math.Abs(math.Cos(latitude*math.Pi/180))
	lonRadius := 180
	if kmPerLonDegree >= 1 {
		lonRadius = int(math.Ceil(r.maxDistanceKM/kmPerLonDegree)) + 1
		if lonRadius > 180 {
			lonRadius = 180
		}
	}

	var best geoNamesPlace
	bestDistance := math.Inf(1)
	seenCells := make(map[geoNamesCell]struct{})
	for latCell := maxInt(-90, base.Latitude-latRadius); latCell <= minInt(89, base.Latitude+latRadius); latCell++ {
		for delta := -lonRadius; delta <= lonRadius; delta++ {
			cell := geoNamesCell{
				Latitude:  latCell,
				Longitude: wrapLongitudeCell(base.Longitude + delta),
			}
			if _, exists := seenCells[cell]; exists {
				continue
			}
			seenCells[cell] = struct{}{}
			for _, candidate := range r.buckets[cell] {
				distance := haversineKM(
					latitude,
					longitude,
					candidate.Latitude,
					candidate.Longitude,
				)
				if distance > r.maxDistanceKM {
					continue
				}
				if distance < bestDistance-1e-9 ||
					(math.Abs(distance-bestDistance) <= 1e-9 &&
						(candidate.Population > best.Population ||
							(candidate.Population == best.Population && candidate.ID < best.ID))) {
					best = candidate
					bestDistance = distance
				}
			}
		}
	}
	if math.IsInf(bestDistance, 1) {
		return PlaceLabel{}, false, nil
	}

	region := ""
	if best.CountryCode != "" && best.Admin1Code != "" {
		region = r.admin1[best.CountryCode+"."+best.Admin1Code]
	}
	country := r.countries[best.CountryCode]
	if country == "" {
		country = best.CountryCode
	}
	return PlaceLabel{
		CountryCode: best.CountryCode,
		Country:     country,
		Region:      region,
		City:        best.Name,
		Locality:    best.Name,
		Formatted:   formatPlaceLabel(best.Name, region, country),
		DistanceKM:  bestDistance,
	}, true, nil
}

func scanGeoNamesFile(
	path string,
	visit func(fields []string) error,
) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open %s: %w", filepath.Base(path), err)
	}
	defer file.Close()

	hash := sha256.New()
	scanner := bufio.NewScanner(io.TeeReader(file, hash))
	scanner.Buffer(make([]byte, 64<<10), 2<<20)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if err := visit(strings.Split(line, "\t")); err != nil {
			return "", fmt.Errorf("%s:%d: %w", filepath.Base(path), lineNumber, err)
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func geoNamesCellFor(latitude, longitude float64) geoNamesCell {
	latCell := int(math.Floor(latitude))
	if latCell < -90 {
		latCell = -90
	}
	if latCell > 89 {
		latCell = 89
	}
	return geoNamesCell{
		Latitude:  latCell,
		Longitude: wrapLongitudeCell(int(math.Floor(longitude))),
	}
}

func wrapLongitudeCell(value int) int {
	for value < -180 {
		value += 360
	}
	for value > 179 {
		value -= 360
	}
	return value
}

func haversineKM(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusKM = 6371.0088
	toRadians := math.Pi / 180
	phi1 := lat1 * toRadians
	phi2 := lat2 * toRadians
	dPhi := (lat2 - lat1) * toRadians
	dLambda := (lon2 - lon1) * toRadians
	a := math.Sin(dPhi/2)*math.Sin(dPhi/2) +
		math.Cos(phi1)*math.Cos(phi2)*
			math.Sin(dLambda/2)*math.Sin(dLambda/2)
	return 2 * earthRadiusKM * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func formatPlaceLabel(values ...string) string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
	}
	return strings.Join(out, ", ")
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
