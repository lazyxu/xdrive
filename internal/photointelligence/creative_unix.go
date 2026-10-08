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

const creativeAnalyzerMaxResponseBytes = (CreativeMaxResultBytes*4)/3 + (2 << 20)

type UnixCreativeAnalyzer struct {
	socketPath string
	token      string
	client     *http.Client
}

func NewUnixCreativeAnalyzer(
	socketPath, token string,
	timeout time.Duration,
) (*UnixCreativeAnalyzer, error) {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" {
		return nil, errors.New("creative analyzer socket path is required")
	}
	if !filepath.IsAbs(socketPath) {
		return nil, errors.New("creative analyzer socket path must be absolute")
	}
	if timeout <= 0 {
		timeout = 5 * time.Minute
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
	return &UnixCreativeAnalyzer{
		socketPath: socketPath,
		token:      strings.TrimSpace(token),
		client: &http.Client{
			Transport: transport,
			Timeout:   timeout,
		},
	}, nil
}

func (a *UnixCreativeAnalyzer) Info(
	ctx context.Context,
) (CreativeAnalyzerInfo, error) {
	var out CreativeAnalyzerInfo
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"http://xdrive-photo-creative/v1/creative-info",
		nil,
	)
	if err != nil {
		return out, err
	}
	a.addHeaders(req)
	if err := a.doJSON(req, &out); err != nil {
		return out, err
	}
	if err := ValidateCreativeAnalyzerInfo(out); err != nil {
		return CreativeAnalyzerInfo{}, err
	}
	return out, nil
}

func (a *UnixCreativeAnalyzer) Generate(
	ctx context.Context,
	task CreativeTask,
) (CreativeResult, error) {
	if err := ValidateCreativeTask(task); err != nil {
		return CreativeResult{}, err
	}
	body, err := json.Marshal(task)
	if err != nil {
		return CreativeResult{}, err
	}
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"http://xdrive-photo-creative/v1/creative-generate",
		bytes.NewReader(body),
	)
	if err != nil {
		return CreativeResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	a.addHeaders(req)
	var out CreativeResult
	if err := a.doJSON(req, &out); err != nil {
		return CreativeResult{}, err
	}
	return ValidateCreativeResult(out)
}

func (a *UnixCreativeAnalyzer) addHeaders(req *http.Request) {
	req.Header.Set(
		"X-XDrive-Creative-Protocol",
		fmt.Sprintf("%d", CreativeAnalyzerProtocolVersion),
	)
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}
}

func (a *UnixCreativeAnalyzer) doJSON(
	req *http.Request,
	out any,
) error {
	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("creative analyzer request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(
		resp.Body,
		creativeAnalyzerMaxResponseBytes+1,
	))
	if err != nil {
		return err
	}
	if len(body) > creativeAnalyzerMaxResponseBytes {
		return errors.New("creative analyzer response exceeds size limit")
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		message := strings.TrimSpace(string(body))
		if len(message) > 1000 {
			message = message[:1000]
		}
		if message == "" {
			message = resp.Status
		}
		return fmt.Errorf(
			"creative analyzer returned HTTP %d: %s",
			resp.StatusCode,
			message,
		)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode creative analyzer response: %w", err)
	}
	return nil
}
