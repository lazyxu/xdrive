package main

import (
	"bufio"
	"fmt"
	"io"
	"strings"
)

const maxLoginPasswordBytes = 4096

// resolveLoginPassword keeps NAS/headless credentials out of command-line
// arguments and shell environment when --password-stdin is used.
func resolveLoginPassword(flagPassword, envPassword string, fromStdin bool, input io.Reader) (string, error) {
	if !fromStdin {
		if flagPassword != "" {
			return flagPassword, nil
		}
		if envPassword != "" {
			return envPassword, nil
		}
		return "", fmt.Errorf("--password, XD_PASSWORD, or --password-stdin is required")
	}
	if flagPassword != "" || envPassword != "" {
		return "", fmt.Errorf("--password-stdin cannot be combined with --password or XD_PASSWORD")
	}
	if input == nil {
		return "", fmt.Errorf("--password-stdin requires a readable stdin")
	}
	reader := bufio.NewReader(io.LimitReader(input, maxLoginPasswordBytes+2))
	line, err := reader.ReadString('\n')
	if err != nil && err != io.EOF {
		return "", fmt.Errorf("read --password-stdin: %w", err)
	}
	line = strings.TrimSuffix(line, "\n")
	line = strings.TrimSuffix(line, "\r")
	if len(line) == 0 || len(line) > maxLoginPasswordBytes || strings.ContainsAny(line, "\r\n\x00") {
		return "", fmt.Errorf("--password-stdin requires one non-empty password line (max %d bytes)", maxLoginPasswordBytes)
	}
	return line, nil
}
