# iOS Notes Shortcut stable identity and N04 device acceptance

## Stable source identity configuration

The native AppIntent already exposes an optional `sourceIdentifier` parameter. The Server uses that value as the Owner-scoped identity key for `ios_notes`: the same key updates the same read-only backup and creates a FileVersion when content changes. An empty value deliberately creates an independent snapshot on every run.

Do not generate a fresh UUID on every execution. Do not derive the key from title, body, creation date or modification date: titles can change, bodies change, and different notes can share all of them.

Apple's standard Shortcuts Notes actions let a shortcut find a Note and pass its title/body, but do not provide a documented stable Note UUID field that xDrive can safely depend on. Do not treat the private Content Graph representation or an undocumented Notes URL identifier as a supported API. See [Apple's Shortcuts action guidance](https://support.apple.com/guide/shortcuts/apdc33e4f4da/ios) and the documented limitations of extracting Notes identifiers in [MacStories' Content Graph investigation](https://www.macstories.net/ios/creating-lock-screen-widgets-for-specific-notes-via-the-apple-notes-url-scheme/).

### Recommended supported setup: one fixed key per source Note

1. In Shortcuts, create a dedicated shortcut for one Apple Note. Give it a recognizable alias, such as `xDrive — Project Journal`.
2. Add Find Notes. Filter by the note's folder and current title, and set the result limit to 1. If the result is missing or ambiguous, stop instead of importing another note under this key.
3. Add Get Details of Notes and select the Title and Body fields.
4. Generate a UUID once while configuring the shortcut. Copy that value into a Text action as a literal constant, prefixed with `apple-notes:`. Remove the Generate UUID action afterwards; the Text constant must not change between runs.
5. Add the xDrive action “备份 Apple 备忘录到 xDrive”. Map the note title and body to the outputs from Get Details of Notes, and map the Text constant to “Apple 备忘录稳定标识（选填）”.
6. Run the shortcut twice without changing the Note. The second run should identify the same xDrive Note and leave its revision unchanged. Edit the Apple Note and run again: the same xDrive Note should advance revision and retain the previous FileVersion.
7. If the Apple Note is renamed, update the Find Notes filter but keep the same literal source ID. If the shortcut can no longer select exactly one intended Note, stop and correct the selection before running it.

For multiple Notes, use a manually maintained mapping from a unique shortcut alias to a fixed UUID, or create one shortcut per Note. Never use the title itself as the external ID. If you cannot maintain a reliable one-to-one mapping, leave the parameter empty; xDrive will keep each run as a separate snapshot rather than risk merging different Notes.

Example stable key (generate once and keep unchanged):

    apple-notes:00000000-0000-4000-8000-000000000042

## Image and history read/write contract

- Shortcuts text backup accepts the text the user explicitly supplies; it does not read the Apple Notes database or promise full rich-text/attachment extraction.
- Full Markdown plus local images uses the native iOS manual importer: select one Markdown file and all referenced local images together. Remote URLs, traversal, missing images and ambiguous filenames are rejected.
- Each image is uploaded once through the dedicated Owner Notes image route. The receipt is checked against bytes, MIME, SHA-256, Note ID and the immutable `_assets/<note-id>/...` path before the Markdown is updated.
- Current Notes preview and historical-version preview both use the same Owner-authorized image reader. Images are immutable and remain addressable by the same Note-relative path for prior Markdown versions.
- A lost/unknown write ACK is not automatically retried. Check the iOS备份 list and history before manually repeating an import.

## N04 physical iPhone acceptance

Install the exact successful unsigned IPA artifact from the iOS Native Unsigned IPA workflow, sign/install it using the supported SideStore process, and record the installed app SHA/build and iOS version.

| Case | Procedure | Expected result |
| --- | --- | --- |
| Shortcut configuration | Run the dedicated shortcut twice with the same fixed source ID and unchanged Note | Same xDrive Note ID; no duplicate and no new revision |
| Shortcut update | Change the source Note body and run again | Same xDrive Note ID; revision increments; previous Markdown remains in history |
| Missing ID | Run twice with the source ID blank | Two independent snapshots; no title/body deduplication |
| Manual image import | Select one Markdown file plus every referenced local image | Images upload once; rewritten Markdown points only to same-Note immutable assets |
| Current image read | Open the imported backup in native Notes | Actual image bytes are fetched through verified Owner HTTPS and rendered |
| Historical image read | Update an editable note containing an image, then open the previous version | Historical Markdown and its original image both render read-only |
| Cross-account | Switch to a second Owner and open the first Owner's Note/image/history IDs | Not found; no cached first-Owner image or history is shown |
| Unknown ACK | Interrupt network during import or image upload | No automatic duplicate POST; UI asks the user to check the cloud list before retrying |

Record the device, iOS version, app build SHA, Server version, test Note alias (redacted if needed), source-ID reuse result, Note ID/revision, image SHA/bytes, history revision and screenshots. Mark each case PASS, FAIL or NOT RUN.

**Physical acceptance status: NOT RUN.** Repository CI and source-contract tests can verify the transport and UI wiring, but cannot prove operation on a real iPhone, Shortcuts configuration, SideStore installation, iCloud behavior or physical image/history readback.