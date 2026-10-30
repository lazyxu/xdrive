package synologyui

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

type nativeNASPreflightAgent struct {
	*fakeAgent
	preflightCalls int
	path           string
	rejected       bool
}

func (a *nativeNASPreflightAgent) PreflightLocalRoot(_ context.Context, path string) error {
	a.preflightCalls++
	a.path = path
	if a.rejected {
		return fmt.Errorf("native permission denied")
	}
	return nil
}

func TestDSMNASSharePreflightIsSessionScopedAndNeverGrantsRoot(t *testing.T) {
	g, basic := newFixture(t)
	fake := &nativeNASPreflightAgent{fakeAgent: basic}
	g.Connect = func(context.Context) (Agent, error) { return fake, nil }
	root := t.TempDir()
	share := filepath.Join(root, "volume1", "Photos")
	if err := os.MkdirAll(share, 0700); err != nil {
		t.Fatal(err)
	}
	g.nasShareRoot = root
	inventory := request(g, http.MethodGet, "/v1/nas-shares", "", "")
	if inventory.Code != http.StatusOK {
		t.Fatalf("inventory HTTP %d", inventory.Code)
	}
	var data map[string][]map[string]string
	if err := json.Unmarshal(inventory.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	selection := data["items"][0]["selection_id"]
	body := fmt.Sprintf("{\"selection_id\":\"%s\"}", selection)
	csrfToken := getCSRF(t, g)
	for _, bad := range []string{
		"{\"selection_id\":\"" + selection + "\",\"path\":\"/etc\"}",
		"{\"selection_id\":\"" + selection + "\",\"selection_id\":\"" + selection + "\"}",
		"{\"selection_id\":\"" + selection + "\"}{}",
		"{\"path\":\"/volume1/Photos\"}",
		"{\"selection_id\":\"" + "a" + "\"}",
	} {
		if got := requestSchedule(g, "POST", "/v1/nas-share-preflight", bad, "https://nas.example:5001", csrfToken); got.Code == http.StatusOK {
			t.Fatalf("untrusted NAS preflight accepted: %s", bad)
		}
	}
	if got := requestSchedule(g, "POST", "/v1/nas-share-preflight", body, "https://evil.example", csrfToken); got.Code != http.StatusForbidden {
		t.Fatalf("foreign origin HTTP %d", got.Code)
	}
	if got := requestSchedule(g, "POST", "/v1/nas-share-preflight", body, "https://nas.example:5001", "bad"); got.Code != http.StatusForbidden {
		t.Fatalf("missing CSRF HTTP %d", got.Code)
	}
	if got := requestSchedule(g, "POST", "/v1/nas-share-preflight", body, "https://nas.example:5001", csrfToken); got.Code != http.StatusOK {
		t.Fatalf("good preflight HTTP %d: %s", got.Code, got.Body.String())
	}
	if fake.path != share || fake.preflightCalls != 1 {
		t.Fatalf("foreign or duplicate native call: %+v", fake)
	}
	if basic.runs != 0 || basic.controls != 0 {
		t.Fatal("read-only preflight triggered a backup action")
	}
	g.Authenticate = func(context.Context) (string, error) { return "foreign", nil }
	if got := requestSchedule(g, "POST", "/v1/nas-share-preflight", body, "https://nas.example:5001", csrfToken); got.Code != http.StatusForbidden {
		t.Fatal("foreign DSM user was admitted")
	}
}

func TestDSMNASPreflightRejectsReplacedOrMissingDirectory(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "volume1", "photos")
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	key := make([]byte, 32)
	choices, err := enumerateNASShareChoices(context.Background(), root, key, "user", "cookie", "host")
	if err != nil || len(choices) != 1 {
		t.Fatal("unavailable initial inventory", err)
	}
	id := choices[0].SelectionID
	if _, err := resolveNASSharePreflight(context.Background(), root, key, "user", "different", "host", id); err == nil {
		t.Fatal("cross-session token accepted")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("/tmp", path); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveNASSharePreflight(context.Background(), root, key, "user", "cookie", "host", id); err == nil {
		t.Fatal("replaced Root accepted")
	}
}
