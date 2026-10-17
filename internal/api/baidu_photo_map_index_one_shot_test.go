package api

import (
	"context"
	"errors"
	"testing"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
)

func TestBaiduPhotoMapOneShotDemandFailsClosedWithoutTrust(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	permit := func(context.Context, uint64) error {
		t.Fatal("untrusted one-shot attempt reached account permission")
		return nil
	}
	ak := func(context.Context, uint64) (string, error) {
		t.Fatal("untrusted one-shot attempt read an AK")
		return "", nil
	}
	forward := func(context.Context, string, []baidumapjsapi.WGS84Coordinate) (
		[]baidumapjsapi.BD09Coordinate, error,
	) {
		t.Fatal("untrusted one-shot attempt sent a GPS point")
		return nil, nil
	}
	if id, err := selectBaiduPhotoMapIndexDemand(nil, nil, 1); id != 0 ||
		!errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
		t.Fatal("nil context admitted")
	}
	if id, err := selectBaiduPhotoMapIndexDemand(ctx, nil, 1); id != 0 ||
		!errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
		t.Fatal("canceled context admitted")
	}
	if id, err := selectBaiduPhotoMapIndexDemand(context.Background(), nil, 1); id != 0 ||
		!errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
		t.Fatal("missing database admitted")
	}
	if err := executeOneBaiduPhotoMapIndexOwnerDemand(context.Background(), nil, 1, permit, ak); err == nil {
		t.Fatal("missing database dispatched")
	}
	if err := executeOneBaiduPhotoMapIndexWithTrustedForward(ctx, nil, 1, permit, ak, forward); err == nil {
		t.Fatal("canceled demand dispatched")
	}
	if err := executeOneBaiduPhotoMapIndexWithTrustedForward(context.Background(), nil, 0, permit, ak, forward); err == nil {
		t.Fatal("zero owner dispatched")
	}
	if err := executeOneBaiduPhotoMapIndexWithTrustedForward(context.Background(), nil, 1, nil, ak, forward); err == nil {
		t.Fatal("missing account permit dispatched")
	}
	if err := executeOneBaiduPhotoMapIndexWithTrustedForward(context.Background(), nil, 1, permit, nil, forward); err == nil {
		t.Fatal("missing Server AK resolver dispatched")
	}
	if err := executeOneBaiduPhotoMapIndexWithTrustedForward(context.Background(), nil, 1, permit, ak, nil); err == nil {
		t.Fatal("missing official sender dispatched")
	}
}
