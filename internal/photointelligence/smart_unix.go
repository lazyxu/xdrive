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

const smartAnalyzerMaxResponseBytes = 2 << 20

type UnixSmartAnalyzer struct {
	socketPath string
	token      string
	client     *http.Client
}

func NewUnixSmartAnalyzer(
	socketPath, token string,
	timeout time.Duration,
) (*UnixSmartAnalyzer, error) {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" {
		return nil, errors.New("smart analyzer socket path is required")
	}
	if !filepath.IsAbs(socketPath) {
		return nil, errors.New("smart analyzer socket path must be absolute")
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
	return &UnixSmartAnalyzer{
		socketPath: socketPath,
		token:      strings.TrimSpace(token),
		client: &http.Client{
			Transport: transport,
			Timeout:   timeout,
		},
	}, nil
}

func (a *UnixSmartAnalyzer) Info(
	ctx context.Context,
) (SmartAnalyzerInfo, error) {
	var out SmartAnalyzerInfo
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"http://xdrive-photo-smart/v1/smart-info",
		nil,
	)
	if err != nil {
		return out, err
	}
	a.addHeaders(req)
	if err := a.doJSON(req, &out); err != nil {
		return out, err
	}
	if err := ValidateSmartAnalyzerInfo(out); err != nil {
		return SmartAnalyzerInfo{}, err
	}
	return out, nil
}

func (a *UnixSmartAnalyzer) Analyze(
	ctx context.Context,
	task SmartAnalysisTask,
) (SmartAnalysisResult, error) {
	if err := ValidateSmartAnalysisTask(task); err != nil {
		return SmartAnalysisResult{}, err
	}
	body, err := json.Marshal(task)
	if err != nil {
		return SmartAnalysisResult{}, err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://xdrive-photo-smart/v1/smart-analyze",
		bytes.NewReader(body),
	)
	if err != nil {
		return SmartAnalysisResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	a.addHeaders(req)

	var response SmartAnalysisResult
	if err := a.doJSON(req, &response); err != nil {
		return SmartAnalysisResult{}, err
	}
	return ValidateSmartAnalysisResult(response)
}

func (a *UnixSmartAnalyzer) addHeaders(req *http.Request) {
	req.Header.Set(
		"X-XDrive-Smart-Protocol",
		fmt.Sprintf("%d", SmartAnalyzerProtocolVersion),
	)
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}
}

func (a *UnixSmartAnalyzer) doJSON(
	req *http.Request,
	out any,
) error {
	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("smart analyzer request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(
		resp.Body,
		smartAnalyzerMaxResponseBytes+1,
	))
	if err != nil {
		return err
	}
	if len(body) > smartAnalyzerMaxResponseBytes {
		return errors.New("smart analyzer response exceeds size limit")
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
			"smart analyzer returned HTTP %d: %s",
			resp.StatusCode,
			message,
		)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode smart analyzer response: %w", err)
	}
	return nil
}
