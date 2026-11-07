'use strict'
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
        "pattern": "acceptedGeneration == ticket, model\\.completed,[\\s\\S]*?loaded\\(\\)\\s*return",
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
    "name": "18 Files Home child pop avoids two duplicate shortcut reads",
    "checks": [
      {
        "file": "f",
        "pattern": "if !favoriteShortcuts\\.matches\\(login\\.owner\\) \\|\\|\\s*!quickAccess\\.matches\\(login\\.owner\\) \\{\\s*reload\\(\\)",
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
        "pattern": "func matches\\(_ owner: XDriveNativeOwnerRoot\\?\\) -> Bool",
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
        "pattern": "if preserveVerifiedRows && matches\\(expected\\) \\{\\s*suspendForNavigation\\(\\)",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "if model\\.loading && !model\\.matches\\(login\\.owner\\)",
        "flags": ""
      }
    ]
  },
  {
    "name": "24 Files read-only Locate modal returns without redundant GET",
    "checks": [
      {
        "file": "c",
        "pattern": "\\.sheet\\(item: \\$locateIntent, onDismiss: \\{[\\s\\S]*?if !model\\.matches\\(login\\.owner\\) \\{ reload\\(\\)",
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
        "pattern": "guard model\\.matches\\(login\\.owner\\) else \\{ return \\[\\] \\}",
        "flags": ""
      },
      {
        "file": "c",
        "pattern": "loadedOwner = nil\\s*items = \\[\\]",
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
