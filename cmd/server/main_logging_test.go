package main

import (
	"os"
	"testing"
)

func TestServerCommandLogsDoNotPolluteJSONStdout(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want *os.File
	}{
		{name: "long-running API", args: []string{"xdrive-server"}, want: os.Stdout},
		{name: "storage full JSON", args: []string{"xdrive-server", "storage", "verify", "--json"}, want: os.Stderr},
		{name: "storage summary JSON", args: []string{"xdrive-server", "storage", "verify", "--summary-json"}, want: os.Stderr},
		{name: "maintenance worker", args: []string{"xdrive-server", "worker"}, want: os.Stderr},
		{name: "backup audit", args: []string{"xdrive-server", "audit"}, want: os.Stderr},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := serverLogOutput(tc.args); got != tc.want {
				t.Fatalf("log output for %q = %v, want %v", tc.args, got, tc.want)
			}
		})
	}
}
