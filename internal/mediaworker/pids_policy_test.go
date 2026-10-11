package mediaworker

import "testing"

func TestPIDsLimitPolicyBounds(t *testing.T) {
	for _, value := range []int{64, 96, 128, 160, 256, 512, 1024} {
		if !ValidPIDsLimit(value) {
			t.Errorf("rejected valid PID limit %d", value)
		}
	}
	for _, value := range []int{-1, 0, 1, 32, 63, 65, 129, 511, 1025, 4096, 1 << 30} {
		if ValidPIDsLimit(value) {
			t.Errorf("accepted invalid PID limit %d", value)
		}
	}
	if !ValidPIDsLimit(DefaultPIDsLimit) {
		t.Fatal("default PID limit invalid")
	}
}
