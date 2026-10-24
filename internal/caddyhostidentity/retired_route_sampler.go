package caddyhostidentity

import (
	"context"
	"io"
	"os/exec"
	"runtime"
	"time"
)

const privateCaddyLiveConfigBodyScript = "wget -q -T 2 -O - http://127.0.0.1:2019/config/"

type privateLimitedRouteBody struct{ bytes []byte }

func (o *privateLimitedRouteBody) Write(b []byte) (int, error) {
	if len(b) > maxHostPrivateRouteJSON-len(o.bytes) {
		return 0, errUntrusted
	}
	o.bytes = append(o.bytes, b...)
	return len(b), nil
}

// Fixed, Linux Host-only, bounded read of the actual Caddy admin /config/ JSON.
// No caller URL, configurable Docker arguments, HTTP/Agent endpoint or generic
// Docker API. The raw config can contain secrets and MUST remain private.
func runPrivateCaddyRouteSample(ctx context.Context) ([]byte, error) {
	if runtime.GOOS != "linux" || ctx == nil || ctx.Err() != nil {
		return nil, errUntrusted
	}
	bounded, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, privateDockerExecutable,
		"exec", "xdrive-caddy", "/bin/sh", "-ec", privateCaddyLiveConfigBodyScript)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LC_ALL=C", "HOME=/nonexistent"}
	cmd.Stdin = nil
	cmd.Stderr = io.Discard
	cmd.WaitDelay = time.Second
	result := &privateLimitedRouteBody{}
	cmd.Stdout = result
	defer clear(result.bytes)
	if err := cmd.Run(); err != nil || bounded.Err() != nil || len(result.bytes) == 0 || len(result.bytes) > maxHostPrivateRouteJSON {
		return nil, errUntrusted
	}
	return append([]byte(nil), result.bytes...), nil
}
