'use strict'
// This suite guards the actual SwiftUI route/model lifecycle; physical frame
// timing remains an independent acceptance check, not a source-test claim.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sources = {
  "d": "ios/XDriveIOS/NativePhotosDashboard.swift",
  "u": "ios/XDriveIOS/NativeUnifiedPhotoGallery.swift",
  "w": "ios/XDriveIOS/NativeUnifiedPhotoWall.swift",
  "l": "ios/XDriveIOS/NativeLocalContinuousGallery.swift",
  "a": "ios/XDriveIOS/NativePhotoAlbumBrowser.swift",
  "f": "ios/XDriveIOS/NativeCloudFilesBrowser.swift",
  "c": "ios/XDriveIOS/NativeFilesCollections.swift",
  "n": "ios/XDriveIOS/NativeFilesNavigationPolicy.swift",
  "q": "ios/XDriveIOS/NativeFilesQuickAccess.swift",
  "v": "ios/XDriveIOS/NativeFilesContinuousWindowPolicy.swift",
  "r": "ios/XDriveIOS/NativePhotoViewerReturnAnchorPolicy.swift",
  "g": "ios/XDriveIOS/NativePhotoWallDensityPolicy.swift",
  "s": "ios/XDriveIOS/NativeLocalPhotoGallery.swift",
  "t": "ios/XDriveIOS/NativeFilesTrash.swift",
  "e": "ios/XDriveIOS/NativeFilesSavedSearches.swift",
  "o": "ios/XDriveIOS/NativeFilesOperationHistory.swift",
  "x": "ios/UITests/XDriveIOSGalleryFilesStabilityUITests.swift",
  "y": "ios/UITests/XDriveIOSNavigationRuntimeUITests.swift",
  "p": "ios/scripts/capture-navigation-smoke-frames.py",
  "m": "ios/scripts/summarize-navigation-latency.py",
  "z": "ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift",
  "j": ".github/workflows/ios-native-navigation-runtime.yml",
  "i": "ios/XDriveIOS/NativeFilesViewer.swift",
  "k": "desktop/tests/ios-native-files-video-firstframe.cjs"
}
const scenarios = [
  {
    "name": "01 Gallery People child push preserves wall",
    "checks": [
      {
        "file": "u",
        "pattern": "NavigationLink\\(isActive: \\$showingPeople\\)",
        "flags": ""
      },
      {
        "file": "u",
        "pattern": "showingPeople \\|\\| showingThumbnailCache",
        "flags": ""
      }
    ]
  },
  {
    "name": "02 Gallery thumbnail cache child push preserves wall",
    "checks": [
      {
        "file": "u",
        "pattern": "NavigationLink\\(isActive: \\$showingThumbnailCache\\)",
        "flags": ""
      },
      {
        "file": "w",
        "pattern": "if !retainWhileCovered \\{\\s*acceptedGeneration = nil",
        "flags": ""
      }
    ]
  },
  {
    "name": "03 Gallery Viewer dismiss reuses verified 48-row snapshot",
    "checks": [
      {
        "file": "w",
        "pattern": "acceptedGeneration == ticket, model\\.completed,[\\s\\S]*?loaded\\(\\)\\s*await readVisibleQueueBadges\\(\\)\\s*return",
        "flags": ""
      }
    ]
  },
  {
    "name": "04 Gallery normal scroll still evicts offscreen rows",
    "checks": [
      {
        "file": "w",
        "pattern": "\\.onDisappear \\{\\s*visible = false\\s*if !retainWhileCovered \\{[\\s\\S]*?model\\.reset\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "05 Gallery Owner change invalidates child route cache",
    "checks": [
      {
        "file": "u",
        "pattern": "showingPeople = false; showingThumbnailCache = false\\s*sourceFilter = nil",
        "flags": ""
      },
      {
        "file": "d",
        "pattern": "\\.id\\(ownerScopeKey\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "06 Gallery unchanged return preserves wall, stale PhotoKit still invalidates",
    "checks": [
      {
        "file": "u",
        "pattern": "let currentEpoch = epoch\\.map \\{\\s*XDriveIOSNativePhotoFingerprintIndex\\.isCurrent\\(\\$0\\)\\s*\\} \\?\\? false",
        "flags": ""
      },
      {
        "file": "u",
        "pattern": "if XDriveIOSUnifiedGalleryScenePolicy\\.requiresResetOnReturn\\([\\s\\S]*?\\) \\{\\s*reset\\(\\)",
        "flags": ""
      },
      {
        "file": "u",
        "pattern": "private func resetWall\\(\\) \\{\\s*selected = nil\\s*viewerReturnAnchor = nil\\s*viewerOpeningPage = nil\\s*wall\\.reset\\(\\)\\s*\\}",
        "flags": ""
      },
      {
        "file": "u",
        "pattern": "private func reset\\(\\) \\{[\\s\\S]*?resetWall\\(\\)[\\s\\S]*?timeline\\.reset\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "07 local Gallery Map retains mounted 64-item window",
    "checks": [
      {
        "file": "l",
        "pattern": "retainWhileCovered: selected != nil \\|\\| showingMap",
        "flags": ""
      },
      {
        "file": "l",
        "pattern": "onRead\\(cached\\)\\s*reportPhotoPageReady\\(\"mounted\", started: pageStarted\\)\\s*await refreshVisibleBackupQueueStatuses\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "08 local Gallery Viewer retains mounted page on cover",
    "checks": [
      {
        "file": "l",
        "pattern": "if selected != nil \\|\\| showingMap \\|\\|\\s*\\(phase == \\.active && authorized\\) \\{[\\s\\S]*?suspendForCoveredNavigation\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "09 local Gallery scroll releases page and thumbnail state",
    "checks": [
      {
        "file": "l",
        "pattern": "if !retainWhileCovered \\{\\s*page = nil\\s*precedingCapturedAt = nil\\s*retainedGeneration = nil",
        "flags": ""
      },
      {
        "file": "l",
        "pattern": "badgeReadEpoch = UUID\\(\\)\\s*if let scanner",
        "flags": ""
      }
    ]
  },
  {
    "name": "10 local Gallery scene and permission revocation clear window",
    "checks": [
      {
        "file": "l",
        "pattern": "if value != \\.active \\{[\\s\\S]*?invalidate\\(with: nil\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "11 local album Map keeps 64-slot verified page",
    "checks": [
      {
        "file": "a",
        "pattern": "retainWhileCovered: selected != nil \\|\\| showingAlbumMap",
        "flags": ""
      },
      {
        "file": "a",
        "pattern": "retainedGeneration == generation,[\\s\\S]*?onRead\\(cached\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "12 local album Viewer same-page return avoids cold reload",
    "checks": [
      {
        "file": "a",
        "pattern": "let sameVerifiedPage = !loading && page\\?\\.startOffset == savedOffset",
        "flags": ""
      }
    ]
  },
  {
    "name": "13 local album Viewer cross-page triggers real revalidation",
    "checks": [
      {
        "file": "a",
        "pattern": "pageRevision == libraryMonitor\\.revision",
        "flags": ""
      },
      {
        "file": "a",
        "pattern": "if sameVerifiedPage \\{\\s*pageRenderRevision &\\+= 1\\s*\\} else \\{\\s*reload\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "14 local album scroll still frees offscreen PhotoKit rows",
    "checks": [
      {
        "file": "a",
        "pattern": "if !retainWhileCovered \\{\\s*page = nil\\s*precedingCapturedAt = nil\\s*retainedGeneration = nil",
        "flags": ""
      }
    ]
  },
  {
    "name": "15 local album directory child back keeps page and position",
    "checks": [
      {
        "file": "a",
        "pattern": "let currentPage = page != nil && !loading && error == nil",
        "flags": ""
      },
      {
        "file": "a",
        "pattern": "isVisible = true\\s*libraryMonitor\\.start\\(\\)\\s*if !currentPage \\{ reload\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "16 local album directory hidden PhotoKit changes force recheck",
    "checks": [
      {
        "file": "a",
        "pattern": "lastConfirmedRevision == libraryMonitor\\.revision",
        "flags": ""
      },
      {
        "file": "a",
        "pattern": "guard isVisible else \\{ return \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "17 local album directory permission/scene change fails closed",
    "checks": [
      {
        "file": "a",
        "pattern": "currentPermission == \\.authorized \\|\\| currentPermission == \\.limited",
        "flags": ""
      },
      {
        "file": "a",
        "pattern": "libraryMonitor\\.stop\\(\\)\\s*invalidate\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "18 Files Home initial mount loads once; offline child pop cannot trigger a fetch loop",
    "checks": [
      {
        "file": "f",
        "pattern": "if !homeReadAttempted \\{\\s*homeReadAttempted = true\\s*reload\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "19 Files nested folder pop reuses verified Owner/sort window",
    "checks": [
      {
        "file": "f",
        "pattern": "XDriveIOSNativeFilesNavigationPolicy\\.canResume\\([\\s\\S]*?sameFolder:",
        "flags": ""
      },
      {
        "file": "n",
        "pattern": "sameOwner && sameFolder && sameQuery",
        "flags": ""
      }
    ]
  },
  {
    "name": "20 Files Recent child folder keeps NavigationLink source",
    "checks": [
      {
        "file": "c",
        "pattern": "if !viewerRefreshPending && selectedFile == nil &&\\s*locateIntent == nil && managementIntent == nil \\{[\\s\\S]*?model\\.suspendForNavigation\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "21 Files Favorites child folder keeps Owner-scoped source",
    "checks": [
      {
        "file": "c",
        "pattern": "func matches\\(_ owner: XDriveNativeOwnerRoot\\?,\\s*kind: XDriveIOSNativeFilesCollectionKind\\) -> Bool",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "loadedOwner = expected",
        "flags": ""
      }
    ]
  },
  {
    "name": "22 Files Recent Viewer return quietly revalidates",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.fullScreenCover\\(item: \\$selectedFile, onDismiss: \\{\\s*selectedOwner = nil\\s*let shouldRefresh = viewerRefreshPending\\s*viewerRefreshPending = false[\\s\\S]*?if shouldRefresh && phase == \\.active && !model\\.loading \\{\\s*reload\\(preserveVerifiedRows: true\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "23 Files Favorites Viewer quiet refresh never blanks verified rows",
    "checks": [
      {
        "file": "c",
        "pattern": "if preserveVerifiedRows && matches\\(expected, kind: kind\\) \\{\\s*suspendForNavigation\\(\\)",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "if !model\\.matches\\(login\\.owner, kind: kind\\) \\{\\s*if model\\.loading",
        "flags": ""
      }
    ]
  },
  {
    "name": "24 Files read-only Locate modal returns without redundant GET",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.sheet\\(item: \\$locateIntent, onDismiss: \\{[\\s\\S]*?if !model\\.matches\\(login\\.owner, kind: kind\\) \\{ reload\\(\\) \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "25 Files advanced filters persist after child navigation",
    "checks": [
      {
        "file": "f",
        "pattern": "searchOptions\\.suspendForNavigation\\(\\)",
        "flags": ""
      },
      {
        "file": "f",
        "pattern": "func suspendForNavigation\\(\\) \\{\\s*epoch = UUID\\(\\)\\s*job\\?\\.cancel\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "26 Files Owner A-B-A reuse revoked and old collection hidden",
    "checks": [
      {
        "file": "c",
        "pattern": "guard model\\.matches\\(login\\.owner, kind: kind\\) else \\{ return \\[\\] \\}",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "loadedOwner = nil\\s*loadedKind = nil\\s*items = \\[\\]",
        "flags": ""
      }
    ]
  },
  {
    "name": "27 Files explicit reload/sort change still invalidates",
    "checks": [
      {
        "file": "f",
        "pattern": "private func reload\\(resetOffset: Bool = false\\)",
        "flags": ""
      },
      {
        "file": "f",
        "pattern": "sameSort: verifiedSort == sort, sameOrder: verifiedOrder == order",
        "flags": ""
      }
    ]
  },
  {
    "name": "28 Gallery/Files retained pages have 48/64 bounded windows",
    "checks": [
      {
        "file": "w",
        "pattern": "Each visible range owns at most 48 reconciled rows",
        "flags": ""
      },
      {
        "file": "l",
        "pattern": "min\\(64, expectedTotal - offset\\)",
        "flags": ""
      },
      {
        "file": "a",
        "pattern": "min\\(64, max\\(0, expectedTotal - offset\\)\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "29 Home verified Favorites silently revalidates after child return",
    "checks": [
      {
        "file": "f",
        "pattern": "else if favoriteShortcuts\\.matches\\(login\\.owner, kind: \\.favorites\\) &&\\s*quickAccess\\.matches\\(login\\.owner\\) \\{[\\s\\S]*?loadFavoriteShortcuts\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "30 Home Favorites refresh preserves verified link identities",
    "checks": [
      {
        "file": "f",
        "pattern": "favoriteShortcuts\\.load\\(\\s*\\.favorites, login: login, preserveVerifiedRows: sameOwner",
        "flags": ""
      }
    ]
  },
  {
    "name": "31 Shared Quick Access still suppresses duplicate Owner reads",
    "checks": [
      {
        "file": "f",
        "pattern": "quickAccess\\.load\\(login: login\\)",
        "flags": ""
      },
      {
        "file": "q",
        "pattern": "if matches\\(expected\\) && !force \\{ return \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "32 Recent nested-folder return quietly revalidates current list",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.onAppear \\{\\s*isVisible = true[\\s\\S]*?guard phase == \\.active, !viewerRefreshPending else \\{ return \\}[\\s\\S]*?reload\\(preserveVerifiedRows: true\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "33 Favorites nested-folder return quietly revalidates current list",
    "checks": [
      {
        "file": "c",
        "pattern": "model\\.matches\\(login\\.owner, kind: kind\\)[\\s\\S]*?reload\\(preserveVerifiedRows: true\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "34 Viewer dismissal and onAppear do not start two reads",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.onAppear \\{\\s*isVisible = true[\\s\\S]*?guard phase == \\.active, !viewerRefreshPending else \\{ return \\}",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "\\.fullScreenCover\\(item: \\$selectedFile, onDismiss: \\{[\\s\\S]*?let shouldRefresh = viewerRefreshPending\\s*viewerRefreshPending = false",
        "flags": ""
      }
    ]
  },
  {
    "name": "35 Locate read-only dismissal reuses the exact Owner projection",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.sheet\\(item: \\$locateIntent, onDismiss: \\{[\\s\\S]*?if !model\\.matches\\(login\\.owner, kind: kind\\) \\{ reload\\(\\) \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "36 SwiftUI reused collection StateObject cannot confuse Recent with Favorites",
    "checks": [
      {
        "file": "c",
        "pattern": "private var loadedKind: XDriveIOSNativeFilesCollectionKind\\?",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "loadedKind == kind else \\{ return false \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "37 Collection invalidation also clears its old projection kind",
    "checks": [
      {
        "file": "c",
        "pattern": "func invalidate\\(\\) \\{[\\s\\S]*?loadedOwner = nil\\s*loadedKind = nil\\s*items = \\[\\]",
        "flags": ""
      }
    ]
  },
  {
    "name": "38 Successful collection GET attaches Owner and kind before publishing items",
    "checks": [
      {
        "file": "c",
        "pattern": "loadedOwner = expected\\s*loadedKind = kind\\s*items = fetched\\s*verified = true",
        "flags": ""
      }
    ]
  },
  {
    "name": "39 Collection heading will not show another kind's cached rows",
    "checks": [
      {
        "file": "c",
        "pattern": "guard model\\.matches\\(login\\.owner, kind: kind\\) else \\{ return \\[\\] \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "40 Kind mismatch shows loading or explicit retry, never an empty-old-category flash",
    "checks": [
      {
        "file": "c",
        "pattern": "if !model\\.matches\\(login\\.owner, kind: kind\\) \\{\\s*if model\\.loading \\{[\\s\\S]*?ProgressView\\(\"正在核验当前文件列表…\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "41 Same Owner and kind only can reuse rows on a quiet GET",
    "checks": [
      {
        "file": "c",
        "pattern": "if preserveVerifiedRows && matches\\(expected, kind: kind\\) \\{\\s*suspendForNavigation\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "42 Rapid changed collection route invalidates stale async reads",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.onChange\\(of: kind\\) \\{ _ in[\\s\\S]*?model\\.invalidate\\(\\)[\\s\\S]*?if phase == \\.active \\{ reload\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "43 Old kind's file Viewer and locate intent are retired on route switch",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.onChange\\(of: kind\\) \\{ _ in[\\s\\S]*?selectedFile = nil[\\s\\S]*?locateIntent = nil[\\s\\S]*?managementIntent = nil",
        "flags": ""
      }
    ]
  },
  {
    "name": "44 Collection child pop suspends obsolete GET without dropping links",
    "checks": [
      {
        "file": "c",
        "pattern": "if !viewerRefreshPending && selectedFile == nil &&\\s*locateIntent == nil && managementIntent == nil \\{[\\s\\S]*?model\\.suspendForNavigation\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "45 Album directory hidden PhotoKit revision triggers fresh read on return",
    "checks": [
      {
        "file": "a",
        "pattern": "lastConfirmedRevision == libraryMonitor\\.revision",
        "flags": ""
      },
      {
        "file": "a",
        "pattern": "if !currentPage \\{ reload\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "46 Album directory stops monitor on scene inactivity, not child navigation",
    "checks": [
      {
        "file": "a",
        "pattern": "if state == \\.active \\{[\\s\\S]*?\\} else \\{\\s*libraryMonitor\\.stop\\(\\)\\s*invalidate\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "47 Inactive Files collection does not start an unnecessary network GET on appear",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.onAppear \\{\\s*isVisible = true[\\s\\S]*?guard phase == \\.active, !viewerRefreshPending else \\{ return \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "48 Collection stale result cannot commit after the epoch or Owner has changed",
    "checks": [
      {
        "file": "c",
        "pattern": "guard epoch == ticket,\\s*XDriveIOSNativePhotoOwnerScope\\.matches\\(login\\.owner, expected\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "49 Files Recent inactive appear waits for foreground",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.onAppear \\{\\s*isVisible = true[\\s\\S]*?guard phase == \\.active, !viewerRefreshPending else \\{ return \\}",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "\\.onChange\\(of: phase\\) \\{ state in[\\s\\S]*?else if isVisible && !model\\.loading &&\\s*selectedFile == nil && !viewerRefreshPending",
        "flags": ""
      }
    ]
  },
  {
    "name": "50 Files Favorites background cancels pending Owner reads",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.onChange\\(of: phase\\) \\{ state in\\s*if state != \\.active \\{[\\s\\S]*?model\\.suspendForNavigation\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "51 Files foreground revalidates exact Owner and kind",
    "checks": [
      {
        "file": "c",
        "pattern": "reload\\(preserveVerifiedRows: model\\.matches\\(login\\.owner, kind: kind\\)\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "52 Files child folder is hidden until returning to source",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.onDisappear \\{\\s*isVisible = false[\\s\\S]*?model\\.suspendForNavigation\\(\\)",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "else if isVisible && !model\\.loading",
        "flags": ""
      }
    ]
  },
  {
    "name": "53 Files Viewer return avoids duplicate GET when refresh in progress",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.fullScreenCover\\(item: \\$selectedFile, onDismiss: \\{[\\s\\S]*?let shouldRefresh = viewerRefreshPending\\s*viewerRefreshPending = false[\\s\\S]*?if shouldRefresh && phase == \\.active && !model\\.loading \\{\\s*reload\\(preserveVerifiedRows: true\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "54 Files obsolete async result is fenced by request epoch",
    "checks": [
      {
        "file": "c",
        "pattern": "guard epoch == ticket,[\\s\\S]*?XDriveIOSNativePhotoOwnerScope\\.matches\\(login\\.owner, expected\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "55 Files wrong-kind state shows neutral loading placeholder",
    "checks": [
      {
        "file": "c",
        "pattern": "if !model\\.matches\\(login\\.owner, kind: kind\\) \\{\\s*if model\\.loading[\\s\\S]*?ProgressView\\(\"正在核验当前文件列表…\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "56 Files Home Favorites compiler call carries explicit cache kind",
    "checks": [
      {
        "file": "f",
        "pattern": "favoriteShortcuts\\.matches\\(login\\.owner, kind: \\.favorites\\)",
        "flags": ""
      },
      {
        "file": "f",
        "pattern": "guard isHome, favoriteShortcuts\\.verified,\\s*favoriteShortcuts\\.matches\\(login\\.owner, kind: \\.favorites\\)",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "func matches\\(_ owner: XDriveNativeOwnerRoot\\?,\\s*kind: XDriveIOSNativeFilesCollectionKind\\) -> Bool",
        "flags": ""
      }
    ]
  },
  {
    "name": "57 Files page bounds check before cursor arithmetic",
    "checks": [
      {
        "file": "v",
        "pattern": "startOffset <= total,\\s*loadedIDs.count <= total - startOffset",
        "flags": ""
      }
    ]
  },
  {
    "name": "58 Files next range bounds check before cursor arithmetic",
    "checks": [
      {
        "file": "v",
        "pattern": "startOffset <= total,\\s*loadedCount <= total - startOffset",
        "flags": ""
      }
    ]
  },
  {
    "name": "59 PhotoKit Viewer return requires a well-formed unique page",
    "checks": [
      {
        "file": "r",
        "pattern": "Set\\(currentPageIDs\\)\\.count == currentPageIDs\\.count",
        "flags": ""
      }
    ]
  },
  {
    "name": "60 Gallery shared wall refuses duplicate return anchors",
    "checks": [
      {
        "file": "g",
        "pattern": "for item in verifiedIDs where item == anchor \\{\\s*if found \\{ return false \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "61 Files Recent Favorites management return retains verified projection",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.sheet\\(item: \\$managementIntent, onDismiss: \\{[\\s\\S]*?reload\\(preserveVerifiedRows: model\\.matches\\(login\\.owner, kind: kind\\)\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "62 Local Gallery foreground refresh only invalidates once",
    "checks": [
      {
        "file": "s",
        "pattern": "private func refresh\\(at requestedOffset: Int = 0\\)[\\s\\S]*?load\\(offset: max\\(0, requestedOffset\\)\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "63 Cloud Files unauthorised error has explicit native escape",
    "checks": [
      {
        "file": "f",
        "pattern": "accessibilityIdentifier\\(\"native-ios-files-error-return\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "64 Trash unauthorised error has explicit native escape",
    "checks": [
      {
        "file": "t",
        "pattern": "accessibilityIdentifier\\(\"native-ios-files-trash-error-return\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "65 Saved Searches modal exposes stable content accessibility",
    "checks": [
      {
        "file": "e",
        "pattern": "accessibilityIdentifier\\(\"native-ios-files-saved-searches-page\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "66 Operation History modal exposes stable content accessibility",
    "checks": [
      {
        "file": "o",
        "pattern": "accessibilityIdentifier\\(\"native-ios-files-operation-history-page\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "67 Unreadable Cloud Files swaps complex list for a bounded native error surface",
    "checks": [
      {
        "file": "f",
        "pattern": "if !isHome && !isGlobalSearch && !model\\.loading && !model\\.verifiedPage,[\\s\\S]*?let failure = model\\.errorMessage[\\s\\S]*?native-ios-files-error-page",
        "flags": ""
      }
    ]
  },
  {
    "name": "68 Unreadable Cloud Files never automatically reloads on return",
    "checks": [
      {
        "file": "f",
        "pattern": "else if !isHome && !model\\.verifiedPage &&\\s*model\\.errorMessage != nil \\{[\\s\\S]*?Explicit Retry",
        "flags": ""
      }
    ]
  },
  {
    "name": "69 Unreadable Trash hides the destructive List behind a bounded error surface",
    "checks": [
      {
        "file": "t",
        "pattern": "if let failure = model\\.error, !model\\.loading,[\\s\\S]*?!model\\.canDisplay\\(owner: login\\.owner\\)[\\s\\S]*?native-ios-files-trash-error-page",
        "flags": ""
      }
    ]
  },
  {
    "name": "70 Trash failed reentry remains terminal until explicit Retry",
    "checks": [
      {
        "file": "t",
        "pattern": "if phase == \\.active && !model\\.loading && model\\.error == nil \\{[\\s\\S]*?reload\\(preserveVisibleRows: true\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "71 Cloud navigation captures a real screen before accessibility enumeration",
    "checks": [
      {
        "file": "x",
        "pattern": "evidence\\.name = \"cloud-child-after-push\"[\\s\\S]*?native-ios-files-error-page",
        "flags": ""
      }
    ]
  },
  {
    "name": "72 Trash navigation captures a real screen before accessibility enumeration",
    "checks": [
      {
        "file": "y",
        "pattern": "evidence\\.name = \"trash-child-after-push\"[\\s\\S]*?native-ios-files-trash-error-page",
        "flags": ""
      }
    ]
  },
  {
    "name": "73 Gallery and Files background resume have real app activation tests",
    "checks": [
      {
        "file": "x",
        "pattern": "func testGalleryBackgroundResumeKeepsNativeSourceAndPixels\\(\\)[\\s\\S]*?func testFilesBackgroundResumeKeepsQuickRailAndPixels\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "74 Gallery and Files rotation roundtrip is exercised on simulator",
    "checks": [
      {
        "file": "x",
        "pattern": "func testGalleryFilesRotateLandscapeAndReturnPortrait\\(\\)[\\s\\S]*?device\\.orientation = \\.landscapeLeft",
        "flags": ""
      }
    ]
  },
  {
    "name": "75 Native Files search and gallery return is tested after typing",
    "checks": [
      {
        "file": "x",
        "pattern": "func testFilesSearchFocusThenGalleryReturnPreservesShell\\(\\)[\\s\\S]*?search\\.typeText\\(\"ab\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "76 Files deep home scroll return revalidates native quick rail",
    "checks": [
      {
        "file": "x",
        "pattern": "func testFilesHomeDeepScrollTabReturnKeepsQuickNavigation\\(\\)[\\s\\S]*?list\\.swipeUp\\(\\)[\\s\\S]*?checkFilesHome\\(app\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "77 App native relaunch and first Files mount remain tested",
    "checks": [
      {
        "file": "x",
        "pattern": "func testFilesGalleryNativeRelaunchDoesNotLoseInitialPages\\(\\)[\\s\\S]*?app\\.terminate\\(\\)[\\s\\S]*?app\\.launch\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "78 Native Files Gallery Mine cross-tab returns use image audit",
    "checks": [
      {
        "file": "x",
        "pattern": "func testAlternatingGalleryFilesSettledFramesAcrossThreeTabs\\(\\)[\\s\\S]*?assertNotSolidScreen\\(app, \"Files\"\\)[\\s\\S]*?assertNotSolidScreen\\(app, \"Mine\"\\)[\\s\\S]*?assertNotSolidScreen\\(app, \"Gallery\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "79 Twenty additional Gallery Files XCUITest routes",
    "checks": [
      {
        "file": "x",
        "pattern": "func testAlbumSourceReturnThroughFilesAndMineKeepsGalleryMounted\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testFilesRecentAndFavoritesRemainAvailableAfterForegroundReturn\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testGalleryPeopleAfterFilesQuickRailReturnKeepsUnifiedWall\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testGalleryFilterCancelAfterRecentFavoritesToggle\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testNativeLocalGalleryMenuRouteReturnsToUnifiedSource\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testGalleryAlbumSourceWithLandscapeAndTabReturn\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testFilesHomeAfterRepeatedNativeGallerySourceChanges\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testCloudFilesRepeatedOfflineRetryRetainsRecoverableChildPage\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testRecentlyDeletedRepeatedOfflineRetryRetainsRecoverableChildPage\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testGalleryPeopleAfterOfflineFilesErrorReturnHasNoSettledBlank\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testGalleryAlbumsAndOriginalsAfterForegroundResumeKeepSourceRail\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testNativeFilesQuickRailAfterLandscapeGalleryReturnNoBlank\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testLocalPhotoSourceRetainsGalleryAfterFilesForegroundRoundtrip\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testSyntheticOwnerFilesAndGalleryRelaunchDoesNotRetainOldScope\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testCloudDeniedThenAlbumFilterFilesRoundTripKeepsRealShells\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testTrashDeniedRetryThenFilesRailAndGalleryReturnKeepsPixels\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testGalleryPeopleThenCloudDeniedAndGalleryReturnNoSettledBlank\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testRepeatedForegroundResumesAlternatingGalleryAndFilesNoBlank\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testLocalPhotosSourceSurvivesFilesMineAndGalleryRoundTrip\\(\\)",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "func testFilesSearchThenGalleryFilterAndBackKeepsBothRoutes\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "80 Native tap and shell readiness telemetry",
    "checks": [
      {
        "file": "x",
        "pattern": "IOS_NATIVE_NAV_TAP_START route=",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "IOS_NATIVE_NAVIGATION_READY_MS route=",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "navigationStarted = Date\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "81 Tap-adjacent and case-start frame samples stay bounded",
    "checks": [
      {
        "file": "p",
        "pattern": "FRAME_OFFSETS_SECONDS = \\(0\\.5, 1\\.5, 3\\.5\\)",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "TAP_FRAME_OFFSETS_SECONDS = \\(0\\.15, 0\\.55\\)",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "TARGETS.update\\(NAV_TARGETS\\)",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "scheduled_after_tap_seconds",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "capture_mode",
        "flags": ""
      }
    ]
  },
  {
    "name": "82 Finished cases cannot capture frames of subsequent navigation",
    "checks": [
      {
        "file": "p",
        "pattern": "if key not in active:",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "current_case == key",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "tap_counts.get\\(current_case, 0\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "83 Video first frame and file jump remain separate from FPS",
    "checks": [
      {
        "file": "m",
        "pattern": "VIDEO_FIRST_FRAME_PATTERN",
        "flags": ""
      },
      {
        "file": "m",
        "pattern": "JUMP_VERIFIED_PATTERN",
        "flags": ""
      },
      {
        "file": "m",
        "pattern": "zero_samples_means_not_measured",
        "flags": ""
      },
      {
        "file": "m",
        "pattern": "is_physical_device_fps",
        "flags": ""
      }
    ]
  },
  {
    "name": "84 Local PhotoKit tab-return uses current verified page",
    "checks": [
      {
        "file": "l",
        "pattern": "navigationRetainedPage.startOffset == offset",
        "flags": ""
      },
      {
        "file": "l",
        "pattern": "page = navigationRetainedPage",
        "flags": ""
      },
      {
        "file": "l",
        "pattern": "reportPhotoPageReady\\(\"tab-return\", started: pageStarted\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "85 Nine real no-Session recovery and background XCUITest routes",
    "checks": [
      {
        "file": "z",
        "pattern": "func testCloudFolderNoSessionIsSmallNativeRecoveryInsteadOfFilesList\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testRecentlyDeletedNoSessionDoesNotMountDestructiveRows\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testAlternatingDeniedCloudAndTrashChildrenKeepsHomeRail\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testDeniedChildBackgroundResumeRetainsExplicitRecoveryAndGallery\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testSignedOutOwnerCannotExposeCloudLocationAfterRelaunch\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testNoSessionCloudReturnAfterGalleryAlbumRoundtrip\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testNoSessionTrashReturnAfterGalleryFilterDismissal\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testRepeatedDeniedCloudDoesNotRenderProtectedRowsOrRetry\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testRepeatedDeniedTrashDoesNotRenderDestructiveRowsOrRetry\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "86 Both protected Readers fail closed before constructing a File or Trash List",
    "checks": [
      {
        "file": "f",
        "pattern": "if folder != nil && !login.hasLocalOwnerSession",
        "flags": ""
      },
      {
        "file": "t",
        "pattern": "if !login.hasLocalOwnerSession",
        "flags": ""
      },
      {
        "file": "f",
        "pattern": "XDriveIOSNativeFilesNoSessionRoute",
        "flags": ""
      },
      {
        "file": "f",
        "pattern": "native-ios-files-error-page",
        "flags": ""
      },
      {
        "file": "t",
        "pattern": "native-ios-files-trash-error-page",
        "flags": ""
      }
    ]
  },
  {
    "name": "87 Absent Session offers Back but cannot retry protected Reads",
    "checks": [
      {
        "file": "x",
        "pattern": "XCTAssertFalse\\(target\\(\"native-ios-files-retry\"",
        "flags": ""
      },
      {
        "file": "x",
        "pattern": "XCTAssertFalse\\(target\\(\"native-ios-files-trash-retry\"",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "XCTAssertFalse\\(element\\(\"native-ios-files-retry\"",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "XCTAssertFalse\\(element\\(\"native-ios-files-trash-retry\"",
        "flags": ""
      }
    ]
  },
  {
    "name": "88 Native mandatory no-Session simulator shard remains enabled",
    "checks": [
      {
        "file": "j",
        "pattern": "source: \\[release-c83, candidate-navigation, candidate-gallery-files, candidate-no-session, candidate-mapkit(?:, candidate-performance)?\\]",
        "flags": ""
      },
      {
        "file": "j",
        "pattern": "XDriveIOSFilesSessionRecoveryUITests",
        "flags": ""
      }
    ]
  },
  {
    "name": "89 Live watcher collects bounded failing no-Session returns",
    "checks": [
      {
        "file": "p",
        "pattern": "testRepeatedDeniedCloudDoesNotRenderProtectedRowsOrRetry",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "testRepeatedDeniedTrashDoesNotRenderDestructiveRowsOrRetry",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "testNoSessionTrashReturnAfterGalleryFilterDismissal",
        "flags": ""
      }
    ]
  },
  {
    "name": "90 Video navigation bottom bar stays interactive when playback chrome is hidden",
    "checks": [
      {
        "file": "i",
        "pattern": "\\.toolbar\\(chromeVisible \\? \\.visible : \\.hidden, for: \\.navigationBar\\)",
        "flags": ""
      },
      {
        "file": "i",
        "pattern": "\\.toolbar\\(isNativeVideo \\? \\.visible :[\\s\\S]*?for: \\.bottomBar\\)",
        "flags": ""
      },
      {
        "file": "i",
        "pattern": "Label\\(\"下一项\", systemImage: \"chevron\\.right\"\\)",
        "flags": ""
      },
      {
        "file": "k",
        "pattern": "\\.toolbar\\\\\\(isNativeVideo",
        "flags": ""
      }
    ]
  },
  {
    "name": "91 Signed device first-frame evidence is AVPlayerLayer-rendered and privacy-safe",
    "checks": [
      {
        "file": "i",
        "pattern": "import OSLog",
        "flags": ""
      },
      {
        "file": "i",
        "pattern": "Logger\\(subsystem: \"com\\.xdrive\\.ios\", category: \"FilesVideoFirstFrame\"\\)",
        "flags": ""
      },
      {
        "file": "i",
        "pattern": "current === renderedPlayer,[\\s\\S]*?!videoFirstFrameRecorded",
        "flags": ""
      },
      {
        "file": "i",
        "pattern": "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=",
        "flags": ""
      }
    ]
  },
  {
    "name": "92 Five extra real no-Session UI journeys guard native denial and recovery",
    "checks": [
      {
        "file": "z",
        "pattern": "func testTrashDenialAcrossRepeatedForegroundActivationsStaysReadOnly\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testFilesQuickRailThenCloudDenialKeepsProtectedGridAbsent\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testCloudDenialGalleryFilterFilesReturnCanReenterDeniedChild\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testTrashDenialPeopleBackThenTrashDenialDoesNotLeakRows\\(\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "func testCloudAndTrashDenialsCaptureVisibleNativeRecoveryScreens\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "93 Those five no-Session journeys have actual early Simulator frame evidence",
    "checks": [
      {
        "file": "p",
        "pattern": "testTrashDenialAcrossRepeatedForegroundActivationsStaysReadOnly",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "testFilesQuickRailThenCloudDenialKeepsProtectedGridAbsent",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "testCloudDenialGalleryFilterFilesReturnCanReenterDeniedChild",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "testTrashDenialPeopleBackThenTrashDenialDoesNotLeakRows",
        "flags": ""
      },
      {
        "file": "p",
        "pattern": "testCloudAndTrashDenialsCaptureVisibleNativeRecoveryScreens",
        "flags": ""
      }
    ]
  },
  {
    "name": "94 Missing local session never offers destructive or unauthenticated retry controls",
    "checks": [
      {
        "file": "f",
        "pattern": "struct XDriveIOSNativeFilesNoSessionRoute: View",
        "flags": ""
      },
      {
        "file": "f",
        "pattern": "当前没有有效的原生登录会话",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "XCTAssertFalse\\(element\\(\"native-ios-files-trash-retry\", app\\)\\.exists\\)",
        "flags": ""
      },
      {
        "file": "z",
        "pattern": "XCTAssertFalse\\(element\\(\"native-ios-files-grid\", app\\)\\.exists\\)",
        "flags": ""
      }
    ]
  }
]
const cache = new Map()
function read(fileKey) {
  if (!cache.has(fileKey)) {
    cache.set(fileKey, fs.readFileSync(path.resolve(__dirname, '../..', sources[fileKey]), 'utf8'))
  }
  return cache.get(fileKey)
}
for (const scenario of scenarios) {
  test(scenario.name, () => {
    for (const check of scenario.checks) {
      assert.match(read(check.file), new RegExp(check.pattern, check.flags))
    }
  })
}
