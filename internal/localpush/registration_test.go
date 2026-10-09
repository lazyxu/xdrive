package localpush

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
)

func TestEnsureDeviceReusesStoredDeviceAndNeverReEnrollsWithoutSecret(t *testing.T) {
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	directory := t.TempDir()
	deviceID := uuid.NewString()
	token := "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY"
	requests := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/devices" || r.Method != http.MethodPost {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
			return
		}
		requests++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"device":       map[string]string{"id": deviceID, "platform": "linux"},
			"device_token": token,
		})
	}))
	defer srv.Close()
	cfgDir := filepath.Join(directory, "user")
	cli := client.New(srv.URL, "test-account-token")
	ctx := context.Background()
	dev, secret, err := EnsureDevice(ctx, cfgDir, srv.URL, "alice", "Desktop", "linux", "1.0", cli)
	if err != nil || dev != deviceID || secret != token {
		t.Fatalf("first enrollment: device=%s secret_match=%t err=%v", dev, secret == token, err)
	}
	dev, secret, err = EnsureDevice(ctx, cfgDir, srv.URL, "alice", "Desktop", "linux", "1.0", cli)
	if err != nil || dev != deviceID || secret != token || requests != 1 {
		t.Fatalf("existing enrollment not reused: %s, %v, requests=%d", dev, err, requests)
	}
	if _, err := LoadDeviceRegistration(cfgDir, srv.URL, "bob"); err == nil {
		t.Fatal("registration was visible to another account")
	}
	if err := DeleteDeviceToken(cfgDir, srv.URL, "alice", deviceID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := EnsureDevice(ctx, cfgDir, srv.URL, "alice", "Desktop", "linux", "1.0", cli); err == nil || requests != 1 {
		t.Fatalf("missing stored credential must not re-enroll: %v requests=%d", err, requests)
	}
	path, err := deviceRegistrationFile(cfgDir, srv.URL, "alice")
	if err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(bytes), token) {
		t.Fatal("device secret leaked into local registration metadata")
	}
}
