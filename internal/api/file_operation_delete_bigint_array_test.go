package api

import "testing"

func TestFileOperationDeleteIDArrayLiteral(t *testing.T) {
	literal, err := fileOperationDeleteIDArrayLiteral([]uint64{1, 22, 333})
	if err != nil || literal != "{1,22,333}" {
		t.Fatalf("unexpected PostgreSQL array argument: literal=%q err=%v", literal, err)
	}
	literal, err = fileOperationDeleteIDArrayLiteral(nil)
	if err != nil || literal != "{}" {
		t.Fatalf("empty array literal=%q err=%v", literal, err)
	}
	if _, err = fileOperationDeleteIDArrayLiteral([]uint64{1 << 63}); err == nil {
		t.Fatal("out-of-range PostgreSQL bigint ID must fail")
	}
}
