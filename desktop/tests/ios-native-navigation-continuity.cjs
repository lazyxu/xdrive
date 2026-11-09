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
  "b": "ios/UITests/XDriveIOSB9ReleaseCrashUITests.swift",
  "j": ".github/workflows/ios-native-navigation-runtime.yml",
  "h": "ios/XDriveIOS/NativeOwnerLoginModel.swift",
  "z": "ios/UITests/XDriveIOSFilesSessionRecoveryUITests.swift",
  "p": "ios/scripts/capture-navigation-smoke-frames.py"
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
    "name": "06 Gallery PhotoKit/scene changes invalidate cached pages",
    "checks": [
      {
        "file": "u",
        "pattern": "!XDriveIOSNativePhotoFingerprintIndex\\.isCurrent\\(library\\) \\{ reset\\(\\) \\}",
        "flags": ""
      },
      {
        "file": "u",
        "pattern": "timeline\\.reset\\(\\)\\s*wall\\.reset\\(\\)",
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
        "pattern": "onRead\\(cached\\)\\s*await refreshVisibleBackupQueueStatuses\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "08 local Gallery Viewer retains mounted page on cover",
    "checks": [
      {
        "file": "l",
        "pattern": "if selected != nil \\|\\| showingMap \\|\\|[\\s\\S]*?suspendForCoveredNavigation\\(\\)",
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
        "pattern": "if !isHome && !isGlobalSearch && parentID != nil &&\\s*!model\\.loading && !model\\.verifiedPage,[\\s\\S]*?let failure = model\\.errorMessage[\\s\\S]*?native-ios-files-error-page",
        "flags": ""
      }
    ]
  },
  {
    "name": "68 Unreadable Cloud Files never automatically reloads on return",
    "checks": [
      {
        "file": "f",
        "pattern": "else if !isGlobalSearch && !model\\.verifiedPage &&\\s*model\\.errorMessage != nil \\{[\\s\\S]*?explicit Retry",
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
    "name": "79 Local PhotoKit tab leave retains verified window rather than resetting total",
    "checks": [
      {
        "file": "l",
        "pattern": "if selected != nil \\|\\| showingMap \\|\\|[\\s\\S]*?phase == \\.active && authorized[\\s\\S]*?suspendForCoveredNavigation\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "80 Local PhotoKit empty library avoids repeated scans on tab return",
    "checks": [
      {
        "file": "l",
        "pattern": "if authorized && selected == nil && !loading &&\\s*!hasCompletedInitialRead \\{ reload\\(\\) \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "81 Local PhotoKit revision while hidden retires stale IDs without hidden scans",
    "checks": [
      {
        "file": "l",
        "pattern": "if selected == nil && authorized && phase == \\.active &&\\s*isVisible \\{ reload\\(\\) \\}\\s*else \\{ invalidate\\(with: nil\\) \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "82 Local PhotoKit permission change invalidates old page before reuse",
    "checks": [
      {
        "file": "l",
        "pattern": "if freshGrant != permission \\{ invalidate\\(with: nil\\) \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "83 Native album contents retains verified page on foreground tab transition",
    "checks": [
      {
        "file": "a",
        "pattern": "if selected != nil \\|\\| showingAlbumMap \\|\\|[\\s\\S]*?phase == \\.active && albumAuthorized[\\s\\S]*?suspendForViewer\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "84 Native album contents validates current library revision and grant",
    "checks": [
      {
        "file": "a",
        "pattern": "pageRevision == libraryMonitor\\.revision &&\\s*freshGrant == permission",
        "flags": ""
      }
    ]
  },
  {
    "name": "85 Legacy local PhotoKit 64-page tab retention observes library revisions",
    "checks": [
      {
        "file": "s",
        "pattern": "@StateObject private var libraryChanges = XDriveIOSNativeLocalPageChanges\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "86 Legacy local PhotoKit page suspends instead of wiping valid foreground tab",
    "checks": [
      {
        "file": "s",
        "pattern": "if selected != nil \\{\\s*suspendForViewer\\(\\)\\s*\\} else if phase == \\.active[\\s\\S]*?suspendForViewer\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "87 Native Recent Favorites error requires explicit Retry on reentry",
    "checks": [
      {
        "file": "c",
        "pattern": "if !model\\.loading && model\\.error == nil \\{ reload\\(\\) \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "88 Native Recent Favorites scene resume retains verified data",
    "checks": [
      {
        "file": "c",
        "pattern": "if model\\.matches\\(login\\.owner, kind: kind\\) \\{\\s*reload\\(preserveVerifiedRows: true\\)\\s*\\} else if model\\.error == nil \\{\\s*reload\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "89 Native Recent Favorites Owner rotation starts current verified read",
    "checks": [
      {
        "file": "c",
        "pattern": "if isVisible && phase == \\.active && login\\.owner != nil \\{\\s*reload\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "90 Simulator covers local source Menu then Files tab return",
    "checks": [
      {
        "file": "x",
        "pattern": "func testNativeLocalGalleryMenuRouteReturnsToUnifiedSource\\(\\)[\\s\\S]*?native-ios-gallery-source-local[\\s\\S]*?native-ios-tab-files",
        "flags": ""
      }
    ]
  },
  {
    "name": "91 Simulator covers PhotoKit gallery and Files foreground activation",
    "checks": [
      {
        "file": "x",
        "pattern": "func testFilesRecentAndFavoritesRemainAvailableAfterForegroundReturn\\(\\)[\\s\\S]*?XCUIDevice\\.shared\\.press\\(\\.home\\)[\\s\\S]*?app\\.activate\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "92 Simulator covers local album landscape and Files return",
    "checks": [
      {
        "file": "x",
        "pattern": "func testGalleryAlbumSourceWithLandscapeAndTabReturn\\(\\)[\\s\\S]*?device\\.orientation = \\.landscapeLeft",
        "flags": ""
      }
    ]
  },
  {
    "name": "93 B9 no-token operation history uses the actual verified GET error",
    "checks": [
      {
        "file": "b",
        "pattern": "\"history\", message: \"无法验证文件操作历史，请检查网络后重试。\"",
        "flags": ""
      }
    ]
  },
  {
    "name": "94 B9 no-token Saved Searches uses the actual verified GET error",
    "checks": [
      {
        "file": "b",
        "pattern": "\"saved-search\", message: \"无法验证当前账户的智能文件夹，请检查网络后重试。\"",
        "flags": ""
      }
    ]
  },
  {
    "name": "95 B9 force-stop recovery offers safe login without classifying it as crash",
    "checks": [
      {
        "file": "b",
        "pattern": "let rescue = app\\.buttons\\[\"native-ios-startup-safe-entry\"\\]\\.firstMatch",
        "flags": ""
      }
    ]
  },
  {
    "name": "96 Native Simulator shards all live Gallery Files and B9 child suites",
    "checks": [
      {
        "file": "j",
        "pattern": "source: \\[release-c83, candidate-navigation, candidate-gallery-files, candidate-no-session\\]",
        "flags": ""
      }
    ]
  },
  {
    "name": "97 Native navigation candidate runs B9 and Files child tests",
    "checks": [
      {
        "file": "j",
        "pattern": "candidate-navigation\\)[\\s\\S]*?XDriveIOSNavigationRuntimeUITests[\\s\\S]*?XDriveIOSB9ReleaseCrashUITests",
        "flags": ""
      }
    ]
  },
  {
    "name": "98 Native Gallery candidate exercises real framebuffer/return suite",
    "checks": [
      {
        "file": "j",
        "pattern": "candidate-gallery-files\\)[\\s\\S]*?XDriveIOSGalleryFilesStabilityUITests",
        "flags": ""
      }
    ]
  },
  {
    "name": "99 Local PhotoKit Viewer first appearance validates grant before reusing a page",
    "checks": [
      {
        "file": "s",
        "pattern": "if freshGrant != authorization \\{\\s*refresh\\(at: savedOffset\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "100 Local PhotoKit Viewer restores only a matching library revision",
    "checks": [
      {
        "file": "s",
        "pattern": "page == nil \\|\\| retainedLibraryRevision != libraryChanges\\.revision",
        "flags": ""
      }
    ]
  },
  {
    "name": "101 Local PhotoKit Viewer tab switch suspends but does not clear a live page",
    "checks": [
      {
        "file": "s",
        "pattern": "if selected != nil \\{\\s*suspendForViewer\\(\\)\\s*\\} else if phase == \\.active &&[\\s\\S]*?suspendForViewer\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "102 Local album same-page reentry verifies PhotoKit permission and revision",
    "checks": [
      {
        "file": "a",
        "pattern": "pageRevision == libraryMonitor\\.revision &&\\s*freshGrant == permission",
        "flags": ""
      }
    ]
  },
  {
    "name": "103 Local album foreground tab switch keeps bounded page only while authorized",
    "checks": [
      {
        "file": "a",
        "pattern": "if selected != nil \\|\\| showingAlbumMap \\|\\|[\\s\\S]*?phase == \\.active && albumAuthorized\\) \\{\\s*suspendForViewer\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "104 Continuous local PhotoKit empty library does not reload on every tab return",
    "checks": [
      {
        "file": "l",
        "pattern": "if authorized && selected == nil && !loading &&\\s*!hasCompletedInitialRead \\{ reload\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "105 Continuous local PhotoKit observer does not scan an invisible tab",
    "checks": [
      {
        "file": "l",
        "pattern": "if selected == nil && authorized && phase == \\.active &&\\s*isVisible \\{ reload\\(\\) \\}\\s*else \\{ invalidate\\(with: nil\\) \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "106 Recent Favorites failure does not automatically restart auth read",
    "checks": [
      {
        "file": "c",
        "pattern": "if !model\\.loading && model\\.error == nil \\{ reload\\(\\) \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "107 Offline Cloud Files retry is simulated and still returns to native Home",
    "checks": [
      {
        "file": "x",
        "pattern": "func testCloudFilesRepeatedOfflineRetryRetainsRecoverableChildPage\\(\\)[\\s\\S]*?native-ios-files-retry[\\s\\S]*?native-ios-files-error-return",
        "flags": ""
      }
    ]
  },
  {
    "name": "108 Offline Trash retry is simulated without stale destructive rows",
    "checks": [
      {
        "file": "x",
        "pattern": "func testRecentlyDeletedRepeatedOfflineRetryRetainsRecoverableChildPage\\(\\)[\\s\\S]*?native-ios-files-trash-retry[\\s\\S]*?native-ios-files-trash-error-return",
        "flags": ""
      }
    ]
  },
  {
    "name": "109 Gallery People navigation after offline Files captures the settled frame",
    "checks": [
      {
        "file": "x",
        "pattern": "func testGalleryPeopleAfterOfflineFilesErrorReturnHasNoSettledBlank\\(\\)[\\s\\S]*?assertNotSolidScreen\\(app, \"Gallery after offline Files and People\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "110 Gallery Albums Originals foreground and source rail roundtrip is simulated",
    "checks": [
      {
        "file": "x",
        "pattern": "func testGalleryAlbumsAndOriginalsAfterForegroundResumeKeepSourceRail\\(\\)[\\s\\S]*?XCUIDevice\\.shared\\.press\\(\\.home\\)[\\s\\S]*?native-ios-gallery-source-unified",
        "flags": ""
      }
    ]
  },
  {
    "name": "111 Native Files quick rail is rechecked after device rotation and Gallery return",
    "checks": [
      {
        "file": "x",
        "pattern": "func testNativeFilesQuickRailAfterLandscapeGalleryReturnNoBlank\\(\\)[\\s\\S]*?\\.landscapeLeft[\\s\\S]*?assertNotSolidScreen\\(app, \"Files quick rail after rotation\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "112 Synthetic Owner root cannot persist across signed-out process relaunch",
    "checks": [
      {
        "file": "x",
        "pattern": "func testSyntheticOwnerFilesAndGalleryRelaunchDoesNotRetainOldScope\\(\\)[\\s\\S]*?app\\.launchArguments = \\[\"-xdrive-ui-navigation-smoke\"\\][\\s\\S]*?XCTAssertFalse\\(target\\(\"native-ios-files-open-root-location\"",
        "flags": ""
      }
    ]
  },
  {
    "name": "113 Files five-UX durable Owner scope retained after stability patch",
    "checks": [
      {
        "file": "f",
        "pattern": "private let resumeStore = XDriveIOSNativeFilesResumeStore\\(\\)[\\s\\S]*?@State private var resumeTask: Task<Void, Never>\\?",
        "flags": ""
      }
    ]
  },
  {
    "name": "114 Files saved directory is re-proven by signed current Owner read",
    "checks": [
      {
        "file": "f",
        "pattern": "try await reader\\.referencedDirectory\\(nodeID: savedFolderID\\)[\\s\\S]*?let first = try await reader\\.children\\(",
        "flags": ""
      }
    ]
  },
  {
    "name": "115 Files deep anchor persists and restores after verified scrolling",
    "checks": [
      {
        "file": "f",
        "pattern": "lastAppearedNodeID = visibleID\\s*persistVisibleAnchorSoon\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "116 Files-local rail remains accessible within pushed directories",
    "checks": [
      {
        "file": "f",
        "pattern": "private var filesMain: some View \\{\\s*VStack\\(spacing: 0\\) \\{\\s*switch quickSection",
        "flags": ""
      }
    ]
  },
  {
    "name": "117 Files-local section is persisted per Owner, not across accounts",
    "checks": [
      {
        "file": "f",
        "pattern": "resumeStore\\.saveSection\\(option\\.rawValue, owner: owner\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "118 Files Home organizer retained after stability patch",
    "checks": [
      {
        "file": "f",
        "pattern": "showingOrganizeHome = true",
        "flags": ""
      },
      {
        "file": "f",
        "pattern": "Label\\(\"整理浏览首页\", systemImage: \"square\\.grid\\.2x2\"\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "119 Files Viewer deep continuation retained beyond 256",
    "checks": [
      {
        "file": "f",
        "pattern": "private func verifiedViewerAdjacent\\([\\s\\S]*?reader\\.childPosition\\(",
        "flags": ""
      }
    ]
  },
  {
    "name": "120 Files Viewer admitted rows remain bounded after deep continuation",
    "checks": [
      {
        "file": "f",
        "pattern": "viewerAdmitted\\[item\\.id\\] = item[\\s\\S]*?viewerAdmissionOrder\\.count > 512",
        "flags": ""
      }
    ]
  },
  {
    "name": "121 Files sort/group pending state remains visible",
    "checks": [
      {
        "file": "f",
        "pattern": "private var arrangementStatusText: String[\\s\\S]*?native-ios-files-arrangement-status",
        "flags": ""
      }
    ]
  },
  {
    "name": "122 Files Owner change retires stored resume and Viewer history",
    "checks": [
      {
        "file": "f",
        "pattern": "\\.onChange\\(of: login\\.owner\\) \\{ _ in[\\s\\S]*?resumeTask\\?\\.cancel\\(\\)[\\s\\S]*?viewerAdmitted\\.removeAll\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "123 Files error surface never hides global search or verified page",
    "checks": [
      {
        "file": "f",
        "pattern": "if !isHome && !isGlobalSearch && parentID != nil &&\\s*!model\\.loading && !model\\.verifiedPage",
        "flags": ""
      }
    ]
  },
  {
    "name": "124 Files same-Owner Home read does not re-trigger on stack pop",
    "checks": [
      {
        "file": "f",
        "pattern": "if !homeReadAttempted \\{\\s*homeReadAttempted = true\\s*reload\\(\\)[\\s\\S]*?favoriteShortcuts\\.matches\\(login\\.owner, kind: \\.favorites\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "125 No-Session navigation always requires a matching active login scope",
    "checks": [
      {
        "file": "h",
        "pattern": "var hasSameOwnerSessionForNavigation: Bool \\{\\s*guard let active, let owner else \\{ return false \\}\\s*return sameScope\\(active\\.verifiedOwner, owner\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "126 Files root chooses protected reader only with same-Owner active Session",
    "checks": [
      {
        "file": "f",
        "pattern": "if login\\.hasSameOwnerSessionForNavigation \\{\\s*XDriveIOSNativeFilesBrowser\\(",
        "flags": ""
      }
    ]
  },
  {
    "name": "127 No-Session cloud route uses a standalone child instead of the Files List",
    "checks": [
      {
        "file": "f",
        "pattern": "else \\{\\s*XDriveIOSNativeFilesNoSessionChild\\(\\s*login: login, expectedOwner: owner, kind: \\.cloud",
        "flags": ""
      }
    ]
  },
  {
    "name": "128 Trash root chooses full reader only with same-Owner active Session",
    "checks": [
      {
        "file": "f",
        "pattern": "if login\\.hasSameOwnerSessionForNavigation \\{\\s*XDriveIOSNativeFilesTrashScreen\\(login: login\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "129 No-Session Trash route does not instantiate destructive reader",
    "checks": [
      {
        "file": "f",
        "pattern": "else \\{\\s*XDriveIOSNativeFilesNoSessionChild\\(\\s*login: login, expectedOwner: expected, kind: \\.trash",
        "flags": ""
      }
    ]
  },
  {
    "name": "130 No-Session Retry must still re-prove exact Server Owner",
    "checks": [
      {
        "file": "f",
        "pattern": "private func retryAuthorization\\(\\)[\\s\\S]*?let auth = try await login\\.verifiedAuthorization\\(\\)[\\s\\S]*?matches\\(auth\\.owner, expectedOwner\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "131 No-Session retry cannot open after Owner switch",
    "checks": [
      {
        "file": "f",
        "pattern": "verifiedForOpen && login\\.hasSameOwnerSessionForNavigation &&\\s*XDriveIOSNativePhotoOwnerScope\\.matches\\(login\\.owner, expectedOwner\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "132 No-Session Cloud Error uses a stable AX page identifier",
    "checks": [
      {
        "file": "f",
        "pattern": "self == \\.cloud \\? \"native-ios-files-error-page\"",
        "flags": ""
      }
    ]
  },
  {
    "name": "133 No-Session Trash Error uses a stable AX page identifier",
    "checks": [
      {
        "file": "f",
        "pattern": "\"native-ios-files-trash-error-page\"",
        "flags": ""
      }
    ]
  },
  {
    "name": "134 No-Session safe return and Retry controls have real actions",
    "checks": [
      {
        "file": "f",
        "pattern": "Button\\(kind == \\.cloud \\? \"重试当前页\" : \"重试\"\\) \\{\\s*retryAuthorization\\(\\)[\\s\\S]*?Button \\{ dismiss\\(\\) \\}",
        "flags": ""
      }
    ]
  },
  {
    "name": "135 No-Session retry cannot materialize Server error body",
    "checks": [
      {
        "file": "f",
        "pattern": "notice = \"当前服务器会话无法验证，请返回文件首页重新登录。\"",
        "flags": ""
      }
    ]
  },
  {
    "name": "136 No-Session test verifies missing protected file List",
    "checks": [
      {
        "file": "z",
        "pattern": "func testCloudFolderNoSessionIsSmallNativeRecoveryInsteadOfFilesList\\(\\)[\\s\\S]*?XCTAssertFalse\\(element\\(\"native-ios-files-grid\"",
        "flags": ""
      }
    ]
  },
  {
    "name": "137 No-Session test verifies Trash hides destructive rows",
    "checks": [
      {
        "file": "z",
        "pattern": "func testRecentlyDeletedNoSessionDoesNotMountDestructiveRows\\(\\)[\\s\\S]*?XCTAssertFalse\\(delete\\.exists",
        "flags": ""
      }
    ]
  },
  {
    "name": "138 No-Session test verifies retries never authorize fake Owner",
    "checks": [
      {
        "file": "z",
        "pattern": "func testCloudRetryCannotPromoteSyntheticOwnerIntoAuthenticatedReader\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "139 No-Session test verifies failed children can alternate without losing Home",
    "checks": [
      {
        "file": "z",
        "pattern": "func testAlternatingDeniedCloudAndTrashChildrenKeepsHomeRail\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "140 No-Session test verifies foreground resume and Gallery transition",
    "checks": [
      {
        "file": "z",
        "pattern": "func testDeniedChildBackgroundResumeRetainsExplicitRecoveryAndGallery\\(\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "141 Simulator workflow requires standalone no-Session candidate shard",
    "checks": [
      {
        "file": "j",
        "pattern": "source: \\[release-c83, candidate-navigation, candidate-gallery-files, candidate-no-session\\]",
        "flags": ""
      }
    ]
  },
  {
    "name": "142 Live CI screenshot capture targets the failed child route before AX timeout",
    "checks": [
      {
        "file": "p",
        "pattern": "\"testSyntheticOwnerRecentlyDeletedReturnKeepsFilesHomeMounted\"[\\s\\S]*?time\\.monotonic\\(\\) \\+ 12",
        "flags": ""
      }
    ]
  },
  {
    "name": "143 Exact GitHub test runner watches screen frames during Xcode build",
    "checks": [
      {
        "file": "j",
        "pattern": "capture-navigation-smoke-frames\\.py[\\s\\S]*?frame_watcher=\\$!",
        "flags": ""
      }
    ]
  },
  {
    "name": "144 Authentic Files model continues to require current Server authorization",
    "checks": [
      {
        "file": "f",
        "pattern": "let auth = try await login\\.verifiedAuthorization\\(\\)[\\s\\S]*?XDriveIOSNativePhotoOwnerScope\\.matches\\(auth\\.owner, expected\\)",
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
