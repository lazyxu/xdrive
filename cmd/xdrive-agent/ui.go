package main

import "context"

type controlUI interface {
	Open() error
	OpenConflicts() error
}

func startAgentUI(ctx context.Context, cancel context.CancelFunc, ctrl *agentController) error {
	control, err := startControlUI(ctx, ctrl)
	if err != nil {
		ctrl.setLastError("本机控制页启动失败: " + err.Error())
	}
	return runDesktopUI(ctx, cancel, ctrl, control)
}
