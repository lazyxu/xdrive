# Native iOS local PhotoKit Gallery in short landscape (2026-11-01)

Only the fixed Gallery tab's local photo wall and local album member wall. Use actual safe-area width >=680pt, height <500pt, non-accessibility Dynamic Type to collapse static explanations while retaining all permission, paging, refresh, error/progress, and L3 Viewer controls. Limited PhotoKit authorization remains visibly labeled even on short landscape.

Each wall retains the existing ScrollViewReader, transient Viewer anchor and unchanged PhotoKit reauthorization. The navigation-toolbar information action provides the full privacy/iCloud explanation. Portrait and accessibility text retain inline copy. No new uploader, new persistent photos metadata or source navigation.

The existing iOS IPA source contract tests both layouts. Exact-head IPA, CI, Final Gate and GitHub mergeability are required; physical safe-area, rotation and VoiceOver acceptance remain **跳过（未验收）**.