//go:build linux

package secretstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

func Save(configDir, sessionID, label string, creds Credentials) error {
	if err := validateSessionID(sessionID); err != nil {
		return err
	}
	data, err := marshalCredentials(creds)
	if err != nil {
		return err
	}
	if secretServiceEnabled() {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		cmd := exec.CommandContext(ctx, "secret-tool", "store", "--label="+label, "service", "xdrive", "session", sessionID)
		cmd.Stdin = bytes.NewReader(data)
		err := cmd.Run()
		cancel()
		if err == nil {
			_ = deleteFallback(configDir, sessionID)
			return nil
		}
	}
	return saveFallback(configDir, sessionID, creds)
}

func Load(configDir, sessionID string) (Credentials, error) {
	if err := validateSessionID(sessionID); err != nil {
		return Credentials{}, err
	}
	if secretServiceEnabled() {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		cmd := exec.CommandContext(ctx, "secret-tool", "lookup", "service", "xdrive", "session", sessionID)
		out, err := cmd.Output()
		cancel()
		if err == nil && len(bytes.TrimSpace(out)) != 0 {
			return unmarshalCredentials(bytes.TrimSpace(out))
		}
	}
	return loadFallback(configDir, sessionID)
}

func Delete(configDir, sessionID string) error {
	if err := validateSessionID(sessionID); err != nil {
		return err
	}
	var errs []error
	if secretServiceEnabled() {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		cmd := exec.CommandContext(ctx, "secret-tool", "clear", "service", "xdrive", "session", sessionID)
		if err := cmd.Run(); err != nil {
			var exitErr *exec.ExitError
			if !errors.As(err, &exitErr) {
				errs = append(errs, fmt.Errorf("clear Secret Service credential: %w", err))
			}
		}
		cancel()
	}
	if err := deleteFallback(configDir, sessionID); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

func Backend(configDir, sessionID string) string {
	if secretServiceEnabled() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		cmd := exec.CommandContext(ctx, "secret-tool", "lookup", "service", "xdrive", "session", sessionID)
		out, err := cmd.Output()
		cancel()
		if err == nil && strings.TrimSpace(string(out)) != "" {
			return "secret-service"
		}
	}
	if _, err := loadFallback(configDir, sessionID); err == nil {
		return "file-0600"
	}
	return "unavailable"
}

func secretServiceEnabled() bool {
	if strings.TrimSpace(os.Getenv("XD_DISABLE_SECRET_SERVICE")) == "1" {
		return false
	}
	_, err := exec.LookPath("secret-tool")
	return err == nil
}
