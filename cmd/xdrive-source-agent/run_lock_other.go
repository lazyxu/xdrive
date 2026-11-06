//go:build !linux

package main

import "fmt"

// DSM source-agent execution requires the Linux process-lock contract.
func lockSourceAgentRun(string) (func(), bool, error) {
	return nil, false, fmt.Errorf("DSM source-agent run is supported only on Linux")
}
