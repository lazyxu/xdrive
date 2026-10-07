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

const semanticAnalyzerMaxResponseBytes = 256 << 10

type UnixSemanticAnalyzer struct {
	socketPath string
	token      string
	client     *http.Client
}

func NewUnixSemanticAnalyzer(
	socketPath, token string,
	timeout time.Duration,
) (*UnixSemanticAnalyzer, error) {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" {
		return nil, errors.New("semantic analyzer socket path is required")
	}
	if !filepath.IsAbs(socketPath) {
		return nil, errors.New("semantic analyzer socket path must be absolute")
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
	return &UnixSemanticAnalyzer{
		socketPath: socketPath,
		token:      strings.TrimSpace(token),
		client: &http.Client{
			Transport: transport,
			Timeout:   timeout,
		},
	}, nil
}

func (a *UnixSemanticAnalyzer) Info(
	ctx context.Context,
) (SemanticAnalyzerInfo, error) {
	var out SemanticAnalyzerInfo
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		"http://xdrive-photo-semantic/v1/semantic-info",
		nil,
	)
	if err != nil {
		return out, err
	}
	a.addHeaders(req)
	if err := a.doJSON(req, &out); err != nil {
		return out, err
	}
	if err := ValidateSemanticAnalyzerInfo(out); err != nil {
		return SemanticAnalyzerInfo{}, err
	}
	return out, nil
}

func (a *UnixSemanticAnalyzer) EmbedImage(
	ctx context.Context,
	task SemanticImageTask,
) (SemanticEmbedding, error) {
	if err := ValidateSemanticImageTask(task); err != nil {
		return SemanticEmbedding{}, err
	}
	body, err := json.Marshal(task)
	if err != nil {
		return SemanticEmbedding{}, err
	}
	var out SemanticEmbedding
	if err := a.postJSON(
		ctx,
		"http://xdrive-photo-semantic/v1/semantic-image",
		body,
		&out,
	); err != nil {
		return SemanticEmbedding{}, err
	}
	return out, nil
}

func (a *UnixSemanticAnalyzer) EmbedText(
	ctx context.Context,
	value string,
) (SemanticEmbedding, error) {
	value, err := NormalizeSemanticSearchText(value)
	if err != nil {
		return SemanticEmbedding{}, err
	}
	body, err := json.Marshal(map[string]string{"text": value})
	if err != nil {
		return SemanticEmbedding{}, err
	}
	var out SemanticEmbedding
	if err := a.postJSON(
		ctx,
		"http://xdrive-photo-semantic/v1/semantic-text",
		body,
		&out,
	); err != nil {
		return SemanticEmbedding{}, err
	}
	return out, nil
}

func (a *UnixSemanticAnalyzer) postJSON(
	ctx context.Context,
	target string,
	body []byte,
	out any,
) error {
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		target,
		bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	a.addHeaders(req)
	return a.doJSON(req, out)
}

func (a *UnixSemanticAnalyzer) addHeaders(req *http.Request) {
	req.Header.Set(
		"X-XDrive-Semantic-Protocol",
		fmt.Sprintf("%d", SemanticAnalyzerProtocolVersion),
	)
	if a.token != "" {
		req.Header.Set("Authorization", "Bearer "+a.token)
	}
}

func (a *UnixSemanticAnalyzer) doJSON(
	req *http.Request,
	out any,
) error {
	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("semantic analyzer request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(
		resp.Body,
		semanticAnalyzerMaxResponseBytes+1,
	))
	if err != nil {
		return err
	}
	if len(body) > semanticAnalyzerMaxResponseBytes {
		return errors.New("semantic analyzer response exceeds size limit")
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
			"semantic analyzer returned HTTP %d: %s",
			resp.StatusCode,
			message,
		)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode semantic analyzer response: %w", err)
	}
	return nil
}
