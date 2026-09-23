package main

import "testing"

func TestClassifyTrayState(t *testing.T) {
	tests := []struct {
		name string
		s    agentSnapshot
		want string
	}{
		{name: "normal", s: agentSnapshot{Configured: true, AuthStatus: "已登录", SyncStatus: "同步正常"}, want: "normal"},
		{name: "syncing", s: agentSnapshot{Configured: true, AuthStatus: "已登录", SyncStatus: "正在同步"}, want: "syncing"},
		{name: "starting", s: agentSnapshot{Configured: true, AuthStatus: "已登录", SyncStatus: "正在启动同步"}, want: "syncing"},
		{name: "paused", s: agentSnapshot{Configured: true, AuthStatus: "已登录", SyncStatus: "已暂停", Paused: true}, want: "paused"},
		{name: "offline-not-logged-in", s: agentSnapshot{AuthStatus: "未登录", SyncStatus: "等待登录"}, want: "offline"},
		{name: "offline-network", s: agentSnapshot{Configured: true, AuthStatus: "已登录", SyncStatus: "网络暂不可用"}, want: "offline"},
		{name: "offline-auth", s: agentSnapshot{Configured: true, AuthStatus: "登录已过期", SyncStatus: "需要重新登录"}, want: "offline"},
		{name: "conflict-wins-over-pause", s: agentSnapshot{Configured: true, AuthStatus: "已登录", SyncStatus: "存在冲突副本", Paused: true, HasConflict: true}, want: "conflict"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := classifyTrayState(tt.s).Key; got != tt.want {
				t.Fatalf("classifyTrayState() = %q, want %q", got, tt.want)
			}
		})
	}
}
