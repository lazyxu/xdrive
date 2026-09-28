package api

import "testing"

func TestEffectiveAvailableBytes(t *testing.T) {
	tests := []struct {
		name  string
		quota int64
		used  int64
		disk  int64
		want  int64
	}{
		{name: "unlimited follows disk", quota: 0, used: 900, disk: 500, want: 500},
		{name: "quota remaining wins", quota: 1000, used: 400, disk: 2000, want: 600},
		{name: "disk remaining wins", quota: 1000, used: 400, disk: 250, want: 250},
		{name: "over quota is zero", quota: 1000, used: 1200, disk: 500, want: 0},
		{name: "negative disk clamps", quota: 0, used: 0, disk: -1, want: 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := effectiveAvailableBytes(tc.quota, tc.used, tc.disk); got != tc.want {
				t.Fatalf("effective available=%d want=%d", got, tc.want)
			}
		})
	}
}
