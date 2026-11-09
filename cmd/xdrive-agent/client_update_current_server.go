package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	xupdate "github.com/lazyxu/xdrive/internal/update"
	"github.com/lazyxu/xdrive/internal/version"
)

// InstallCurrentServerCommit is *only* invoked by an explicit, confirmed
// Desktop action. Automatic update policy continues to use the independent
// configured release channel; a Server upgrade never triggers this method.
//
// Trust: current authenticated Owner -> immutable GitHub tag/source+asset
// digest verification -> exact size and SHA-256 -> OS-specific signed-package
// admission. Never execute an arbitrary Server-supplied URL or download path.
func (m *clientUpdateManager) InstallCurrentServerCommit(
	ctx context.Context, cli *client.Client, expectedCommit, filename string,
) (clientUpdateState, error) {
	if !m.Snapshot().ManualInstallSupported {
		return m.Snapshot(), fmt.Errorf("当前平台未提供可验证的系统安装授权；请下载当前 Server 安装包后使用平台安装程序")
	}
	opCtx, ok := m.beginOperation(ctx)
	if !ok {
		return m.Snapshot(), errClientUpdateBusy
	}
	defer m.endOperation()
	m.setOperation(clientUpdateStatusChecking, "核验当前 Server Commit 与已发布安装包…", "current-server")
	if cli == nil || len(expectedCommit) != 40 {
		return m.fail(fmt.Errorf("missing authenticated Server or complete target Commit"))
	}
	listing, err := cli.CurrentReleaseBundle(opCtx)
	if err != nil {
		return m.fail(err)
	}
	if listing.Commit != expectedCommit {
		return m.fail(fmt.Errorf("Server Commit changed while confirming the client update"))
	}
	switch listing.Channel {
	case xupdate.ChannelMaster:
		if !xupdate.IsSnapshotVersion(listing.ServerVersion) {
			return m.fail(fmt.Errorf("master Bundle must identify a snapshot installer"))
		}
	case xupdate.ChannelStable:
		if !xupdate.IsReleaseVersion(listing.ServerVersion) {
			return m.fail(fmt.Errorf("stable Bundle has no valid installed release version"))
		}
	default:
		return m.fail(fmt.Errorf("Server Bundle has no recognized release channel"))
	}
	if version.Metadata().Commit == expectedCommit {
		return m.applyCheckResult(xupdate.Result{
			Current: version.String(), Latest: version.String(),
			Commit: expectedCommit, Channel: listing.Channel,
		}), nil
	}
	if runtime.GOARCH != "amd64" || (runtime.GOOS != "windows" && runtime.GOOS != "linux") {
		return m.fail(fmt.Errorf("no supported verified installer for current device architecture"))
	}
	wantFile := "xDriveSetup-amd64.exe"
	if runtime.GOOS == "linux" {
		wantFile = "xdrive-linux-amd64.deb"
	}
	if filename != wantFile {
		return m.fail(fmt.Errorf("requested installer does not match the current platform"))
	}
	var item *client.ReleaseBundleArtifact
	for i := range listing.Artifacts {
		artifact := &listing.Artifacts[i]
		if artifact.Filename == filename && artifact.Platform == runtime.GOOS &&
			artifact.BuildCommit == expectedCommit && artifact.InstallMode == "manual" {
			item = artifact
			break
		}
	}
	if item == nil {
		return m.fail(fmt.Errorf("the current Server does not publish a signed installer for this platform"))
	}
	if err := client.VerifyCurrentBundlePublisher(opCtx, expectedCommit, *item); err != nil {
		return m.fail(fmt.Errorf("independent published-Commit verification failed: %w", err))
	}
	result := xupdate.Result{
		Current: version.String(), Latest: listing.ServerVersion,
		Channel: listing.Channel, Commit: expectedCommit,
		UpdateAvailable: true,
		ReleaseName:     "Current Server Commit " + expectedCommit,
		Asset: xupdate.Asset{
			Name: item.Filename, Size: item.Size,
			Digest: "sha256:" + item.SHA256,
		},
	}
	m.markChecked(result)
	m.mu.Lock()
	m.state.Status = clientUpdateStatusDownload
	m.state.BytesTotal = item.Size
	m.state.BytesDone = 0
	m.state.Message = "正在从当前 Server、GitLab 或 GitHub 下载并校验指定 Commit 安装包…"
	m.mu.Unlock()
	cache, err := os.UserCacheDir()
	if err != nil {
		return m.fail(err)
	}
	path := filepath.Join(cache, "xdrive", "updates", "server-"+expectedCommit, filename)
	if err := cli.DownloadCurrentReleaseArtifact(opCtx, expectedCommit, *item, path); err != nil {
		if opCtx.Err() != nil {
			return m.cancelled()
		}
		return m.fail(err)
	}
	m.mu.Lock()
	m.state.Status = clientUpdateStatusReady
	m.state.Downloaded = true
	m.state.BytesDone = item.Size
	m.state.Message = "当前 Server Commit 安装包已验证，准备系统安装…"
	m.mu.Unlock()
	// The platform installer re-checks the digest and permissions. Windows
	// additionally pins its Authenticode signer to the installed xd.exe.
	if _, err := xupdate.InstallPreviouslyVerified(opCtx, path, result); err != nil {
		return m.fail(err)
	}
	m.mu.Lock()
	m.state.Status = clientUpdateStatusInstall
	m.state.Message = "已提交当前 Server Commit 的客户端安装，等待版本与健康检查。"
	m.state.LastError = ""
	m.mu.Unlock()
	if runtime.GOOS == "windows" {
		// The Windows installer is detached and needs its Agent to exit.
		go func() {
			timer := time.NewTimer(250 * time.Millisecond)
			defer timer.Stop()
			select {
			case <-m.ctx.Done():
				return
			case <-timer.C:
			}
			select {
			case m.install <- struct{}{}:
			default:
			}
		}()
	}
	return m.Snapshot(), nil
}
