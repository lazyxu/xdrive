package caddyhostidentity

import (
	"strings"
	"testing"
)

func TestPrivateCaddyRouteJSONRejectsDuplicateKeys(t *testing.T) {
	if !privateHasUnambiguousCaddyJSON([]byte(retiredTestRoutes)) {
		t.Fatal("valid Caddy app JSON rejected")
	}
	for _, tt := range []struct {
		name, document string
	}{
		{"duplicate host", `{"apps":{"http":{"servers":{"srv":{"listen":[":443"],"routes":[{"match":[{"host":["former.example.test"],"host":["current.example.test"]}]}]}}}}}`},
		{"duplicate route", `{"apps":{"http":{"servers":{"srv":{"listen":[":443"],"routes":[{"match":[{"host":["former.example.test"]}]}],"routes":[{"match":[{"host":["current.example.test"]}]}]}}}}}`},
		{"duplicate app", `{"apps":{"http":{"servers":{}},"http":{"servers":{"srv":{"listen":[":443"],"routes":[{"match":[{"host":["current.example.test"]}]}]}}}}}`},
		{"duplicate unicode key", `{"host":["former.example.test"],"h\u006fst":["current.example.test"]}`},
		{"unclosed", `{"a":[1}`},
		{"trailing", retiredTestRoutes + "{}"},
		{"over deep", strings.Repeat("[", 50) + "1" + strings.Repeat("]", 50)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if privateHasUnambiguousCaddyJSON([]byte(tt.document)) {
				t.Fatal("ambiguous Caddy JSON accepted")
			}
		})
	}
}
