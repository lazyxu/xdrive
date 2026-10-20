# P111 · Gallery Album Folder errors do not reflow accepted cards

## Verified original defect
The shared Web/Mobile Web/Desktop `XDriveMediaGalleryAlbumOrganizer` keeps one 44px breadcrumb row and an authenticated folder list. It already keeps the initial pending folder read silent. However a failed album-folder list or a failed create/rename/move/remove mutation could render a conditional `<Alert>` **in normal vertical Stack layout between breadcrumb and existing folder cards**. The late error inserted one extra Flex/Stack child and pushed the existing cards/album content even though the user had not navigated. Hiding the error is not acceptable.

## Scoped change
Anchor the same real `role=alert` message absolutely within the already `position:relative` folder navigation section, 52px below the permanent 44px breadcrumb row. Bound the warning height and add its standard dismiss control to avoid obscuring the accepted grid indefinitely. It is excluded from normal Stack sizing and does not touch gallery thumbnail loading, album folders' canonical read/generation, writes, breadcrumbs, selection, scrolling or shared Server API.

## Regression
Extend the actual mounted original Gallery Organizer P58/P68 test: first load real folder cards, then reject an original Create Folder mutation, verify the accepted card, breadcrumb and grid are still the **same React test instances**, and assert its readable actionable error remains under the same relative-positioned folder section with `sx.position='absolute'`; close the warning without changing the list. Keep existing P58/P68 cold first-read contract and Web/Desktop Gallery tests. Physical iOS/Android/PWA/WAN/100k CLS or FPS remain NOT RUN. Do not merge without one-work full exact-head CI with Final Gate.
