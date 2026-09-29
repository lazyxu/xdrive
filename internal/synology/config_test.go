package synology

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestPullConfigDefaultsAndNormalization(t *testing.T) {
	if want := []Space{SpacePersonal, SpaceShared}; !reflect.DeepEqual(DefaultPullConfig().Spaces, want) {
		t.Fatalf("default spaces=%v want=%v", DefaultPullConfig().Spaces, want)
	}
	payload, err := json.Marshal(PullConfig{Spaces: []Space{SpaceShared, SpacePersonal, SpacePersonal}})
	if err != nil {
		t.Fatal(err)
	}
	config, err := ParsePullConfig(payload)
	if err != nil {
		t.Fatal(err)
	}
	if want := []Space{SpacePersonal, SpaceShared}; !reflect.DeepEqual(config.Spaces, want) {
		t.Fatalf("spaces=%v want=%v", config.Spaces, want)
	}
	for _, payload := range []string{`{}`, `{"spaces":[]}`, `{"spaces":["other"]}`} {
		if _, err := ParsePullConfig([]byte(payload)); err == nil {
			t.Fatalf("payload %s unexpectedly accepted", payload)
		}
	}
}
