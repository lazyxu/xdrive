package synologyui

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDSMOwnerSmallUploadRequiresExactBoundedDigest(t *testing.T) {
	payload := []byte{0, 1, 2, 7, 255, 128}
	sum := sha256.Sum256(payload)
	good := map[string]any{
		"parent_id": 17,
		"name": "leaf.txt",
		"owner_scope": strings.Repeat("a", 64),
		"sha256": hex.EncodeToString(sum[:]),
		"data": payload,
	}
	packed, err := json.Marshal(good)
	if err != nil {
		t.Fatal(err)
	}
	request := func(body []byte) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "https://nas.example/v1/cloud-upload-file", bytes.NewReader(body))
		record := httptest.NewRecorder()
		parsed, err := parseDSMOwnerSmallUpload(r)
		if err != nil || parsed.ParentID != 17 || parsed.Name != "leaf.txt" ||
			parsed.SHA256 != good["sha256"] || !bytes.Equal(parsed.Data, payload) {
			t.Errorf("valid Owner upload rejected: %+v %v", parsed, err)
		}
		return record
	}
	_ = request(packed)
	for name, body := range map[string][]byte{
		"duplicate": []byte(`{"parent_id":17,"parent_id":18,"name":"leaf.txt","owner_scope":"` + strings.Repeat("a", 64) + `","sha256":"` + hex.EncodeToString(sum[:]) + `","data":"AAECB/+A"}`),
		"unknown": append(append([]byte(nil), packed[:len(packed)-1]...), []byte(`,"local_path":"/volume1/photo"}`)...),
		"trailing": append(append([]byte(nil), packed...), []byte(` {}`)...),
		"missing": []byte(`{"parent_id":17,"name":"leaf.txt"}`),
		"oversized": bytes.Repeat([]byte("x"), dsmOwnerSmallUploadJSONMax+1),
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "https://nas.example/v1/cloud-upload-file", bytes.NewReader(body))
			if _, err := parseDSMOwnerSmallUpload(req); err == nil {
				t.Fatal("invalid DSM upload was accepted")
			}
		})
	}
	for name, mutate := range map[string]func(map[string]any){
		"parent": func(m map[string]any) { m["parent_id"] = 0 },
		"scope": func(m map[string]any) { m["owner_scope"] = "forged" },
		"path": func(m map[string]any) { m["name"] = "../attack" },
		"hash": func(m map[string]any) { m["sha256"] = strings.Repeat("0", 64) },
		"empty": func(m map[string]any) { m["data"] = []byte{} },
		"large": func(m map[string]any) { m["data"] = make([]byte, (4<<20)+1) },
	} {
		t.Run(name, func(t *testing.T) {
			m := make(map[string]any, len(good))
			for k, v := range good {
				m[k] = v
			}
			mutate(m)
			body, err := json.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("POST", "https://nas.example/v1/cloud-upload-file", bytes.NewReader(body))
			if _, err := parseDSMOwnerSmallUpload(req); err == nil {
				t.Fatal("invalid DSM upload selector or bytes passed")
			}
		})
	}
	req := httptest.NewRequest("POST", "https://nas.example/v1/cloud-upload-file?path=/tmp", bytes.NewReader(packed))
	if _, err := parseDSMOwnerSmallUpload(req); err == nil {
		t.Fatal("arbitrary path query accepted")
	}
	req = httptest.NewRequest("POST", "https://nas.example/v1/cloud-upload-file", bytes.NewReader(packed))
	req.ContentLength--
	if _, err := parseDSMOwnerSmallUpload(req); err == nil {
		t.Fatal("mismatched Content-Length accepted")
	}
}
