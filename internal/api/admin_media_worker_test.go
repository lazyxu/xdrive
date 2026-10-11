package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/mediaworker"
)

func adminMediaWorkerState(t *testing.T, server *Server) (serviceDependency, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services", nil)
	server.adminServiceDependencies(ctx)
	var result serviceDependenciesSnapshot
	if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &result) != nil {
		t.Fatalf("admin services response invalid: %d %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("media runtime state response was cacheable")
	}
	for _, item := range result.Services {
		if item.ID == "media-worker" {
			return item, recorder.Body.String()
		}
	}
	t.Fatal("media-worker service row missing")
	return serviceDependency{}, ""
}

func TestAdminMediaWorkerRuntimeIsProbedButJobsAreNotClaimed(t *testing.T) {
	disabled, _ := adminMediaWorkerState(t, &Server{})
	if disabled.Status != "disabled" {
		t.Fatalf("default media runtime incorrectly ready: %+v", disabled)
	}
	unavailable, _ := adminMediaWorkerState(t, &Server{MediaWorkerConfigured: true})
	if unavailable.Status != "unavailable" {
		t.Fatalf("configured but missing worker wrongly ready: %+v", unavailable)
	}
	invalid, _ := adminMediaWorkerState(t, &Server{
		MediaWorkerConfigured: true,
		MediaWorkerProbe: mediaworker.ProbeFunc(func(context.Context) (mediaworker.Info, error) {
			return mediaworker.Info{ProtocolVersion: 1, Ready: true}, nil
		}),
	})
	if invalid.Status != "unavailable" {
		t.Fatalf("unverified ffmpeg/ffprobe was advertised ready: %+v", invalid)
	}
	down, payload := adminMediaWorkerState(t, &Server{
		MediaWorkerConfigured: true,
		MediaWorkerProbe: mediaworker.ProbeFunc(func(context.Context) (mediaworker.Info, error) {
			return mediaworker.Info{}, errors.New("secret socket /private/worker.sock")
		}),
	})
	if down.Status != "unavailable" || strings.Contains(payload, "/private/worker.sock") {
		t.Fatal("failed worker health probe leaked operator socket/error")
	}
	ok, body := adminMediaWorkerState(t, &Server{
		MediaWorkerConfigured: true,
		MediaWorkerProbe: mediaworker.ProbeFunc(func(context.Context) (mediaworker.Info, error) {
			return mediaworker.Info{ProtocolVersion: 1, Ready: true,
				FFmpegVersion: "ffmpeg version 5.1.6", FFprobeVersion: "ffprobe version 5.1.6"}, nil
		}),
	})
	if ok.Status != "ready" || ok.Version != "ffmpeg version 5.1.6" ||
		!strings.Contains(ok.Detail, "队列尚未接入") ||
		ok.ConfigMode != "deployment" || ok.ApplyMode != "controlled-restart" ||
		strings.Contains(body, "XD_MEDIA_WORKER_SOCKET") {
		t.Fatalf("media worker was not truthfully probed: %+v", ok)
	}
}
