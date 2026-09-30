package api

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/synology"
)

func TestNormalizeSynologyPullConnectorConfig(t *testing.T) {
	source := meta.Source{Kind: synologySourceKind, Direction: meta.SourceDirectionPull}

	normalized, err := normalizeSourceConnectorConfig(source, json.RawMessage(`{"spaces":["shared","personal","personal"]}`))
	if err != nil {
		t.Fatal(err)
	}
	var got synology.PullConfig
	if err := json.Unmarshal(normalized, &got); err != nil {
		t.Fatal(err)
	}
	if want := []synology.Space{synology.SpacePersonal, synology.SpaceShared}; !reflect.DeepEqual(got.Spaces, want) {
		t.Fatalf("spaces=%v want=%v", got.Spaces, want)
	}

	for _, payload := range []string{
		`{"spaces":[]}`,
		`{"spaces":["unknown"]}`,
		`{"spaces":["personal","unknown"]}`,
		`{}`,
	} {
		if _, err := normalizeSourceConnectorConfig(source, json.RawMessage(payload)); !errors.Is(err, errInvalidSourceConfig) {
			t.Fatalf("payload=%s error=%v want invalid config", payload, err)
		}
	}

	yike := meta.Source{Kind: yikeSourceKind, Direction: meta.SourceDirectionPull}
	if _, err := normalizeSourceConnectorConfig(yike, json.RawMessage(`{"spaces":["personal"]}`)); !errors.Is(err, errUnsupportedSourceConnectorConfig) {
		t.Fatalf("unsupported connector error=%v", err)
	}
}

func TestDefaultSynologyPullConnectorConfigIncludesBothSpaces(t *testing.T) {
	source := meta.Source{Kind: synologySourceKind, Direction: meta.SourceDirectionPull}
	payload, err := defaultSourceConnectorConfig(source)
	if err != nil {
		t.Fatal(err)
	}
	var got synology.PullConfig
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if want := []synology.Space{synology.SpacePersonal, synology.SpaceShared}; !reflect.DeepEqual(got.Spaces, want) {
		t.Fatalf("spaces=%v want=%v", got.Spaces, want)
	}
}

func TestNormalizeSynologyFilesConnectorConfig(t *testing.T) {
	source := meta.Source{Kind: synologyFilesSourceKind, Direction: meta.SourceDirectionPull}
	normalized, err := normalizeSourceConnectorConfig(source, json.RawMessage(`{"roots":["/video/projects","/documents","/documents"]}`))
	if err != nil {
		t.Fatal(err)
	}
	var got synology.FilePullConfig
	if err := json.Unmarshal(normalized, &got); err != nil {
		t.Fatal(err)
	}
	if want := []string{"/documents", "/video/projects"}; !reflect.DeepEqual(got.Roots, want) {
		t.Fatalf("roots=%v want=%v", got.Roots, want)
	}

	for _, payload := range []string{
		`{"roots":[]}`,
		`{"roots":["/"]}`,
		`{"roots":["/documents","/documents/work"]}`,
		`{"roots":["documents"]}`,
	} {
		if _, err := normalizeSourceConnectorConfig(source, json.RawMessage(payload)); !errors.Is(err, errInvalidSourceConfig) {
			t.Fatalf("payload=%s error=%v want invalid config", payload, err)
		}
	}
}

func TestDefaultSynologyFilesConnectorConfigIsUnconfigured(t *testing.T) {
	source := meta.Source{Kind: synologyFilesSourceKind, Direction: meta.SourceDirectionPull}
	payload, err := defaultSourceConnectorConfig(source)
	if err != nil {
		t.Fatal(err)
	}
	var got synology.FilePullConfig
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Roots) != 0 {
		t.Fatalf("default roots=%v want empty", got.Roots)
	}
}
