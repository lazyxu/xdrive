//go:build !linux && !windows

package main

// Native folder backup executes only on the owning Windows/Linux Agent.
func (c *agentController) runLocalPushAutoScheduler() {}
