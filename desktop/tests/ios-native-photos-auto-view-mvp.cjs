'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const repo = path.resolve(__dirname, '..', '..')
const read = p => fs.readFileSync(path.join(repo, p), 'utf8')

const app = read('ios/XDriveIOS/XDriveIOSApp.swift')
const login = read('ios/XDriveIOS/NativeOwnerLoginScreen.swift')
const session = read('ios/XDriveIOS/NativeOwnerLoginModel.swift')
const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift')
const ui = read('ios/XDriveIOS/NativePhotoBackupScreen.swift')
const dashboard = read('ios/XDriveIOS/NativePhotosDashboard.swift')
const local = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
const cloud = read('ios/XDriveIOS/NativeCloudOriginalGallery.swift')
const scope = read('ios/XDriveIOS/NativePhotoOwnerScope.swift')

test('native Photos entry uses SwiftUI rather than WKWebView and supports verified login', () => {
  assert.match(app, /XDriveIOSNativeOwnerLoginScreen\(safeStartup: safeStartup\)/)
  assert.doesNotMatch(app, /\bXDriveWebAppHome\(\)/)
  assert.match(login, /if model\.owner != nil \{[\s\S]*?XDriveIOSNativePhotosDashboard\(/)
  assert.match(dashboard, /XDriveIOSNativeLocalPhotoTimelineContainer\(\s*savedOffset: \$localGalleryPageOffset,\s*mediaFilter: \$localGalleryMediaFilter,\s*onMapDateScope: \{ galleryMapCaptureRange = \$0 \}\s*\)/)
  assert.match(dashboard, /XDriveIOSNativePhotoBackupScreen\(\s*login: login, controller: backup,[\s\S]*?launchAction: backupLaunchAction/)
  assert.match(dashboard, /XDriveIOSNativeCloudOriginalGallery\([\s\S]*?login: login,[\s\S]*?confirmedOriginalUpdate: backup\.confirmedOriginalUpdate/)
  assert.match(login, /phase == \.active/)
  assert.match(login, /backup\.cancel\(\)/)
  assert.match(login, /Timer\.publish\(every: 60/)
  assert.match(dashboard, /@ObservedObject var backup: XDriveIOSNativePhotoBackupController/)
  assert.doesNotMatch(dashboard, /Timer\.publish|backup\.cancel\(\)/)
})

test('native auto schedule shares original CAS writer, gate and durable window cursor', () => {
  const lock = controller.indexOf('XDriveIOSOriginalRunGate.shared.acquire()')
  const reserve = controller.indexOf('.reserveDue(owner: selected,')
  const managed = controller.indexOf('.readExistingForUpload(owner: selected, accessToken: verified.accessToken)')
  assert.ok(lock >= 0 && managed > lock && reserve > managed,
    'shared gate and current managed Source/Node proof must precede reservation')
  assert.match(controller, /XDriveIOSOriginalRunGate.shared.release\(gate\)/)
  assert.match(controller, /XDriveIOSForegroundPhotoBackupMVP\(/)
  assert.match(controller, /XDriveIOSPhotoAutoScheduleStore.shared.recordResult/)
  assert.match(controller, /\.run\(allowICloudOriginals: cloud, startOffset: offset,\s*newOnlySince: newOnlySince,\s*changeQueue: incrementalQueue,\s*onPotentialWrite: \{ beganOriginalWrite = true \}\)/)
  assert.match(controller, /XDriveIOSPhotoAutoSchedulePolicy.accepts\(minutes: minutes\)/)
  assert.match(controller, /XDriveIOSNativePhotoOwnerScope.matches\(login.owner, selected\)/)
  assert.doesNotMatch(controller, /UploadSessionTransport\(|URLSession\(|WKWebView\(|SecItemAdd\(/)
  assert.match(ui, /\.confirmationDialog\("开启自动原件备份？"/)
  assert.match(ui, /\.confirmationDialog\("确认开始上传/)
  assert.match(ui, /native-ios-photos-auto-disable/)
  assert.match(ui, /@State private var allowICloud = false/)
})

test('native viewer pages PhotoKit without exporting data, provides still video and Live', () => {
  assert.match(local, /XDrivePhotoKitBoundedSnapshotScanner\(/)
  assert.match(local, /load\(offset: page.nextOffset\)/)
  assert.match(local, /page.startOffset - 64/)
  assert.match(local, /PHImageManager.default\(\)\.requestImage/)
  assert.match(local, /requestAVAsset/)
  assert.match(local, /requestLivePhoto/)
  assert.match(local, /PHLivePhotoView/)
  const thumbnailLoader = local.slice(local.indexOf('final class XDriveIOSPhotoImageLoader'),
    local.indexOf('struct XDriveIOSLocalPhotoTile'))
  const detailModel = local.slice(local.indexOf('final class XDriveIOSLocalPhotoDetailModel'),
    local.indexOf('private struct XDriveIOSNativeLivePhotoView'))
  assert.match(thumbnailLoader, /allowICloud: Bool = true/)
  assert.match(thumbnailLoader, /settings\.isNetworkAccessAllowed = allowICloud/)
  assert.match(thumbnailLoader, /PHImageManager\.default\(\)\.requestImage/)
  assert.match(detailModel, /func load\(_ candidate: XDrivePhotoKitScanCandidate, allowICloud: Bool = false\)/)
  assert.match(detailModel, /options\.isNetworkAccessAllowed = allowICloud/)
  assert.match(detailModel, /liveOptions\.isNetworkAccessAllowed = allowICloud/)
  assert.match(local, /if selected != nil \{\s*suspendForViewer\(\)/)
  assert.match(local, /else if phase == \.active &&[\s\S]*?\[\.authorized, \.limited\]\.contains\([\s\S]*?suspendForViewer\(\)/)
  assert.match(local, /else \{\s*invalidate\(\)\s*\}/)
  assert.doesNotMatch(local, /URLSession|UploadSession|document\.cookie|window\.webkit/)
})

test('cloud reader uses exact Owner Files root, bounded pages and same-origin preview tickets', () => {
  assert.match(cloud, /"\/api\/v1\/nodes\/\\\(owner.rootNodeID\)\/children"/)
  assert.match(cloud, /URLQueryItem\(name: "limit", value: "48"\)/)
  assert.match(cloud, /XDriveIOSBackgroundOriginalNamePolicy.valid\(\$0.name\)/)
  assert.match(cloud, /"\/api\/v1\/files\/\\\(node.id\)\/preview-ticket"/)
  assert.match(cloud, /ticket.url.hasPrefix\("\/api\/v1\/file-preview\/"\)/)
  assert.match(cloud, /final.host == origin.host/)
  assert.match(cloud, /owner: auth.owner, accessToken: auth.accessToken/)
  assert.match(cloud, /func livePreview\(_ node:/)
  assert.match(cloud, /node.isLiveArchive/)
  assert.match(cloud, /endpoint\("\/api\/v1\/files\/\\\(node.id\)\/download-ticket"\)/)
  assert.match(cloud, /XDriveIOSLivePreviewArchive.extract\(temporary\)/)
  assert.match(cloud, /native-ios-cloud-live-motion-toggle/)
  assert.doesNotMatch(cloud, /WKWebView|document\.cookie|localStorage|bg-approved/)
})

test('native refresh rotates only after exact Owner proof, logout revokes local auto grants', () => {
  assert.match(session, /catch XDriveNativeOwnerRootFailure.serverStatus\(401\)/)
  assert.match(session, /sameScope\(fresh, snapshot.verifiedOwner\)/)
  assert.match(session, /XDriveIOSNativeOwnerSessionStore.save\(record/)
  assert.match(session, /generation == ticket/)
  assert.match(login, /XDriveIOSPhotoAutoScheduleStore.shared.disableAllOnThisDevice\(\)/)
  assert.match(login, /XDriveIOSBackgroundPhotoTask.revokePendingRequests\(\)/)
  assert.match(login, /emergencyStopLocally\(\)/)
  assert.match(login, /guard let gate = XDriveIOSOriginalRunGate.shared.acquire\(\)/)
  assert.match(scope, /current.instanceID == expected.instanceID/)
  assert.doesNotMatch(scope, /current.rootRevision == expected.rootRevision/)
})


test('native manual, auto and receipt-resume consent is pinned to the exact verified Owner', () => {
  // A modal can outlive Server/Owner changes; it must never silently
  // authorize an upload or re-enable a schedule for the replacement Owner.
  assert.match(ui, /@State private var manualConsentOwner: XDriveNativeOwnerRoot\?/)
  assert.match(ui, /@State private var autoConsentOwner: XDriveNativeOwnerRoot\?/)
  assert.match(ui, /@State private var resumeConsentOwner: XDriveNativeOwnerRoot\?/)
  assert.match(ui, /manualConsentOwner = login\.owner/)
  assert.match(ui, /autoConsentOwner = login\.owner/)
  assert.match(ui, /resumeConsentOwner = login\.owner/)
  assert.match(ui, /manualConsentAllowICloud = allowICloud/)
  assert.match(ui, /autoConsentMinutes = autoStartRule == \.resumePrevious[\s\S]*?\? \(controller\.schedule\?\.intervalMinutes \?\? interval\) : interval/)
  assert.match(ui, /autoConsentAllowICloud = autoStartRule == \.resumePrevious/)
  assert.match(ui, /controller\.startManual\(\s*login: login, expectedOwner: expected/)
  assert.match(ui, /login: login, expectedOwner: expected,\s*expectedDestination: approvedDestination,\s*minutes: autoConsentMinutes/)
  assert.match(ui, /receipts\.resumePausedAuto\(login: login, expectedOwner: expected\)/)
  assert.match(ui, /showManualConsent = false[\s\S]*showAutoConsent = false[\s\S]*showResumeConsent = false/)
  assert.match(ui, /native-ios-photos-consent-error/)
  const manual = controller.slice(controller.indexOf('    func startManual('), controller.indexOf('    func tickIfDue('))
  assert.match(manual, /expectedOwner: XDriveNativeOwnerRoot/)
  assert.match(manual, /XDriveIOSNativePhotoOwnerScope\.matches\(login.owner, expectedOwner\)/)
  const auto = controller.slice(controller.indexOf('    func configure('), controller.indexOf('    func disable('))
  assert.match(auto, /expectedOwner: XDriveNativeOwnerRoot/)
  assert.match(auto, /XDriveIOSNativePhotoOwnerScope\.matches\(login.owner, expectedOwner\)/)
  assert.match(auto, /let selected = expectedOwner/)
  assert.match(auto, /XDriveIOSNativePhotoOwnerScope\.matches\(second.owner, selected\)/)
  const review = read('ios/XDriveIOS/NativePhotoReceiptReviewController.swift')
  const resume = review.slice(review.indexOf('    func resumePausedAuto('))
  assert.match(resume, /expectedOwner: XDriveNativeOwnerRoot/)
  assert.match(resume, /XDriveIOSNativePhotoOwnerScope\.matches\(login.owner, expectedOwner\)/)
  assert.match(resume, /let expected = expectedOwner/)
})


test('native cloud original list and preview clear stale media across Owner switches', () => {
  // Server/Owner logout or switch must immediately remove the old filenames
  // and stop the AVPlayer, not merely protect a future page response.
  assert.match(cloud, /func invalidate\(\) \{\s*cancel\(\)\s*nodes = \[\]\s*seenNodeIDs\.removeAll\(\)\s*total = 0\s*scanned = 0\s*verifiedPageOwner = nil\s*verifiedFirstPage = \[\]\s*coveredRetryRequired = false\s*thumbnailEpoch = UUID\(\)\s*error = nil/)
  assert.match(cloud, /func reload\(login: XDriveIOSNativeOwnerLoginModel\) \{\s*invalidate\(\)/)
  const preview = cloud.slice(cloud.indexOf('struct XDriveIOSNativeCloudOriginalPreview: View'),
    cloud.indexOf('struct XDriveIOSNativeCloudOriginalGallery: View'))
  assert.match(preview, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?player\?\.pause\(\)[\s\S]*?still = nil[\s\S]*?dismiss\(\)/)
  const gallery = cloud.slice(cloud.indexOf('struct XDriveIOSNativeCloudOriginalGallery: View'))
  // Owner switch clears old rows synchronously. A foreground scene reloads
  // immediately; an inactive scene defers the same verified read until active.
  assert.match(gallery, /\.onChange\(of: login\.owner\) \{ _ in[\s\S]*?refreshAfterViewer = false[\s\S]*?selected = nil\s*viewerOwner = nil\s*viewerLoadedNodes = \[\]\s*viewerReturnNode = nil\s*accessibilityFocusedNodeID = nil\s*needsTabRevalidation = false\s*needsForegroundReload = false\s*hasActivated = false\s*model\.invalidate\(\)/)
  assert.match(gallery, /if login\.owner != nil \{\s*if phase == \.active && isTabActive \{\s*activateIfNeeded\(\)\s*\} else \{\s*needsForegroundReload = true/)
  assert.match(gallery, /\.fullScreenCover\(item: \$selected, onDismiss:/)
  assert.match(gallery, /\.onDisappear \{[\s\S]*?if selected == nil \{\s*refreshAfterViewer = false\s*if phase == \.active, !isTabActive,\s*model\.matchesOwner\(login.owner\) \{\s*needsTabRevalidation = true\s*model\.cancel\(\)\s*\} else \{[\s\S]*?model\.invalidate\(\)/)
})

test('native Photos exposes an Owner-bound backup status and cloud-originals route', () => {
  assert.match(dashboard, /native-ios-gallery-backup-settings/)
  assert.match(dashboard, /backup\.schedule/)
  assert.match(dashboard, /backup\.busy/)
  assert.match(dashboard, /自动备份已暂停：需核对收据/)
  assert.match(dashboard, /XDriveIOSNativePhotoBackupScreen\([\s\S]*?launchNonce: backupLaunchNonce[\s\S]*?guard login\.owner != nil else \{ return \}[\s\S]*?openGallery\(\.originals\)/)
  assert.match(ui, /let onShowCloudOriginals: \(\) -> Void/)
  assert.match(ui, /native-ios-photos-cloud-originals/)
  assert.match(ui, /guard login\.owner != nil else \{ return \}[\s\S]*?onShowCloudOriginals\(\)/)
  assert.match(ui, /待核对收据不代表上传成功/)
  assert.match(cloud, /XDriveIOSNativePhotoOwnerScope\.matches\(login.owner, update.owner\)/)
  assert.doesNotMatch(ui, /WKWebView|document\.cookie|window\.webkit/)
})

test('foreground auto iCloud and interval settings show the stored current Owner plan', () => {
  const store = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
  const setup = ui.slice(ui.indexOf('Section("备份范围")'), ui.indexOf('Section("可选系统后台原件备份")'))
  const hydrate = ui.slice(ui.indexOf('private func syncSavedAutomaticSettings()'))
  assert.match(ui, /@State private var allowICloud = false/)
  assert.match(ui, /@State private var autoAllowICloud = false/)
  assert.match(setup, /Toggle\("手动备份允许下载 iCloud 原件", isOn: \$allowICloud\)/)
  assert.match(setup, /Toggle\("前台自动备份允许下载 iCloud 原件", isOn: \$autoAllowICloud\)/)
  assert.match(setup, /native-ios-photos-auto-icloud/)
  assert.match(setup, /native-ios-photos-auto-saved-settings/)
  assert.match(setup, /active\.intervalMinutes/)
  assert.match(setup, /active\.allowICloudOriginals/)
  assert.match(setup, /\.disabled\(controller\.busy \|\| enablingAutomaticBackup \|\| controller\.schedule\?\.enabled == true\)/)
  assert.match(ui, /private var enableAutomaticBackupButton:[\s\S]*?autoConsentAllowICloud = autoStartRule == \.resumePrevious/)
  assert.match(setup, /manualConsentAllowICloud = allowICloud/)
  assert.match(ui, /\.onAppear \{\s*photoAuthorization = PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\)\s*syncSavedAutomaticSettings\(\)/)
  assert.match(ui, /allowICloud = false\s*autoAllowICloud = false\s*autoStartRule = \.everything\s*interval = 60\s*syncSavedAutomaticSettings\(\)/)
  assert.match(hydrate, /controller\.refresh\(owner: login\.owner\)/)
  assert.match(hydrate, /if let active = controller\.schedule \{\s*interval = active\.intervalMinutes\s*autoAllowICloud = active\.allowICloudOriginals/)
  assert.match(store, /var intervalMinutes: Int/)
  assert.match(store, /var allowICloudOriginals: Bool/)
  assert.match(controller, /allowICloud: state\.allowICloudOriginals/)
  assert.doesNotMatch(setup, /scheduleStore\.configure|UploadSessionTransport|XDriveIOSJournaledOriginalUpload/)
});


test('unreadable original journal after failed writer stops the 256-item run', () => {
  const runner = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
  const writer = read('ios/XDriveIOS/IOSJournaledOriginalUpload.swift')
  const prepared = runner.slice(runner.indexOf('case .prepared:'),
    runner.indexOf('case .creating, .uploading, .finalizing, .needsReconciliation:'))
  const failure = prepared.slice(prepared.indexOf('} catch {', prepared.indexOf('writer.uploadPrepared(')))
  assert.match(failure, /let current: XDrivePhotoSyncOperation\?/)
  assert.match(failure, /current = try await journal\.operation\(/)
  assert.match(failure, /catch is CancellationError \{\s*throw CancellationError\(\)/)
  assert.match(failure, /catch \{[\s\S]*?return \.requiresReview/)
  assert.match(failure, /guard let current, current\.state == \.prepared else \{[\s\S]*?return \.requiresReview/)
  assert.match(failure, /throw error/)
  assert.doesNotMatch(failure, /try\? await journal\.operation/)
  const errorPath = runner.slice(runner.indexOf('case .requiresReview:'),
    runner.indexOf('if report.stoppedForReview { break scanning }'))
  assert.match(errorPath, /report\.needsReview \+= 1/)
  assert.match(errorPath, /report\.stoppedForReview = true/)
  assert.match(runner, /if report\.stoppedForReview \{ break scanning \}/)
  assert.match(writer, /beforeCreate: \{[\s\S]*?ledger\.beginCreate/)
  assert.match(writer, /beforeFinalize: \{[\s\S]*?ledger\.beginFinalize/)
  assert.doesNotMatch(failure, /confirmReceipt\(|beginCreate\(|resetLedger|uploadPreparedOriginal\(/)
})

test('backup portrait stays one ordered form and short landscape splits status from settings only once', () => {
  assert.match(ui, /@Environment\(\\\.dynamicTypeSize\) private var dynamicTypeSize/);
  assert.match(ui, /GeometryReader \{ viewport in/);
  assert.match(ui, /viewport\.size\.width >= 760 &&[\s\S]*?viewport\.size\.height < 500 &&[\s\S]*?!dynamicTypeSize\.isAccessibilitySize/);
  assert.match(ui, /HStack\(alignment: \.top, spacing: 0\) \{\s*Form \{ backupStatusSections \}/);
  assert.match(ui, /Form \{ backupSettingsSections \}/);
  assert.match(ui, /Form \{\s*backupSettingsSections\s*backupStatusSections\s*\}/);
  assert.match(ui, /@ViewBuilder\s*private var backupSettingsSections: some View \{[\s\S]*?Section\("备份范围"\)[\s\S]*?Section\("手动备份"\)[\s\S]*?Section\("前台自动增量"\)/);
  assert.match(ui, /@ViewBuilder\s*private var backupStatusSections: some View \{[\s\S]*?Section\("可选系统后台原件备份"\)[\s\S]*?Section\("不确定收据核对"\)[\s\S]*?Section\("查看已备份原件"\)[\s\S]*?Section\("执行结果"\)/);
  for (const name of ['备份范围','手动备份','前台自动增量','可选系统后台原件备份','不确定收据核对','查看已备份原件','执行结果']) {
    assert.equal(ui.split('Section("'+name+'")').length-1, 1, name+' must not duplicate');
  }
  assert.match(ui, /\.accessibilityIdentifier\("native-ios-backup-landscape-status"\)/);
  assert.match(ui, /\.accessibilityIdentifier\("native-ios-backup-landscape-settings"\)/);
  assert.match(ui, /\.onDisappear \{[\s\S]*?receipts\.cancel\(\)/);
  assert.match(ui, /\.confirmationDialog\("开启自动原件备份？"/);
  assert.doesNotMatch(ui, /\.onChange\(of: viewport\)|\.id\(viewport\)/);
});

test('backup setup advances from verified device and folder to explicit scoped consent', () => {
  const setup = ui.slice(ui.indexOf('private var backupSetup:'), ui.indexOf('private func openDetails('))
  const steps = ['registerDeviceButton', 'saveDestinationButton',
    'PHPhotoLibrary.requestAuthorization', 'backupScopePicker', 'enableAutomaticBackupButton']
  let previous = -1
  for (const step of steps) {
    const next = setup.indexOf(step)
    assert.ok(next > previous, step + ' must follow the preceding prerequisite')
    previous = next
  }
  assert.match(setup, /else if let error = destination\.errorMessage[\s\S]*?refreshDestinationButton/)
  assert.doesNotMatch(setup, /controller\.configure\(|UploadSession|\.enroll\(/)
  assert.match(ui, /case \.overview: backupOverview\s*case \.setup: backupSetup\s*case \.details: backupDetails/)
  assert.match(ui, /"去核对收据"\) \{ openDetails\(\.receipts\) \}/)
  assert.match(ui, /\.confirmationDialog\("开启自动原件备份？"[\s\S]*?approvedDestination == destination\.confirmed,[\s\S]*?XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)[\s\S]*?expectedDestination: approvedDestination/)
  assert.match(controller, /readExistingForUpload\([\s\S]*?managed\.destination == expectedDestination,[\s\S]*?schedule = try store\.configure\(/)
})


test('native local and album photo walls free short landscape grid space while retaining Viewer return', () => {
  const local = read('ios/XDriveIOS/NativeLocalPhotoGallery.swift')
  const album = read('ios/XDriveIOS/NativePhotoAlbumBrowser.swift')
  const localWall = local.slice(local.indexOf('struct XDriveIOSNativeLocalGalleryScreen: View {'))
  const albumWall = album.slice(album.indexOf('struct XDriveIOSNativeAlbumContentsScreen: View {'),
    album.indexOf('/// Photos-first list of local smart/user albums.'))
  for (const [name, screen] of [['local', localWall], ['album', albumWall]]) {
    assert.match(screen, /@Environment\(\\\.dynamicTypeSize\) private var dynamicTypeSize/, name)
    assert.match(screen, /GeometryReader \{ viewport in/, name)
    assert.match(screen, /viewport\.size\.width >= 680 &&\s*viewport\.size\.height < 500 && !dynamicTypeSize\.isAccessibilitySize/, name)
    assert.match(screen, /ScrollViewReader \{ returnScroll in\s*ScrollView \{/, name)
    assert.match(screen, /if !compactGallery \{[\s\S]*?Text\(/, name)
    assert.match(screen, /@AccessibilityFocusState private var accessibilityFocusedTileID: String\?/, name)
    assert.match(screen, /\.onChange\(of: pageRenderRevision\)/, name)
    assert.match(screen, /\.fullScreenCover\(item: \$selected, onDismiss: \{ restoreAfterViewer\(\) \}\)/, name)
    if (name === 'album') {
      // Album MapKit cover is another transient child; preserve the verified
      // page and scroll checkpoint, but invalidate on a genuine route exit.
      assert.match(screen, /if selected != nil \|\| showingAlbumMap \|\|\s*\(phase == \.active && albumAuthorized\) \{\s*suspendForViewer\(\)/, name)
      assert.match(screen, /else \{\s*libraryMonitor\.stop\(\)\s*invalidate\(\)\s*\}/, name)
    } else {
      assert.match(screen, /if selected != nil \{\s*suspendForViewer\(\)/, name)
      assert.match(screen, /else if phase == \.active &&[\s\S]*?\[\.authorized, \.limited\]\.contains\([\s\S]*?suspendForViewer\(\)/, name)
    }
    assert.doesNotMatch(screen, /\.id\(compactGallery\)|onChange\(of: compactGallery\)|UploadSession|URLSession/, name)
  }
  assert.match(localWall, /if authorization == \.limited \|\| !compactGallery/)
  assert.match(localWall, /native-ios-local-gallery-layout-help/)
  assert.match(albumWall, /native-ios-local-album-layout-help/)
  assert.match(localWall, /只读取当前授权子集/)
  // Album selection still cannot upload or persist PhotoKit member IDs.
  // Explicit, user-initiated original sharing may read iCloud originals:
  // the pre-batch MVP text "never reads iCloud originals" is no longer true.
  assert.match(albumWall, /仅操作当前授权相簿的媒体；原件分享需明确点击，不上传或持久保存相簿成员标识/)
  assert.match(albumWall, /Button\("从 iCloud 下载后分享"\)/)
  assert.match(albumWall, /XDriveIOSNativeLocalOriginalSharer\.prepare\(\s*batch, allowICloudDownload: allowICloud/)
  assert.match(albumWall, /guard selectionMode, albumAuthorized, phase == \.active/)
  assert.doesNotMatch(albumWall, /UploadSession|PhotoSyncLedger|XDriveIOSForegroundPhotoBackupMVP/)
});

test('native automatic scan stops for revoked Owner, sealed ledger or revoked Photos permission', () => {
  const backup = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
  const run = backup.slice(backup.indexOf('    func run('), backup.indexOf('    private static func mustAbortRun('))
  const policy = backup.slice(backup.indexOf('    private static func mustAbortRun('),
    backup.indexOf('    private enum StillOutcome'))
  const callback = run.slice(run.indexOf('let outcome = try await uploadOrVerifyOriginal('),
    run.indexOf('await scanner.reset()'))
  const abort = callback.indexOf('if Self.isTransientConfirmedReadbackFailure(error) ||')
  assert.match(callback, /if Self\.isTransientConfirmedReadbackFailure\(error\) \|\|\s*Self\.mustAbortRun\(after: error\) \{ throw error \}/)
  const countUnavailable = callback.indexOf('report.unavailable += 1')
  assert.ok(abort >= 0 && countUnavailable > abort,
    'global trust failure must escape before counting an ordinary unavailable original')
  assert.match(callback, /catch is CancellationError \{\s*throw CancellationError\(\)/)
  assert.match(policy, /error is XDriveNativeOwnerRootFailure/)
  assert.match(policy, /error is XDrivePhotoSyncLedgerError/)
  assert.match(policy, /error as\? XDrivePhotoKitExportFailure,[\s\S]*?case \.notAuthorized = source/)
  assert.match(policy, /error as\? XDriveIOSPhotoIntentPreparationError,[\s\S]*?case \.unverifiedOwnerOrDeviceScope = intent/)
  assert.match(policy, /return false/)
  assert.doesNotMatch(policy, /URLSession|UploadSession|ledger\.prepare|revokePendingRequests|localIdentifier/)
  assert.match(backup, /case \.requiresReview:\s*report\.needsReview \+= 1\s*report\.stoppedForReview = true/)
  assert.match(backup, /await scanner\.reset\(\)\s*throw error/,
    'failed run must dispose native PhotoKit snapshot rather than resume a stale cursor')
})

test('manual original backup continues the same bounded window before visiting older assets', () => {
  const store = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
  const policy = read('ios/XDriveIOS/PhotoAutoSchedulePolicy.swift')
  const epoch = read('ios/XDriveIOS/PhotoKitLibraryEpoch.swift')
  const start = controller.slice(controller.indexOf('    private func start('))
  const manual = start.slice(start.indexOf('let window: Int'),
    start.indexOf('guard let offset = XDrivePhotoBackupScanWindow.offset('))
  const receipt = start.slice(start.indexOf('self.progress = result'),
    start.indexOf('self.message = "本轮确认新增'))
  const refresh = controller.slice(controller.indexOf('    func refresh(owner:'),
    controller.indexOf('    /// A receipt review'))
  assert.match(controller, /@Published private\(set\) var manualNextWindow = 0/)
  assert.match(controller, /private var manualLibraryEpoch: Data\?/)
  assert.match(controller, /private var manualAuthorizationRaw: Int\?/)
  assert.match(refresh, /if !unchanged \{\s*displayEpoch = UUID\(\)\s*manualNextWindow = 0\s*manualLibraryEpoch = nil\s*manualAuthorizationRaw = nil/)
  assert.match(manual, /XDriveIOSPhotoKitLibraryEpoch\.capture\(\)/)
  assert.match(manual, /XDrivePhotoCursorEpochPolicy\.trustedWindow\(/)
  assert.match(manual, /requested: self\.manualNextWindow/)
  assert.match(manual, /tokenUnchanged: XDriveIOSPhotoKitLibraryEpoch\.matches\(/)
  assert.match(manual, /previousAuthorization: self\.manualAuthorizationRaw/)
  assert.match(manual, /self\.manualNextWindow = window/)
  assert.match(manual, /manualStartEpoch = epoch/)
  assert.match(receipt, /if kind == \.automatic \{\s*let recorded = try XDriveIOSPhotoAutoScheduleStore\.shared\.recordResult/)
  assert.match(receipt, /self\.schedule = recorded[\s\S]*?\} else if let initial = manualStartEpoch \{/)
  assert.match(receipt, /else if let initial = manualStartEpoch \{/)
  assert.match(receipt, /let completed = try XDriveIOSPhotoKitLibraryEpoch\.capture\(\)/)
  assert.match(receipt, /self\.manualNextWindow = unchanged\s*\? XDriveIOSPhotoAutoSchedulePolicy\.nextWindow\(/)
  assert.match(receipt, /needsReview: result\.stoppedForReview \|\| result\.needsReview > 0/)
  assert.match(receipt, /self\.manualLibraryEpoch = completed\.serialized/)
  assert.match(receipt, /self\.manualAuthorizationRaw = completed\.authorization/)
  assert.match(ui, /native-ios-photos-manual-window/)
  assert.match(ui, /native-ios-photos-manual-coverage/)
  assert.match(ui, /不代表全部已备份/)
  assert.match(policy, /guard scanned == capacity, uploaded <= maxNewFiles/)
  assert.match(epoch, /currentChangeToken/)
  assert.doesNotMatch(manual + receipt, /store\.configure|SecItemAdd|UploadSessionTransport|URLSession/)
  assert.doesNotMatch(store, /manualNextWindow|manualLibraryEpoch/,
    'manual progress stays ephemeral, never silently advances the saved automatic schedule')
});

test('PhotoKit changes advance only an approved foreground Owner plan, not an original writer', () => {
  const store = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
  const policy = read('ios/XDriveIOS/PhotoAutoSchedulePolicy.swift')
  assert.match(controller, /class XDriveIOSForegroundPhotoLibraryObserver:[\s\S]*?PHPhotoLibraryChangeObserver/)
  assert.match(controller, /func photoLibraryDidChange\(_ changeInstance: PHChange\)/)
  assert.match(controller, /Task \{ @MainActor \[weak self\] in self\?\.onChanged\(\) \}/)
  assert.match(controller, /PHPhotoLibrary\.shared\(\)\.register\(observer\)/)
  assert.match(controller, /PHPhotoLibrary\.shared\(\)\.unregisterChangeObserver\(observer\)/)
  assert.match(controller, /\[weak self, weak login\][\s\S]*?let owner = login\.owner/)
  assert.match(controller, /\.expediteForLibraryChange\(owner: owner\)/)
  assert.match(login, /mark\(\.ready\)\s*startupReady = true[\s\S]*?if !safeStartup \{\s*backup\.startLibraryChangeMonitoring\(login: model\)/)
  assert.match(login, /readinessTask\?\.cancel\(\)[\s\S]*?backup\.stopLibraryChangeMonitoring\(\)/)
  assert.match(login, /mayAutoBackup\([\s\S]*?startupReady: startupReady, safeStartup: safeStartup/)
  assert.match(store, /func expediteForLibraryChange\(owner: XDriveNativeOwnerRoot/)
  assert.match(store, /state\.enabled, !state\.pausedForReview/)
  assert.match(store, /\.earlierDueAfterLibraryChange\(currentDueAt: state\.nextDueAt, at: now\)/)
  assert.match(store, /state\.nextDueAt = due\s*try persist\(state, owner: owner\)/)
  assert.match(policy, /return currentDueAt > soon \? soon : nil/)
  const observer = controller.slice(controller.indexOf('private final class XDriveIOSForegroundPhotoLibraryObserver'),
                                    controller.indexOf('    func refresh(owner:'))
  assert.doesNotMatch(observer, /UploadSession|URLSession|start\(login:|reserveDue\(|PhotoSyncLedger|fetchAssets/)
})

test('foreground auto retries only an owned pre-write transient network failure', () => {
  const store = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
  const policy = read('ios/XDriveIOS/PhotoAutoSchedulePolicy.swift')
  const start = controller.slice(controller.indexOf('    private func start('))
  const fail = start.slice(start.indexOf('            } catch is CancellationError {'),
    start.indexOf('            // A successful original may be followed'))
  assert.match(start, /var automaticReservedNextDueAt: Date\?/)
  assert.match(start, /var beganOriginalWrite = false/)
  assert.match(start, /automaticReservedNextDueAt = due\.nextDueAt/)
  assert.match(start, /onPotentialWrite: \{ beganOriginalWrite = true \}/)
  assert.match(fail, /if kind == \.automatic,[\s\S]*?let reservedDue = automaticReservedNextDueAt,[\s\S]*?!beganOriginalWrite, !Task\.isCancelled/)
  assert.match(fail, /let networkError = error as\? URLError/)
  assert.match(fail, /let retryableNetwork = error is XDriveIOSPhotoBackupNetworkError \|\|\s*networkError\.map\(XDriveIOSPhotoAutoSchedulePolicy\.retryablePrewriteNetworkFailure\) == true/)
  assert.match(fail, /!beganOriginalWrite, !Task\.isCancelled,\s*retryableNetwork,/)
  assert.match(fail, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, selected\)/)
  assert.match(fail, /UIApplication\.shared\.applicationState == \.active/)
  assert.match(fail, /\.rescheduleSafePrewriteNetworkFailure\(\s*owner: selected, expectedNextDueAt: reservedDue/)
  assert.match(store, /func rescheduleSafePrewriteNetworkFailure\(/)
  assert.match(store, /state\.enabled, !state\.pausedForReview,\s*state\.nextDueAt == expectedNextDueAt/)
  assert.match(store, /state\.nextDueAt = soon\s*try persist\(state, owner: owner\)/)
  assert.match(policy, /static let prewriteNetworkRetryDelay: TimeInterval = 5 \* 60/)
  assert.match(policy, /return currentDueAt > soon \? soon : nil/)
  assert.match(policy, /case \.notConnectedToInternet, \.networkConnectionLost, \.timedOut/)
  assert.doesNotMatch(fail, /UploadSession|uploadPrepared|confirmReceipt|reserveDue\(|\.configure\(|start\(login:/)
})

test('new-only foreground auto plan keeps explicit Owner choice and never counts old photos as confirmed', () => {
  const store = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
  const policy = read('ios/XDriveIOS/PhotoAutoSchedulePolicy.swift')
  const runner = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
  const background = read('ios/XDriveIOS/BackgroundPhotoTask.swift')
  assert.match(ui, /Picker\("备份范围", selection: \$autoStartRule\)/)
  assert.match(ui, /autoConsentStartRule = autoStartRule/)
  assert.match(ui, /autoConsentEnabledAt = Date\(\)/)
  assert.match(ui, /startRule: autoConsentStartRule,[\s\S]*?enabledAt: autoConsentEnabledAt/)
  assert.match(store, /var backupStartRuleRaw: String\? = nil/)
  assert.match(store, /var newOnlySince: Date\? = nil/)
  assert.match(store, /state\.backupStartRule != nil/)
  assert.match(store, /backupStartRuleRaw: startRule\.rawValue/)
  assert.match(store, /newOnlySince: startRule == \.onlyNew \? enabledAt : nil/)
  assert.match(policy, /guard let raw else \{ return \.everything \}/)
  assert.match(policy, /case unknownDates/)
  assert.match(controller, /newOnlySince = due\.backupStartRule == \.onlyNew/)
  assert.match(controller, /newOnlySince = nil\s*manualStartEpoch = epoch/)
  assert.match(runner, /newOnlySince: Date\? = nil/)
  const admission = runner.slice(runner.indexOf('report.scanned += 1'), runner.indexOf('// Live uses one atomic ZIP'))
  assert.match(admission, /newOnlyCandidate\(/)
  assert.match(admission, /case \.olderThanStart:[\s\S]*?report\.skippedBeforeBaseline \+= 1/)
  assert.match(admission, /case \.unknownDates:[\s\S]*?report\.unavailable \+= 1/)
  assert.doesNotMatch(admission, /report\.uploaded \+= 1|report\.verifiedAlready \+= 1/)
  assert.match(ui, /不代表这些原件已经备份/)
  // This shared runner remains the BG entrypoint; subsequent BG rule
  // unification must be allowed instead of frozen out by this contract.
  assert.match(background, /XDriveIOSForegroundPhotoBackupMVP\(/)
})

test('only-new foreground consent installs its durable PhotoKit baseline and replays bounded records without claiming an ACK', () => {
  const schedule = read('ios/XDriveIOS/NativePhotoBackupController.swift')
  const changeQueue = read('ios/XDriveIOS/PhotoKitPersistentBackupQueue.swift')
  const configure = schedule.slice(schedule.indexOf('func configure('), schedule.indexOf('func disable('))
  const automatic = schedule.slice(schedule.indexOf('private func start(login:'), schedule.indexOf('private func runFocused('))
  // Consent-time PhotoKit token is captured BEFORE asynchronous Server
  // verification; persisting it is allowed only after the managed target is
  // authenticated and still belongs to the same Owner.
  assert.match(configure, /if startRule == \.onlyNew \{[\s\S]*?XDriveIOSPhotoKitLibraryEpoch\.capture\(\)/)
  assert.match(configure, /if let consentEpoch \{[\s\S]*?installNewOnlyBaseline\([\s\S]*?owner: selected,[\s\S]*?consentToken: consentEpoch\.serialized,[\s\S]*?consentAuthorization: consentEpoch\.authorization/)
  const capture = configure.indexOf('XDriveIOSPhotoKitLibraryEpoch.capture()')
  const firstAuth = configure.indexOf('let first = try await login.verifiedAuthorization()')
  const managedTarget = configure.indexOf('.readExistingForUpload(owner: selected')
  const install = configure.indexOf('.installNewOnlyBaseline(')
  const persist = configure.indexOf('schedule = try store.configure(')
  assert.ok(capture >= 0 && capture < firstAuth && firstAuth < managedTarget &&
    managedTarget < install && install < persist,
    'only-new baseline must use consent-time token after Owner target verification, before saving plan')
  assert.match(configure, /let second = try await login\.verifiedAuthorization\(\)/)
  assert.match(automatic, /activePlan\.backupStartRule == \.onlyNew/)
  const replay = automatic.indexOf('changeQueue.replay(')
  const reserve = automatic.indexOf('.reserveDue(owner: selected,')
  assert.ok(replay >= 0 && reserve > replay, 'durable replay must precede automatic due reservation')
  // A single-photo revision lookup now has an earlier, distinct
  // unauthorizedOrChanged catch. Scope this assertion to the automatic
  // PhotoKit *replay* block rather than the first catch in the entire run.
  const replayBlock = automatic.slice(replay, reserve)
  const catchAt = replayBlock.indexOf('} catch XDriveIOSPhotoKitPersistentBackupQueue.Failure')
  const recoveryEnd = replayBlock.indexOf('try Task.checkCancellation()', catchAt)
  assert.ok(catchAt >= 0 && recoveryEnd > catchAt,
    'automatic lost-history recovery must be caught before reserveDue')
  const recoveryFailure = replayBlock.slice(catchAt, recoveryEnd)
  assert.match(recoveryFailure, /requiresExplicitBaseline/)
  assert.match(recoveryFailure, /invalidArchivedToken/)
  assert.match(recoveryFailure, /historyUnavailable/)
  assert.match(recoveryFailure, /requireFullLibraryReconciliation\(owner: selected\)/)
  assert.match(recoveryFailure, /incrementalQueue = nil[\s\S]*?canUseOnlyNewDateFilter = false/)
  const consentGate = automatic.indexOf('if activePlan.requiresFullLibraryReconciliation &&')
  assert.ok(consentGate > replay && consentGate < reserve,
    'missing or expired history must not reserve a backup window before Owner consent')
  const gated = automatic.slice(consentGate, reserve)
  assert.match(gated, /historyRecoveryRequiresConsent == true/)
  assert.match(gated, /historyRecoveryFullScopeConfirmed != true/)
  assert.match(gated, /return/)
  const persisted = read('ios/XDriveIOS/PhotoAutoScheduleStore.swift')
  const reserveGuard = persisted.slice(persisted.indexOf('func reserveDue(owner:'),
    persisted.indexOf('func recordResult(owner:'))
  assert.match(reserveGuard, /state\.historyRecoveryRequiresConsent != true/)
  assert.match(reserveGuard, /state\.historyRecoveryRequired != true \|\|[\s\S]*?state\.historyRecoveryFullScopeConfirmed == true/)
  assert.match(changeQueue, /guard \(1\.\.\.4\)\.contains\(maximumEvents\)/)
  assert.match(changeQueue, /if progress\.events >= maximumEvents \{ break \}/)
  assert.doesNotMatch(changeQueue, /\.uploadPrepared\(|\.finalize\(|\.deleteNode\(/)
})

test('one-photo priority backup is explicit, Owner-bound, and uses the shared CAS original writer', () => {
  const priority = read('ios/XDriveIOS/PhotoPriorityBackupSection.swift')
  const runner = read('ios/XDriveIOS/ForegroundPhotoBackupMVP.swift')
  const controller = read('ios/XDriveIOS/NativePhotoBackupController.swift')
  const screen = read('ios/XDriveIOS/NativePhotoBackupScreen.swift')
  const single = runner.slice(runner.indexOf('func runSingle('),
    runner.indexOf('/// Only ITEM-LOCAL errors are summarized'))
  assert.match(priority, /PhotosPicker\(selection: \$selectedItem/)
  assert.match(priority, /matching: \.any\(of: \[\.images, \.videos\]\)/)
  assert.match(priority, /\.confirmationDialog\(/)
  assert.match(priority, /XDriveIOSNativePhotoOwnerScope\.matches\(login\.owner, expected\)/)
  assert.match(priority, /controller\.startSingle\(/)
  assert.match(priority, /destination\.confirmedForCurrentName/)
  assert.match(screen, /XDriveIOSPhotoPriorityBackupSection\(/)
  assert.match(controller, /func startSingle\(/)
  assert.match(controller, /kind: \.single[\s\S]*?singleLocalIdentifier: localIdentifier/)
  assert.match(controller, /if kind == \.single[\s\S]*?\.runSingle\(/)
  const singleController = controller.slice(
    controller.indexOf('if kind == .single'),
    controller.indexOf('else if kind == .focused')
  )
  assert.match(singleController, /result\.stoppedForReview \|\| result\.needsReview > 0[\s\S]*?pauseForPendingReceipts\(owner: selected\)/)
  const foregroundStart = controller.slice(controller.indexOf('private func start('))
  assert.match(foregroundStart, /if olderPending > 0 \{[\s\S]*?pauseForPendingReceipts\(owner: selected\)/)
  assert.match(single, /authorization\.verify\(owner: owner\)/)
  assert.match(single, /PHAsset\.fetchAssets\(\s*withLocalIdentifiers:/)
  assert.match(single, /uploadOrVerifyOriginal\(/)
  assert.match(single, /onPotentialWrite: onPotentialWrite/)
  assert.match(single, /case \.requiresReview:[\s\S]*?report\.stoppedForReview = true/)
  assert.doesNotMatch(single, /XDriveNativeUploadSessionTransport|URLSession\(/)
})

test('only-new PhotoKit history recovery is visible and requires explicit full-library consent', () => {
  const ui = read('ios/XDriveIOS/NativePhotoBackupScreen.swift')
  assert.match(ui, /native-ios-photo-history-recovery/)
  assert.match(ui, /native-ios-photo-history-recovery-confirm/)
  assert.match(ui, /历史 Token 缺失、损坏、过期或变更详情不可用时/)
  assert.match(ui, /为遵守“仅备份新照片”，自动任务已暂停/)
  assert.match(ui, /可能上传拍摄日期较早、但当前没有备份收据的照片/)
  assert.match(ui, /只有所有支持的原件都通过当前 Server 收据核验后，才会恢复增量备份/)
})
