package main

import "strings"

type trayStateVisual struct {
	Key string
	Tip string
}

func classifyTrayState(s agentSnapshot) trayStateVisual {
	switch {
	case s.HasConflict:
		return trayStateVisual{Key: "conflict", Tip: "xDrive · 存在冲突"}
	case s.Paused:
		return trayStateVisual{Key: "paused", Tip: "xDrive · 已暂停"}
	case !s.Configured || s.AuthStatus == "未登录":
		return trayStateVisual{Key: "offline", Tip: "xDrive · 未登录"}
	case s.AuthStatus != "已登录" ||
		strings.Contains(s.SyncStatus, "失败") ||
		strings.Contains(s.SyncStatus, "不可用") ||
		strings.Contains(s.SyncStatus, "错误"):
		return trayStateVisual{Key: "offline", Tip: "xDrive · 离线"}
	case s.SyncStatus == "正在同步" ||
		strings.Contains(s.SyncStatus, "启动") ||
		strings.Contains(s.SyncStatus, "恢复"):
		return trayStateVisual{Key: "syncing", Tip: "xDrive · 同步中"}
	default:
		return trayStateVisual{Key: "normal", Tip: "xDrive · 正常"}
	}
}
