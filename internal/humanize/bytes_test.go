package humanize

import "testing"

func TestBytes(t *testing.T) {
	tests := []struct {
		name  string
		value float64
		want  string
	}{
		{name: "zero", value: 0, want: "0 B"},
		{name: "bytes", value: 1023, want: "1023 B"},
		{name: "one kibibyte", value: 1024, want: "1.0 KiB"},
		{name: "fractional kibibytes", value: 1536, want: "1.5 KiB"},
		{name: "mebibytes", value: 10 * 1024 * 1024, want: "10.0 MiB"},
		{name: "tebibytes", value: 5.5 * 1024 * 1024 * 1024 * 1024, want: "5.5 TiB"},
		{name: "negative clamps to zero", value: -1, want: "0 B"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Bytes(tt.value); got != tt.want {
				t.Fatalf("Bytes(%v)=%q want %q", tt.value, got, tt.want)
			}
		})
	}
}
