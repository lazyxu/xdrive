package mediaworker

import "testing"

func TestMemoryLimitPolicyBounds(t *testing.T) {
	for _, value := range []int{256, 384, 768, 1024, 2048, 4096} {
		if !ValidMemoryMiB(value) {
			t.Errorf("rejected valid memory limit %d MiB", value)
		}
	}
	for _, value := range []int{-256, 0, 1, 128, 255, 257, 767, 1000, 4097, 4224, 1 << 30} {
		if ValidMemoryMiB(value) {
			t.Errorf("accepted invalid memory limit %d MiB", value)
		}
	}
	if !ValidMemoryMiB(DefaultMemoryMiB) {
		t.Fatal("default memory limit is invalid")
	}
}
