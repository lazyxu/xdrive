package shellintegration

import (
	"fmt"
	"strings"
)

const (
	VerbKeepLocalKey    = "xDrive.KeepLocal"
	VerbReleaseSpaceKey = "xDrive.ReleaseSpace"
)

type ExplorerVerbSpec struct {
	Key       string
	Label     string
	AppliesTo string
	Command   string
	Icon      string
}

func ExplorerVerbSpecs(root, executable, icon string) []ExplorerVerbSpec {
	root = strings.TrimRight(strings.TrimSpace(root), "\\/")
	executable = strings.TrimSpace(executable)
	icon = strings.TrimSpace(icon)
	escapedRoot := strings.ReplaceAll(root, `"`, `\\"`)
	descendantRoot := escapedRoot
	if !strings.HasSuffix(descendantRoot, `\`) {
		descendantRoot += `\`
	}
	appliesTo := fmt.Sprintf(
		`(System.ItemPathDisplay:="%s" OR System.ItemPathDisplay:~<"%s")`,
		escapedRoot,
		descendantRoot,
	)
	command := func(action string) string {
		return fmt.Sprintf(`"%s" --shell-action %s "%%1"`, strings.ReplaceAll(executable, `"`, `\\"`), action)
	}
	return []ExplorerVerbSpec{
		{
			Key:       VerbKeepLocalKey,
			Label:     "始终保留在此设备",
			AppliesTo: appliesTo,
			Command:   command("keep"),
			Icon:      icon,
		},
		{
			Key:       VerbReleaseSpaceKey,
			Label:     "释放空间",
			AppliesTo: appliesTo,
			Command:   command("release"),
			Icon:      icon,
		},
	}
}
