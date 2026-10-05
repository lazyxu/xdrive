package photointelligence

import (
	"encoding/binary"
	"math"
	"reflect"
	"sort"
	"testing"
)

func testPersonFace(
	faceID, assetID uint64,
	key string,
	vector []float64,
) personClusterFace {
	normalized := normalizeVector(vector)
	raw := make([]byte, len(normalized)*4)
	for index, value := range normalized {
		binary.LittleEndian.PutUint32(
			raw[index*4:index*4+4],
			math.Float32bits(float32(value)),
		)
	}
	return personClusterFace{
		row: personClusterFaceRow{
			FaceID:           faceID,
			AssetID:          assetID,
			AssetEvidenceKey: key,
			DetectionKey:     "face:000",
			Confidence:       0.99,
			Width:            0.25,
			Height:           0.25,
			Embedding:        raw,
			EmbeddingFormat:  "f32le",
			EmbeddingVersion: "embed-v1",
		},
		vector:    normalized,
		stableKey: key + "\x00face:000",
		quality:   0.99 * 0.25 * 0.25,
	}
}

func resultMemberKeys(results []personClusterResult) [][]string {
	out := make([][]string, 0, len(results))
	for _, result := range results {
		keys := make([]string, 0, len(result.members))
		for _, member := range result.members {
			keys = append(keys, member.stableKey)
		}
		sort.Strings(keys)
		out = append(out, keys)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i][0] < out[j][0]
	})
	return out
}

func TestClusterPersonFacesGroupsStrongMatchesConservatively(t *testing.T) {
	faces := []personClusterFace{
		testPersonFace(1, 1, "asset:a", []float64{1, 0, 0}),
		testPersonFace(2, 2, "asset:b", []float64{0.8, 0.6, 0}),
		testPersonFace(3, 3, "asset:c", []float64{0, 1, 0}),
	}
	results, err := clusterPersonFaces(faces)
	if err != nil {
		t.Fatal(err)
	}
	got := resultMemberKeys(results)
	want := [][]string{
		{"asset:a\x00face:000", "asset:b\x00face:000"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("clusters=%v want=%v", got, want)
	}
}

func TestClusterPersonFacesNeverMergesTwoFacesFromSameAsset(t *testing.T) {
	faces := []personClusterFace{
		testPersonFace(1, 10, "asset:same:a", []float64{1, 0, 0}),
		testPersonFace(2, 10, "asset:same:b", []float64{1, 0, 0}),
	}
	results, err := clusterPersonFaces(faces)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 0 {
		t.Fatalf("same-asset faces were clustered: %+v", results)
	}
}

func TestClusterPersonFacesDoesNotSingleLinkChain(t *testing.T) {
	degrees := func(value float64) []float64 {
		radians := value * math.Pi / 180
		return []float64{math.Cos(radians), math.Sin(radians), 0}
	}
	faces := []personClusterFace{
		testPersonFace(1, 1, "asset:a", degrees(0)),
		testPersonFace(2, 2, "asset:b", degrees(50)),
		testPersonFace(3, 3, "asset:c", degrees(100)),
	}
	results, err := clusterPersonFaces(faces)
	if err != nil {
		t.Fatal(err)
	}
	got := resultMemberKeys(results)
	want := [][]string{
		{"asset:a\x00face:000", "asset:b\x00face:000"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("transitive chain merged unexpectedly: %v", got)
	}
}

func TestClusterPersonFacesIsDeterministicAcrossInputOrder(t *testing.T) {
	original := []personClusterFace{
		testPersonFace(1, 1, "asset:a", []float64{1, 0, 0}),
		testPersonFace(2, 2, "asset:b", []float64{0.95, 0.15, 0}),
		testPersonFace(3, 3, "asset:c", []float64{0, 1, 0}),
		testPersonFace(4, 4, "asset:d", []float64{0.1, 0.98, 0}),
	}
	first, err := clusterPersonFaces(original)
	if err != nil {
		t.Fatal(err)
	}
	shuffled := []personClusterFace{
		original[3], original[1], original[0], original[2],
	}
	second, err := clusterPersonFaces(shuffled)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(resultMemberKeys(first), resultMemberKeys(second)) {
		t.Fatalf(
			"cluster membership depends on input order: first=%v second=%v",
			resultMemberKeys(first),
			resultMemberKeys(second),
		)
	}
}

func TestDecodeNormalizedF32LERejectsInvalidAndNormalizes(t *testing.T) {
	raw := make([]byte, 8)
	binary.LittleEndian.PutUint32(raw[0:4], math.Float32bits(3))
	binary.LittleEndian.PutUint32(raw[4:8], math.Float32bits(4))
	vector, err := decodeNormalizedF32LE(raw)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(vector[0]-0.6) > 1e-6 ||
		math.Abs(vector[1]-0.8) > 1e-6 {
		t.Fatalf("normalized=%v", vector)
	}

	if _, err := decodeNormalizedF32LE([]byte{1, 2, 3}); err == nil {
		t.Fatal("invalid byte length was accepted")
	}
	zero := make([]byte, 8)
	if _, err := decodeNormalizedF32LE(zero); err == nil {
		t.Fatal("zero vector was accepted")
	}
}

func TestPersonClusterAnalyzerVersionIsStableAndBounded(t *testing.T) {
	first := PersonClusterAnalyzerVersion()
	second := PersonClusterAnalyzerVersion()
	if first != second {
		t.Fatalf("version is not stable: %q != %q", first, second)
	}
	if len(first) > 128 {
		t.Fatalf("version length=%d exceeds schema limit", len(first))
	}
	if first[:18] != "person-cluster:v1:" {
		t.Fatalf("version=%q", first)
	}
}
