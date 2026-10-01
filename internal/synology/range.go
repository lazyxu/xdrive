package synology

import (
	"fmt"
	"strconv"
	"strings"
)

func validateResumeContentRange(value string, offset int64) error {
	if offset <= 0 {
		return nil
	}
	value = strings.TrimSpace(value)
	unit, rest, ok := strings.Cut(value, " ")
	if !ok || !strings.EqualFold(unit, "bytes") {
		return fmt.Errorf("%w: partial download has invalid Content-Range %q", ErrUnavailable, value)
	}
	span, _, ok := strings.Cut(strings.TrimSpace(rest), "/")
	if !ok {
		return fmt.Errorf("%w: partial download has invalid Content-Range %q", ErrUnavailable, value)
	}
	startText, endText, ok := strings.Cut(strings.TrimSpace(span), "-")
	if !ok || strings.TrimSpace(endText) == "" {
		return fmt.Errorf("%w: partial download has invalid Content-Range %q", ErrUnavailable, value)
	}
	start, err := strconv.ParseInt(strings.TrimSpace(startText), 10, 64)
	if err != nil || start != offset {
		return fmt.Errorf("%w: partial download Content-Range %q does not start at offset %d", ErrUnavailable, value, offset)
	}
	return nil
}
