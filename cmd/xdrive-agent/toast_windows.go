//go:build windows

package main

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"html"
	"os/exec"
	"strings"
	"syscall"
	"unicode/utf16"
)

const xDriveAppUserModelID = "xDrive.Client"

func showWindowsToast(title, body string) error {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(body)
	if title == "" && body == "" {
		return nil
	}

	xml := "<toast><visual><binding template=\"ToastGeneric\">"
	if title != "" {
		xml += "<text>" + html.EscapeString(title) + "</text>"
	}
	if body != "" {
		xml += "<text>" + html.EscapeString(body) + "</text>"
	}
	xml += "</binding></visual><audio silent=\"true\"/></toast>"

	xmlB64 := base64.StdEncoding.EncodeToString([]byte(xml))
	script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('%s'))
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($payload)
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('%s').Show($toast)
`, xmlB64, xDriveAppUserModelID)

	encoded := encodePowerShellCommand(script)
	cmd := exec.Command("powershell.exe",
		"-NoLogo",
		"-NoProfile",
		"-NonInteractive",
		"-WindowStyle", "Hidden",
		"-EncodedCommand", encoded,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("Windows toast failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func encodePowerShellCommand(script string) string {
	units := utf16.Encode([]rune(script))
	raw := make([]byte, len(units)*2)
	for i, unit := range units {
		binary.LittleEndian.PutUint16(raw[i*2:], unit)
	}
	return base64.StdEncoding.EncodeToString(raw)
}
