package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/lazyxu/xdrive/internal/client"
)

// Release Bundle operations remain Owner-authenticated through the installed
// Agent. The Desktop renderer only sees manifest metadata and request receipts,
// never a bearer token or Host cache path.
func (c *agentController) CloudReleaseBundleState(ctx context.Context) (client.ReleaseBundleListing, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return client.ReleaseBundleListing{}, err
	}
	return cli.CurrentReleaseBundle(ctx)
}

func (c *agentController) CloudRetryReleaseBundle(ctx context.Context) error {
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	return cli.RetryCurrentReleaseBundle(ctx)
}

func (c *agentController) CloudDownloadReleaseBundle(ctx context.Context, fullCommit, filename, destination string) error {
	if destination == "" || !filepath.IsAbs(destination) ||
		filepath.Clean(destination) != destination {
		return fmt.Errorf("the selected installer destination must be an absolute, normalized path")
	}
	if info, err := os.Lstat(destination); err == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("installer destination cannot be a directory or symlink")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	cli, _, err := c.cloudClient()
	if err != nil {
		return err
	}
	listing, err := cli.CurrentReleaseBundle(ctx)
	if err != nil {
		return err
	}
	if fullCommit != listing.Commit {
		return fmt.Errorf("Server Commit changed after selecting client installer")
	}
	for _, item := range listing.Artifacts {
		if releaseBundleDownloadAllowed(item, fullCommit, filename) {
			return cli.DownloadCurrentReleaseArtifact(ctx, fullCommit, item, destination)
		}
	}
	return fmt.Errorf("current Server Commit does not contain the requested approved installer")
}

func (c *agentController) CloudInstallCurrentServerCommit(ctx context.Context, fullCommit, filename string, personalUnsigned bool) (clientUpdateState, error) {
	cli, _, err := c.cloudClient()
	if err != nil {
		return c.updates.Snapshot(), err
	}
	return c.updates.InstallCurrentServerCommit(ctx, cli, fullCommit, filename, personalUnsigned)
}

func releaseBundleDownloadAllowed(item client.ReleaseBundleArtifact, fullCommit, filename string) bool {
	if item.Filename != filename || item.BuildCommit != fullCommit {
		return false
	}
	if item.InstallMode == "manual" {
		return true
	}
	// Unsigned IPA remains available for developer-side signing and testing,
	// but never participates in the native automatic installer.
	return item.InstallMode == "manual_test_only" &&
		item.Platform == "ios" && item.Filename == "xDrive-unsigned.ipa"
}
