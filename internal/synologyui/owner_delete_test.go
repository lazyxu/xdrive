package synologyui

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDSMOwnerDeleteStrictSingleNodeRequest(t *testing.T) {
	good := map[string]any{
		"id": 42, "revision": 7, "parent_id": 17,
		"type": "file", "name": "report.txt", "owner_scope": strings.Repeat("a", 64),
	}
	makeRequest := func(body []byte, query string) error {
		r := httptest.NewRequest("POST", "https://nas.example/v1/cloud-delete-node"+query,
			bytes.NewReader(body))
		_, err := parseDSMOwnerNodeDelete(r)
		return err
	}
	valid, err := json.Marshal(good)
	if err != nil { t.Fatal(err) }
	if err := makeRequest(valid, ""); err != nil { t.Fatal(err) }
	cases := map[string][]byte{
		"duplicate": []byte(`{"id":42,"id":43,"revision":7,"parent_id":17,"type":"file","name":"report.txt","owner_scope":"` + strings.Repeat("a", 64) + `"}`),
		"extra field": append(append([]byte{}, valid[:len(valid)-1]...), []byte(`,"local_path":"/volume1/photo"}`)...),
		"missing field": []byte(`{"id":42,"revision":7}`),
		"trailing": append(append([]byte{}, valid...), []byte(` {}`)...),
	}
	for label, payload := range cases {
		if err := makeRequest(payload, ""); err == nil {
			t.Errorf("%s: invalid Owner delete accepted", label)
		}
	}
	for label, change := range map[string]func(map[string]any){
		"invalid revision": func(m map[string]any){ m["revision"] = 0 },
		"path": func(m map[string]any){ m["name"] = "../escape" },
		"invalid scope": func(m map[string]any){ m["owner_scope"] = "other" },
		"invalid type": func(m map[string]any){ m["type"] = "symlink" },
	}{
		t.Run(label, func(t *testing.T) {
			payload := make(map[string]any)
			for k,v := range good { payload[k]=v }
			change(payload)
			body,_ := json.Marshal(payload)
			if err := makeRequest(body, ""); err == nil {
				t.Fatal("invalid Owner delete accepted")
			}
		})
	}
	if err := makeRequest(valid, "?path=/volume1/photo"); err == nil {
		t.Fatal("native NAS path query accepted")
	}
}
