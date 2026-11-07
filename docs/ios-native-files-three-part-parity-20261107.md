# iOS Native Files — three-scope parity implementation (2026-11-07)

**Base:** GitHub master `b137e42cc4c7fd1147ebaa0b4e029cd1d43843a5`.
This implementation is scoped to the Native Files UI, existing Server APIs,
read-only Viewer context and existing original transfer writers. It does not
introduce WebKit, alternate CAS endpoints or changes to other native products.

## 1. Native Files three-way quick navigation

- Files-local native bottom rail: **最近 / 浏览 / 收藏**, above the existing five-slot app navigation.
- Reuses the already authenticated Native `XDriveIOSNativeFilesCollectionScreen`
  for Recent/Favorites, and the existing Browse NavigationStack and verified
  quick-access/tag/saved-search homepage. No second collection API or cache.
- Selection/busy state disables unsafe section switches. The rail does not
  appear within pushed folder navigation, where the ordinary native back
  button remains authoritative.

## 2. Bounded large selection and truthful server batches

- Native can accumulate and select up to **2,048** exact, same-Owner/parent,
  revision-bearing Nodes via authenticated 64-item pages. The selection is
  committed only if all pages agree on total/sort/parent and visible revisions.
- Go's delete/copy/move API still limits each *atomic* transaction to **200**.
  201–2,048 selected Nodes use deterministic 200-node groups and sequential
  existing authenticated writers; every group receives its own receipt.
- A group may commit while a later one fails. Explain this *before* destructive
  confirmation. Cancellation/unknown ACK stops future groups and requires
  explicit user readback; no blind retry, fake full atomicity or rollback.
- Clipboard and tags retain their own 200-item bound. UI selection never
  materializes a 100k directory; cap remains 2,048, with safe manual continuation.

## 3. Original transfers and native Viewer

- Sequential multi-file upload: **64 files** (from 8); preflight and
  per-file 1 GiB staging limit retained. Foreground folder upload: **128 files,
  64 directories, 8 levels, 512 MiB**; complete subtree preflight preserved.
- Batch original export: **32 files, total 2 GiB**, still **1 GiB/file**.
  Every original is verified and temporarily staged sequentially. iOS system
  Share Sheet is not proof that the user saved files; cancel/Owner change
  retires private temporary files.
- Native L3 Viewer uses the existing verified 4×64 sliding directory range,
  allowing previous/next across former 64-row subrange boundaries, up to
  **256** same-parent file identities; no unbounded subtree scan and no silent
  cross-Owner/unstaged neighbor reads. PDFKit/AVPlayer remain native.
- **Boundary:** truly seamless Viewer navigation *beyond* the current verified
  256-row window is still not implemented by this bounded change. This report
  must not claim cross-all-pages infinite navigation.

## Validation

Existing Native Swift policy suites and the modified source contracts remain
required. A new Foundation Swift executable checks 201/2048 chunk decomposition
and invalid Owner/Node identities, and a Node test checks navigation integration,
existing Go atomic limit, sequential writers, cancellation and transfer limits.
The native unsigned IPA must also compile the complete SwiftUI application.

The source change/PR itself is not proof of a passed Xcode build, CI, release,
or installation. Device-level acceptance: **跳过（未验收）**.
