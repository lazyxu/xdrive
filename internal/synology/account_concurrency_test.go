package synology

import "testing"

func TestAccountConcurrencyKeyNormalizesOriginAndIgnoresPassword(t *testing.T) {
	first := AccountConcurrencyKey(Credential{
		BaseURL:  "HTTPS://NAS.EXAMPLE.COM/",
		Username: "alice",
		Password: "old-secret",
	})
	second := AccountConcurrencyKey(Credential{
		BaseURL:  "https://nas.example.com",
		Username: "alice",
		Password: "new-secret",
	})
	if first == "" || first != second {
		t.Fatalf("same DSM account must share a non-empty concurrency key: first=%q second=%q", first, second)
	}
	if got := AccountConcurrencyKey(Credential{BaseURL: "https://nas.example.com", Username: "bob"}); got == first {
		t.Fatal("different DSM usernames must not share a concurrency key")
	}
	if got := AccountConcurrencyKey(Credential{BaseURL: "https://other.example.com", Username: "alice"}); got == first {
		t.Fatal("different DSM origins must not share a concurrency key")
	}
}
