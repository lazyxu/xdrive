# Integrated iOS Photos + native navigation (2026-10-30)

This independent development integration includes the complete exact code histories of Photos security PR #3274 (`0d94895558bcf8b321f84ac444c6c5cfa9587d5d`) and the five-slot native Gallery navigation PR #3278 (`867360af373a3e12e1189d38b3946e6b6eb4af9d`). Neither parent PR head was modified. It is not a released IPA and does not prove real-device behavior.

## Merge resolution
- Preserve #3274's Owner-scoped consent, uncertain ACK review, encrypted ledger/reconciliation, foreground scheduler, album/root verification and signed cloud-preview revocation. No second uploader.
- Use #3278's native **全部 | 动态 | 图库 | 文件 | 我的** bottom shell and bounded PhotoKit album-specific wall.
- Cloud preview now uses `fullScreenCover`: the presenting page does not clear its selected media while that Viewer is up. The independent Owner-change handler still immediately clears selected, revokes the RAM-only preview reader, stops AVPlayer and dismisses.
- iOS unsigned-IPA step runs **both** parents' native source contracts, including photo receipt and consent, album navigation and five-slot stability. Genuine iPhoneOS compilation and complete required CI/Final Gate must be verified on this integration's exact SHA.
- Files/admin/map remain unsupported in native UI and must not report fabricated completion. Server PhotoAsset Gallery is distinct from the iPhone backed-up-original wall; future work must use the existing Owner REST `/api/v1/media/items?range=true` and `/api/v1/media/albums` read contracts.
