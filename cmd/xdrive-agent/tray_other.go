//go:build !windows

package main

import "context"

func runDesktopUI(ctx context.Context, _ context.CancelFunc, _ *agentController, _ controlUI) error {
	<-ctx.Done()
	return nil
}

func startControlUI(context.Context, *agentController) (controlUI, error) {
	return nil, nil
}
