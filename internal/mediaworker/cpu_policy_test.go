package mediaworker

import "testing"

func TestCPULimitPolicyBounds(t *testing.T) {
	for _, value := range []int{250, 500, 750, 1000, 1250, 2000, 4000} {
		if !ValidCPUMilli(value) {
			t.Errorf("rejected valid CPU quota %d mCPU", value)
		}
	}
	for _, value := range []int{-1, 0, 1, 249, 251, 749, 999, 4001, 4250, 1 << 30} {
		if ValidCPUMilli(value) {
			t.Errorf("accepted invalid CPU quota %d mCPU", value)
		}
	}
	if !ValidCPUMilli(DefaultCPUMilli) {
		t.Fatal("default CPU quota invalid")
	}
}
