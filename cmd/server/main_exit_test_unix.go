//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

func detachControllingTTY(command *exec.Cmd) {
	if command == nil {
		return
	}
	if command.SysProcAttr == nil {
		command.SysProcAttr = &syscall.SysProcAttr{}
	}
	command.SysProcAttr.Setsid = true
}
