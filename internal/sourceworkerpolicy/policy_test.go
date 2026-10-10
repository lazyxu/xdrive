package sourceworkerpolicy

import "testing"

func TestAdminSourceWorkerBoundsAndDefaults(t *testing.T) {
	if !Valid(Defaults()) {
		t.Fatal("code defaults must fit administrator limits")
	}
	for _, invalid := range []Values{
		{ScanIntervalSeconds: 59, PollIntervalSeconds: 60, MaxConcurrency: 2},
		{ScanIntervalSeconds: 7*24*60*60 + 1, PollIntervalSeconds: 60, MaxConcurrency: 2},
		{ScanIntervalSeconds: 3600, PollIntervalSeconds: 9, MaxConcurrency: 2},
		{ScanIntervalSeconds: 3600, PollIntervalSeconds: 3601, MaxConcurrency: 2},
		{ScanIntervalSeconds: 3600, PollIntervalSeconds: 60, MaxConcurrency: 0},
		{ScanIntervalSeconds: 3600, PollIntervalSeconds: 60, MaxConcurrency: 9},
	} {
		if Valid(invalid) {
			t.Fatalf("invalid configuration accepted: %+v", invalid)
		}
	}
}
