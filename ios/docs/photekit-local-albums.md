# iOS PhotoKit album inventory (read-only, bounded pages)

The native diagnostics panel now has **检查本机相册目录** after the user
grants Full or Limited Photos read access.

- Uses PhotoKit `PHAssetCollection.fetchAssetCollections` for user albums
  and system smart albums, with independent `PHFetchResult.count` metadata.
- Displays at most **32** album rows per explicit page. Next/Previous issue
  another bounded metadata query. No eager `100k` media array, album-image
  decoding, thumbnail download or native Server upload is performed.
- Each album member count is evaluated only within the currently authorized
  iOS Photos scope. With Limited access this is **not** a whole-device album
  count. Albums overlap; adding their counts is not a distinct-media total.
- The entry's ID is an ephemeral row key. No `PHAssetCollection.localIdentifier`,
  Photos asset ID, GPS, user album name or member content is sent to a Server,
  written to a sync ledger, saved in Keychain or persisted in UserDefaults.
- Re-entering the app, changing authorization or leaving the view cancels the
  current album scan and discards prior rows. The Server remains unaware of
  every local collection until a future explicit, authorized sync.
- PhotoKit `PHCollectionList` folder hierarchy and nested album sections are
  not yet indexed in this increment; this is an **album member inventory**
  rather than full iOS Photos hierarchy parity.

The next real backup increment must use an authenticated current Server
Owner/Device/Root, a durable local asset/resource key and authorized original
byte export; the album name alone is not a stable or unique backup identity.
Do not mark a local album count as a synchronized Server PhotoCollection.

Physical iOS Photos Limited/Full/Revoked authorization, 100k performance and
iCloud assets remain **跳过（未验收）** until independently tested.
