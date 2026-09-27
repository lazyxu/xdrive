package yikeworker

import (
	"errors"
	"fmt"
	"testing"

	"github.com/lazyxu/xdrive/internal/yike"
)

func TestSourceErrorMessageClassifiesYikeFailures(t *testing.T) {
	tests := []struct {
		err  error
		want string
	}{
		{fmt.Errorf("wrapped: %w", yike.ErrAuthentication), "一刻相册登录已失效，请更新 Cookie"},
		{fmt.Errorf("wrapped: %w", yike.ErrRateLimited), "一刻相册请求过于频繁，请稍后重试"},
		{fmt.Errorf("wrapped: %w", yike.ErrUnavailable), "一刻相册服务暂时不可用，请稍后重试"},
		{errors.New("other failure"), "other failure"},
	}
	for _, tt := range tests {
		if got := sourceErrorMessage(tt.err); got != tt.want {
			t.Fatalf("sourceErrorMessage(%v)=%q want %q", tt.err, got, tt.want)
		}
	}
}
