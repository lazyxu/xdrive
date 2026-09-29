package api

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestNormalizeSynologyPullConnectorConfig(t *testing.T) {
	source := meta.Source{Kind: synologySourceKind, Direction: meta.SourceDirectionPull}

	normalized, err := normalizeSourceConnectorConfig(source, json.RawMessage(`{"spaces":["shared","personal","personal"]}`))
	if err != nil {
		t.Fatal(err)
	}
	var got synologyPullConfig
	if err := json.Unmarshal(normalized, &got); err != nil {
		t.Fatal(err)
	}
	if want := []string{"personal", "shared"}; !reflect.DeepEqual(got.Spaces, want) {
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
	var got synologyPullConfig
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if want := []string{"personal", "shared"}; !reflect.DeepEqual(got.Spaces, want) {
		t.Fatalf("spaces=%v want=%v", got.Spaces, want)
	}
}
