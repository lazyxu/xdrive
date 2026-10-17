package api

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
)

func TestBaiduGeoconvPrivateForwardRejectsMissingProofAndSecret(t *testing.T) {
	ctx := context.Background()
	permitCalls, secretCalls, forwardCalls := 0, 0, 0
	permit := func(context.Context, uint64) error {
		permitCalls++
		return nil
	}
	secret := func(context.Context, uint64) (string, error) {
		secretCalls++
		return "offline-synthetic-server-ak", nil
	}
	forward := func(context.Context, string, []baidumapjsapi.WGS84Coordinate) ([]baidumapjsapi.BD09Coordinate, error) {
		forwardCalls++
		return []baidumapjsapi.BD09Coordinate{{Longitude: 0.006, Latitude: 0.006}}, nil
	}
	for _, item := range []struct {
		owner  uint64
		permit baiduGeoconvAccountPermit
		ak     baiduGeoconvPrivateServerAK
		send   baiduGeoconvPrivateForwardSend
	}{
		{owner: 0, permit: permit, ak: secret, send: forward},
		{owner: uint64(1) << 63, permit: permit, ak: secret, send: forward},
		{owner: 1, ak: secret, send: forward},
		{owner: 1, permit: permit, send: forward},
		{owner: 1, permit: permit, ak: secret},
	} {
		if converter, err := baiduGeoconvPrivateForwardConverter(
			item.owner, item.permit, item.ak, item.send,
		); converter != nil || !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("unsafe private forward callback accepted")
		}
	}
	deny := func(context.Context, uint64) error {
		return errors.New("licence revoked")
	}
	converter, err := baiduGeoconvPrivateForwardConverter(91, deny, secret, forward)
	if err != nil {
		t.Fatal(err)
	}
	point := baidumapjsapi.WGS84Coordinate{Longitude: 0, Latitude: 0}
	if _, err := converter(ctx, point); !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
		t.Fatal("missing account entitlement admitted")
	}
	if secretCalls != 0 || forwardCalls != 0 {
		t.Fatal("unlicensed account could read Server AK or export GPS")
	}

	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	converter, err = baiduGeoconvPrivateForwardConverter(91, permit, secret, forward)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := converter(cancelled, point); !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
		t.Fatal("canceled conversion admitted")
	}
	for _, p := range []baidumapjsapi.WGS84Coordinate{
		{Longitude: math.NaN()}, {Latitude: math.Inf(1)}, {Longitude: 181}, {Latitude: -91},
	} {
		if _, err := converter(ctx, p); !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("invalid source GPS admitted")
		}
	}
	if permitCalls != 0 || secretCalls != 0 || forwardCalls != 0 {
		t.Fatal("invalid or canceled source invoked a provider/credential callback")
	}

	for _, ak := range []string{"", " contains-space", "line\nfeed", strings.Repeat("x", 513)} {
		bad := func(context.Context, uint64) (string, error) { return ak, nil }
		converter, err = baiduGeoconvPrivateForwardConverter(91, permit, bad, forward)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := converter(ctx, point); !errors.Is(err, errBaiduGeoconvDispatchUnavailable) {
			t.Fatal("invalid Server AK reached forward sender")
		}
	}
	if forwardCalls != 0 {
		t.Fatal("invalid Server credentials were sent upstream")
	}
}

func TestBaiduGeoconvPrivateForwardRejectsUntrustedProviderResults(t *testing.T) {
	ctx := context.Background()
	key := "offline-private-AK-must-not-appear"
	point := baidumapjsapi.WGS84Coordinate{Longitude: 0, Latitude: 0}
	permit := func(context.Context, uint64) error { return nil }
	secret := func(context.Context, uint64) (string, error) { return key, nil }
	for _, tc := range []struct {
		points []baidumapjsapi.BD09Coordinate
		err    error
	}{
		{points: nil},
		{points: []baidumapjsapi.BD09Coordinate{{}, {}}},
		{points: []baidumapjsapi.BD09Coordinate{{Latitude: math.NaN()}}},
		{points: []baidumapjsapi.BD09Coordinate{{Longitude: 181}}},
		{points: nil, err: errors.New("provider response contained " + key)},
	} {
		forward := func(context.Context, string, []baidumapjsapi.WGS84Coordinate) ([]baidumapjsapi.BD09Coordinate, error) {
			return tc.points, tc.err
		}
		converter, err := baiduGeoconvPrivateForwardConverter(91, permit, secret, forward)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := converter(ctx, point); !errors.Is(err, errBaiduGeoconvDispatchUnavailable) ||
			strings.Contains(err.Error(), key) {
			t.Fatal("invalid or secret-bearing provider error escaped")
		}
	}
	var seen int
	forward := func(ctx context.Context, ak string, input []baidumapjsapi.WGS84Coordinate) ([]baidumapjsapi.BD09Coordinate, error) {
		seen++
		if ctx.Err() != nil || ak != key || len(input) != 1 || input[0] != point {
			t.Fatal("wrong Server-only exact point/AK contract")
		}
		return []baidumapjsapi.BD09Coordinate{{Longitude: 0.006, Latitude: 0.006}}, nil
	}
	converter, err := baiduGeoconvPrivateForwardConverter(91, permit, secret, forward)
	if err != nil {
		t.Fatal(err)
	}
	out, err := converter(ctx, point)
	if err != nil || seen != 1 || out.Longitude != 0.006 || out.Latitude != 0.006 {
		t.Fatal("offline-only exact forward result not returned")
	}
}
