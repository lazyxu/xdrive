package photointelligence

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

const faceAnalyzerMaxResponseBytes = 8 << 20

type UnixFaceAnalyzer struct {
	socketPath string
	token      string
	client     *http.Client
}

func NewUnixFaceAnalyzer(
	socketPath, token string,
	timeout time.Duration,
) (*UnixFaceAnalyzer, error) {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" {
		return nil, errors.New("face analyzer socket path is required")
	}
	if !filepath.IsAbs(socketPath) {
		return nil, errors.New("face analyzer socket path must be absolute")
	}
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	transport := &http.Transport{
		DialContext: func(
			ctx context.Context,
			network, address string,
		) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", socketPath)
		},
	}
	return &UnixFaceAnalyzer{
		socketPath: socketPath,
		token:      strings.TrimSpace(token),
		client: &http.Client{
			Transport: transport,
			Timeout:   timeout,
		},
	}, nil
}

func (a *UnixFaceAnalyzer) Info(
	ctx context.Context,
) (FaceAnalyzerInfo, error) {
	var out FaceAnalyzerInfo
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"http://xdrive-photo-face/v1/info",
		nil,
	)
	if err != nil {
		return out, err
	}
	a.addHeaders(req)
	if err := a.doJSON(req, &out); err != nil {
		return out, err
	}
	if err := ValidateFaceAnalyzerInfo(out); err != nil {
		return FaceAnalyzerInfo{}, err
	}
	return out, nil
}

func (a *UnixFaceAnalyzer) Analyze(
	ctx context.Context,
	task FaceAnalysisTask,
) ([]FaceObservation, error) {
	if err := ValidateFaceAnalysisTask(task); err != nil {
		return nil, err
	}
	body, err := json.Marshal(task)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://xdrive-photo-face/v1/analyze",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	a.addHeaders(req)

	var response struct {
		Faces []FaceObservation `json:"faces"`
	}
	if err := a.doJSON(req, &response); err != nil {
		return nil, err
	}
	return response.Faces, nil
}

func (a *UnixFaceAnalyzer) addHeaders(req *http.Request) {
	req.Header.Set(
		"X-XDrive-Face-Protocol",
		fmt.Sprintf("%d", FaceAnalyzerProtocolVersion),
	)
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}
}

func (a *UnixFaceAnalyzer) doJSON(
	req *http.Request,
	out any,
) error {
	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("face analyzer request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(
		resp.Body,
		faceAnalyzerMaxResponseBytes+1,
	))
	if err != nil {
		return err
	}
	if len(body) > faceAnalyzerMaxResponseBytes {
		return errors.New("face analyzer response exceeds size limit")
	}
	if resp.StatusCode < http.StatusOK ||
		resp.StatusCode >= http.StatusMultipleChoices {
		message := strings.TrimSpace(string(body))
		if len(message) > 1000 {
			message = message[:1000]
		}
		if message == "" {
			message = resp.Status
		}
		return fmt.Errorf(
			"face analyzer returned HTTP %d: %s",
			resp.StatusCode,
			message,
		)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode face analyzer response: %w", err)
	}
	return nil
}
