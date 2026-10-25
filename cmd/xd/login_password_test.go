package main

import (
	"strings"
	"testing"
)

func TestResolveLoginPassword(t *testing.T) {
	for _, tc := range []struct {
		name           string
		arg, env, data string
		stdin          bool
		want           string
		fail           bool
	}{
		{name: "existing flag", arg: "from-flag", want: "from-flag"},
		{name: "existing env", env: "from-env", want: "from-env"},
		{name: "flag precedence", arg: "from-flag", env: "from-env", want: "from-flag"},
		{name: "stdin line", data: "secret-value\n", stdin: true, want: "secret-value"},
		{name: "stdin no final newline", data: "secret-value", stdin: true, want: "secret-value"},
		{name: "stdin CRLF and spaces preserved", data: " spaces retained \r\n", stdin: true, want: " spaces retained "},
		{name: "no credential", fail: true},
		{name: "stdin empty", data: "\n", stdin: true, fail: true},
		{name: "stdin zero", data: "a\x00b\n", stdin: true, fail: true},
		{name: "stdin too large", data: strings.Repeat("A", maxLoginPasswordBytes+1) + "\n", stdin: true, fail: true},
		{name: "stdin conflicts with argv", arg: "not-allowed", data: "one\n", stdin: true, fail: true},
		{name: "stdin conflicts with env", env: "not-allowed", data: "one\n", stdin: true, fail: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := resolveLoginPassword(tc.arg, tc.env, tc.stdin, strings.NewReader(tc.data))
			if tc.fail {
				if err == nil {
					t.Fatalf("wanted failure, got %q", got)
				}
				if strings.Contains(err.Error(), tc.arg) && tc.arg != "" || strings.Contains(err.Error(), tc.env) && tc.env != "" {
					t.Fatal("error exposed credential")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestResolveLoginPasswordStdinNil(t *testing.T) {
	if _, err := resolveLoginPassword("", "", true, nil); err == nil {
		t.Fatal("nil stdin accepted")
	}
}
