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
  "n": "ios/XDriveIOS/NativeFilesNavigationPolicy.swift"
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
        "pattern": "if selected != nil \\|\\| showingMap \\{[\\s\\S]*?suspendForCoveredNavigation\\(\\)",
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
    "name": "18 Files Home child pop retains links and only refreshes changed projection",
    "checks": [
      {
        "file": "f",
        "pattern": "if !favoriteShortcuts\\.matches\\(login\\.owner, kind: \\.favorites\\) \\|\\|\\s*!quickAccess\\.matches\\(login\\.owner\\) \\{\\s*reload\\(\\)",
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
        "pattern": "if selectedFile == nil && locateIntent == nil && managementIntent == nil \\{[\\s\\S]*?model\\.suspendForNavigation\\(\\)",
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
        "pattern": "\\.fullScreenCover\\(item: \\$selectedFile, onDismiss: \\{[\\s\\S]*?reload\\(preserveVerifiedRows: true\\)",
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
    "name": "29 Home's verified Favorites refresh silently on child return",
    "checks": [
      {
        "file": "f",
        "pattern": "if !favoriteShortcuts\\.matches\\(login\\.owner, kind: \\.favorites\\) \\|\\|\\s*!quickAccess\\.matches\\(login\\.owner\\) \\{\\s*reload\\(\\)\\s*\\} else \\{[\\s\\S]*?loadFavoriteShortcuts\\(\\)",
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
    "name": "31 Home Quick Access shared model still skips duplicate Owner requests",
    "checks": [
      {
        "file": "f",
        "pattern": "quickAccess\\.load\\(login: login\\)",
        "flags": ""
      },
      {
        "file": "f",
        "pattern": "if !favoriteShortcuts\\.matches\\(login\\.owner, kind: \\.favorites\\) \\|\\|\\s*!quickAccess\\.matches\\(login\\.owner\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "32 Recent nested-folder return quietly revalidates current list",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.onAppear \\{\\s*isVisible = true\\s*guard phase == \\.active else \\{ return \\}[\\s\\S]*?reload\\(preserveVerifiedRows: true\\)",
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
        "pattern": "selectedFile == nil && locateIntent == nil &&\\s*managementIntent == nil \\{[\\s\\S]*?reload\\(preserveVerifiedRows: true\\)",
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
        "pattern": "if selectedFile == nil && locateIntent == nil && managementIntent == nil \\{[\\s\\S]*?model\\.suspendForNavigation\\(\\)",
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
        "pattern": "\\.onAppear \\{\\s*isVisible = true\\s*guard phase == \\.active else \\{ return \\}",
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
        "pattern": "\\.onAppear \\{\\s*isVisible = true\\s*guard phase == \\.active else \\{ return \\}",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "\\.onChange\\(of: phase\\) \\{ state in[\\s\\S]*?else if isVisible && !model\\.loading",
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
        "pattern": "\\.fullScreenCover\\(item: \\$selectedFile, onDismiss: \\{[\\s\\S]*?if !model\\.loading \\{ reload\\(preserveVerifiedRows: true\\) \\}",
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
