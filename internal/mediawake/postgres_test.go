package mediawake

import "testing"

func TestParseOwnerID(t *testing.T) {
	for _, test := range []struct {
		raw  string
		want uint64
		ok   bool
	}{
		{raw: "42", want: 42, ok: true},
		{raw: " 7 ", want: 7, ok: true},
		{raw: "", ok: false},
		{raw: "0", ok: false},
		{raw: "-1", ok: false},
		{raw: "user", ok: false},
	} {
		got, err := parseOwnerID(test.raw)
		if test.ok {
			if err != nil || got != test.want {
				t.Fatalf("parseOwnerID(%q)=(%d,%v), want (%d,nil)", test.raw, got, err, test.want)
			}
			continue
		}
		if err == nil {
			t.Fatalf("parseOwnerID(%q) unexpectedly succeeded with %d", test.raw, got)
		}
	}
}
