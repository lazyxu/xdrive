package client

import (
	"context"
	"errors"
	"os"
	"testing"
)

func TestClassifySourceFailure(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{&APIError{Status: 429}, "rate_limit"},
		{&APIError{Status: 403}, "permission"},
		{&APIError{Status: 409}, "conflict"},
		{os.ErrPermission, "permission"},
		{context.DeadlineExceeded, "network"},
		{errors.New("source changed while hashing"), "file_changed"},
		{errors.New("unexpected"), "other"},
	}
	for _, tc := range cases {
		if got := ClassifySourceFailure(tc.err); got != tc.want {
			t.Errorf("ClassifySourceFailure(%v)=%q want=%q", tc.err, got, tc.want)
		}
	}
}
