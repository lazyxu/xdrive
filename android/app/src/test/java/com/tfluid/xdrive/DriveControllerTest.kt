package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DriveControllerTest {
    @Test fun galleryCompactSelectionKeepsPwaTwoRowDockClearance() {
        assertEquals(144f, galleryDockClearance(true, false).value, 0f)
        assertEquals(144f, galleryDockClearance(true, true).value, 0f)
        assertEquals(144f, galleryDockClearance(false, true).value, 0f)
        assertEquals(88f, galleryDockClearance(false, false).value, 0f)
    }

    @Test fun galleryVisibleColumnsKeepsResponsiveBaselineAndBounds() {
        assertEquals(3, galleryVisibleColumns(390f, 3))
        assertEquals(2, galleryVisibleColumns(390f, 2))
        assertEquals(4, galleryVisibleColumns(390f, 4))
        assertEquals(2, galleryVisibleColumns(180f, 2))
        assertEquals(5, galleryVisibleColumns(768f, 3))
        assertEquals(10, galleryVisibleColumns(1500f, 10))
        assertEquals(2, galleryVisibleColumns(Float.NaN, 2))
        assertEquals(4, galleryVisibleColumns(576f, 3))
    }

    private val root = DriveNode(1, name = "", type = "dir")
    private val folder = DriveNode(2, 1, "照片", "dir", revision = 1)
    private val file = DriveNode(3, 1, "readme.txt", "file", 42, revision = 1)

    private open inner class Service : XDriveService {
        val calls = mutableListOf<Pair<Long, Int>>()
        var textPreviewReads = 0
        var textPreviewRequest: suspend (DriveNode) -> FileTextPreview = { node ->
            FileTextPreview("Hello xDrive", false, node.size)
        }
        override suspend fun textFilePreview(
            accessToken: String, node: DriveNode,
        ): FileTextPreview {
            textPreviewReads++
            return textPreviewRequest(node)
        }
        var required = false
        var failure: Exception? = null
        var refreshed = 0
        var refreshFailure: Exception? = null
        var loggedOut = false
        val galleryTagsCalls = mutableListOf<Pair<List<Long>, List<String>>>()
        var galleryTagsFailure: Exception? = null
        override suspend fun galleryTagsBatch(
            accessToken: String, items: List<GalleryAsset>, tags: List<String>,
        ): Int {
            assertEquals("access", accessToken)
            galleryTagsCalls += items.map { it.node.id } to tags
            galleryTagsFailure?.let { throw it }
            return items.size
        }
        val galleryFavoriteCalls = mutableListOf<Pair<List<Long>, Boolean>>()
        var galleryFavoriteFailure: Exception? = null
        override suspend fun galleryFavoriteBatch(
            accessToken: String, items: List<GalleryAsset>, favorite: Boolean,
        ): Int {
            assertEquals("access", accessToken)
            galleryFavoriteCalls += (items.map { it.node.id } to favorite)
            galleryFavoriteFailure?.let { throw it }
            return items.size
        }
        val latestGallery = GalleryAsset(
            DriveNode(990L, 1, "today.jpg", "file", size = 5, revision = 1),
            "image", "2026-10-25T01:00:00Z", hasThumbnail = true)
        val galleryRequests = mutableListOf<Pair<Int, Boolean>>()
        var provideGalleryTimeline = false
        val gallerySearchRequests = mutableListOf<String>()
        val galleryKindRequests = mutableListOf<Pair<String, String>>()
        override suspend fun galleryKindPage(accessToken: String, offset: Int,
            initialLatest: Boolean, search: String, kind: String): GalleryPage {
            galleryKindRequests += search to kind
            galleryGate?.await()
            val media = if (kind == "video") "video" else "image"
            return GalleryPage(listOf(GalleryAsset(
                DriveNode(if (kind == "video") 992L else 993L, 1,
                    if (kind == "video") "filtered.mp4" else "filtered.jpg",
                    "file", size = 100, revision = 1), media, hasThumbnail = true)), 1, 0)
        }
        override suspend fun gallerySearchPage(accessToken: String, offset: Int,
            initialLatest: Boolean, search: String): GalleryPage {
            gallerySearchRequests += search
            galleryGate?.await()
            return GalleryPage(listOf(GalleryAsset(
                DriveNode(991L, 1, "found.jpg", "file", size = 5, revision = 1),
                "image", "2026-10-25T01:00:00Z", hasThumbnail = true)), 1, 0)
        }
        var videoSessionsOpened = 0
        var videoSessionsClosed = 0
        override fun galleryVideoPlayback(accessToken: String, node: DriveNode): OwnerVideoPlayback {
            videoSessionsOpened++
            return OwnerVideoPlayback(
                "https://fixture.invalid/api/v1/files/" + node.id + "/content",
                okhttp3.OkHttpClient(), node.size,
            ) { videoSessionsClosed++ }
        }
        var galleryGate: CompletableDeferred<Unit>? = null
        var galleryFailOlderOnce = false
        override suspend fun galleryPage(
            accessToken: String, offset: Int, initialLatest: Boolean,
        ): GalleryPage {
            galleryRequests += offset to initialLatest
            galleryGate?.await()
            if (initialLatest) return GalleryPage(listOf(latestGallery), 121, 120,
                timeline = if (provideGalleryTimeline) GalleryTimelineSets(
                    year = listOf(
                        GalleryTimelineGroup("2025", 60, 0),
                        GalleryTimelineGroup("2026", 61, 60)),
                    month = listOf(
                        GalleryTimelineGroup("2025-12", 60, 0),
                        GalleryTimelineGroup("2026-10", 61, 60)),
                    day = listOf(
                        GalleryTimelineGroup("unknown", 60, 0),
                        GalleryTimelineGroup("2026-10-25", 61, 60))
                ) else null)
            if (provideGalleryTimeline && offset == 120)
                return GalleryPage(listOf(latestGallery), 121, 120)
            if (galleryFailOlderOnce) {
                galleryFailOlderOnce = false
                throw ApiException(503, "temporary gallery failure")
            }
            val items = (offset until offset + 60).map { id ->
                GalleryAsset(DriveNode(2000L + id, 1, "image-$id.jpg", "file", size = 10, revision = 1),
                    "image", hasThumbnail = true)
            }
            return GalleryPage(items, 121, offset)
        }
        var thumbnailReads = 0
        var thumbnailGate: CompletableDeferred<Unit>? = null
        override suspend fun galleryThumbnail(accessToken: String, nodeId: Long, revision: Long): ByteArray {
            thumbnailReads++
            thumbnailGate?.await()
            return byteArrayOf(1, 2, 3)
        }
        val locateCalls = mutableListOf<Long>()
        val positionCalls = mutableListOf<Pair<Long, Long>>()
        var locateNode: suspend (Long) -> OwnedNodeLocation = { node ->
            OwnedNodeLocation(node, 1, 1, listOf(DriveCrumb(1, "")))
        }
        var positionNode: suspend (Long, Long) -> DirectoryItemPosition = { _, node ->
            DirectoryItemPosition(node, 1, if (node == file.id) 1 else 0)
        }
        override suspend fun nodeLocation(accessToken: String, nodeId: Long): OwnedNodeLocation {
            locateCalls += nodeId
            return locateNode(nodeId)
        }
        override suspend fun childPosition(
            accessToken: String, parentId: Long, nodeId: Long,
        ): DirectoryItemPosition {
            positionCalls += parentId to nodeId
            return positionNode(parentId, nodeId)
        }
        val recentFolder = DriveCollectionItem(folder, "照片",
            listOf(DriveCrumb(1, ""), DriveCrumb(2, "照片")))
        val favoriteFile = DriveCollectionItem(file, "readme.txt",
            listOf(DriveCrumb(1, ""), DriveCrumb(3, "readme.txt")))
        val searchFile = DriveCollectionItem(file, "readme.txt",
            listOf(DriveCrumb(1, ""))) // Go /search emits directory-only crumbs for files.
        var recentRows = listOf(recentFolder)
        var favoriteRows = listOf(favoriteFile)
        var recentListing: suspend () -> List<DriveCollectionItem> = { recentRows }
        var favoriteListing: suspend () -> List<DriveCollectionItem> = { favoriteRows }
        var favoritePuts = 0
        var favoriteDeletes = 0
        val searchCalls = mutableListOf<Pair<String, String>>()
        var searchListing: suspend (String, String) -> FileSearchPage = { _, cursor ->
            if (cursor.isEmpty()) FileSearchPage(listOf(searchFile), "cursor-1")
            else FileSearchPage(listOf(recentFolder), "")
        }
        var downloadReads = 0
        var downloadFailure: Exception? = null
        var downloadGate: CompletableDeferred<Unit>? = null
        override suspend fun downloadFile(accessToken: String, node: DriveNode,
            openDestination: () -> OutputStream, onProgress: (Long) -> Unit): Long {
            downloadReads++
            downloadFailure?.let { throw it }
            openDestination().use { output ->
                output.write("hel".toByteArray())
                onProgress(3)
                downloadGate?.await()
                output.write("lo".toByteArray())
            }
            onProgress(5)
            return 5
        }
        var uploadCount = 0
        var uploadGate: CompletableDeferred<Unit>? = null
        var uploadFailure: Exception? = null
        override suspend fun uploadFile(accessToken: String, parent: DriveNode,
            name: String, size: Long, openSource: () -> InputStream,
            onProgress: (Long) -> Unit): DriveNode {
            uploadCount++
            uploadFailure?.let { throw it }
            openSource().use { source -> source.readBytes() }
            uploadGate?.await()
            onProgress(size)
            val created = DriveNode(800L + uploadCount, parent.id, name, "file", size, revision = 1)
            mutationRows += created
            mutationListing = true
            return created
        }
        var mutationRows = listOf(folder, file)
        var mutationListing = false
        val mutationCalls = mutableListOf<String>()
        var mutationFailure: Exception? = null
        var refreshAfterCommitFailure = false
        var createHandler: suspend (Long, String) -> DriveNode = { parent, name ->
            DriveNode(8, parent, name, "dir", revision = 1)
        }
        var copyHandler: suspend (DriveNode, Long) -> DriveNode = { node, parent ->
            node.copy(id = 31, parentId = parent, name = node.name + " - 副本", revision = 1)
        }
        var moveHandler: suspend (DriveNode, Long) -> DriveNode = { node, parent ->
            node.copy(parentId = parent, revision = node.revision + 1)
        }
        var listing: suspend (Long, Int) -> NodeRange = { _, offset ->
            if (mutationListing) NodeRange(if (offset == 0) mutationRows else emptyList(),
                mutationRows.size.toLong(), offset)
            else NodeRange(if (offset == 0) listOf(folder, file) else listOf(file), 101, offset)
        }
        override suspend fun login(username: String, password: String) = AuthSession("access", "refresh", username, required)
        override suspend fun refresh(refreshToken: String): AuthSession { refreshed++; refreshFailure?.let { throw it }; return AuthSession("new", "rotated", "owner") }
        override suspend fun logout(refreshToken: String) { loggedOut = true }
        override suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String) = AuthSession("changed", "refresh", "owner")
        override suspend fun root(accessToken: String) = root
        override suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange {
            calls += parentId to offset
            failure?.let { failure = null; throw it }
            if (refreshAfterCommitFailure) {
                refreshAfterCommitFailure = false
                throw ApiException(503, "refresh unavailable")
            }
            return listing(parentId, offset)
        }
        override suspend fun createDirectory(accessToken: String, parentId: Long, name: String): DriveNode {
            mutationCalls += "create:$name"
            mutationFailure?.let { mutationFailure = null; throw it }
            val created = createHandler(parentId, name)
            mutationRows += created
            mutationListing = true
            return created
        }
        override suspend fun renameNode(accessToken: String, original: DriveNode, name: String): DriveNode {
            mutationCalls += "rename:$name"
            mutationFailure?.let { mutationFailure = null; throw it }
            val renamed = original.copy(name = name, revision = original.revision + 1)
            mutationRows = mutationRows.map { if (it.id == original.id) renamed else it }
            mutationListing = true
            return renamed
        }
        override suspend fun trashNode(accessToken: String, original: DriveNode) {
            mutationCalls += "trash:${original.id}"
            mutationFailure?.let { mutationFailure = null; throw it }
            mutationRows = mutationRows.filterNot { it.id == original.id }
            mutationListing = true
        }
        override suspend fun trashNodes(accessToken: String, originals: List<DriveNode>) {
            mutationCalls += "batch-trash:${originals.joinToString(",") { "${it.id}@${it.revision}" }}"
            mutationFailure?.let { mutationFailure = null; throw it }
            val ids = originals.map { it.id }.toSet()
            mutationRows = mutationRows.filterNot { it.id in ids }
            mutationListing = true
        }
        override suspend fun copyNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode {
            mutationCalls += "copy:${original.id}->$parentId"
            mutationFailure?.let { mutationFailure = null; throw it }
            val copied = copyHandler(original, parentId)
            if (parentId == root.id) mutationRows += copied
            mutationListing = true
            return copied
        }
        override suspend fun moveNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode {
            mutationCalls += "move:${original.id}->$parentId@${original.revision}"
            mutationFailure?.let { mutationFailure = null; throw it }
            val moved = moveHandler(original, parentId)
            mutationRows = mutationRows.filterNot { it.id == original.id }
            if (parentId == root.id) mutationRows += moved
            mutationListing = true
            return moved
        }
        override suspend fun fileRecent(accessToken: String) = recentListing()
        override suspend fun fileFavorites(accessToken: String) = favoriteListing()
        override suspend fun searchFiles(accessToken: String, query: String, cursor: String): FileSearchPage {
            searchCalls += query to cursor
            return searchListing(query, cursor)
        }
        override suspend fun favoriteFile(accessToken: String, nodeId: Long): DriveCollectionItem {
            assertEquals(file.id, nodeId)
            favoritePuts++
            return favoriteFile
        }
        override suspend fun unfavoriteFile(accessToken: String, nodeId: Long) {
            assertEquals(file.id, nodeId)
            favoriteDeletes++
        }
    }

    private fun controller(scope: CoroutineScope, api: Service) = DriveController(scope, { api }).also {
        it.connect("https://drive.example", false)
    }

    /** Native login no longer has a manual public-IP field. Failure text
     * must guide an actual input without changing pinned Host/SNI behavior. */

    @Test fun gallerySelectionFavoriteCommitsOnceAndBackExitsBeforeFiles() = runTest {
        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val item = c.state.value.galleryItems.single()
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(item)
        assertEquals(listOf(item), c.state.value.gallerySelectedItems)
        c.favoriteGallerySelected(true); runCurrent()
        assertEquals(listOf(listOf(item.node.id) to true), api.galleryFavoriteCalls)
        assertEquals(true, c.state.value.galleryItems.single().favorite)
        assertFalse(c.state.value.gallerySelectionMode)
        assertTrue(c.state.value.gallerySelectedItems.isEmpty())
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(c.state.value.galleryItems.single())
        c.back()
        assertEquals(Screen.GALLERY, c.state.value.screen)
        assertFalse(c.state.value.gallerySelectionMode)
        assertTrue(c.state.value.gallerySelectedItems.isEmpty())
        c.close()
    }


    @Test fun galleryTagsCommitOneOwnerMutationAndClearSelection() = runTest {
        val api = Service()
        val controller = controller(this, api)
        controller.login("owner", "password"); runCurrent()
        controller.openGallery(); runCurrent()
        controller.setGallerySelectionMode(true)
        controller.toggleGallerySelection(controller.state.value.galleryItems.single())
        controller.tagGallerySelected(listOf("Family", "旅行")); runCurrent()
        assertEquals(listOf(listOf(990L) to listOf("Family", "旅行")),
            api.galleryTagsCalls)
        assertFalse(controller.state.value.gallerySelectionMode)
        assertTrue(controller.state.value.gallerySelectedItems.isEmpty())
        assertFalse(controller.state.value.galleryMetadataWriteAttempted)
        controller.close()
    }

    @Test fun galleryTagsUncertainAckNeverReplaysAndAllowsGetOnlyRefresh() = runTest {
        val api = Service().apply {
            galleryTagsFailure = ApiException(503, "ACK lost")
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(c.state.value.galleryItems.single())
        c.tagGallerySelected(listOf("旅行")); runCurrent()
        assertEquals(1, api.galleryTagsCalls.size)
        assertTrue(c.state.value.galleryMetadataWriteAttempted)
        assertTrue(requireNotNull(c.state.value.error).contains("未确认"))
        c.tagGallerySelected(listOf("旅行")); runCurrent()
        assertEquals(1, api.galleryTagsCalls.size)
        c.retryGallery(); runCurrent()
        assertEquals(1, api.galleryTagsCalls.size)
        assertTrue(c.state.value.galleryLoaded)
        assertFalse(c.state.value.galleryMetadataWriteAttempted)
        c.close()
    }


    @Test fun manualAlbumCustomAndAutoCoverUseRealOwnerAckAndList() = runTest {
        val item = GalleryAsset(DriveNode(40, 1, "cover.jpg", "file", 44,
            revision = 2), "image", hasThumbnail = true)
        val initial = GalleryAlbum("manual:cover", "manual", "旅行", 1, 2, 0, 41)
        val api = object : Service() {
            var album = initial
            var listReads = 0
            var memberReads = 0
            val updates = mutableListOf<Long>()
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                assertEquals("access", accessToken)
                listReads++
                return listOf(album)
            }
            override suspend fun galleryAlbumPage(
                accessToken: String, albumId: String, offset: Int,
                initialLatest: Boolean,
            ): GalleryPage {
                assertEquals(album.id, albumId)
                memberReads++
                return GalleryPage(listOf(item), 1, 0)
            }
            override suspend fun gallerySetManualAlbumCover(
                accessToken: String, target: GalleryAlbum, nodeId: Long,
            ): GalleryAlbum {
                assertEquals("access", accessToken)
                assertEquals(album, target)
                updates += nodeId
                album = target.copy(revision = target.revision + 1,
                    coverNodeId = if (nodeId > 0) nodeId else item.node.id)
                return album
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        c.openGalleryAlbum(initial); runCurrent()
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(item)
        c.setGallerySelectedManualAlbumCover(item); runCurrent()
        assertEquals(listOf(40L), api.updates)
        assertEquals(api.album, c.state.value.gallerySelectedAlbum)
        assertFalse(c.state.value.gallerySelectionMode)
        assertFalse(c.state.value.galleryMetadataWriteAttempted)
        assertFalse(c.state.value.galleryAlbumsLoaded)
        assertEquals(listOf(item), c.state.value.galleryItems)
        c.closeGalleryAlbum(); runCurrent()
        assertEquals(2, api.listReads)
        assertEquals(listOf(api.album), c.state.value.galleryAlbums)
        val custom = api.album
        c.restoreGalleryAutomaticAlbumCover(custom); runCurrent()
        assertEquals(listOf(40L, 0L), api.updates)
        assertEquals(3, api.listReads)
        assertEquals(custom.revision + 1, api.album.revision)
        // Go may return the same visible auto cover as the custom one.
        assertEquals(item.node.id, api.album.coverNodeId)
        assertEquals(listOf(api.album), c.state.value.galleryAlbums)
        assertFalse(c.state.value.galleryAlbumEditAttempted)
        assertFalse(c.state.value.galleryAlbumEditCommittedNeedsRefresh)
        c.close()
    }

    @Test fun uncertainManualAlbumCoverAckOnlyReconcilesOwnerGets() = runTest {
        val item = GalleryAsset(DriveNode(40, 1, "cover.jpg", "file", 44,
            revision = 2), "image", hasThumbnail = true)
        val initial = GalleryAlbum("manual:cover", "manual", "旅行", 1, 2, 0, 41)
        val api = object : Service() {
            var album = initial
            var puts = 0
            var listReads = 0
            var memberReads = 0
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                listReads++
                return listOf(album)
            }
            override suspend fun galleryAlbumPage(
                accessToken: String, albumId: String, offset: Int,
                initialLatest: Boolean,
            ): GalleryPage {
                memberReads++
                return GalleryPage(listOf(item), 1, 0)
            }
            override suspend fun gallerySetManualAlbumCover(
                accessToken: String, target: GalleryAlbum, nodeId: Long,
            ): GalleryAlbum {
                puts++
                album = target.copy(revision = target.revision + 1,
                    coverNodeId = nodeId)
                throw ApiException(503, "Owner cover PUT ACK lost")
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        c.openGalleryAlbum(initial); runCurrent()
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(item)
        c.setGallerySelectedManualAlbumCover(item); runCurrent()
        assertEquals(1, api.puts)
        assertTrue(c.state.value.galleryMetadataWriteAttempted)
        c.setGallerySelectedManualAlbumCover(item); runCurrent()
        assertEquals(1, api.puts)
        c.retryGallery(); runCurrent()
        assertEquals(1, api.puts)
        assertEquals(2, api.listReads)
        assertEquals(2, api.memberReads)
        assertEquals(api.album, c.state.value.gallerySelectedAlbum)
        assertFalse(c.state.value.galleryMetadataWriteAttempted)
        assertFalse(c.state.value.gallerySelectionMode)
        c.close()
    }

    @Test fun manualAlbumMemberRemovalChangesOnlyCollectionAndReloadsOwnerRange() = runTest {
        val original = GalleryAlbum("manual:trip", "manual", "旅途", 1, 2, 0, 40)
        val member = GalleryAsset(DriveNode(40, 1, "travel.jpg", "file", 42, revision = 5),
            "image", hasThumbnail = true)
        val api = object : Service() {
            var album = original
            var exists = true
            var deletes = 0
            var memberReads = 0
            var overviewReads = 0
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                overviewReads++
                return listOf(album)
            }
            override suspend fun galleryAlbumPage(
                accessToken: String, albumId: String, offset: Int,
                initialLatest: Boolean,
            ): GalleryPage {
                assertEquals(original.id, albumId)
                memberReads++
                return GalleryPage(if (exists) listOf(member) else emptyList(),
                    if (exists) 1 else 0, 0)
            }
            override suspend fun galleryRemoveFromManualAlbum(
                accessToken: String, selectedAlbum: GalleryAlbum, item: GalleryAsset,
            ): GalleryAlbum {
                assertEquals("access", accessToken)
                assertEquals(album, selectedAlbum)
                assertEquals(member, item)
                deletes++
                exists = false
                return album.copy(revision = album.revision + 1,
                    itemCount = 0, coverNodeId = null).also { album = it }
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        c.openGalleryAlbum(original); runCurrent()
        assertEquals(1, api.memberReads)
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(member)
        c.removeGallerySelectedAlbumMember(member); runCurrent()
        assertEquals(1, api.deletes)
        assertEquals(2, api.memberReads)
        assertTrue(c.state.value.galleryLoaded)
        assertTrue(c.state.value.galleryItems.isEmpty())
        assertEquals(0L, c.state.value.galleryTotal)
        assertEquals(api.album, c.state.value.gallerySelectedAlbum)
        assertFalse(c.state.value.gallerySelectionMode)
        assertFalse(c.state.value.galleryMetadataWriteAttempted)
        assertFalse(c.state.value.galleryAlbumsLoaded)
        c.closeGalleryAlbum(); runCurrent()
        assertEquals(2, api.overviewReads)
        assertEquals(listOf(api.album), c.state.value.galleryAlbums)
        c.close()
    }

    @Test fun missingAlbumRemovalAckRequiresGetOfAlbumAndMembersWithoutWriteReplay() = runTest {
        val original = GalleryAlbum("manual:trip", "manual", "旅途", 1, 2, 0, 40)
        val member = GalleryAsset(DriveNode(40, 1, "travel.jpg", "file", 42, revision = 5),
            "image", hasThumbnail = true)
        val api = object : Service() {
            var album = original
            var exists = true
            var deletes = 0
            var overviewReads = 0
            var memberReads = 0
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                overviewReads++
                return listOf(album)
            }
            override suspend fun galleryAlbumPage(
                accessToken: String, albumId: String, offset: Int,
                initialLatest: Boolean,
            ): GalleryPage {
                memberReads++
                return GalleryPage(if (exists) listOf(member) else emptyList(),
                    if (exists) 1 else 0, 0)
            }
            override suspend fun galleryRemoveFromManualAlbum(
                accessToken: String, selectedAlbum: GalleryAlbum, item: GalleryAsset,
            ): GalleryAlbum {
                deletes++
                exists = false
                album = album.copy(revision = album.revision + 1,
                    itemCount = 0, coverNodeId = null)
                throw ApiException(503, "ACK lost after committed removal")
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        c.openGalleryAlbum(original); runCurrent()
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(member)
        c.removeGallerySelectedAlbumMember(member); runCurrent()
        assertEquals(1, api.deletes)
        assertTrue(c.state.value.galleryMetadataWriteAttempted)
        assertTrue(requireNotNull(c.state.value.error).contains("未确认"))
        c.removeGallerySelectedAlbumMember(member); runCurrent()
        assertEquals(1, api.deletes)
        c.retryGallery(); runCurrent()
        assertEquals(1, api.deletes)
        assertEquals(2, api.overviewReads)
        assertEquals(2, api.memberReads)
        assertEquals(api.album, c.state.value.gallerySelectedAlbum)
        assertTrue(c.state.value.galleryItems.isEmpty())
        assertFalse(c.state.value.gallerySelectionMode)
        assertFalse(c.state.value.galleryMetadataWriteAttempted)
        c.close()
    }

    @Test fun galleryCompactManualAlbumPickerListsOnlyVerifiedManualSearchResults() {
        val manual = GalleryAlbum("manual:trip", "manual", "旅行 2026", 2, 3, 0)
        val smart = GalleryAlbum("smart:trip", "smart", "旅行汇总", 5, 1, 0)
        val imported = GalleryAlbum("source:trip", "imported", "旅行 2025", 2, 1, 0)
        assertEquals(listOf(manual),
            galleryManualAlbumChoices(listOf(smart, imported, manual), "旅行"))
        assertEquals(listOf(manual),
            galleryManualAlbumChoices(listOf(smart, imported, manual), "  2026  "))
        assertTrue(galleryManualAlbumChoices(listOf(smart, imported, manual), "no-match").isEmpty())
        assertTrue(galleryManualAlbumChoices(listOf(smart, imported), "").isEmpty())
    }

    @Test fun manualAlbumSelectionRequiresFreshGetAndClearsOnVerifiedWrite() = runTest {
        val album = GalleryAlbum("manual:trip", "manual", "Trip", 0, 2, 0)
        val api = object : Service() {
            var reads = 0
            var writes = 0
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                assertEquals("access", accessToken)
                reads++
                return listOf(album, GalleryAlbum("smart:recent", "smart", "Recent", 0, 1, 0))
            }
            override suspend fun galleryAddToManualAlbum(
                accessToken: String, target: GalleryAlbum, items: List<GalleryAsset>,
            ): GalleryAlbum {
                assertEquals("access", accessToken)
                assertEquals(album, target)
                assertEquals(listOf(990L), items.map { it.node.id })
                writes++
                return album.copy(revision = 3, itemCount = 1)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(c.state.value.galleryItems.single())
        c.addGallerySelectedToAlbum(album)
        assertEquals(0, api.writes)
        c.loadGalleryAlbumsForSelection(); runCurrent()
        assertEquals(1, api.reads)
        assertTrue(c.state.value.galleryAlbumsLoaded)
        c.addGallerySelectedToAlbum(album); runCurrent()
        assertEquals(1, api.writes)
        assertFalse(c.state.value.gallerySelectionMode)
        assertTrue(c.state.value.gallerySelectedItems.isEmpty())
        assertFalse(c.state.value.galleryAlbumsLoaded)
        c.openGalleryCollections(); runCurrent()
        assertEquals(2, api.reads)
        c.close()
    }

    @Test fun returnFromEditedManualAlbumReloadsInvalidatedCollectionOverview() = runTest {
        val album = GalleryAlbum("manual:trip", "manual", "Trip", 1, 2, 0)
        val api = object : Service() {
            var listReads = 0
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                listReads++
                return listOf(album)
            }
            override suspend fun galleryAlbumPage(
                accessToken: String, albumId: String, offset: Int, initialLatest: Boolean,
            ): GalleryPage {
                assertEquals(album.id, albumId)
                return GalleryPage(listOf(latestGallery), 1, 0)
            }
            override suspend fun galleryAddToManualAlbum(
                accessToken: String, target: GalleryAlbum, items: List<GalleryAsset>,
            ) = album.copy(revision = 3, itemCount = 1)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        assertEquals(1, api.listReads)
        c.openGalleryAlbum(album); runCurrent()
        assertTrue(c.state.value.galleryLoaded)
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(c.state.value.galleryItems.single())
        c.loadGalleryAlbumsForSelection(); runCurrent()
        assertEquals(2, api.listReads)
        c.addGallerySelectedToAlbum(album); runCurrent()
        assertFalse(c.state.value.galleryAlbumsLoaded)
        c.closeGalleryAlbum(); runCurrent()
        assertNull(c.state.value.gallerySelectedAlbum)
        assertTrue(c.state.value.galleryAlbumsLoaded)
        assertEquals(3, api.listReads)
        c.close()
    }

    @Test fun manualAlbumUncertainAckNeverReplaysAndRefreshesGetOnly() = runTest {
        val album = GalleryAlbum("manual:trip", "manual", "Trip", 0, 2, 0)
        val api = object : Service() {
            var writes = 0
            override suspend fun galleryAlbums(accessToken: String) = listOf(album)
            override suspend fun galleryAddToManualAlbum(
                accessToken: String, target: GalleryAlbum, items: List<GalleryAsset>,
            ): GalleryAlbum {
                writes++
                throw ApiException(503, "ACK lost")
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(c.state.value.galleryItems.single())
        c.loadGalleryAlbumsForSelection(); runCurrent()
        c.addGallerySelectedToAlbum(album); runCurrent()
        assertEquals(1, api.writes)
        assertTrue(c.state.value.galleryMetadataWriteAttempted)
        assertTrue(requireNotNull(c.state.value.error).contains("未确认"))
        c.addGallerySelectedToAlbum(album); runCurrent()
        assertEquals(1, api.writes)
        c.retryGallery(); runCurrent()
        assertFalse(c.state.value.galleryMetadataWriteAttempted)
        assertEquals(1, api.writes)
        c.close()
    }

    @Test fun gallerySelectionReviewFilterAndLocalEditsNeverWriteOrLeakAcrossOwner() = runTest {
        val list = listOf(
            GalleryAsset(DriveNode(11, 1, "Trip.JPG", "file", 4, revision = 1), "image"),
            GalleryAsset(DriveNode(12, 1, "night.mp4", "file", 9, revision = 2), "video"),
        )
        assertEquals(list, gallerySelectedReviewFilter(list, " "))
        assertEquals(listOf(list.first()), gallerySelectedReviewFilter(list, "trip"))
        assertEquals(listOf(list[1]), gallerySelectedReviewFilter(list, "  MP4  "))
        assertTrue(gallerySelectedReviewFilter(list, "not-loaded").isEmpty())
        assertTrue(gallerySelectedReviewFilter(emptyList(), "trip").isEmpty())

        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val row = c.state.value.galleryItems.single()
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(row)
        c.removeGallerySelected(-1)
        c.removeGallerySelected(row.node.id + 1)
        assertEquals(listOf(row), c.state.value.gallerySelectedItems)
        c.removeGallerySelected(row.node.id)
        assertTrue(c.state.value.gallerySelectedItems.isEmpty())
        assertTrue(c.state.value.gallerySelectionMode)

        c.toggleGallerySelection(row)
        c.clearGallerySelection()
        assertTrue(c.state.value.gallerySelectedItems.isEmpty())
        assertTrue(c.state.value.gallerySelectionMode)
        assertTrue(api.galleryFavoriteCalls.isEmpty())
        assertTrue(api.galleryTagsCalls.isEmpty())
        c.toggleGallerySelection(row)
        c.logout(); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertFalse(c.state.value.gallerySelectionMode)
        assertTrue(c.state.value.gallerySelectedItems.isEmpty())
        c.removeGallerySelected(row.node.id)
        c.clearGallerySelection()
        assertTrue(c.state.value.gallerySelectedItems.isEmpty())
        c.close()
    }

    @Test fun galleryFavoriteUncertainAckFreezesUntilReadOnlyRefresh() = runTest {
        val api = Service().apply {
            galleryFavoriteFailure = ApiException(503, "ACK lost")
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.setGallerySelectionMode(true)
        c.toggleGallerySelection(c.state.value.galleryItems.single())
        c.favoriteGallerySelected(false); runCurrent()
        assertEquals(1, api.galleryFavoriteCalls.size)
        assertTrue(c.state.value.galleryMetadataWriteAttempted)
        assertTrue(requireNotNull(c.state.value.error).contains("未确认"))
        c.favoriteGallerySelected(false); runCurrent()
        assertEquals(1, api.galleryFavoriteCalls.size)
        c.back(); runCurrent() // Read-only GET; never duplicate the PATCH.
        assertEquals(1, api.galleryFavoriteCalls.size)
        assertFalse(c.state.value.galleryMetadataWriteAttempted)
        assertFalse(c.state.value.gallerySelectionMode)
        assertTrue(c.state.value.galleryLoaded)
        c.close()
    }

    @Test fun unifiedLoginDnsFailureUsesActualServerAndOptionalLanInputs() = runTest {
        val api = object : Service() {
            override suspend fun login(username: String, password: String): AuthSession =
                throw ApiException(0, "DNS failed", ApiFailureReason.DNS)
        }
        val c = DriveController(this, { api })
        c.connectAndLogin("https://drive.example", false, "", "owner", "password", true)
        runCurrent()
        assertEquals(Screen.CONNECT, c.state.value.screen)
        assertFalse(c.state.value.loading)
        val hint = requireNotNull(c.state.value.error)
        assertTrue(hint.contains("服务器域名"))
        assertTrue(hint.contains("内网 IP"))
        assertFalse(hint.contains("公网 IP"))
        c.close()
    }

    @Test fun invalidNativeConnectionDoesNotSuggestRetiredPublicIpEntry() = runTest {
        val c = DriveController(this, { Service() })
        c.connect("ftp://bad.example", false)
        assertEquals(Screen.CONNECT, c.state.value.screen)
        val hint = requireNotNull(c.state.value.error)
        assertTrue(hint.contains("服务器 URL"))
        assertTrue(hint.contains("内网 IP"))
        assertFalse(hint.contains("公网 IP"))
        c.close()
    }

    @Test fun routeProbeMustFinishBeforeLoginAndPersistsOnlyOriginBoundPreferences() = runTest {
        val selected = CompletableDeferred<String?>()
        val api = Service()
        val saved = mutableMapOf<String, ConnectionRoute>()
        val route = ConnectionRoute(RouteMode.LAN, lanIp = "192.168.2.4")
        var usedIp: String? = null
        val c = DriveController(this, { api }, routeSelector = { _, _ -> selected.await() },
            routedServiceFactory = { _, ip -> usedIp = ip; api },
            saveRoute = { origin, value -> saved[origin] = value })
        c.connect("https://drive.example", false, route); runCurrent()
        assertTrue(c.state.value.loading)
        assertEquals(Screen.CONNECT, c.state.value.screen)
        c.login("owner", "synthetic-password"); runCurrent()
        assertEquals("", c.state.value.username)
        selected.complete("192.168.2.4"); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertEquals("192.168.2.4", usedIp)
        assertEquals("192.168.2.4", c.state.value.connectionIp)
        assertEquals(mapOf("https://drive.example/" to route), saved)
        c.changeServer(); runCurrent()
        c.connect("https://another.example", false); runCurrent()
        assertEquals(ConnectionRoute(), c.state.value.route)
        assertNull(c.state.value.connectionIp)
        c.close()
    }

    @Test fun lateProbeCannotInstallSessionAfterChangeServerAndReloginReselects() = runTest {
        val late = CompletableDeferred<String?>()
        var probes = 0
        var built = 0
        val route = ConnectionRoute(RouteMode.LAN, lanIp = "192.168.2.4")
        val c = DriveController(this, { Service() },
            routeSelector = { _, _ -> probes++; withContext(NonCancellable) { late.await() } },
            routedServiceFactory = { _, _ -> built++; Service() })
        c.connect("https://drive.example", false, route); runCurrent()
        c.changeServer(); runCurrent()
        late.complete("192.168.2.4"); runCurrent()
        assertEquals(Screen.CONNECT, c.state.value.screen)
        assertEquals(0, built)
        c.connect("https://drive.example", false, route); runCurrent()
        c.login("owner", "synthetic-password"); runCurrent()
        c.logout(); runCurrent()
        assertNull(c.state.value.connectionIp)
        c.login("owner", "synthetic-password"); runCurrent()
        assertEquals(3, probes)
        assertEquals(2, built)
        c.close()
    }

    @Test fun loginNavigatesAndPagesReplaceRows() = runTest {
        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(listOf(folder, file), c.state.value.items)
        c.nextPage(); runCurrent()
        assertEquals(100, c.state.value.offset)
        assertEquals(listOf(file), c.state.value.items)
        c.nextPage(); runCurrent()
        assertEquals(2, api.calls.size)
        c.previousPage(); runCurrent()
        assertEquals(0, c.state.value.offset)
    }

    @Test fun continuousScrollAppendsDeduplicatedRowsWithoutReplacingEarlierPages() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(listOf(folder, file), c.state.value.items)
        c.loadMore(); runCurrent()
        assertEquals(100, c.state.value.offset)
        assertEquals(listOf(folder, file), c.state.value.items)
        assertFalse(c.state.value.hasNext)
        c.loadMore(); runCurrent()
        assertEquals(listOf(1L to 0, 1L to 100), api.calls)
    }

    @Test fun failedAppendKeepsOldRowsAndRetryAppendsOnlyTheMissingPage() = runTest {
        val api = Service().apply { listing = { _, offset ->
            NodeRange(if (offset == 0) listOf(folder) else listOf(file), 101, offset)
        } }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        api.failure = ApiException(503, "retry")
        c.loadMore(); runCurrent()
        assertNotNull(c.state.value.error)
        assertEquals(0, c.state.value.offset)
        assertEquals(listOf(folder), c.state.value.items)
        c.loadMore(); runCurrent()
        assertEquals(2, api.calls.size) // no retry loop after failure
        c.retry(); runCurrent()
        assertEquals(listOf(folder, file), c.state.value.items)
        assertEquals(100, c.state.value.offset)
        c.refresh(); runCurrent()
        assertEquals(listOf(folder), c.state.value.items)
        assertEquals(0, c.state.value.offset)
    }

    @Test fun textPreviewShowsOnlyCurrentOwnedFileAndClearsOnClose() = runTest {
        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.showDetails(file); runCurrent()
        assertEquals(file, c.state.value.selected)
        assertEquals("Hello xDrive", c.state.value.fileTextPreview?.text)
        assertEquals(42L, c.state.value.fileTextPreview?.size)
        assertEquals(1, api.textPreviewReads)
        assertFalse(c.state.value.fileTextPreviewLoading)

        c.dismissDetails(); runCurrent()
        assertNull(c.state.value.selected)
        assertNull(c.state.value.fileTextPreview)
        assertNull(c.state.value.fileTextPreviewError)

        c.showDetails(folder); runCurrent()
        assertEquals(folder, c.state.value.selected)
        assertEquals(1, api.textPreviewReads) // No text GET for directories.
        c.logout(); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertNull(c.state.value.fileTextPreview)
    }

    @Test fun textPreviewNoncooperativeOldResultCannotOverwriteAtoBtoA() = runTest {
        val stale = CompletableDeferred<FileTextPreview>()
        val api = Service()
        api.textPreviewRequest = { node ->
            if (api.textPreviewReads == 1) withContext(NonCancellable) { stale.await() }
            else FileTextPreview("current", false, node.size)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.open(file); runCurrent()
        assertTrue(c.state.value.fileTextPreviewLoading)
        c.dismissDetails(); runCurrent()
        c.open(file); runCurrent()
        assertEquals("current", c.state.value.fileTextPreview?.text)
        stale.complete(FileTextPreview("old Owner context", false, file.size))
        runCurrent()
        assertEquals(2, api.textPreviewReads)
        assertEquals("current", c.state.value.fileTextPreview?.text)
        c.changeServer(); runCurrent()
        assertNull(c.state.value.fileTextPreview)
        assertNull(c.state.value.selected)
    }

    @Test fun textPreviewFailureIsExplicitAndRetryIsOnlyUserTriggered() = runTest {
        val api = Service()
        api.textPreviewRequest = { throw ApiException(415, "binary content") }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.open(file); runCurrent()
        assertEquals(1, api.textPreviewReads)
        assertNull(c.state.value.fileTextPreview)
        assertEquals("当前文件不是可预览的 UTF-8 文本。", c.state.value.fileTextPreviewError)
        runCurrent()
        assertEquals(1, api.textPreviewReads) // Never auto retry.
        api.textPreviewRequest = { node -> FileTextPreview("safe preview", false, node.size) }
        c.retryTextPreview(); runCurrent()
        assertEquals(2, api.textPreviewReads)
        assertEquals("safe preview", c.state.value.fileTextPreview?.text)
        assertNull(c.state.value.fileTextPreviewError)
    }

    @Test fun openingDetailsCancelsPendingPageSoItCannotDismissTheDialog() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val late = CompletableDeferred<NodeRange>()
        api.listing = { _, offset -> if (offset == 100) withContext(NonCancellable) { late.await() }
            else NodeRange(listOf(folder, file), 101, offset) }
        c.loadMore(); runCurrent()
        c.open(file); runCurrent()
        assertEquals(file, c.state.value.selected)
        late.complete(NodeRange(listOf(file), 101, 100)); runCurrent()
        assertEquals(file, c.state.value.selected)
        assertEquals(0, c.state.value.offset)
    }

    @Test fun longPressFolderPropertiesNeverNavigatesAndCancelsStaleAppend() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.showDetails(folder); runCurrent()
        assertEquals(folder, c.state.value.selected)
        assertEquals(listOf(root), c.state.value.path)
        c.dismissDetails()
        assertNull(c.state.value.selected)
    }

    @Test fun ancestorNavigationUsesOnlyCurrentPathAndReloadsVerifiedRoot() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.open(folder); runCurrent()
        assertEquals(listOf(root, folder), c.state.value.path)
        val before = api.calls.size
        c.navigateToAncestor(-1)
        c.navigateToAncestor(2)
        assertEquals(before, api.calls.size)
        c.navigateToAncestor(0); runCurrent()
        assertEquals(listOf(root), c.state.value.path)
        assertEquals(1L to 0, api.calls.last())
    }

    @Test fun contradictoryEmptyPageStopsAutomaticPagination() = runTest {
        val api = Service().apply { listing = { _, offset ->
            if (offset == 0) NodeRange(listOf(folder), 301, 0)
            else NodeRange(emptyList(), 301, offset)
        } }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.loadMore(); runCurrent()
        assertNotNull(c.state.value.error)
        assertEquals(0, c.state.value.offset)
        c.loadMore(); runCurrent()
        assertEquals(2, api.calls.size)
        assertEquals(listOf(folder), c.state.value.items)
    }


    @Test fun albumCoverRequiresCurrentOwnerAlbumAndSuppressesLateCrossTabBytes() = runTest {
        val album = GalleryAlbum("manual:trip", "manual", "旅途", 1, 3, 0, 17)
        val gate = CompletableDeferred<Unit>()
        var coverCalls = 0
        val server = object : Service() {
            override suspend fun galleryAlbums(accessToken: String) = listOf(album)
            override suspend fun galleryAlbumCover(
                accessToken: String, selected: GalleryAlbum,
            ): GalleryAlbumCover {
                assertEquals("access", accessToken)
                assertEquals(album, selected)
                coverCalls++
                withContext(NonCancellable) { gate.await() }
                return GalleryAlbumCover(17, 4, byteArrayOf(1, 2, 3))
            }
        }
        val c = controller(this, server)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        assertTrue(c.state.value.galleryAlbumsLoaded)
        assertNull(c.galleryAlbumCover(album.copy(revision = 9)))
        assertEquals(0, coverCalls)

        var leaked: GalleryAlbumCover? = null
        var cancelled = false
        val pending = launch {
            try { leaked = c.galleryAlbumCover(album) }
            catch (_: CancellationException) { cancelled = true }
        }
        runCurrent()
        assertEquals(1, coverCalls)
        c.openGalleryLibrary(); runCurrent()
        gate.complete(Unit)
        runCurrent()
        pending.join()
        assertTrue(cancelled)
        assertNull(leaked)
        assertTrue(c.state.value.galleryAlbums.isNotEmpty())
        assertEquals(GalleryPrimaryTab.LIBRARY, c.state.value.galleryPrimaryTab)
        c.logout(); runCurrent()
        assertTrue(c.state.value.galleryAlbums.isEmpty())
        c.close()
    }

    @Test fun manualAlbumRenameAndDeleteUseVerifiedOwnerListAndNeverAStaleRevision() = runTest {
        val original = GalleryAlbum("manual:trip", "manual", "旧名字", 2, 3, 0)
        val smart = GalleryAlbum("smart:recent", "smart", "智能相册", 1, 1, 0)
        val api = object : Service() {
            var album: GalleryAlbum? = original
            var reads = 0
            var renames = 0
            var deletes = 0
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                assertEquals("access", accessToken)
                reads++
                return listOfNotNull(album) + smart
            }
            override suspend fun renameGalleryManualAlbum(
                accessToken: String, target: GalleryAlbum, name: String,
            ): GalleryAlbum {
                assertEquals("access", accessToken)
                assertEquals(album, target)
                assertEquals("新名字", name)
                renames++
                return target.copy(name = name, revision = target.revision + 1)
                    .also { album = it }
            }
            override suspend fun deleteGalleryManualAlbum(
                accessToken: String, target: GalleryAlbum,
            ) {
                assertEquals("access", accessToken)
                assertEquals(album, target)
                deletes++
                album = null
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        assertEquals(1, api.reads)
        c.renameGalleryManualAlbum(original, " 新名字 "); runCurrent()
        assertEquals(1, api.renames)
        assertEquals(2, api.reads)
        val renamed = requireNotNull(api.album)
        assertEquals(listOf(renamed, smart), c.state.value.galleryAlbums)
        assertTrue(c.state.value.galleryAlbumsLoaded)
        c.renameGalleryManualAlbum(original, "stale"); runCurrent()
        c.deleteGalleryManualAlbum(smart); runCurrent()
        assertEquals(1, api.renames)
        assertEquals(0, api.deletes)
        c.deleteGalleryManualAlbum(renamed); runCurrent()
        assertEquals(1, api.deletes)
        assertEquals(3, api.reads)
        assertEquals(listOf(smart), c.state.value.galleryAlbums)
        assertFalse(c.state.value.galleryAlbumEditAttempted)
        assertFalse(c.state.value.galleryAlbumEditCommittedNeedsRefresh)
        c.close()
    }

    @Test fun manualAlbumRenameMissingAckFreezesWritesUntilReadOnlyGet() = runTest {
        val album = GalleryAlbum("manual:trip", "manual", "旧名字", 2, 3, 0)
        val api = object : Service() {
            var patchCalls = 0
            var deleteCalls = 0
            var reads = 0
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                reads++
                return listOf(album)
            }
            override suspend fun renameGalleryManualAlbum(
                accessToken: String, target: GalleryAlbum, name: String,
            ): GalleryAlbum {
                patchCalls++
                throw ApiException(503, "rename ACK lost")
            }
            override suspend fun deleteGalleryManualAlbum(
                accessToken: String, target: GalleryAlbum,
            ) { deleteCalls++ }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        c.renameGalleryManualAlbum(album, "新名字"); runCurrent()
        assertEquals(1, api.patchCalls)
        assertTrue(c.state.value.galleryAlbumEditAttempted)
        assertFalse(c.state.value.galleryAlbumsLoaded)
        assertTrue(requireNotNull(c.state.value.error).contains("未确认"))
        c.renameGalleryManualAlbum(album, "另一个名字"); runCurrent()
        c.deleteGalleryManualAlbum(album); runCurrent()
        assertEquals(1, api.patchCalls)
        assertEquals(0, api.deleteCalls)
        c.retryGalleryAlbums(); runCurrent()
        assertEquals(2, api.reads)
        assertTrue(c.state.value.galleryAlbumsLoaded)
        assertFalse(c.state.value.galleryAlbumEditAttempted)
        c.close()
    }

    @Test fun manualAlbumDeleteAckedButFollowupGetFailedNeverResendsDelete() = runTest {
        val album = GalleryAlbum("manual:trip", "manual", "旧名字", 2, 3, 0)
        val api = object : Service() {
            var albumPresent = true
            var reads = 0
            var deletes = 0
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                reads++
                if (reads == 2) throw ApiException(503, "Owner GET failed")
                return if (albumPresent) listOf(album) else emptyList()
            }
            override suspend fun deleteGalleryManualAlbum(
                accessToken: String, target: GalleryAlbum,
            ) {
                deletes++
                albumPresent = false
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        c.deleteGalleryManualAlbum(album); runCurrent()
        assertEquals(1, api.deletes)
        assertTrue(c.state.value.galleryAlbumEditCommittedNeedsRefresh)
        assertFalse(c.state.value.galleryAlbumsLoaded)
        assertTrue(requireNotNull(c.state.value.error).contains("已提交"))
        c.deleteGalleryManualAlbum(album); runCurrent()
        assertEquals(1, api.deletes)
        c.retryGalleryAlbums(); runCurrent()
        assertTrue(c.state.value.galleryAlbumsLoaded)
        assertTrue(c.state.value.galleryAlbums.isEmpty())
        assertFalse(c.state.value.galleryAlbumEditCommittedNeedsRefresh)
        assertEquals(1, api.deletes)
        c.close()
    }

    @Test fun manualAlbumCreateOneAckThenAuthoritativeOwnerGet() = runTest {
        val created = GalleryAlbum("manual:new", "manual", "旅行", 0, 1, 0)
        val api = object : Service() {
            var posts = 0
            var reads = 0
            var stored: GalleryAlbum? = null
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                assertEquals("access", accessToken)
                reads++
                return listOfNotNull(stored)
            }
            override suspend fun createGalleryManualAlbum(
                accessToken: String, name: String,
            ): GalleryAlbum {
                assertEquals("access", accessToken)
                assertEquals("旅行", name)
                posts++
                stored = created
                return created
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        assertEquals(1, api.reads)
        c.createGalleryManualAlbum(" 旅行 "); runCurrent()
        assertEquals(1, api.posts)
        assertEquals(2, api.reads)
        assertEquals(listOf(created), c.state.value.galleryAlbums)
        assertTrue(c.state.value.galleryAlbumsLoaded)
        assertFalse(c.state.value.galleryAlbumCreateAttempted)
        assertFalse(c.state.value.galleryAlbumCreateCommittedNeedsRefresh)
        c.close()
    }

    @Test fun manualAlbumUnknownAckFreezesWritesUntilReadOnlyOwnerGet() = runTest {
        val api = object : Service() {
            var posts = 0
            var reads = 0
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                reads++
                return emptyList()
            }
            override suspend fun createGalleryManualAlbum(
                accessToken: String, name: String,
            ): GalleryAlbum {
                posts++
                throw ApiException(503, "ACK missing")
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        c.createGalleryManualAlbum("旅行"); runCurrent()
        assertEquals(1, api.posts)
        assertFalse(c.state.value.galleryAlbumsLoaded)
        assertTrue(c.state.value.galleryAlbumCreateAttempted)
        assertTrue(requireNotNull(c.state.value.error).contains("未确认"))
        c.createGalleryManualAlbum("旅行"); runCurrent()
        assertEquals(1, api.posts)
        c.retryGalleryAlbums(); runCurrent()
        assertEquals(2, api.reads)
        assertTrue(c.state.value.galleryAlbumsLoaded)
        assertFalse(c.state.value.galleryAlbumCreateAttempted)
        assertEquals(1, api.posts)
        c.close()
    }

    @Test fun manualAlbumAckedButListFailureNeverReplaysPost() = runTest {
        val created = GalleryAlbum("manual:new", "manual", "旅行", 0, 1, 0)
        val api = object : Service() {
            var posts = 0
            var reads = 0
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                reads++
                if (reads == 2) throw ApiException(503, "GET failed")
                return if (reads > 2) listOf(created) else emptyList()
            }
            override suspend fun createGalleryManualAlbum(
                accessToken: String, name: String,
            ): GalleryAlbum {
                posts++
                return created
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        c.createGalleryManualAlbum("旅行"); runCurrent()
        assertEquals(1, api.posts)
        assertTrue(c.state.value.galleryAlbumCreateCommittedNeedsRefresh)
        assertTrue(requireNotNull(c.state.value.error).contains("已创建"))
        c.createGalleryManualAlbum("旅行"); runCurrent()
        assertEquals(1, api.posts)
        c.retryGalleryAlbums(); runCurrent()
        assertEquals(listOf(created), c.state.value.galleryAlbums)
        assertFalse(c.state.value.galleryAlbumCreateCommittedNeedsRefresh)
        assertEquals(1, api.posts)
        c.close()
    }

    @Test fun realOwnerAlbumsOpenNativeRangeViewerAndReturnWithoutInventingMedia() = runTest {
        val trip = GalleryAlbum("manual:trip", "manual", "旅途", 1, 3, 0)
        val imported = GalleryAlbum("source:phone-1", "imported", "手机", 0, 1, 0)
        val photo = GalleryAsset(
            DriveNode(3888, 1, "trip.jpg", "file", size = 18, revision = 2),
            "image", hasThumbnail = false)
        val requested = mutableListOf<String>()
        var albumReads = 0
        val service = object : Service() {
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                albumReads++
                return listOf(trip, imported)
            }
            override suspend fun galleryAlbumPage(
                accessToken: String, albumId: String, offset: Int,
                initialLatest: Boolean,
            ): GalleryPage {
                requested += albumId
                return GalleryPage(if (albumId == trip.id) listOf(photo) else emptyList(),
                    if (albumId == trip.id) 1 else 0, 0)
            }
        }
        val c = controller(this, service)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        assertEquals(GalleryPrimaryTab.COLLECTIONS, c.state.value.galleryPrimaryTab)
        assertTrue(c.state.value.galleryAlbumsLoaded)
        assertEquals(listOf(trip, imported), c.state.value.galleryAlbums)
        assertEquals(1, albumReads)
        c.refreshGalleryAlbums(); runCurrent()
        assertEquals(2, albumReads)
        assertEquals(listOf(trip, imported), c.state.value.galleryAlbums)
        assertTrue(c.state.value.galleryItems.isEmpty())
        assertFalse(c.state.value.galleryLoaded)

        c.openGalleryAlbum(trip); runCurrent()
        assertEquals(trip, c.state.value.gallerySelectedAlbum)
        assertEquals(listOf(trip.id), requested)
        assertEquals(photo, c.state.value.galleryItems.single())
        c.openGalleryViewer(photo)
        assertEquals(photo, c.state.value.galleryViewer)
        c.back()
        assertNull(c.state.value.galleryViewer)
        assertEquals(trip, c.state.value.gallerySelectedAlbum)
        c.back()
        assertNull(c.state.value.gallerySelectedAlbum)
        assertEquals(listOf(trip, imported), c.state.value.galleryAlbums)
        c.openGalleryAlbum(trip.copy(revision = 99))
        assertNull(c.state.value.gallerySelectedAlbum)
        assertEquals(1, requested.size)
        c.openGalleryAlbum(imported); runCurrent()
        assertEquals(imported, c.state.value.gallerySelectedAlbum)
        assertTrue(c.state.value.galleryLoaded)
        assertTrue(c.state.value.galleryItems.isEmpty())
        c.closeGalleryAlbum()
        c.openGalleryLibrary(); runCurrent()
        assertEquals(GalleryPrimaryTab.LIBRARY, c.state.value.galleryPrimaryTab)
        assertNotNull(c.state.value.galleryItems.firstOrNull())
        c.logout(); runCurrent()
        assertTrue(c.state.value.galleryAlbums.isEmpty())
        assertFalse(c.state.value.galleryAlbumsLoaded)
        c.close()
    }

    @Test fun cancelledAlbumsGetNeverPublishesAfterReturningToPhotoLibrary() = runTest {
        val album = GalleryAlbum("manual:late", "manual", "迟到", 1, 1, 0)
        val gate = CompletableDeferred<Unit>()
        val api = object : Service() {
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
                withContext(NonCancellable) { gate.await() }
                return listOf(album)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        assertTrue(c.state.value.loading)
        c.openGalleryLibrary(); runCurrent()
        gate.complete(Unit); runCurrent()
        assertEquals(GalleryPrimaryTab.LIBRARY, c.state.value.galleryPrimaryTab)
        assertFalse(c.state.value.galleryAlbumsLoaded)
        assertTrue(c.state.value.galleryAlbums.isEmpty())
        c.close()
    }

    @Test fun GalleryKindFiltersEntireOwnerRangeAndKeepsSearchScope() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.filterGalleryKind("audio"); runCurrent()
        assertEquals("", c.state.value.galleryMediaKind)
        c.filterGalleryKind("video"); runCurrent()
        assertEquals("video", c.state.value.galleryMediaKind)
        assertEquals(listOf("" to "video"), api.galleryKindRequests)
        assertEquals(992L, c.state.value.galleryItems.single().node.id)
        c.searchGallery("sunset"); runCurrent()
        assertEquals(listOf("" to "video", "sunset" to "video"), api.galleryKindRequests)
        assertEquals(992L, c.state.value.galleryItems.single().node.id)
        c.filterGalleryKind("image"); runCurrent()
        assertEquals(993L, c.state.value.galleryItems.single().node.id)
        c.filterGalleryKind(""); runCurrent()
        assertEquals(991L, c.state.value.galleryItems.single().node.id)
        c.openFilesApp(); runCurrent()
        assertEquals("", c.state.value.galleryMediaKind)
        c.close()
    }

    @Test fun gallerySortIsRealOwnerPaginationAndReturnsToDefaultAfterLeavingApp() = runTest {
        val api = object : Service() {
            val sorted = mutableListOf<Triple<String, String, Int>>()
            override suspend fun gallerySortedPage(accessToken: String, offset: Int,
                initialLatest: Boolean, search: String, kind: String, albumId: String?,
                sortBy: String, sortDir: String): GalleryPage {
                assertEquals("access", accessToken)
                sorted += Triple(sortBy, sortDir, offset)
                val row = GalleryAsset(DriveNode(9000L + offset, 1, "sorted-$offset.jpg",
                    "file", size = 20, revision = 2), "image", hasThumbnail = true)
                return GalleryPage(listOf(row), 2, offset)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        assertEquals("captured", c.state.value.gallerySortBy)
        val oldCount = api.galleryRequests.size
        c.changeGallerySort("bad", "desc"); runCurrent()
        assertEquals(oldCount, api.galleryRequests.size)
        c.changeGallerySort("added", "desc"); runCurrent()
        assertEquals("added", c.state.value.gallerySortBy)
        assertEquals("desc", c.state.value.gallerySortDir)
        assertNull(c.state.value.galleryTimelineSets)
        assertEquals(0, c.state.value.galleryOffset)
        assertEquals(9000L, c.state.value.galleryItems.single().node.id)
        c.galleryLoadNewer(); runCurrent()
        assertEquals(listOf(9000L, 9001L),
            c.state.value.galleryItems.map { it.node.id })
        assertEquals(listOf(Triple("added", "desc", 0),
            Triple("added", "desc", 1)), api.sorted)
        c.openFilesApp(); runCurrent()
        assertEquals("captured", c.state.value.gallerySortBy)
        assertEquals("asc", c.state.value.gallerySortDir)
        c.openGallery(); runCurrent()
        assertEquals("captured", c.state.value.gallerySortBy)
        assertEquals(990L, c.state.value.galleryItems.single().node.id)
        c.close()
    }

    @Test fun GallerySearchReplacesOwnerRangeAndClearsAtAppBoundary() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        assertEquals(990L, c.state.value.galleryItems.single().node.id)
        c.searchGallery("  sunset  "); runCurrent()
        assertEquals("sunset", c.state.value.gallerySearchQuery)
        assertEquals(listOf("sunset"), api.gallerySearchRequests)
        assertEquals(991L, c.state.value.galleryItems.single().node.id)
        c.searchGallery(""); runCurrent()
        assertTrue(c.state.value.gallerySearchQuery.isEmpty())
        assertEquals(990L, c.state.value.galleryItems.single().node.id)
        c.searchGallery("sunset"); runCurrent()
        c.openFilesApp(); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertTrue(c.state.value.gallerySearchQuery.isEmpty())
    }

    @Test fun GalleryTimelineJumpUsesTrueGlobalOffsetAndPagesBothDirections() = runTest {
        val api = Service().apply { provideGalleryTimeline = true }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        assertEquals(2, c.state.value.galleryTimelineSets!!.year.size)
        val originalEpoch = c.state.value.galleryJumpEpoch
        c.jumpGalleryToGroup("year", "not-a-server-group"); runCurrent()
        assertEquals(1, api.galleryRequests.size)
        c.jumpGalleryToGroup("year", "2026"); runCurrent()
        assertEquals(60, c.state.value.galleryJumpIndex)
        assertTrue(c.state.value.galleryJumpEpoch > originalEpoch)
        assertEquals(60, c.state.value.galleryOffset)
        assertEquals(60, c.state.value.galleryItems.size)
        assertEquals(2060L, c.state.value.galleryItems.first().node.id)
        assertEquals(listOf(0 to true, 60 to false), api.galleryRequests)

        c.galleryLoadNewer(); runCurrent()
        assertEquals(61, c.state.value.galleryItems.size)
        assertEquals(990L, c.state.value.galleryItems.last().node.id)
        assertEquals(60, c.state.value.galleryOffset)
        c.galleryLoadOlder(); runCurrent()
        assertEquals(0, c.state.value.galleryOffset)
        assertEquals(121, c.state.value.galleryItems.size)
        assertEquals(2000L, c.state.value.galleryItems.first().node.id)
        assertEquals(listOf(0 to true, 60 to false, 120 to false, 0 to false),
            api.galleryRequests)
        c.searchGallery("sunset"); runCurrent()
        assertNull(c.state.value.galleryTimelineSets)
        assertNull(c.state.value.galleryJumpIndex)
        val afterSearchEpoch = c.state.value.galleryJumpEpoch
        c.openFilesApp(); runCurrent()
        c.openGallery(); runCurrent()
        assertTrue(c.state.value.galleryJumpEpoch > afterSearchEpoch)
        assertEquals(120, c.state.value.galleryOffset)
        assertNotNull(c.state.value.galleryTimelineSets)
        c.close()
    }

    @Test fun GalleryTimelinePartialOlderRangeMustMatchAlreadyLoadedOwnerRows() = runTest {
        val api = object : Service() {
            private val rows = (0 until 41).map { i ->
                GalleryAsset(DriveNode(4000L + i, 1, "photo-$i.jpg",
                    "file", size = 9, revision = 1), "image", hasThumbnail = true)
            }
            override suspend fun galleryPage(accessToken: String, offset: Int,
                initialLatest: Boolean): GalleryPage {
                return if (initialLatest) GalleryPage(listOf(rows.last()), 41, 40)
                else GalleryPage(rows, 41, 0)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.galleryLoadOlder(); runCurrent()
        assertNull(c.state.value.error)
        assertEquals(0, c.state.value.galleryOffset)
        assertEquals(41, c.state.value.galleryItems.size)
        assertEquals(4040L, c.state.value.galleryItems.last().node.id)
        c.close()
    }

    @Test fun GalleryLoadsRealChronologicalTailAndPagesOlderWithoutLosingFilesOwner() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        assertEquals(Screen.GALLERY, c.state.value.screen)
        assertEquals(120, c.state.value.galleryOffset)
        assertEquals(121L, c.state.value.galleryTotal)
        assertEquals(990L, c.state.value.galleryItems.last().node.id)
        c.galleryLoadOlder(); runCurrent()
        assertEquals(listOf(0 to true, 60 to false), api.galleryRequests)
        assertEquals(61, c.state.value.galleryItems.size)
        assertEquals(60, c.state.value.galleryOffset)
        assertEquals(990L, c.state.value.galleryItems.last().node.id)
        c.openFilesApp(); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(root.id, c.state.value.path.last().id)
        assertTrue(c.state.value.galleryItems.isEmpty())
    }

    @Test fun GalleryOlderRetryPreservesLoadedPhotosAndSameAbsoluteOffset() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        assertEquals(120, c.state.value.galleryOffset)
        api.galleryFailOlderOnce = true
        c.galleryLoadOlder(); runCurrent()
        assertEquals(120, c.state.value.galleryOffset)
        assertEquals(listOf(990L), c.state.value.galleryItems.map { it.node.id })
        assertNotNull(c.state.value.error)
        c.retryGallery(); runCurrent()
        assertNull(c.state.value.error)
        assertEquals(60, c.state.value.galleryOffset)
        assertEquals(61, c.state.value.galleryItems.size)
        assertEquals(listOf(0 to true, 60 to false, 60 to false), api.galleryRequests)
        assertEquals(990L, c.state.value.galleryItems.last().node.id)
    }

    @Test fun filesPdfPreviewIsBoundedToCurrentOwnerAndReturnsWithoutFolderReload() = runTest {
        val pdf = DriveNode(95, 1, "file.pdf", "file", 5, revision = 4)
        val api = object : Service() {
            var reads = 0
            override suspend fun filesPdfDownload(
                accessToken: String, original: DriveNode,
                openDestination: () -> OutputStream, onProgress: (Long) -> Unit,
            ): Long {
                assertEquals("access", accessToken)
                assertEquals(pdf, original)
                reads++
                openDestination().use { it.write("hello".toByteArray()) }
                onProgress(5)
                return 5
            }
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(folder, pdf) else emptyList(), 2, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val rows = c.state.value.items
        val calls = api.calls.toList()
        c.open(pdf)
        assertEquals(pdf, c.state.value.filesPdfViewer)
        val buffer = ByteArrayOutputStream()
        assertEquals(5L, c.downloadFilesPdf(pdf) { buffer })
        assertArrayEquals("hello".toByteArray(), buffer.toByteArray())
        assertEquals(5L, c.state.value.filesPdfBytes)
        assertEquals(1, api.reads)
        c.back()
        assertNull(c.state.value.filesPdfViewer)
        assertEquals(0L, c.state.value.filesPdfBytes)
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(rows, c.state.value.items)
        assertEquals(calls, api.calls)
        c.close()
    }

    @Test fun oldOwnerPdfDownloadCannotPublishAfterLogout() = runTest {
        val pdf = DriveNode(96, 1, "file.pdf", "file", 5, revision = 4)
        val gate = CompletableDeferred<Unit>()
        val api = object : Service() {
            override suspend fun filesPdfDownload(
                accessToken: String, original: DriveNode,
                openDestination: () -> OutputStream, onProgress: (Long) -> Unit,
            ): Long = withContext(NonCancellable) {
                gate.await()
                openDestination().use { it.write("hello".toByteArray()) }
                onProgress(5)
                5
            }
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(pdf) else emptyList(), 1, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.open(pdf)
        val output = ByteArrayOutputStream()
        val active = async { c.downloadFilesPdf(pdf) { output } }
        runCurrent()
        c.logout()
        gate.complete(Unit)
        runCurrent()
        assertTrue(active.isCancelled)
        assertNull(c.state.value.filesPdfViewer)
        assertEquals(0L, c.state.value.filesPdfBytes)
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
        c.close()
    }

    @Test fun oversizedPdfNeverRequestsOwnerPrivateBytes() = runTest {
        val pdf = DriveNode(97, 1, "huge.pdf", "file",
            64L * 1024 * 1024 + 1L, revision = 4)
        val api = object : Service() {
            var reads = 0
            override suspend fun filesPdfDownload(
                accessToken: String, original: DriveNode,
                openDestination: () -> OutputStream, onProgress: (Long) -> Unit,
            ): Long {
                reads++
                return 0
            }
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(pdf) else emptyList(), 1, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.open(pdf)
        val failure = runCatching { c.downloadFilesPdf(pdf) { ByteArrayOutputStream() } }
            .exceptionOrNull()
        assertTrue(failure is ApiException)
        assertEquals(413, (failure as ApiException).statusCode)
        assertEquals(0, api.reads)
        c.back()
        c.close()
    }

    @Test fun filesAudioOpensOwnerRangeAndBackClosesWithoutReloadingRows() = runTest {
        val audio = DriveNode(91, 1, "song.mp3", "file", 6, revision = 4)
        val api = object : Service() {
            var started = 0
            var closed = 0
            override suspend fun filesAudioPlayback(accessToken: String, node: DriveNode): OwnerVideoPlayback {
                assertEquals("access", accessToken)
                assertEquals(audio, node)
                started++
                return OwnerVideoPlayback("https://fixture.invalid/api/v1/files/91/content",
                    okhttp3.OkHttpClient(), node.size) { closed++ }
            }
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(audio) else emptyList(), 1, offset) }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val oldRows = c.state.value.items
        val oldCalls = api.calls.toList()
        c.open(audio)
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(audio, c.state.value.filesAudioViewer)
        val source = c.openFilesAudioPlayback(audio)
        assertNotNull(source)
        assertEquals(1, api.started)
        c.back()
        assertNull(c.state.value.filesAudioViewer)
        assertEquals(1, api.closed)
        c.closeGalleryVideoPlayback(requireNotNull(source))
        assertEquals(1, api.closed)
        assertEquals(oldRows, c.state.value.items)
        assertEquals(oldCalls, api.calls)
        c.close()
    }

    @Test fun filesAudioRetryIgnoresNonCooperativePreviousOwnerStream() = runTest {
        val audio = DriveNode(99, 1, "retry.mp3", "file", 8, revision = 2)
        val firstGate = CompletableDeferred<Unit>()
        var opened = 0
        val closed = mutableListOf<Int>()
        val api = object : Service() {
            override suspend fun filesAudioPlayback(accessToken: String, node: DriveNode):
                OwnerVideoPlayback {
                opened++
                val requestNumber = opened
                if (requestNumber == 1) withContext(NonCancellable) {
                    firstGate.await()
                }
                return OwnerVideoPlayback(
                    "https://fixture.invalid/api/v1/files/99/content",
                    okhttp3.OkHttpClient(), node.size,
                ) { closed += requestNumber }
            }
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(audio) else emptyList(), 1, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.open(audio)
        val stale = async { c.openFilesAudioPlayback(audio) }
        runCurrent()
        assertEquals(1, opened)
        val current = requireNotNull(c.openFilesAudioPlayback(audio))
        assertEquals(2, opened)
        // Deliberately complete the older, uncooperative GET after retry.
        firstGate.complete(Unit); runCurrent()
        assertTrue(stale.isCancelled)
        assertEquals(listOf(1), closed) // Old stream released, current stays live.
        assertEquals(audio, c.state.value.filesAudioViewer)
        c.back()
        assertEquals(listOf(1, 2), closed)
        c.closeGalleryVideoPlayback(current) // Idempotent close.
        assertEquals(listOf(1, 2), closed)
        c.close()
    }

    @Test fun oldOwnerAudioStreamCannotAppearAfterLogout() = runTest {
        val audio = DriveNode(91, 1, "song.mp3", "file", 6, revision = 4)
        val gate = CompletableDeferred<Unit>()
        var releases = 0
        val api = object : Service() {
            override suspend fun filesAudioPlayback(accessToken: String, node: DriveNode):
                OwnerVideoPlayback = withContext(NonCancellable) {
                gate.await()
                OwnerVideoPlayback("https://fixture.invalid/files/91", okhttp3.OkHttpClient(),
                    node.size) { releases++ }
            }
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(audio) else emptyList(), 1, offset) }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.open(audio)
        val pending = async { c.openFilesAudioPlayback(audio) }
        runCurrent()
        c.logout()
        gate.complete(Unit)
        runCurrent()
        assertTrue(pending.isCancelled)
        assertEquals(1, releases)
        assertNull(c.state.value.filesAudioViewer)
        assertEquals(Screen.LOGIN, c.state.value.screen)
        c.close()
    }

    @Test fun oneFilesOwnerCanOpenPdfThenAudioWithoutLosingOwnerRows() = runTest {
        val pdf = DriveNode(97, 1, "paper.pdf", "file", 8, revision = 2)
        val audio = DriveNode(98, 1, "voice.mp3", "file", 8, revision = 3)
        val api = object : Service() {
            override suspend fun filesAudioPlayback(accessToken: String, node: DriveNode) =
                OwnerVideoPlayback("https://fixture.invalid/files/98", okhttp3.OkHttpClient(),
                    node.size)
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(pdf, audio) else emptyList(), 2, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val first = c.state.value.items.toList()
        c.open(pdf)
        assertEquals(pdf, c.state.value.filesPdfViewer)
        assertNull(c.state.value.filesAudioViewer)
        c.open(audio) // A stale/offscreen row cannot open a second Viewer.
        assertNull(c.state.value.filesAudioViewer)
        c.back()
        assertNull(c.state.value.filesPdfViewer)
        c.open(audio)
        assertEquals(audio, c.state.value.filesAudioViewer)
        assertNull(c.state.value.filesPdfViewer)
        c.open(pdf) // A new PDF can't replace audio before its resource closes.
        assertNull(c.state.value.filesPdfViewer)
        val playback = c.openFilesAudioPlayback(audio)
        assertNotNull(playback)
        c.back()
        assertNull(c.state.value.filesAudioViewer)
        assertNull(c.state.value.filesPdfViewer)
        assertEquals(first, c.state.value.items)
        assertEquals(Screen.FILES, c.state.value.screen)
        c.close()
    }

    @Test fun filesMediaUsesGalleryViewerAndBackReturnsExactLoadedBrowse() = runTest {
        val photo = DriveNode(91, 1, "family.jpg", "file", 5, revision = 4)
        val api = object : Service() {
            var mediaDetails = 0
            override suspend fun filesMediaItem(accessToken: String, node: DriveNode): GalleryAsset {
                assertEquals("access", accessToken)
                assertEquals(photo, node)
                mediaDetails++
                return GalleryAsset(node, "image", hasThumbnail = true)
            }
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(folder, photo) else emptyList(), 2, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val before = c.state.value.items
        val reads = api.calls.toList()
        c.open(photo); runCurrent()
        assertEquals(Screen.GALLERY, c.state.value.screen)
        assertTrue(c.state.value.viewerReturnToFiles)
        assertEquals(photo, c.state.value.galleryViewer?.node)
        assertEquals(1, c.state.value.galleryItems.size)
        assertEquals(1, api.mediaDetails)
        val asset = requireNotNull(c.state.value.galleryViewer)
        assertArrayEquals("hello".toByteArray(), c.galleryImageBytes(asset))
        assertNull(c.galleryViewerNeighbor(1))
        assertFalse(c.galleryViewerCanShift(-1))
        assertFalse(c.galleryViewerCanShift(1))
        c.shiftGalleryViewer(-1) // Must not fetch a synthetic Gallery Range.
        assertTrue(c.state.value.viewerReturnToFiles)
        c.back()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertFalse(c.state.value.viewerReturnToFiles)
        assertNull(c.state.value.galleryViewer)
        assertTrue(c.state.value.galleryItems.isEmpty())
        assertEquals(before, c.state.value.items)
        assertEquals(reads, api.calls) // No extra directory GET after Viewer.
        c.close()
    }

    @Test fun filesVideoViewerClosesOriginalMedia3StreamOnBack() = runTest {
        val video = DriveNode(92, 1, "clip.mp4", "file", 5, revision = 3)
        val api = object : Service() {
            override suspend fun filesMediaItem(accessToken: String, node: DriveNode) =
                GalleryAsset(node, "video", hasThumbnail = false)
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(video) else emptyList(), 1, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.open(video); runCurrent()
        val media = requireNotNull(c.state.value.galleryViewer)
        val stream = c.openGalleryVideoPlayback(media)
        assertNotNull(stream)
        c.back()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(1, api.videoSessionsClosed)
        c.closeGalleryVideoPlayback(requireNotNull(stream))
        assertEquals(1, api.videoSessionsClosed)
        c.close()
    }

    @Test fun filesMediaDelayedOwnerDetailCannotReturnAfterLogout() = runTest {
        val photo = DriveNode(93, 1, "late.jpg", "file", 5, revision = 4)
        val gate = CompletableDeferred<GalleryAsset>()
        val api = object : Service() {
            override suspend fun filesMediaItem(accessToken: String, node: DriveNode) =
                withContext(NonCancellable) { gate.await() }
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(photo) else emptyList(), 1, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.open(photo); runCurrent()
        assertTrue(c.state.value.loading)
        c.logout()
        gate.complete(GalleryAsset(photo, "image", hasThumbnail = true)); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertNull(c.state.value.galleryViewer)
        assertTrue(c.state.value.items.isEmpty())
        c.close()
    }

    @Test fun galleryImageViewerUsesRevisionedOwnerDownloadAndBackReturnsToWall() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val photo = c.state.value.galleryItems.single()
        c.openGalleryViewer(photo)
        assertEquals(photo, c.state.value.galleryViewer)
        assertArrayEquals("hello".toByteArray(), c.galleryImageBytes(photo))
        assertEquals(1, api.downloadReads)
        c.back()
        assertNull(c.state.value.galleryViewer)
        assertEquals(Screen.GALLERY, c.state.value.screen)
        assertEquals(990L, c.state.value.galleryItems.single().node.id)
        // Media metadata is not a fake image Viewer for a video tile.
        c.openGalleryViewer(photo.copy(mediaKind = "video"))
        assertNull(c.state.value.galleryViewer)
    }

    @Test fun filesThumbnailAcceptsOnlyCurrentOwnerFileRevision() = runTest {
        val photo = DriveNode(199L, 1, "camera.heic", "file", size = 1024, revision = 7)
        val api = Service().apply {
            listing = { _, offset ->
                NodeRange(if (offset == 0) listOf(photo) else emptyList(), 1, offset)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertArrayEquals(byteArrayOf(1, 2, 3), c.filesThumbnail(photo))
        assertEquals(1, api.thumbnailReads)
        assertNull(c.filesThumbnail(photo.copy(revision = 8)))
        assertNull(c.filesThumbnail(photo.copy(name = "camera.txt")))
        assertNull(c.filesThumbnail(file))
        assertEquals(1, api.thumbnailReads)
        c.changeFilesSection(FilesSection.RECENT); runCurrent()
        assertNull(c.filesThumbnail(photo))
        c.logout(); runCurrent()
        assertNull(c.filesThumbnail(photo))
        assertEquals(1, api.thumbnailReads)
    }

    @Test fun filesThumbnailRejectsLateSectionReturn() = runTest {
        val photo = DriveNode(199L, 1, "camera.jpg", "file", size = 128, revision = 1)
        val api = Service().apply {
            listing = { _, offset ->
                NodeRange(if (offset == 0) listOf(photo) else emptyList(), 1, offset)
            }
            thumbnailGate = CompletableDeferred()
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val old = async { c.filesThumbnail(photo) }; runCurrent()
        assertEquals(1, api.thumbnailReads)
        c.changeFilesSection(FilesSection.FAVORITES); runCurrent()
        api.thumbnailGate?.complete(Unit); runCurrent()
        assertTrue(old.isCancelled)
        assertNull(c.filesThumbnail(photo))
    }

    @Test fun oversizedGalleryOriginalFallsBackToVerifiedThumbnailWithoutDownloadingFullBytes() = runTest {
        val api = object : Service() {
            override suspend fun galleryPage(accessToken: String, offset: Int, initialLatest: Boolean) =
                GalleryPage(listOf(latestGallery.copy(
                    node = latestGallery.node.copy(size = 32L * 1024 * 1024 + 1L)
                )), 1, 0)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val photo = c.state.value.galleryItems.single()
        c.openGalleryViewer(photo)
        val error = runCatching { c.galleryImageBytes(photo) }.exceptionOrNull()
        assertTrue(error is ApiException)
        assertEquals(413, (error as ApiException).statusCode)
        assertEquals(0, api.downloadReads)
        assertArrayEquals(byteArrayOf(1, 2, 3), c.galleryViewerThumbnail(photo))
        assertEquals(1, api.thumbnailReads)
        c.dismissGalleryViewer()
        assertNull(c.galleryViewerThumbnail(photo))
        assertEquals("Closed Viewer must not request private thumbnails", 1, api.thumbnailReads)
    }

    @Test fun delayedViewerThumbnailCannotEscapeOldOwnerEpochEvenForSamePhotoIdentity() = runTest {
        val api = Service().apply { thumbnailGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val photo = c.state.value.galleryItems.single()
        c.openGalleryViewer(photo)
        val old = async { c.galleryViewerThumbnail(photo) }
        runCurrent()
        assertEquals(1, api.thumbnailReads)
        c.dismissGalleryViewer()
        c.openGalleryViewer(photo) // A -> B -> A: equal node and revision, new epoch.
        api.thumbnailGate?.complete(Unit); runCurrent()
        assertTrue(old.isCancelled)
        assertEquals(photo, c.state.value.galleryViewer)
        assertArrayEquals(byteArrayOf(1, 2, 3), c.galleryViewerThumbnail(photo))
        assertEquals(2, api.thumbnailReads)
    }

    @Test fun galleryViewerNavigationOnlyMovesToImmediateVerifiedPhotos() = runTest {
        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.galleryLoadOlder(); runCurrent()
        val latest = c.state.value.galleryItems.last()
        c.openGalleryViewer(latest)
        assertNull(c.galleryViewerNeighbor(1)) // The next Owner Range is not loaded.
        assertEquals(2119L, c.galleryViewerNeighbor(-1)?.node?.id)
        c.shiftGalleryViewer(-1)
        assertEquals(2119L, c.state.value.galleryViewer?.node?.id)
        c.shiftGalleryViewer(1)
        assertEquals(latest, c.state.value.galleryViewer)
        c.shiftGalleryViewer(2)
        assertEquals(latest, c.state.value.galleryViewer)
        c.showGalleryInfo(latest)
        c.shiftGalleryViewer(-1)
        assertEquals(latest, c.state.value.galleryViewer)
        c.dismissGalleryInfo()
        c.openFilesApp()
        c.shiftGalleryViewer(-1)
        assertNull(c.state.value.galleryViewer)
    }

    @Test fun galleryViewerSwipesAcrossOlderOwnerRangeWithoutSkipping() = runTest {
        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val latest = c.state.value.galleryItems.single()
        c.openGalleryViewer(latest)
        assertNull(c.galleryViewerNeighbor(-1))
        assertTrue(c.galleryViewerCanShift(-1))
        c.shiftGalleryViewer(-1)
        assertEquals(latest, c.state.value.galleryViewer)
        assertTrue(c.state.value.galleryViewerPageBusy)
        c.shiftGalleryViewer(-1) // Single in-flight page, no duplicate fetch.
        runCurrent()
        assertEquals(listOf(0 to true, 60 to false), api.galleryRequests)
        assertEquals(60, c.state.value.galleryOffset)
        assertEquals(61, c.state.value.galleryItems.size)
        assertEquals(2119L, c.state.value.galleryViewer?.node?.id)
        assertFalse(c.state.value.galleryViewerPageBusy)
        assertNull(c.state.value.galleryViewerPageError)
        assertEquals(latest, c.galleryViewerNeighbor(1))
        c.close()
    }

    @Test fun galleryViewerSwipesAcrossNewerTimeJumpRangeWithoutInventedItem() = runTest {
        val api = Service().apply { provideGalleryTimeline = true }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.jumpGalleryToGroup("year", "2026"); runCurrent()
        val last = c.state.value.galleryItems.last()
        c.openGalleryViewer(last)
        assertNull(c.galleryViewerNeighbor(1))
        assertTrue(c.galleryViewerCanShift(1))
        c.shiftGalleryViewer(1); runCurrent()
        assertEquals(990L, c.state.value.galleryViewer?.node?.id)
        assertEquals(60, c.state.value.galleryOffset)
        assertEquals(61, c.state.value.galleryItems.size)
        assertEquals(listOf(0 to true, 60 to false, 120 to false), api.galleryRequests)
        assertFalse(c.galleryViewerCanShift(1))
        c.close()
    }

    @Test fun galleryViewerBoundaryFailureKeepsCurrentPhotoAndRetriesOneGet() = runTest {
        val api = Service().apply { galleryFailOlderOnce = true }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val latest = c.state.value.galleryItems.single()
        c.openGalleryViewer(latest)
        c.shiftGalleryViewer(-1); runCurrent()
        assertEquals(latest, c.state.value.galleryViewer)
        assertEquals(listOf(latest), c.state.value.galleryItems)
        assertFalse(c.state.value.galleryViewerPageBusy)
        assertEquals(-1, c.state.value.galleryViewerPageDirection)
        assertNotNull(c.state.value.galleryViewerPageError)
        assertTrue(c.galleryViewerCanShift(-1))
        c.shiftGalleryViewer(-1); runCurrent()
        assertEquals(2119L, c.state.value.galleryViewer?.node?.id)
        assertNull(c.state.value.galleryViewerPageError)
        assertEquals(listOf(0 to true, 60 to false, 60 to false), api.galleryRequests)
        c.close()
    }

    @Test fun viewerInfoCancelsDelayedBoundaryWithoutHidingDialog() = runTest {
        val gate = CompletableDeferred<Unit>()
        val api = object : Service() {
            override suspend fun galleryPage(accessToken: String, offset: Int,
                initialLatest: Boolean): GalleryPage {
                if (!initialLatest) withContext(NonCancellable) { gate.await() }
                return super.galleryPage(accessToken, offset, initialLatest)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val photo = c.state.value.galleryItems.single()
        c.openGalleryViewer(photo)
        c.shiftGalleryViewer(-1); runCurrent()
        assertTrue(c.state.value.galleryViewerPageBusy)
        c.showGalleryInfo(photo)
        assertEquals(photo, c.state.value.gallerySelected)
        assertFalse(c.state.value.galleryViewerPageBusy)
        assertEquals(0, c.state.value.galleryViewerPageDirection)
        gate.complete(Unit); runCurrent()
        assertEquals(photo, c.state.value.galleryViewer)
        assertEquals(photo, c.state.value.gallerySelected)
        assertEquals(listOf(photo), c.state.value.galleryItems)
        assertNull(c.state.value.galleryViewerPageError)
        c.dismissGalleryInfo()
        c.dismissGalleryViewer()
        c.close()
    }

    @Test fun galleryViewerNonCooperativeBoundaryCannotPublishAfterLogout() = runTest {
        val gate = CompletableDeferred<Unit>()
        val api = object : Service() {
            override suspend fun galleryPage(accessToken: String, offset: Int,
                initialLatest: Boolean): GalleryPage {
                if (!initialLatest) withContext(NonCancellable) { gate.await() }
                return super.galleryPage(accessToken, offset, initialLatest)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryViewer(c.state.value.galleryItems.single())
        c.shiftGalleryViewer(-1); runCurrent()
        assertTrue(c.state.value.galleryViewerPageBusy)
        c.logout()
        gate.complete(Unit); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertNull(c.state.value.galleryViewer)
        assertTrue(c.state.value.galleryItems.isEmpty())
        assertNull(c.state.value.galleryViewerPageError)
        c.close()
    }

    @Test fun galleryViewerSwipeDiscardsOldOriginalAfterAdjacentImageChange() = runTest {
        val api = Service().apply { downloadGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.galleryLoadOlder(); runCurrent()
        val latest = c.state.value.galleryItems.last()
        c.openGalleryViewer(latest)
        val previousRead = async { c.galleryImageBytes(latest) }
        runCurrent()
        assertEquals(1, api.downloadReads)
        c.shiftGalleryViewer(-1)
        assertEquals(2119L, c.state.value.galleryViewer?.node?.id)
        api.downloadGate?.complete(Unit); runCurrent()
        assertTrue(previousRead.isCancelled)
        assertEquals(2119L, c.state.value.galleryViewer?.node?.id)
    }

    @Test fun galleryViewerSwipesImageVideoImageWithoutSkippingOrLeakingStreams() = runTest {
        val api = object : Service() {
            override suspend fun galleryPage(
                accessToken: String, offset: Int, initialLatest: Boolean,
            ): GalleryPage = GalleryPage(listOf(
                GalleryAsset(DriveNode(301, 1, "a.jpg", "file", 5, revision = 1), "image"),
                GalleryAsset(DriveNode(302, 1, "b.mp4", "file", 5, revision = 1), "video"),
                GalleryAsset(DriveNode(303, 1, "c.jpg", "file", 5, revision = 1), "image"),
            ), 3, 0)
        }.apply { downloadGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val (first, video, last) = c.state.value.galleryItems
        c.openGalleryViewer(first)
        assertNull(c.galleryViewerNeighbor(-1))
        assertEquals(video, c.galleryViewerNeighbor(1))
        val pending = async { c.galleryImageBytes(first) }
        runCurrent()
        assertEquals(1, api.downloadReads)

        c.shiftGalleryViewer(1)
        assertEquals(video, c.state.value.galleryViewer)
        api.downloadGate?.complete(Unit); runCurrent()
        assertTrue(pending.isCancelled) // Photo bytes cannot leak into the Video.
        val firstVideoStream = c.openGalleryVideoPlayback(video)
        assertNotNull(firstVideoStream)
        assertEquals(1, api.videoSessionsOpened)
        assertEquals(last, c.galleryViewerNeighbor(1))

        c.shiftGalleryViewer(1)
        assertEquals(last, c.state.value.galleryViewer)
        assertEquals(1, api.videoSessionsClosed) // Closed synchronously at swipe.
        c.closeGalleryVideoPlayback(requireNotNull(firstVideoStream)) // Idempotent.
        assertEquals(1, api.videoSessionsClosed)
        assertNull(c.galleryViewerNeighbor(1))
        c.shiftGalleryViewer(-1)
        assertEquals(video, c.state.value.galleryViewer)
        val secondVideoStream = c.openGalleryVideoPlayback(video)
        assertNotNull(secondVideoStream)
        assertEquals(2, api.videoSessionsOpened)
        c.shiftGalleryViewer(-1)
        assertEquals(first, c.state.value.galleryViewer)
        assertEquals(2, api.videoSessionsClosed)
        c.dismissGalleryViewer()
        assertNull(c.galleryViewerNeighbor(1))
        assertEquals(2, api.videoSessionsClosed)
    }

    @Test fun livePhotoUsesRealStillResourceAndNeverDownloadsOuterLIVP() = runTest {
        val api = object : Service() {
            override suspend fun galleryPage(
                accessToken: String, offset: Int, initialLatest: Boolean,
            ): GalleryPage = GalleryPage(listOf(GalleryAsset(
                DriveNode(3001, 1, "verified.livp", "file",
                    80L * 1024 * 1024, revision = 8),
                "image", livePhoto = true, hasThumbnail = true)), 1, 0)
            var stillReads = 0
            override suspend fun galleryLivePhotoStill(
                accessToken: String, node: DriveNode,
                onProgress: (Long, Long?) -> Unit,
            ): ByteArray {
                stillReads++
                assertEquals("access", accessToken)
                assertEquals(3001L, node.id)
                onProgress(4L, 4L)
                return "jpeg".toByteArray()
            }
        }
        val controller = controller(this, api)
        controller.login("owner", "password"); runCurrent()
        controller.openGallery(); runCurrent()
        val photo = controller.state.value.galleryItems.single()
        controller.openGalleryViewer(photo)
        val progress = mutableListOf<Pair<Long, Long?>>()
        assertArrayEquals("jpeg".toByteArray(),
            controller.galleryImageBytes(photo) { done, total ->
                progress += done to total
            })
        assertEquals(listOf(4L to 4L), progress)
        assertEquals(1, api.stillReads)
        assertEquals(0, api.downloadReads)
    }

    @Test fun liveMotionOldOwnerEpochIsRejectedAndLateResourceDisposed() = runTest {
        val gate = CompletableDeferred<Unit>()
        val photo = GalleryAsset(
            DriveNode(3002, 1, "verified.jpg", "file",
                1000L, revision = 2),
            "image", livePhoto = true, hasThumbnail = true)
        val api = object : Service() {
            var motionCalls = 0
            var motionClosed = 0
            override suspend fun galleryPage(
                accessToken: String, offset: Int, initialLatest: Boolean,
            ): GalleryPage = GalleryPage(listOf(photo), 1, 0)
            override suspend fun galleryLivePhotoMotionPlayback(
                accessToken: String, node: DriveNode,
            ): OwnerVideoPlayback {
                motionCalls++
                if (motionCalls == 1) gate.await()
                return OwnerVideoPlayback(
                    "https://fixture.invalid/api/v1/media-live-photo-motion/3002?ticket=fixture",
                    okhttp3.OkHttpClient(), 0,
                ) { motionClosed++ }
            }
        }
        val controller = controller(this, api)
        controller.login("owner", "password"); runCurrent()
        controller.openGallery(); runCurrent()
        assertNull("Only a visibly opened current-Owner Live Photo may request motion",
            controller.openGalleryLivePhotoPlayback(photo))
        controller.openGalleryViewer(photo)
        val first = async { controller.openGalleryLivePhotoPlayback(photo) }
        runCurrent()
        assertEquals(1, api.motionCalls)
        controller.dismissGalleryViewer()
        controller.openGalleryViewer(photo) // same Node+Revision, different Viewer epoch.
        gate.complete(Unit); runCurrent()
        assertTrue(first.isCancelled)
        assertEquals(1, api.motionClosed)
        val next = controller.openGalleryLivePhotoPlayback(photo)
        assertNotNull(next)
        assertEquals(2, api.motionCalls)
        controller.dismissGalleryViewer()
        assertEquals(2, api.motionClosed)
        assertNull(controller.openGalleryLivePhotoPlayback(photo))
        controller.logout(); runCurrent()
        assertNull(controller.openGalleryLivePhotoPlayback(photo))
        assertEquals(2, api.motionCalls)
    }

    @Test fun galleryVideoUsesOwnerOnlyAndClosesStreamOnBackAndLogout() = runTest {
        val api = object : Service() {
            override suspend fun galleryPage(accessToken: String, offset: Int,
                initialLatest: Boolean): GalleryPage = GalleryPage(listOf(
                GalleryAsset(DriveNode(301, 1, "clip.mp4", "file", 7, revision = 2),
                    "video", durationMs = 12_000L)
            ), 1, 0)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val video = c.state.value.galleryItems.single()
        c.openGalleryViewer(video)
        assertEquals(video, c.state.value.galleryViewer)
        val source = c.openGalleryVideoPlayback(video)
        assertNotNull(source)
        assertEquals(1, api.videoSessionsOpened)
        c.back()
        assertNull(c.state.value.galleryViewer)
        assertEquals(1, api.videoSessionsClosed)
        c.openGalleryViewer(video)
        assertNotNull(c.openGalleryVideoPlayback(video))
        c.logout(); runCurrent()
        assertEquals(2, api.videoSessionsClosed)
        assertNull(c.openGalleryVideoPlayback(video))
        assertTrue(c.state.value.galleryItems.isEmpty())
    }

    @Test fun galleryViewerOldBytesAreDiscardedAfterCloseAndReopen() = runTest {
        val api = Service().apply { downloadGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val photo = c.state.value.galleryItems.single()
        c.openGalleryViewer(photo)
        val pending = async { c.galleryImageBytes(photo) }
        runCurrent()
        assertEquals(1, api.downloadReads)
        c.dismissGalleryViewer()
        c.openGalleryViewer(photo)
        api.downloadGate?.complete(Unit)
        runCurrent()
        assertTrue(pending.isCancelled)
        assertEquals(photo, c.state.value.galleryViewer)
        c.logout(); runCurrent()
        assertNull(c.state.value.galleryViewer)
        assertTrue(c.state.value.galleryItems.isEmpty())
    }

    @Test fun GalleryOldOwnerRangeCannotReturnAfterLeavingApp() = runTest {
        val api = Service().apply { galleryGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        assertTrue(c.state.value.loading)
        c.openFilesApp(); runCurrent()
        api.galleryGate?.complete(Unit); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertTrue(c.state.value.galleryItems.isEmpty())
        assertFalse(c.state.value.galleryLoaded)
    }

    @Test fun nativeTransferHistoryTracksRealUploadAckAndClearsAtLogout() = runTest {
        val api = Service()
        var now = 1_000L
        val c = DriveController(this, { api }, transferClockMillis = { now }).also {
            it.connect("https://drive.example", false)
        }
        c.login("owner", "password"); runCurrent()
        assertTrue(c.prepareFileUpload())
        c.acceptFileUpload("saved.txt", 3,
            { ByteArrayInputStream("abc".toByteArray()) }); runCurrent()
        val saved = c.state.value.nativeTransfers.single()
        assertEquals(NativeTransferKind.UPLOAD, saved.kind)
        assertEquals(NativeTransferStatus.COMPLETED, saved.status)
        assertEquals("saved.txt", saved.fileName)
        assertEquals(3L, saved.totalBytes)
        assertEquals(3L, saved.transferredBytes)
        assertTrue(c.state.value.fileUploadCommitted)
        assertEquals(1, api.uploadCount)
        c.clearNativeTransferHistory()
        assertTrue(c.state.value.nativeTransfers.isEmpty())
        assertEquals(1, api.uploadCount) // Clearing does not send any request.

        assertTrue(c.prepareFileUpload())
        now += 1_000L
        c.acceptFileUpload("second.txt", 3,
            { ByteArrayInputStream("abc".toByteArray()) }); runCurrent()
        assertEquals(1, c.state.value.nativeTransfers.size)
        c.logout(); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.nativeTransfers.isEmpty())
        c.close()
    }

    @Test fun nativeTransferCancelAndFailureNeverFalselyBecomeCompleted() = runTest {
        val api = Service().apply { downloadGate = CompletableDeferred() }
        var now = 10_000L
        val c = DriveController(this, { api }, transferClockMillis = { now }).also {
            it.connect("https://drive.example", false)
        }
        c.login("owner", "password"); runCurrent()
        assertTrue(c.prepareFileExport(file))
        var discarded = 0
        c.saveFileExport({ ByteArrayOutputStream() }, { discarded++ }); runCurrent()
        val running = c.state.value.nativeTransfers.single()
        assertEquals(NativeTransferKind.DOWNLOAD, running.kind)
        assertEquals(NativeTransferStatus.RUNNING, running.status)
        assertEquals(3L, running.transferredBytes)
        assertEquals(42L, running.totalBytes)
        now += 1_000L
        c.cancelFileDownload(); runCurrent()
        assertEquals(1, discarded)
        val cancelled = c.state.value.nativeTransfers.single()
        assertEquals(NativeTransferStatus.CANCELLED, cancelled.status)
        assertEquals(3L, cancelled.transferredBytes)
        assertFalse(c.state.value.fileDownloadSaved)
        assertFalse(c.state.value.fileDownloadActive)
        c.clearNativeTransferHistory()
        assertTrue(c.state.value.nativeTransfers.isEmpty())

        api.downloadGate = null
        api.downloadFailure = ApiException(503, "transient")
        assertTrue(c.prepareFileExport(file))
        c.saveFileExport({ ByteArrayOutputStream() }, { discarded++ }); runCurrent()
        assertEquals(2, discarded)
        assertEquals(NativeTransferStatus.FAILED,
            c.state.value.nativeTransfers.single().status)
        assertFalse(c.state.value.fileDownloadSaved)
        c.logout(); runCurrent()
        assertTrue(c.state.value.nativeTransfers.isEmpty())
        c.close()
    }

    @Test fun nativeTransferUploadCancelledBeforeFinalizeIsExplicitlyUnconfirmed() = runTest {
        val api = Service().apply { uploadGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertTrue(c.prepareFileUpload())
        c.acceptFileUpload("uncertain.txt", 3,
            { ByteArrayInputStream("abc".toByteArray()) }); runCurrent()
        assertEquals(NativeTransferStatus.RUNNING,
            c.state.value.nativeTransfers.single().status)
        assertEquals(1, api.uploadCount)
        c.cancelFileUpload(); runCurrent()
        assertEquals(NativeTransferStatus.UNCONFIRMED,
            c.state.value.nativeTransfers.single().status)
        assertFalse(c.state.value.fileUploadCommitted)
        assertFalse(c.state.value.fileUploadActive)
        c.clearNativeTransferHistory()
        assertTrue(c.state.value.nativeTransfers.isEmpty())
        assertEquals(1, api.uploadCount)
        c.close()
    }

    @Test fun manualFileUploadUsesCurrentOwnerFolderAndNoStalePicker() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertTrue(c.prepareFileUpload())
        c.changeFilesSection(FilesSection.RECENT); runCurrent()
        c.acceptFileUpload("new.txt", 3, { ByteArrayInputStream("abc".toByteArray()) })
        runCurrent()
        assertEquals(0, api.uploadCount)
        c.changeFilesSection(FilesSection.BROWSE); runCurrent()
        assertTrue(c.prepareFileUpload())
        c.acceptFileUpload("new.txt", 3, { ByteArrayInputStream("abc".toByteArray()) })
        runCurrent()
        assertEquals(1, api.uploadCount)
        assertTrue(c.state.value.fileUploadCommitted)
        assertFalse(c.state.value.fileUploadActive)
        assertEquals(3L, c.state.value.fileUploadBytes)
        assertTrue(c.state.value.items.any { it.name == "new.txt" })
    }

    @Test fun uploadConflictUnfreezesProgressAndDoesNotRepeatMutation() = runTest {
        val api = Service().apply { uploadFailure = ApiException(409, "conflict") }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertTrue(c.prepareFileUpload())
        c.acceptFileUpload("new.txt", 3, { ByteArrayInputStream("abc".toByteArray()) })
        runCurrent()
        assertEquals(1, api.uploadCount)
        assertFalse(c.state.value.fileUploadActive)
        assertFalse(c.state.value.fileUploadCommitted)
        assertTrue(c.state.value.error?.contains("名称冲突") == true)
        assertNull(c.state.value.fileUploadPickerParent)
        assertEquals(0, api.mutationCalls.size)
    }

    @Test fun cancellingUploadClearsOwnerProgressAndCancelsWork() = runTest {
        val api = Service().apply { uploadGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertTrue(c.prepareFileUpload())
        c.acceptFileUpload("new.txt", 3, { ByteArrayInputStream("abc".toByteArray()) })
        runCurrent()
        assertTrue(c.state.value.fileUploadActive)
        assertEquals(1, api.uploadCount)
        c.cancelFileUpload(); runCurrent()
        assertFalse(c.state.value.fileUploadActive)
        assertFalse(c.state.value.fileUploadCommitted)
        assertEquals(0L, c.state.value.fileUploadBytes)
        assertNull(c.state.value.fileUploadPickerParent)
    }

    @Test fun galleryExportsOnlySelectedVerifiedOwnerAssetViaExistingSafPipeline() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val asset = api.latestGallery
        assertFalse(c.prepareFileExport(asset.node)) // Not selected.
        c.showGalleryInfo(asset)
        assertTrue(c.prepareFileExport(asset.node))
        assertEquals(Screen.GALLERY, c.state.value.fileExportOrigin)
        var discarded = 0
        val output = ByteArrayOutputStream()
        c.saveFileExport({ output }, { discarded++ }); runCurrent()
        assertEquals(1, api.downloadReads)
        assertEquals("hello", output.toString("UTF-8"))
        assertTrue(c.state.value.fileDownloadSaved)
        assertFalse(c.state.value.fileDownloadActive)
        assertNull(c.state.value.gallerySelected)
        assertEquals(Screen.GALLERY, c.state.value.screen)
        assertEquals(0, discarded)

        c.showGalleryInfo(asset)
        assertTrue(c.prepareFileExport(asset.node))
        c.openFilesApp(); runCurrent()
        c.saveFileExport({ error("Stale picker must not open a document") }, { discarded++ }); runCurrent()
        assertEquals(1, discarded)
        assertEquals(1, api.downloadReads)
        assertFalse(c.state.value.fileDownloadSaved)
        assertNull(c.state.value.fileExportOrigin)
    }

@Test fun galleryExportRefreshRequiresExplicitCancelAndNeverLeaksStaleSafBytes() = runTest {
        val api = Service().apply { downloadGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val asset = api.latestGallery
        c.openGallery(); runCurrent()
        c.showGalleryInfo(asset)
        assertTrue(c.prepareFileExport(asset.node))
        var discarded = 0
        c.saveFileExport({ ByteArrayOutputStream() }, { discarded++ }); runCurrent()
        assertTrue(c.state.value.fileDownloadActive)
        assertEquals(3L, c.state.value.fileDownloadBytes)
        val before = api.galleryRequests.size
        c.refreshGallery(); runCurrent()
        assertEquals(0, discarded) // A page refresh must not interrupt the document.
        assertTrue(c.state.value.fileDownloadActive)
        assertEquals(1, api.downloadReads)
        assertEquals(before, api.galleryRequests.size)
        assertEquals(3L, c.state.value.fileDownloadBytes)
        c.cancelFileDownload(); runCurrent()
        assertEquals(1, discarded) // Explicit cancel destroys the partial SAF document.
        assertFalse(c.state.value.fileDownloadActive)
        assertFalse(c.state.value.fileDownloadSaved)
        assertEquals(0L, c.state.value.fileDownloadBytes)
        c.refreshGallery(); runCurrent()
        assertEquals(before + 1, api.galleryRequests.size)
        assertTrue(c.state.value.galleryLoaded)
        assertNull(c.state.value.fileExportPending)
        assertNull(c.state.value.fileExportOrigin)
        assertEquals(1, api.downloadReads) // No upload/download write replay.
        c.close()
    }

    @Test fun gallerySearchAndKindScopeRetireDelayedSafPickerBeforeAnyDownload() = runTest {
        val api = Service().apply { provideGalleryTimeline = true }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val latest = c.state.value.galleryItems.single()
        c.showGalleryInfo(latest)
        assertTrue(c.prepareFileExport(latest.node))
        assertEquals(Screen.GALLERY, c.state.value.fileExportOrigin)

        // The SAF picker can return after Owner search changes the visible rows.
        c.searchGallery("sunset"); runCurrent()
        assertEquals("sunset", c.state.value.gallerySearchQuery)
        assertNull(c.state.value.fileExportPending)
        assertNull(c.state.value.fileExportOrigin)
        var discarded = 0
        c.saveFileExport({ error("stale search picker must not open output") }, { discarded++ })
        runCurrent()
        assertEquals(1, discarded)
        assertEquals(0, api.downloadReads)

        // Changing media kind also invalidates a picker from the prior Range.
        val searched = c.state.value.galleryItems.single()
        c.showGalleryInfo(searched)
        assertTrue(c.prepareFileExport(searched.node))
        c.filterGalleryKind("video"); runCurrent()
        assertEquals("video", c.state.value.galleryMediaKind)
        assertNull(c.state.value.fileExportPending)
        assertNull(c.state.value.fileExportOrigin)
        c.saveFileExport({ error("stale kind picker must not open output") }, { discarded++ })
        runCurrent()
        assertEquals(2, discarded)
        assertEquals(0, api.downloadReads)
        assertFalse(c.state.value.fileDownloadActive)
        assertFalse(c.state.value.fileDownloadSaved)
        c.close()
    }

@Test fun galleryIndexedJumpDefersWhileSafDownloadThenUsesExactOwnerIndex() = runTest {
        val api = Service().apply {
            provideGalleryTimeline = true
            downloadGate = CompletableDeferred()
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        assertNotNull(c.state.value.galleryTimelineSets)
        val original = c.state.value.galleryItems.single()
        c.showGalleryInfo(original)
        assertTrue(c.prepareFileExport(original.node))
        var discarded = 0
        c.saveFileExport({ ByteArrayOutputStream() }, { discarded++ }); runCurrent()
        assertTrue(c.state.value.fileDownloadActive)
        val before = api.galleryRequests.size

        // An indexed GET must not supersede an active foreground SAF write.
        c.jumpGalleryToGroup("year", "2026"); runCurrent()
        assertEquals(1, api.downloadReads)
        assertEquals(0, discarded)
        assertNull(c.state.value.galleryJumpIndex)
        assertEquals(before, api.galleryRequests.size)
        assertTrue(c.state.value.fileDownloadActive)
        assertEquals(3L, c.state.value.fileDownloadBytes)

        api.downloadGate?.complete(Unit); runCurrent()
        assertTrue(c.state.value.fileDownloadSaved)
        assertFalse(c.state.value.fileDownloadActive)
        c.jumpGalleryToGroup("year", "2026"); runCurrent()
        assertEquals(60, c.state.value.galleryJumpIndex)
        assertTrue(c.state.value.galleryLoaded)
        assertFalse(c.state.value.fileDownloadSaved)
        assertEquals(before + 1, api.galleryRequests.size)
        assertEquals(1, api.downloadReads)
        assertEquals(0, discarded)
        assertNull(c.state.value.error)
        c.close()
    }

    @Test fun galleryFailedExportDoesNotOfferMisleadingGalleryPageRetry() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.showGalleryInfo(api.latestGallery)
        assertTrue(c.prepareFileExport(api.latestGallery.node))
        api.downloadFailure = ApiException(503, "unavailable")
        var discarded = 0
        c.saveFileExport({ ByteArrayOutputStream() }, { discarded++ }); runCurrent()
        assertEquals(1, discarded)
        assertNotNull(c.state.value.fileDownloadError)
        assertNull(c.state.value.error)
        assertTrue(c.state.value.galleryLoaded)
        assertFalse(c.state.value.fileDownloadSaved)
    }

    @Test fun fileExportRejectsOldOwnerPickerAndExportsCurrentFileOnce() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val invalid = ByteArrayOutputStream()
        assertFalse(c.prepareFileExport(folder)) // Directory cannot be downloaded.
        assertTrue(c.prepareFileExport(file))
        c.changeFilesSection(FilesSection.FAVORITES); runCurrent()
        var discarded = 0
        c.saveFileExport({ invalid }, { discarded++ }); runCurrent()
        assertEquals(1, discarded)
        assertEquals(0, api.downloadReads)
        c.changeFilesSection(FilesSection.BROWSE); runCurrent()
        assertTrue(c.prepareFileExport(file))
        val output = ByteArrayOutputStream()
        c.saveFileExport({ output }, { discarded++ }); runCurrent()
        assertEquals(1, api.downloadReads)
        assertEquals("hello", output.toString("UTF-8"))
        assertEquals(5L, c.state.value.fileDownloadBytes)
        assertTrue(c.state.value.fileDownloadSaved)
        assertFalse(c.state.value.fileDownloadActive)
        assertEquals(1, discarded)
    }

@Test fun changingFolderWaitsForSafDownloadAndExplicitCancelCleansPartialFile() = runTest {
        val api = Service().apply { downloadGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertTrue(c.prepareFileExport(file))
        var discarded = 0
        val output = ByteArrayOutputStream()
        c.saveFileExport({ output }, { discarded++ }); runCurrent()
        assertTrue(c.state.value.fileDownloadActive)
        assertEquals(3L, c.state.value.fileDownloadBytes)
        val beforeCalls = api.calls.size
        assertTrue(shouldHandleFilesBack(c.state.value, false, false))
        c.open(folder); runCurrent()
        c.back(); runCurrent()
        assertEquals(beforeCalls, api.calls.size)
        assertEquals(root.id, c.state.value.path.last().id)
        assertTrue(c.state.value.fileDownloadActive)
        assertEquals(0, discarded)
        assertEquals(3L, c.state.value.fileDownloadBytes)
        c.cancelFileDownload(); runCurrent()
        assertEquals(1, discarded)
        assertFalse(c.state.value.fileDownloadActive)
        assertFalse(c.state.value.fileDownloadSaved)
        assertEquals(0L, c.state.value.fileDownloadBytes)
        assertNull(c.state.value.fileExportPending)
        assertTrue(output.size() < 5)
        c.open(folder); runCurrent()
        assertEquals(folder.id, c.state.value.path.last().id)
        assertEquals(1, api.downloadReads)
        c.close()
    }

    @Test fun refreshingInvalidatesUnreturnedSafPickerWithoutDownloading() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertTrue(c.prepareFileExport(file))
        c.refresh(); runCurrent()
        assertEquals(null, c.state.value.fileExportPending)
        var discarded = 0
        c.saveFileExport({ ByteArrayOutputStream() }, { discarded++ }); runCurrent()
        assertEquals(1, discarded)
        assertEquals(0, api.downloadReads)
    }

    @Test fun fileExportFailureDiscardsPartialDestinationAndDoesNotReplay() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertTrue(c.prepareFileExport(file))
        api.downloadFailure = ApiException(503, "unavailable")
        var discarded = 0
        c.saveFileExport({ ByteArrayOutputStream() }, { discarded++ }); runCurrent()
        assertEquals(1, discarded)
        assertEquals(1, api.downloadReads)
        assertFalse(c.state.value.fileDownloadActive)
        assertFalse(c.state.value.fileDownloadSaved)
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(null, c.state.value.fileExportPending)
    }

    @Test fun rootBackFirstExitsFilesSelectionWithoutLeavingOwnerSession() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertFalse(shouldHandleFilesBack(c.state.value, false, false))
        c.setBrowseSelectionMode(true)
        c.toggleBrowseSelection(folder)
        assertEquals(setOf(folder.id), c.state.value.browseSelectedIds)
        assertTrue(shouldHandleFilesBack(c.state.value, false, false))
        c.back()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(listOf(root), c.state.value.path)
        assertFalse(c.state.value.browseSelectionMode)
        assertTrue(c.state.value.browseSelectedIds.isEmpty())
        assertFalse(shouldHandleFilesBack(c.state.value, false, false))
        assertTrue(shouldHandleFilesBack(c.state.value, false, true))
    }

    @Test fun batchTrashUsesRevisionedOwnedBrowseRowsAndClearsSelectionAfterAck() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.setBrowseSelectionMode(true)
        c.toggleBrowseSelection(folder)
        c.toggleBrowseSelection(file)
        assertEquals(setOf(2L, 3L), c.state.value.browseSelectedIds)
        assertEquals(listOf("照片", "readme.txt"), c.state.value.items.map { it.name })
        c.trashSelectedBrowseNodes(); runCurrent()
        assertEquals(listOf("batch-trash:2@1,3@1"), api.mutationCalls)
        assertTrue(c.state.value.items.isEmpty())
        assertEquals(0L, c.state.value.totalCount)
        assertFalse(c.state.value.browseSelectionMode)
        assertTrue(c.state.value.browseSelectedIds.isEmpty())
        assertFalse(c.state.value.browseBatchWriteAttempted)
    }

    @Test fun failedBatchTrashDoesNotRetryWriteAndRequiresFreshBrowseRead() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.setBrowseSelectionMode(true)
        c.toggleBrowseSelection(file)
        api.mutationFailure = ApiException(503, "unknown commit")
        c.trashSelectedBrowseNodes(); runCurrent()
        assertFalse(c.state.value.loaded)
        assertTrue(c.state.value.browseBatchWriteAttempted)
        assertEquals(listOf("batch-trash:3@1"), api.mutationCalls)
        c.trashSelectedBrowseNodes(); runCurrent()
        assertEquals(1, api.mutationCalls.size)
        c.refresh(); runCurrent()
        assertTrue(c.state.value.loaded)
        assertFalse(c.state.value.browseBatchWriteAttempted)
        assertEquals(listOf("batch-trash:3@1"), api.mutationCalls)
    }

    @Test fun selectionLimit200WorksAcrossPagedBrowseAndAllowsDeselect() = runTest {
        val rows = (1..201).map { DriveNode(1000L + it, 1, "item-$it", "file", revision = 1) }
        val api = Service().apply { listing = { _, offset ->
            NodeRange(rows.drop(offset).take(100), rows.size.toLong(), offset)
        } }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.setBrowseSelectionMode(true)
        c.state.value.items.forEach(c::toggleBrowseSelection)
        assertEquals(100, c.state.value.browseSelectedIds.size)
        c.loadMore(); runCurrent()
        c.state.value.items.drop(100).forEach(c::toggleBrowseSelection)
        assertEquals(200, c.state.value.browseSelectedIds.size)
        c.loadMore(); runCurrent()
        c.toggleBrowseSelection(rows.last())
        assertEquals(200, c.state.value.browseSelectedIds.size)
        assertNotNull(c.state.value.error)
        c.toggleBrowseSelection(rows.first())
        assertNull(c.state.value.error)
        assertEquals(199, c.state.value.browseSelectedIds.size)
        c.toggleBrowseSelection(rows.last())
        assertEquals(200, c.state.value.browseSelectedIds.size)
        assertEquals(0, api.mutationCalls.size)
    }

    @Test fun batchTrash401DoesNotRefreshAndReplayUnknownCommittedDelete() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.setBrowseSelectionMode(true)
        c.toggleBrowseSelection(file)
        api.mutationFailure = ApiException(401, "uncertain batch delete")
        c.trashSelectedBrowseNodes(); runCurrent()
        assertEquals(listOf("batch-trash:3@1"), api.mutationCalls)
        assertEquals(0, api.refreshed)
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertFalse(c.state.value.loaded)
        assertTrue(c.state.value.browseSelectedIds.isEmpty())
        assertFalse(c.state.value.browseSelectionMode)
    }

    @Test fun selectionCannotEscapeBrowseOrOperateOnUnseenNode() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.setBrowseSelectionMode(true)
        c.toggleBrowseSelection(file.copy(revision = 99))
        c.toggleBrowseSelection(DriveNode(111, 1, "foreign", "file", revision = 1))
        assertTrue(c.state.value.browseSelectedIds.isEmpty())
        c.toggleBrowseSelection(file)
        assertEquals(setOf(3L), c.state.value.browseSelectedIds)
        c.changeFilesSection(FilesSection.FAVORITES); runCurrent()
        assertFalse(c.state.value.browseSelectionMode)
        assertTrue(c.state.value.browseSelectedIds.isEmpty())
        c.trashSelectedBrowseNodes(); runCurrent()
        assertTrue(api.mutationCalls.isEmpty())
        c.logout(); runCurrent()
        assertTrue(c.state.value.browseSelectedIds.isEmpty())
    }

    @Test fun nativeFileMutationsUseOwnerBrowseAndRefreshOnlyAfterServerAck() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.createFolder("新建文件夹"); runCurrent()
        assertTrue(c.state.value.items.any { it.name == "新建文件夹" })
        assertEquals(listOf("create:新建文件夹"), api.mutationCalls)
        assertEquals(1L to 0, api.calls.last())

        c.renameBrowseNode(file, "renamed.txt"); runCurrent()
        val changed = c.state.value.items.single { it.id == file.id }
        assertEquals("renamed.txt", changed.name)
        assertEquals(2L, changed.revision)
        c.moveBrowseNodeToTrash(changed); runCurrent()
        assertFalse(c.state.value.items.any { it.id == file.id })
        assertEquals(listOf("create:新建文件夹", "rename:renamed.txt", "trash:3"), api.mutationCalls)
    }

    @Test fun targetPickerIsServerVerifiedAndMovingFileUsesSameOwnerPath() = runTest {
        val api = Service()
        api.listing = { parent, offset ->
            if (parent == root.id) NodeRange(api.mutationRows, api.mutationRows.size.toLong(), offset)
            else NodeRange(emptyList(), 0, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.chooseDestination(file, FilesTransferKind.MOVE); runCurrent()
        assertEquals(root.id, c.state.value.destinationPath.last().id)
        assertEquals(listOf(folder), c.state.value.destinationFolders)
        c.enterDestinationFolder(folder); runCurrent()
        assertEquals(folder.id, c.state.value.destinationPath.last().id)
        c.commitDestination(); runCurrent()
        assertEquals(listOf("move:3->2@1"), api.mutationCalls)
        assertNull(c.state.value.destinationKind)
        assertFalse(c.state.value.items.any { it.id == file.id })
        assertEquals(listOf(root), c.state.value.path)
    }

    @Test fun atomicBrowseBatchCopyUsesOnlySelectedOwnerRowsAndOneServerPost() = runTest {
        val second = DriveNode(4, 1, "notes.txt", "file", 17, revision = 2)
        val api = object : Service() {
            var batches = 0
            override suspend fun batchCopyNodes(accessToken: String,
                originals: List<DriveNode>, parentId: Long): List<DriveNode> {
                assertEquals("access", accessToken)
                assertEquals(root.id, parentId)
                assertEquals(listOf(file, second), originals)
                batches++
                val copies = originals.mapIndexed { index, node ->
                    node.copy(id = 110L + index, parentId = parentId,
                        name = node.name + " - 副本", revision = 1)
                }
                mutationRows += copies
                mutationListing = true
                return copies
            }
        }
        api.mutationRows = listOf(folder, file, second)
        api.mutationListing = true
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.setBrowseSelectionMode(true)
        c.toggleBrowseSelection(file)
        c.toggleBrowseSelection(second)
        c.chooseSelectedDestination(FilesTransferKind.COPY); runCurrent()
        assertEquals(listOf(file, second), c.state.value.destinationSources)
        assertEquals(root.id, c.state.value.destinationPath.single().id)
        assertTrue(c.state.value.destinationLoaded)
        c.commitDestination(); runCurrent()
        assertEquals(1, api.batches)
        assertTrue(c.state.value.items.any { it.id == 110L })
        assertTrue(c.state.value.items.any { it.id == 111L })
        assertTrue(c.state.value.items.any { it == file })
        assertFalse(c.state.value.browseSelectionMode)
        assertTrue(c.state.value.browseSelectedIds.isEmpty())
        assertTrue(c.state.value.destinationSources.isEmpty())
        assertNull(c.state.value.destinationKind)
        c.close()
    }

    @Test fun batchMoveIsOneAtomicWriteAndCannotTargetCurrentParent() = runTest {
        val second = DriveNode(4, 1, "notes.txt", "file", 17, revision = 2)
        val api = object : Service() {
            var batches = 0
            override suspend fun batchMoveNodes(accessToken: String,
                originals: List<DriveNode>, parentId: Long): List<DriveNode> {
                batches++
                assertEquals("access", accessToken)
                assertEquals(listOf(file, second), originals)
                assertEquals(folder.id, parentId)
                mutationRows = mutationRows.filterNot { it.id in originals.map { o -> o.id } }
                mutationListing = true
                return originals.map { it.copy(parentId = parentId,
                    revision = it.revision + 1) }
            }
        }
        api.mutationRows = listOf(folder, file, second)
        api.mutationListing = true
        api.listing = { parent, offset ->
            if (parent == root.id) NodeRange(
                if (offset == 0) api.mutationRows else emptyList(),
                api.mutationRows.size.toLong(), offset)
            else NodeRange(emptyList(), 0, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.setBrowseSelectionMode(true)
        c.toggleBrowseSelection(file); c.toggleBrowseSelection(second)
        c.chooseSelectedDestination(FilesTransferKind.MOVE); runCurrent()
        c.commitDestination(); runCurrent()
        assertEquals(0, api.batches) // Root is their existing parent.
        c.enterDestinationFolder(folder); runCurrent()
        c.commitDestination(); runCurrent()
        assertEquals(1, api.batches)
        assertEquals(listOf(folder), c.state.value.items)
        assertEquals(listOf(root), c.state.value.path)
        assertNull(c.state.value.destinationKind)
        assertFalse(c.state.value.browseSelectionMode)
        c.close()
    }

    @Test fun uncertainBatchAckFreezesBrowseAndDoesNotRepeatPhysicalWrite() = runTest {
        val second = DriveNode(4, 1, "notes.txt", "file", 17, revision = 2)
        val api = object : Service() {
            var attempts = 0
            override suspend fun batchCopyNodes(accessToken: String,
                originals: List<DriveNode>, parentId: Long): List<DriveNode> {
                attempts++
                throw ApiException(503, "Commit ACK might have been lost")
            }
        }
        api.mutationRows = listOf(folder, file, second)
        api.mutationListing = true
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.setBrowseSelectionMode(true)
        c.toggleBrowseSelection(file); c.toggleBrowseSelection(second)
        c.chooseSelectedDestination(FilesTransferKind.COPY); runCurrent()
        c.commitDestination(); runCurrent()
        assertEquals(1, api.attempts)
        assertFalse(c.state.value.loaded)
        assertTrue(c.state.value.destinationWriteAttempted)
        assertTrue(c.state.value.error.orEmpty().contains("结果未确认"))
        c.commitDestination(); runCurrent()
        assertEquals(1, api.attempts)
        c.dismissDestination()
        assertNull(c.state.value.destinationKind)
        c.commitDestination(); runCurrent()
        assertEquals(1, api.attempts)
        c.close()
    }

    @Test fun batchPickerRejectsMissingOrUnrevisionedSourceAndKeepsSelectionOnCancel() = runTest {
        val second = DriveNode(4, 1, "notes.txt", "file", 17, revision = 2)
        val api = Service().apply {
            mutationRows = listOf(folder, file, second)
            mutationListing = true
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.chooseSelectedDestination(FilesTransferKind.COPY)
        assertNull(c.state.value.destinationKind)
        c.setBrowseSelectionMode(true)
        c.toggleBrowseSelection(file)
        c.toggleBrowseSelection(second)
        c.chooseSelectedDestination(FilesTransferKind.COPY); runCurrent()
        assertEquals(2, c.state.value.destinationSources.size)
        c.dismissDestination(); runCurrent()
        assertNull(c.state.value.destinationKind)
        assertTrue(c.state.value.destinationSources.isEmpty())
        assertEquals(setOf(file.id, second.id), c.state.value.browseSelectedIds)
        c.setBrowseSelectionMode(false)
        assertTrue(c.state.value.browseSelectedIds.isEmpty())
        c.close()
    }

    @Test fun nativeCopyToCurrentFolderAcceptsServerGeneratedDuplicateName() = runTest {
        val api = Service()
        api.listing = { parent, offset ->
            if (parent == root.id) NodeRange(api.mutationRows, api.mutationRows.size.toLong(), offset)
            else NodeRange(emptyList(), 0, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.chooseDestination(file, FilesTransferKind.COPY); runCurrent()
        c.commitDestination(); runCurrent()
        assertEquals(listOf("copy:3->1"), api.mutationCalls)
        assertEquals("readme.txt - 副本", c.state.value.items.single { it.id == 31L }.name)
        assertNull(c.state.value.destinationKind)
        assertTrue(c.state.value.items.any { it.id == file.id })
    }

    @Test fun targetPickerNeverOffersSelfMoveOrUntrustedFolderAndBackCancels() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.chooseDestination(folder, FilesTransferKind.MOVE); runCurrent()
        val calls = api.calls.size
        c.enterDestinationFolder(folder); runCurrent()
        assertEquals(calls, api.calls.size) // cannot descend into own subtree
        c.commitDestination(); runCurrent() // same parent cannot move
        assertTrue(api.mutationCalls.isEmpty())
        c.enterDestinationFolder(DriveNode(987, 1, "foreign", "dir")); runCurrent()
        assertEquals(calls, api.calls.size)
        c.dismissDestination(); runCurrent()
        assertNull(c.state.value.destinationKind)
        assertEquals(listOf(root), c.state.value.path)
    }

    @Test fun targetFolderPickerPages100ItemServerRangesWithoutDuplication() = runTest {
        val api = Service()
        val firstPage = listOf(folder, file) +
            (1..98).map { DriveNode(1000L + it, 1, "sub-$it", "dir", revision = 1) }
        val lastFolder = DriveNode(2100, 1, "last-folder", "dir", revision = 1)
        api.listing = { parent, offset ->
            if (parent != root.id) NodeRange(emptyList(), 0, offset)
            else if (offset == 0) NodeRange(firstPage, 101, 0)
            else NodeRange(listOf(lastFolder), 101, 100)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.chooseDestination(file, FilesTransferKind.COPY); runCurrent()
        assertTrue(c.state.value.destinationHasNext)
        assertEquals(99, c.state.value.destinationFolders.size)
        c.loadMoreDestination(); runCurrent()
        assertEquals(100, c.state.value.destinationOffset)
        assertFalse(c.state.value.destinationHasNext)
        assertEquals(100, c.state.value.destinationFolders.size)
        assertEquals(lastFolder.id, c.state.value.destinationFolders.last().id)
        c.loadMoreDestination(); runCurrent()
        assertEquals(1, api.calls.count { it.first == root.id && it.second == 100 })
    }

    @Test fun failedTargetDirectoryReadCannotSendAnyMutation() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        api.failure = ApiException(503, "target unavailable")
        c.chooseDestination(file, FilesTransferKind.MOVE); runCurrent()
        assertNotNull(c.state.value.error)
        assertFalse(c.state.value.destinationLoaded)
        c.commitDestination(); runCurrent()
        assertTrue(api.mutationCalls.isEmpty())
        c.retryDestination(); runCurrent()
        assertTrue(c.state.value.destinationLoaded)
        assertEquals(root.id, c.state.value.destinationPath.last().id)
    }

    @Test fun failedChildFolderReadRetriesRequestedChildNotPreviousParent() = runTest {
        val api = Service(); val c = controller(this, api)
        var childReads = 0
        api.listing = { parent, offset ->
            if (parent == folder.id) {
                childReads++
                if (childReads == 1) throw ApiException(503, "temporary target failure")
                NodeRange(emptyList(), 0, offset)
            } else NodeRange(listOf(folder, file), 2, offset)
        }
        c.login("owner", "password"); runCurrent()
        c.chooseDestination(file, FilesTransferKind.COPY); runCurrent()
        assertEquals(root.id, c.state.value.destinationPath.last().id)
        c.enterDestinationFolder(folder); runCurrent()
        assertEquals(folder.id, c.state.value.destinationPath.last().id)
        assertFalse(c.state.value.destinationLoaded)
        assertNotNull(c.state.value.error)
        c.commitDestination(); runCurrent()
        assertTrue(api.mutationCalls.isEmpty())
        c.retryDestination(); runCurrent()
        assertEquals(folder.id, c.state.value.destinationPath.last().id)
        assertTrue(c.state.value.destinationLoaded)
        assertEquals(2, childReads)
        assertTrue(api.mutationCalls.isEmpty())
    }

    @Test fun passwordRequiredDuringTargetLoadClearsPrivatePickerState() = runTest {
        val api = object : Service() {
            override suspend fun refresh(refreshToken: String): AuthSession =
                AuthSession("new", "rotated", "owner", mustChangePassword = true)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        api.failure = ApiException(401, "expired")
        c.chooseDestination(file, FilesTransferKind.COPY); runCurrent()
        assertEquals(Screen.PASSWORD, c.state.value.screen)
        assertNull(c.state.value.destinationKind)
        assertNull(c.state.value.destinationSource)
        assertTrue(c.state.value.destinationPath.isEmpty())
        assertTrue(c.state.value.destinationFolders.isEmpty())
        assertTrue(c.state.value.path.isEmpty())
        assertTrue(c.state.value.items.isEmpty())
    }

    @Test fun uncertainCopyAckAllowsNoSecondWriteUntilBrowseGetRefresh() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.chooseDestination(file, FilesTransferKind.COPY); runCurrent()
        api.mutationFailure = ApiException(503, "unknown if committed")
        c.commitDestination(); runCurrent()
        assertEquals(listOf("copy:3->1"), api.mutationCalls)
        assertTrue(c.state.value.destinationWriteAttempted)
        assertFalse(c.state.value.loaded)
        assertNotNull(c.state.value.error)
        c.commitDestination(); runCurrent()
        c.retryDestination(); runCurrent()
        assertEquals(listOf("copy:3->1"), api.mutationCalls)
        c.dismissDestination(); runCurrent()
        assertNull(c.state.value.destinationKind)
        assertFalse(c.state.value.loaded)
        c.refresh(); runCurrent()
        assertTrue(c.state.value.loaded)
        assertNull(c.state.value.error)
        assertEquals(listOf("copy:3->1"), api.mutationCalls)
    }

    @Test fun oldTargetFolderResponseCannotShowAfterOwnerLogout() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.chooseDestination(file, FilesTransferKind.COPY); runCurrent()
        val late = CompletableDeferred<NodeRange>()
        api.listing = { parent, offset ->
            if (parent == folder.id) withContext(NonCancellable) { late.await() }
            else NodeRange(listOf(folder, file), 2, offset)
        }
        c.enterDestinationFolder(folder); runCurrent()
        c.logout(); runCurrent()
        late.complete(NodeRange(emptyList(), 0, 0)); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertNull(c.state.value.destinationKind)
        assertTrue(c.state.value.destinationFolders.isEmpty())
    }

    @Test fun destinationCopy401NeverRefreshesTokenOrRetriesWrite() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.chooseDestination(file, FilesTransferKind.COPY); runCurrent()
        api.mutationFailure = ApiException(401, "uncertain copy")
        c.commitDestination(); runCurrent()
        assertEquals(listOf("copy:3->1"), api.mutationCalls)
        assertEquals(0, api.refreshed)
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertNull(c.state.value.destinationSource)
    }

    @Test fun uncertain401WriteNeverAutoRefreshesAndReplaysTheMutation() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        api.mutationFailure = ApiException(401, "uncertain mutation")
        c.createFolder("no-replay"); runCurrent()
        assertEquals(listOf("create:no-replay"), api.mutationCalls)
        assertEquals(0, api.refreshed)
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
    }

    @Test fun revisionConflictDoesNotOptimisticallyRenameOrAutomaticallyRetry() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        api.mutationFailure = ApiException(409, "conflict")
        c.renameBrowseNode(file, "other.txt"); runCurrent()
        assertNotNull(c.state.value.error)
        assertTrue(c.state.value.items.contains(file))
        assertEquals(listOf("rename:other.txt"), api.mutationCalls)
        c.retry(); runCurrent()
        assertEquals(listOf("rename:other.txt"), api.mutationCalls) // GET, never replay PATCH
    }

    @Test fun confirmedMutationReadFailureShowsCommittedStatusAndGetRetryOnly() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        api.refreshAfterCommitFailure = true
        c.createFolder("已保存"); runCurrent()
        assertTrue(c.state.value.error.orEmpty().contains("已提交"))
        assertTrue(c.state.value.items.any { it.name == "已保存" })
        c.retry(); runCurrent()
        assertEquals(listOf("create:已保存"), api.mutationCalls)
        assertNull(c.state.value.error)
        assertTrue(c.state.value.items.any { it.name == "已保存" })
    }

    @Test fun lateCommittedMutationCannotRestoreRowsAfterLogout() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val delayed = CompletableDeferred<DriveNode>()
        api.createHandler = { parentId, name ->
            withContext(NonCancellable) { delayed.await() }
        }
        c.createFolder("private"); runCurrent()
        assertTrue(c.state.value.loading)
        c.logout(); runCurrent()
        delayed.complete(DriveNode(55, 1, "private", "dir", revision = 1)); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
        assertTrue(c.state.value.collectionItems.isEmpty())
    }

    @Test fun collectionAndStaleNodesCannotIssueBrowseMutations() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.renameBrowseNode(file.copy(revision = 5), "stale.txt")
        c.moveBrowseNodeToTrash(file.copy(revision = 5))
        c.changeFilesSection(FilesSection.RECENT); runCurrent()
        c.createFolder("not-a-folder")
        c.renameBrowseNode(file, "file.txt")
        c.moveBrowseNodeToTrash(file)
        assertTrue(api.mutationCalls.isEmpty())
    }

    @Test fun globalSearchUsesServerCursorAndRestoresBrowseState() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val browse = c.state.value.items
        val path = c.state.value.path
        c.submitGlobalSearch(" trip "); runCurrent()
        assertEquals(FilesSection.SEARCH, c.state.value.filesSection)
        assertEquals("trip", c.state.value.searchQuery)
        assertEquals(listOf(api.searchFile), c.state.value.collectionItems)
        assertEquals("cursor-1", c.state.value.searchNextCursor)
        c.loadMoreSearch(); runCurrent()
        assertEquals(listOf(api.searchFile, api.recentFolder), c.state.value.collectionItems)
        assertEquals("", c.state.value.searchNextCursor)
        assertEquals(listOf("trip" to "", "trip" to "cursor-1"), api.searchCalls)
        c.loadMoreSearch(); runCurrent()
        assertEquals(2, api.searchCalls.size)
        c.changeFilesSection(FilesSection.BROWSE); runCurrent()
        assertEquals(path, c.state.value.path)
        assertEquals(browse, c.state.value.items)
        assertEquals("", c.state.value.searchQuery)
    }

    @Test fun searchFileDirectoryOnlyBreadcrumbLocatesActualParent() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.submitGlobalSearch("readme"); runCurrent()
        c.locateCollectionItem(api.searchFile); runCurrent()
        assertEquals(FilesSection.BROWSE, c.state.value.filesSection)
        assertEquals(listOf(root), c.state.value.path)
        assertEquals(1L to 0, api.calls.last())
    }

    @Test fun searchShowInFolderScrollsToExactOwnerFileWithoutFullDirectoryScan() = runTest {
        val target = DriveNode(1155, 1, "target.txt", "file", 12, revision = 3)
        val api = Service()
        api.searchListing = { _, _ ->
            // Stale/misleading search crumbs must not determine destination.
            FileSearchPage(listOf(DriveCollectionItem(target, "old/path/target.txt",
                listOf(DriveCrumb(404, "not-owner")))), "")
        }
        api.locateNode = { node ->
            OwnedNodeLocation(node, 3, 1, listOf(DriveCrumb(1, "")))
        }
        api.positionNode = { _, node -> DirectoryItemPosition(node, 3, 155) }
        api.listing = { parent, offset ->
            assertEquals(1L, parent)
            val page = (offset until minOf(offset + 100, 301)).map { index ->
                if (index == 155) target
                else DriveNode(1000L + index, 1, "file-$index.txt", "file", 12, revision = 1)
            }
            NodeRange(page, 301, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.submitGlobalSearch("target"); runCurrent()
        c.locateCollectionItem(c.state.value.collectionItems.single()); runCurrent()

        assertEquals(FilesSection.BROWSE, c.state.value.filesSection)
        assertEquals(listOf(root.id), c.state.value.path.map { it.id })
        assertEquals(100, c.state.value.browseWindowStart)
        assertEquals(100, c.state.value.offset)
        assertEquals(301L, c.state.value.totalCount)
        assertEquals(100, c.state.value.items.size)
        assertEquals(target, c.state.value.items[55])
        assertEquals(target.id, c.state.value.focusedBrowseNodeId)
        assertEquals(55, c.state.value.focusedBrowseIndex)
        assertTrue(c.state.value.focusedBrowseEpoch > 0)
        assertEquals(listOf(1L to 100), api.calls.takeLast(1))
        assertEquals(listOf(target.id), api.locateCalls)
        assertEquals(listOf(1L to target.id), api.positionCalls)
        assertTrue(c.state.value.hasPrevious)

        c.loadPrevious(); runCurrent()
        assertEquals(0, c.state.value.browseWindowStart)
        assertEquals(200, c.state.value.items.size)
        assertEquals(155, c.state.value.focusedBrowseIndex)
        assertEquals(target, c.state.value.items[155])
        assertEquals(listOf(1L to 100, 1L to 0), api.calls.takeLast(2))

        c.loadMore(); runCurrent()
        assertEquals(200, c.state.value.offset)
        assertEquals(300, c.state.value.items.size)
        assertEquals(target.id, c.state.value.focusedBrowseNodeId)
        // Locate + two user-driven pages; never a scan of the first 155 rows.
        assertEquals(listOf(1L to 100, 1L to 0, 1L to 200),
            api.calls.takeLast(3))
        c.close()
    }

    @Test fun searchShowInFolderAt95237LoadsOnlyExactPage() = runTest {
        val target = DriveNode(990037L, 1L, "deep-photo.jpg", "file", 50, revision = 9)
        val hit = DriveCollectionItem(target, "obsolete/foreign/path.jpg",
            listOf(DriveCrumb(404L, "stale-search-crumb")))
        val api = Service()
        api.searchListing = { _, _ -> FileSearchPage(listOf(hit), "") }
        api.locateNode = { id ->
            assertEquals(target.id, id)
            OwnedNodeLocation(id, target.revision, 1L, listOf(DriveCrumb(1L, "")))
        }
        api.positionNode = { parent, id ->
            assertEquals(1L, parent)
            assertEquals(target.id, id)
            DirectoryItemPosition(id, target.revision, 95237)
        }
        api.listing = { parent, offset ->
            assertEquals(1L, parent)
            val page = (offset until offset + 100).map { index ->
                if (index == 95237) target else
                    DriveNode(1000000L + index, 1L, "row-$index.txt", "file",
                        size = 12, revision = 9)
            }
            NodeRange(page, 100000, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(listOf(1L to 0), api.calls)
        c.submitGlobalSearch("deep"); runCurrent()
        c.locateCollectionItem(c.state.value.collectionItems.single()); runCurrent()
        val state = c.state.value
        assertEquals(FilesSection.BROWSE, state.filesSection)
        assertEquals(95200, state.browseWindowStart)
        assertEquals(95200, state.offset)
        assertEquals(100000L, state.totalCount)
        assertEquals(100, state.items.size)
        assertEquals(target, state.items[37])
        assertEquals(target.id, state.focusedBrowseNodeId)
        assertEquals(37, state.focusedBrowseIndex)
        assertEquals(listOf(1L to 0, 1L to 95200), api.calls)
        assertEquals(listOf(target.id), api.locateCalls)
        assertEquals(listOf(1L to target.id), api.positionCalls)
        assertTrue(state.hasPrevious)
        c.close()
    }

    @Test fun changedOwnerPositionFailsClosedAndKeepsSearchResults() = runTest {
        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.submitGlobalSearch("readme"); runCurrent()
        val oldRows = c.state.value.collectionItems.toList()
        api.positionNode = { _, node -> DirectoryItemPosition(node, 999, 1) }
        val readsBefore = api.calls.size
        c.locateCollectionItem(oldRows.single()); runCurrent()
        assertEquals(FilesSection.SEARCH, c.state.value.filesSection)
        assertEquals(oldRows, c.state.value.collectionItems)
        assertNull(c.state.value.focusedBrowseNodeId)
        assertNotNull(c.state.value.error)
        assertEquals(readsBefore, api.calls.size)
        c.close()
    }

    @Test fun delayedOwnerLocationCannotSelectItemAfterLogout() = runTest {
        val reply = CompletableDeferred<OwnedNodeLocation>()
        val api = Service().apply {
            locateNode = { withContext(NonCancellable) { reply.await() } }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.submitGlobalSearch("readme"); runCurrent()
        c.locateCollectionItem(c.state.value.collectionItems.single()); runCurrent()
        c.logout(); runCurrent()
        reply.complete(OwnedNodeLocation(file.id, 1, 1, listOf(DriveCrumb(1, ""))))
        runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.collectionItems.isEmpty())
        assertNull(c.state.value.focusedBrowseNodeId)
        assertTrue(c.state.value.items.isEmpty())
        c.close()
    }

    @Test fun staleGlobalSearchCannotOverwriteFreshQueryOrLogout() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val old = CompletableDeferred<FileSearchPage>()
        api.searchListing = { q, _ -> if (q == "old") withContext(NonCancellable) { old.await() }
            else FileSearchPage(listOf(api.searchFile), "") }
        c.submitGlobalSearch("old"); runCurrent()
        c.submitGlobalSearch("new"); runCurrent()
        old.complete(FileSearchPage(listOf(api.recentFolder), "obsolete")); runCurrent()
        assertEquals(FilesSection.SEARCH, c.state.value.filesSection)
        assertEquals("new", c.state.value.searchQuery)
        assertEquals(listOf(api.searchFile), c.state.value.collectionItems)
        c.logout(); runCurrent()
        assertTrue(c.state.value.collectionItems.isEmpty())
        assertEquals("", c.state.value.searchQuery)
    }

    @Test fun searchOpenedFromFavoritesReturnsToFavoritesNotBrowse() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changeFilesSection(FilesSection.FAVORITES); runCurrent()
        c.submitGlobalSearch("hello"); runCurrent()
        assertEquals(FilesSection.SEARCH, c.state.value.filesSection)
        assertEquals(FilesSection.FAVORITES, c.state.value.searchReturnSection)
        c.submitGlobalSearch("world"); runCurrent()
        assertEquals(FilesSection.FAVORITES, c.state.value.searchReturnSection)
        c.back(); runCurrent()
        assertEquals(FilesSection.FAVORITES, c.state.value.filesSection)
        assertEquals(listOf(api.favoriteFile), c.state.value.collectionItems)
    }

    @Test fun searchFailedCursorIsRetriedWithoutLosingPreviousRows() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        var failed = false
        api.searchListing = { _, cursor ->
            if (cursor.isNotEmpty() && !failed) {
                failed = true
                throw ApiException(503, "failed")
            }
            if (cursor.isEmpty()) FileSearchPage(listOf(api.searchFile), "cursor-1")
            else FileSearchPage(listOf(api.recentFolder), "")
        }
        c.submitGlobalSearch("sample"); runCurrent()
        c.loadMoreSearch(); runCurrent()
        assertNotNull(c.state.value.error)
        assertEquals(listOf(api.searchFile), c.state.value.collectionItems)
        c.loadMoreSearch(); runCurrent()
        assertEquals(2, api.searchCalls.size)
        c.retry(); runCurrent()
        assertEquals(listOf(api.searchFile, api.recentFolder), c.state.value.collectionItems)
        assertEquals(3, api.searchCalls.size)
        assertNull(c.state.value.error)
    }

    @Test fun recentAndFavoriteSectionsLoadOwnerCollectionsAndPreserveBrowsePath() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val browse = c.state.value.items
        val path = c.state.value.path
        c.changeFilesSection(FilesSection.RECENT); runCurrent()
        assertEquals(FilesSection.RECENT, c.state.value.filesSection)
        assertTrue(c.state.value.collectionLoaded)
        assertEquals(listOf(api.recentFolder), c.state.value.collectionItems)
        c.changeFilesSection(FilesSection.FAVORITES); runCurrent()
        assertEquals(listOf(api.favoriteFile), c.state.value.collectionItems)
        c.showDetails(file)
        assertEquals(file, c.state.value.selected)
        c.dismissDetails()
        c.changeFilesSection(FilesSection.BROWSE); runCurrent()
        assertEquals(path, c.state.value.path)
        assertEquals(browse, c.state.value.items)
        assertTrue(c.state.value.collectionItems.isEmpty())
        c.logout(); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.collectionItems.isEmpty())
        assertEquals(FilesSection.BROWSE, c.state.value.filesSection)
    }

    @Test fun staleRecentResponseCannotOverwriteSelectedFavoritesOrNextOwner() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val late = CompletableDeferred<List<DriveCollectionItem>>()
        api.recentListing = { withContext(NonCancellable) { late.await() } }
        c.changeFilesSection(FilesSection.RECENT); runCurrent()
        c.changeFilesSection(FilesSection.FAVORITES); runCurrent()
        assertEquals(listOf(api.favoriteFile), c.state.value.collectionItems)
        late.complete(listOf(api.recentFolder)); runCurrent()
        assertEquals(FilesSection.FAVORITES, c.state.value.filesSection)
        assertEquals(listOf(api.favoriteFile), c.state.value.collectionItems)
        c.logout(); runCurrent()
        assertTrue(c.state.value.collectionItems.isEmpty())
    }

    @Test fun recentFolderNavigationRevalidatesOwnedRootAndUsesOneBrowsePipeline() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changeFilesSection(FilesSection.RECENT); runCurrent()
        c.openCollectionItem(api.recentFolder); runCurrent()
        assertEquals(FilesSection.BROWSE, c.state.value.filesSection)
        // Breadcrumbs carry owned IDs/names but do not promise Node revision.
        assertEquals(listOf(root.id, folder.id), c.state.value.path.map { it.id })
        assertEquals(listOf(root.name, folder.name), c.state.value.path.map { it.name })
        assertEquals(folder.id to 0, api.calls.last())
    }

    @Test fun favoritesMutationsOnlyAffectUiAfterServerAcknowledges() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.favoriteFile(file); runCurrent()
        assertEquals(1, api.favoritePuts)
        c.changeFilesSection(FilesSection.FAVORITES); runCurrent()
        assertEquals(1, c.state.value.collectionItems.size)
        c.unfavoriteFile(file); runCurrent()
        assertEquals(1, api.favoriteDeletes)
        assertTrue(c.state.value.collectionItems.isEmpty())
    }

    @Test fun failedFolderNavigationKeepsPathAndRetriesIntendedFolder() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        api.failure = ApiException(500, "safe")
        c.open(folder); runCurrent()
        assertEquals(listOf(root), c.state.value.path)
        assertNotNull(c.state.value.error)
        c.retry(); runCurrent()
        assertEquals(listOf(root, folder), c.state.value.path)
        c.back(); runCurrent()
        assertEquals(listOf(root), c.state.value.path)
    }

    @Test fun logoutCancelsRequestAndRejectsLateCompletion() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val late = CompletableDeferred<NodeRange>()
        var cancelled = false
        api.listing = { _, _ ->
            try { awaitCancellation() } finally {
                cancelled = true
                withContext(NonCancellable) { late.await() }
            }
        }
        c.open(folder); runCurrent()
        c.logout(); runCurrent()
        assertTrue(cancelled)
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
        late.complete(NodeRange(listOf(file), 1, 0)); runCurrent()
        assertEquals(Screen.LOGIN, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
        assertTrue(api.loggedOut)
    }

    @Test fun newNavigationRejectsNonCooperativeOldResponse() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val late = CompletableDeferred<NodeRange>()
        api.listing = { id, offset -> if (id == folder.id) withContext(NonCancellable) { late.await() } else NodeRange(listOf(file), 1, offset) }
        c.open(folder); runCurrent()
        c.refresh(); runCurrent()
        late.complete(NodeRange(listOf(folder), 1, 0)); runCurrent()
        assertEquals(listOf(root), c.state.value.path)
        assertEquals(listOf(file), c.state.value.items)
    }

    @Test fun passwordChangeIsRequiredBeforeAnyFileRead() = runTest {
        val api = Service().apply { required = true }; val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(Screen.PASSWORD, c.state.value.screen)
        assertTrue(api.calls.isEmpty())
        c.changePassword("old", "new-password"); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(1, api.calls.size)
    }

    @Test fun wrongCurrentPasswordStaysOnFormWithoutRefreshAndCanRetry() = runTest {
        var attempts = 0
        val api = object : Service() {
            override suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String): AuthSession {
                attempts++
                if (attempts == 1) {
                    throw ApiException(401, "Server request failed", ApiFailureReason.CURRENT_PASSWORD_INCORRECT)
                }
                assertEquals("access", accessToken)
                assertEquals("correct", currentPassword)
                return AuthSession("changed", "refresh", "owner")
            }
        }.apply { required = true }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changePassword("incorrect", "replacement"); runCurrent()
        assertEquals(Screen.PASSWORD, c.state.value.screen)
        assertEquals(0, api.refreshed)
        assertFalse(api.loggedOut)
        assertTrue(api.calls.isEmpty())
        assertFalse(c.state.value.loading)
        assertEquals("当前密码不正确，请重新输入。", c.state.value.error)
        c.changePassword("correct", "replacement"); runCurrent()
        assertEquals(2, attempts)
        assertEquals(Screen.FILES, c.state.value.screen)
        assertNull(c.state.value.error)
        c.close()
    }

    @Test fun expiredAccessRefreshesOnceAndRetries() = runTest {
        val api = Service().apply { failure = ApiException(401, "expired") }; val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(1, api.refreshed)
        assertEquals(2, api.calls.size)
        assertNull(c.state.value.error)
    }

    @Test fun changeServerImmediatelyClearsOwnerRowsAndSession() = runTest {
        val api = Service(); val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changeServer(); runCurrent()
        assertEquals(Screen.CONNECT, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
        assertTrue(c.state.value.path.isEmpty())
        assertEquals("", c.state.value.username)
    }

    @Test fun revokedRefreshClearsExistingRowsAndRequiresLogin() = runTest {
        for (failure in listOf(ApiException(401, "revoked"), ApiException(403, "disabled"),
            java.io.IOException("lost ACK"), ApiException(0, "malformed response"))) {
            val api = Service(); val c = controller(this, api)
            c.login("owner", "password"); runCurrent()
            api.failure = ApiException(401, "expired")
            api.refreshFailure = failure
            c.refresh(); runCurrent()
            assertEquals(Screen.LOGIN, c.state.value.screen)
            assertTrue(c.state.value.items.isEmpty())
            assertTrue(c.state.value.path.isEmpty())
            assertEquals(1, api.refreshed)
            c.close()
        }
    }

    @Test fun firstPageFailureIsNotAnEmptyFolderAndRetryLoadsRoot() = runTest {
        val api = Service().apply { failure = ApiException(503, "failure") }; val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertFalse(c.state.value.loaded)
        assertNotNull(c.state.value.error)
        c.retry(); runCurrent()
        assertTrue(c.state.value.loaded)
        assertNull(c.state.value.error)
        assertEquals(listOf(root), c.state.value.path)
    }

    private class TestVault : DriveSessionPersistence {
        var value: SavedDriveSession? = null
        var cleared = 0
        override fun load() = value
        override fun save(server: String, session: AuthSession) {
            value = SavedDriveSession(server, session.username, session.refreshToken)
        }
        override fun clear() { value = null; cleared++ }
    }

    @Test fun unifiedLoginPersistsRefreshAndColdStartRestoresWithoutPassword() = runTest {
        val vault = TestVault()
        val service = Service()
        val first = DriveController(this, { service }, sessionPersistence = vault)
        first.connectAndLogin("https://drive.example", false, "", "owner", "secret-password", true)
        runCurrent()
        assertEquals(Screen.FILES, first.state.value.screen)
        assertEquals("refresh", vault.value?.refreshToken)
        first.close() // Process exit must NOT log out.
        val second = DriveController(this, { service }, sessionPersistence = vault)
        second.restoreSession()
        runCurrent()
        assertEquals(1, service.refreshed)
        assertEquals(Screen.FILES, second.state.value.screen)
        assertEquals("rotated", vault.value?.refreshToken)
        second.logout()
        runCurrent()
        assertNull(vault.value)
        assertEquals(Screen.LOGIN, second.state.value.screen)
        second.close()
    }

    @Test fun offlineRestoreKeepsVaultButRevokedRefreshReturnsToLogin() = runTest {
        val vault = TestVault().apply {
            value = SavedDriveSession("https://drive.example/", "owner", "saved-refresh")
        }
        val offline = Service().apply { refreshFailure = ApiException(503, "network unavailable") }
        val first = DriveController(this, { offline }, sessionPersistence = vault)
        first.restoreSession()
        runCurrent()
        assertEquals(Screen.CONNECT, first.state.value.screen)
        assertEquals("saved-refresh", vault.value?.refreshToken)
        first.close()
        val expired = Service().apply { refreshFailure = ApiException(401, "invalid") }
        val second = DriveController(this, { expired }, sessionPersistence = vault)
        second.restoreSession()
        runCurrent()
        assertEquals(Screen.LOGIN, second.state.value.screen)
        assertNull(vault.value)
        second.close()
    }

    @Test fun optOutOfKeepingLoginDoesNotPersistCredential() = runTest {
        val vault = TestVault()
        val service = Service()
        val c = DriveController(this, { service }, sessionPersistence = vault)
        c.connectAndLogin("https://drive.example", false, "", "owner", "secret", false)
        runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertNull(vault.value)
        c.close()
    }

    @Test fun oldLoginResponseCannotSignInAfterChangingServer() = runTest {
        val late = CompletableDeferred<AuthSession>()
        val api = object : Service() {
            override suspend fun login(username: String, password: String) = withContext(NonCancellable) { late.await() }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changeServer(); runCurrent()
        late.complete(AuthSession("secret", "refresh", "old-owner")); runCurrent()
        assertEquals(Screen.CONNECT, c.state.value.screen)
        assertTrue(c.state.value.items.isEmpty())
        assertEquals("", c.state.value.username)
        assertTrue(api.calls.isEmpty())
    }

    @Test fun filesNewGalleryPreemptsStaleDirectoryGetWithoutLateRows() = runTest {
        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val late = CompletableDeferred<NodeRange>()
        api.listing = { _, offset ->
            if (offset == 100) withContext(NonCancellable) { late.await() }
            else NodeRange(listOf(folder, file), 101, offset)
        }
        c.loadMore(); runCurrent()
        assertTrue(c.state.value.loading)
        assertTrue(c.state.value.discardableReadInFlight)
        c.openGallery(); runCurrent()
        assertEquals(Screen.GALLERY, c.state.value.screen)
        assertFalse(c.state.value.discardableReadInFlight)
        assertTrue(c.state.value.galleryLoaded)
        late.complete(NodeRange(listOf(file), 101, 100)); runCurrent()
        assertEquals(Screen.GALLERY, c.state.value.screen)
        assertEquals(listOf(api.latestGallery), c.state.value.galleryItems)
        assertEquals(0, c.state.value.offset)
        c.close()
    }

    @Test fun filesTrashAndFolderNavigationCanPreemptAnOldDirectoryGet() = runTest {
        val lateTrash = CompletableDeferred<NodeRange>()
        val api = object : Service() {
            override suspend fun trashPage(accessToken: String, offset: Int): TrashPage {
                assertEquals("access", accessToken)
                return TrashPage(emptyList(), 0, offset)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        api.listing = { parent, offset ->
            when {
                offset == 100 -> withContext(NonCancellable) { lateTrash.await() }
                parent == folder.id -> NodeRange(listOf(file.copy(parentId = folder.id)), 1, 0)
                else -> NodeRange(listOf(folder, file), 101, 0)
            }
        }
        c.loadMore(); runCurrent()
        assertTrue(c.state.value.discardableReadInFlight)
        c.openTrash(); runCurrent()
        assertEquals(Screen.TRASH, c.state.value.screen)
        assertTrue(c.state.value.trashLoaded)
        lateTrash.complete(NodeRange(listOf(file), 101, 100)); runCurrent()
        assertEquals(Screen.TRASH, c.state.value.screen)
        c.closeTrash(); runCurrent()
        val lateFolder = CompletableDeferred<NodeRange>()
        api.listing = { parent, offset ->
            when {
                offset == 100 -> withContext(NonCancellable) { lateFolder.await() }
                parent == folder.id -> NodeRange(listOf(file.copy(parentId = folder.id)), 1, 0)
                else -> NodeRange(listOf(folder, file), 101, 0)
            }
        }
        c.loadMore(); runCurrent()
        assertTrue(c.state.value.discardableReadInFlight)
        c.open(folder); runCurrent()
        assertEquals(folder.id, c.state.value.path.last().id)
        assertEquals(folder.id, c.state.value.items.single().parentId)
        lateFolder.complete(NodeRange(listOf(file), 101, 100)); runCurrent()
        assertEquals(folder.id, c.state.value.path.last().id)
        assertEquals(0, c.state.value.offset)
        c.close()
    }

    @Test fun filesPdfViewerPreemptsObsoleteAppendAndKeepsOpenedRevision() = runTest {
        val pdf = DriveNode(87, 1, "report.pdf", "file", 128, revision = 3)
        val late = CompletableDeferred<NodeRange>()
        val api = Service().apply {
            listing = { _, offset ->
                if (offset == 100) withContext(NonCancellable) { late.await() }
                else NodeRange(listOf(pdf), 101, offset)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.loadMore(); runCurrent()
        assertTrue(c.state.value.discardableReadInFlight)
        c.open(pdf)
        assertEquals(pdf, c.state.value.filesPdfViewer)
        assertFalse(c.state.value.loading)
        assertFalse(c.state.value.discardableReadInFlight)
        late.complete(NodeRange(listOf(file), 101, 100)); runCurrent()
        assertEquals(pdf, c.state.value.filesPdfViewer)
        assertEquals(0, c.state.value.offset)
        c.back()
        assertNull(c.state.value.filesPdfViewer)
        c.close()
    }

    @Test fun filesNavigationNeverCancelsAnInFlightOwnerMutation() = runTest {
        val gate = CompletableDeferred<Unit>()
        var writes = 0
        val api = object : Service() {
            override suspend fun favoriteFile(accessToken: String, nodeId: Long): DriveCollectionItem {
                assertEquals("access", accessToken)
                writes++
                gate.await()
                return DriveCollectionItem(file, "readme.txt", listOf(DriveCrumb(1, "")))
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.favoriteFile(file); runCurrent()
        assertEquals(1, writes)
        assertTrue(c.state.value.loading)
        assertFalse(c.state.value.discardableReadInFlight)
        assertFalse(c.state.value.canNavigateFiles())
        val reads = api.calls.size
        c.openGallery()
        c.openTrash()
        c.changeFilesSection(FilesSection.RECENT)
        c.submitGlobalSearch("all files")
        c.open(folder)
        c.refresh()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(FilesSection.BROWSE, c.state.value.filesSection)
        assertTrue(c.state.value.loading)
        assertEquals(reads, api.calls.size)
        gate.complete(Unit); runCurrent()
        assertEquals(1, writes)
        assertFalse(c.state.value.loading)
        assertTrue(c.state.value.canNavigateFiles())
        c.close()
    }

    @Test fun gallerySafExportCannotBePreemptedByAnotherPageOrOwnerQuery() = runTest {
        val api = Service().apply { downloadGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        val photo = api.latestGallery
        c.showGalleryInfo(photo)
        assertTrue(c.prepareFileExport(photo.node))
        var discarded = 0
        c.saveFileExport({ ByteArrayOutputStream() }, { discarded++ }); runCurrent()
        assertTrue(c.state.value.fileDownloadActive)
        assertTrue(c.state.value.loading)
        assertEquals(1, api.downloadReads)
        val photoRows = c.state.value.galleryItems
        val galleryRequests = api.galleryRequests.size
        c.openFilesApp()
        c.back()
        c.refreshGallery()
        c.searchGallery("test")
        c.filterGalleryKind("video")
        c.changeGallerySort("added", "desc")
        c.jumpGalleryToGroup("year", "2026")
        assertEquals(Screen.GALLERY, c.state.value.screen)
        assertEquals(photoRows, c.state.value.galleryItems)
        assertEquals(galleryRequests, api.galleryRequests.size)
        assertTrue(c.state.value.fileDownloadActive)
        assertEquals(0, discarded)
        api.downloadGate?.complete(Unit); runCurrent()
        assertTrue(c.state.value.fileDownloadSaved)
        assertFalse(c.state.value.fileDownloadActive)
        assertEquals(1, api.downloadReads)
        c.openFilesApp(); runCurrent()
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(0, discarded)
        c.close()
    }

    @Test fun galleryAlbumBackWaitsForActiveNativeSafExportWithoutCancel() = runTest {
        val album = GalleryAlbum("manual:trip", "manual", "旅行", 1, 2, 0, 990)
        val api = object : Service() {
            override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> = listOf(album)
            override suspend fun galleryAlbumPage(
                accessToken: String, albumId: String, offset: Int,
                initialLatest: Boolean,
            ): GalleryPage {
                assertEquals(album.id, albumId)
                return GalleryPage(listOf(latestGallery), 1, 0)
            }
        }.apply { downloadGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.openGallery(); runCurrent()
        c.openGalleryCollections(); runCurrent()
        c.openGalleryAlbum(album); runCurrent()
        val photo = c.state.value.galleryItems.single()
        c.showGalleryInfo(photo)
        assertTrue(c.prepareFileExport(photo.node))
        c.saveFileExport({ ByteArrayOutputStream() }, {}); runCurrent()
        assertTrue(c.state.value.fileDownloadActive)
        c.back() // Album Back may cancel a GET, never this active SAF stream.
        assertEquals(album, c.state.value.gallerySelectedAlbum)
        assertEquals(Screen.GALLERY, c.state.value.screen)
        assertTrue(c.state.value.fileDownloadActive)
        api.downloadGate?.complete(Unit); runCurrent()
        assertTrue(c.state.value.fileDownloadSaved)
        c.back(); runCurrent()
        assertNull(c.state.value.gallerySelectedAlbum)
        assertEquals(GalleryPrimaryTab.COLLECTIONS, c.state.value.galleryPrimaryTab)
        c.close()
    }

    @Test fun uncertainBatchWriteOnlyAllowsReadOnlyRefreshOrRetryBeforeNewNavigation() = runTest {
        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.setBrowseSelectionMode(true)
        c.toggleBrowseSelection(file)
        api.mutationFailure = ApiException(503, "lost batch ACK")
        c.trashSelectedBrowseNodes(); runCurrent()
        assertEquals(1, api.mutationCalls.size)
        assertTrue(c.state.value.canReconcileBatchBrowse())
        assertFalse(c.state.value.canNavigateFiles())
        c.openGallery()
        c.open(folder)
        c.changeFilesSection(FilesSection.RECENT)
        assertEquals(Screen.FILES, c.state.value.screen)
        assertEquals(listOf(root), c.state.value.path)
        assertEquals(FilesSection.BROWSE, c.state.value.filesSection)
        api.failure = ApiException(503, "first reconciliation GET fails")
        c.retry(); runCurrent()
        assertEquals(1, api.mutationCalls.size)
        assertTrue(c.state.value.canReconcileBatchBrowse())
        assertFalse(c.state.value.loaded)
        c.refresh(); runCurrent()
        assertTrue(c.state.value.loaded)
        assertFalse(c.state.value.browseBatchWriteAttempted)
        assertFalse(c.state.value.canReconcileBatchBrowse())
        assertEquals(1, api.mutationCalls.size)
        c.close()
    }

    @Test fun anotherFilesMediaDetailWinsOverNonCooperativeOldPhotoGet() = runTest {
        val photoA = DriveNode(119, 1, "first.jpg", "file", 5, revision = 2)
        val photoB = DriveNode(120, 1, "second.jpg", "file", 5, revision = 3)
        val late = CompletableDeferred<GalleryAsset>()
        val requested = mutableListOf<Long>()
        val api = object : Service() {
            override suspend fun filesMediaItem(accessToken: String, node: DriveNode): GalleryAsset {
                assertEquals("access", accessToken)
                requested += node.id
                return if (node == photoA && requested.size == 1)
                    withContext(NonCancellable) { late.await() }
                else GalleryAsset(node, "image", hasThumbnail = true)
            }
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(photoA, photoB) else emptyList(), 2, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.open(photoA); runCurrent()
        assertTrue(c.state.value.loading)
        assertTrue(c.state.value.discardableReadInFlight)
        c.open(photoB); runCurrent()
        assertEquals(Screen.GALLERY, c.state.value.screen)
        assertEquals(photoB, c.state.value.galleryViewer?.node)
        assertEquals(listOf(photoA.id, photoB.id), requested)
        late.complete(GalleryAsset(photoA, "image", hasThumbnail = true)); runCurrent()
        assertEquals(photoB, c.state.value.galleryViewer?.node)
        assertEquals(listOf(photoA, photoB), c.state.value.items)
        c.back()
        assertEquals(Screen.FILES, c.state.value.screen)
        c.open(photoA); runCurrent()
        assertEquals(photoA, c.state.value.galleryViewer?.node)
        assertEquals(listOf(photoA.id, photoB.id, photoA.id), requested)
        c.close()
    }

    @Test fun newLocationSelectionPreemptsOldNonCooperativeOwnerLookup() = runTest {
        val late = CompletableDeferred<OwnedNodeLocation>()
        val api = Service()
        api.recentRows = listOf(api.recentFolder, api.favoriteFile)
        api.locateNode = { nodeId ->
            if (nodeId == folder.id) withContext(NonCancellable) { late.await() }
            else OwnedNodeLocation(nodeId, 1, 1, listOf(DriveCrumb(1, "")))
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changeFilesSection(FilesSection.RECENT); runCurrent()
        c.locateCollectionItem(api.recentFolder); runCurrent()
        assertTrue(c.state.value.discardableReadInFlight)
        c.locateCollectionItem(api.favoriteFile); runCurrent()
        assertEquals(FilesSection.BROWSE, c.state.value.filesSection)
        assertEquals(file.id, c.state.value.focusedBrowseNodeId)
        late.complete(OwnedNodeLocation(folder.id, 1, 1, listOf(DriveCrumb(1, ""))))
        runCurrent()
        assertEquals(file.id, c.state.value.focusedBrowseNodeId)
        assertEquals(listOf(root), c.state.value.path)
        c.close()
    }

    @Test fun recentFolderLookupYieldsToNextFilesSectionWithoutStalePath() = runTest {
        val late = CompletableDeferred<NodeRange>()
        val api = Service()
        api.listing = { parent, offset ->
            if (parent == folder.id) withContext(NonCancellable) { late.await() }
            else NodeRange(listOf(folder, file), 2, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changeFilesSection(FilesSection.RECENT); runCurrent()
        c.openCollectionItem(api.recentFolder); runCurrent()
        assertEquals(FilesSection.BROWSE, c.state.value.filesSection)
        assertTrue(c.state.value.discardableReadInFlight)
        c.changeFilesSection(FilesSection.FAVORITES); runCurrent()
        assertEquals(FilesSection.FAVORITES, c.state.value.filesSection)
        assertEquals(listOf(api.favoriteFile), c.state.value.collectionItems)
        late.complete(NodeRange(listOf(file.copy(parentId = folder.id)), 1, 0))
        runCurrent()
        assertEquals(FilesSection.FAVORITES, c.state.value.filesSection)
        assertEquals(listOf(api.favoriteFile), c.state.value.collectionItems)
        assertEquals(listOf(root), c.state.value.path)
        c.close()
    }

    @Test fun browseSortCommitsOnlyAfterRealOwnerFirstRangeAndRetainsOldOnError() = runTest {
        val target = FileBrowseArrangement("size", "desc", false)
        val next = FileBrowseArrangement("type", "asc", true)
        val actual = listOf(file, folder)
        val api = object : Service() {
            var failNextSort = false
            val sorted = mutableListOf<Pair<Int, FileBrowseArrangement>>()
            override suspend fun childrenArranged(
                accessToken: String, parentId: Long, offset: Int,
                arrangement: FileBrowseArrangement,
            ): NodeRange {
                if (arrangement == FileBrowseArrangement())
                    return children(accessToken, parentId, offset)
                assertEquals("access", accessToken)
                sorted += offset to arrangement
                if (failNextSort) {
                    failNextSort = false
                    throw ApiException(503, "GET failed")
                }
                return NodeRange(if (offset == 0) actual else emptyList(), 2, offset)
            }
        }
        api.listing = { _, offset ->
            NodeRange(if (offset == 0) listOf(folder, file) else emptyList(), 2, offset)
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val beforeRows = c.state.value.items
        c.changeFilesArrangement(target); runCurrent()
        assertEquals(listOf(0 to target), api.sorted)
        assertEquals(target, c.state.value.filesArrangement)
        assertEquals(actual, c.state.value.items)
        assertEquals(0, c.state.value.browseWindowStart)
        assertEquals(2L, c.state.value.totalCount)

        api.failNextSort = true
        c.changeFilesArrangement(next); runCurrent()
        assertEquals(target, c.state.value.filesArrangement)
        assertEquals(actual, c.state.value.items) // No fake next ordering after failed GET.
        assertNotNull(c.state.value.error)
        assertFalse(c.state.value.loading)
        assertEquals(0, c.state.value.offset)
        c.retry(); runCurrent() // Only the existing arrangement's read is retried.
        assertEquals(target, c.state.value.filesArrangement)
        assertEquals(listOf(0 to target, 0 to next, 0 to target), api.sorted)
        assertEquals(actual, c.state.value.items)
        c.changeFilesArrangement(FileBrowseArrangement()); runCurrent()
        assertEquals(FileBrowseArrangement(), c.state.value.filesArrangement)
        assertEquals(beforeRows, c.state.value.items)
        c.close()
    }

    @Test fun sortedShowInFolderUsesIdenticalOwnerPositionAndBoundedPage() = runTest {
        val layout = FileBrowseArrangement("updated", "desc", false)
        val calls = mutableListOf<Pair<Int, FileBrowseArrangement>>()
        val api = object : Service() {
            override suspend fun childrenArranged(
                accessToken: String, parentId: Long, offset: Int,
                arrangement: FileBrowseArrangement,
            ): NodeRange {
                assertEquals("access", accessToken)
                if (arrangement == FileBrowseArrangement())
                    return children(accessToken, parentId, offset)
                calls += offset to arrangement
                if (offset == 0) return NodeRange(listOf(folder, file), 2, 0)
                assertEquals(100, offset)
                val rows = (100..199).map { absolute ->
                    if (absolute == 155) file else
                        DriveNode(1000L + absolute, 1, "other-$absolute.txt",
                            "file", size = 11, revision = 1)
                }
                return NodeRange(rows, 201, 100)
            }
            override suspend fun childPositionArranged(
                accessToken: String, parentId: Long, nodeId: Long,
                arrangement: FileBrowseArrangement,
            ): DirectoryItemPosition {
                assertEquals(layout, arrangement)
                assertEquals(1L, parentId)
                assertEquals(file.id, nodeId)
                return DirectoryItemPosition(nodeId, file.revision, 155)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changeFilesArrangement(layout); runCurrent()
        c.changeFilesSection(FilesSection.FAVORITES); runCurrent()
        c.locateCollectionItem(api.favoriteFile); runCurrent()
        assertEquals(FilesSection.BROWSE, c.state.value.filesSection)
        assertEquals(layout, c.state.value.filesArrangement)
        assertEquals(file.id, c.state.value.focusedBrowseNodeId)
        assertEquals(55, c.state.value.focusedBrowseIndex)
        assertEquals(100, c.state.value.browseWindowStart)
        assertEquals(listOf(0 to layout, 100 to layout), calls)
        c.close()
    }

    @Test fun browserArrangementCannotInterruptOwnerWriteOrSelection() = runTest {
        val api = Service()
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.setBrowseSelectionMode(true)
        val old = c.state.value.items
        c.changeFilesArrangement(FileBrowseArrangement("size", "desc", false))
        assertEquals(FileBrowseArrangement(), c.state.value.filesArrangement)
        assertEquals(old, c.state.value.items)
        c.setBrowseSelectionMode(false)
        assertTrue(c.prepareFileUpload())
        c.acceptFileUpload("upload.txt", 3, { ByteArrayInputStream("abc".toByteArray()) })
        // Real completion already changes browse, never assumes an uploaded file's sort.
        runCurrent()
        assertEquals(FileBrowseArrangement(), c.state.value.filesArrangement)
        assertNull(c.state.value.error)
        c.close()
    }

    @Test fun groupedOwnerBrowseKeepsFullServerIndexDuringPaginationAndShowInFolder() = runTest {
        val wanted = FileBrowseArrangement("name", "asc", true, "type")
        val groups = listOf(
            FileBrowseGroupIndex("folder", 1, 0),
            FileBrowseGroupIndex("ext:txt", 200, 1),
        )
        val requests = mutableListOf<Int>()
        var ordinalRequests = 0
        val api = object : Service() {
            override suspend fun childrenArranged(
                accessToken: String, parentId: Long, offset: Int,
                arrangement: FileBrowseArrangement,
            ): NodeRange {
                if (arrangement != wanted) return children(accessToken, parentId, offset)
                assertEquals("access", accessToken)
                assertEquals(1L, parentId)
                requests += offset
                val rows = (offset until (offset + 100).coerceAtMost(201)).map { index ->
                    when (index) {
                        0 -> folder
                        155 -> file
                        else -> DriveNode(1000L + index, 1, "other-$index.txt",
                            "file", size = 12, revision = 1)
                    }
                }
                return NodeRange(rows, 201, offset,
                    groups = if (offset == 0) groups else emptyList())
            }
            override suspend fun childPositionArranged(
                accessToken: String, parentId: Long, nodeId: Long,
                arrangement: FileBrowseArrangement,
            ): DirectoryItemPosition {
                assertEquals(wanted, arrangement)
                assertEquals(1L, parentId)
                assertEquals(file.id, nodeId)
                ordinalRequests++
                return DirectoryItemPosition(nodeId, file.revision, 155)
            }
        }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        c.changeFilesArrangement(wanted); runCurrent()
        assertEquals(groups, c.state.value.filesGroups)
        assertEquals(100, c.state.value.items.size)
        assertEquals(listOf(0), requests)

        c.loadMore(); runCurrent()
        assertEquals(200, c.state.value.items.size)
        assertEquals(groups, c.state.value.filesGroups)
        assertEquals(listOf(0, 100), requests)

        c.changeFilesSection(FilesSection.FAVORITES); runCurrent()
        c.locateCollectionItem(api.favoriteFile); runCurrent()
        assertEquals(1, ordinalRequests)
        assertEquals(listOf(0, 100, 100, 0), requests) // One grouped Range plus index.
        assertEquals(100, c.state.value.browseWindowStart)
        assertEquals(155 - 100, c.state.value.focusedBrowseIndex)
        assertEquals(file.id, c.state.value.focusedBrowseNodeId)
        assertEquals(groups, c.state.value.filesGroups)
        assertEquals(wanted, c.state.value.filesArrangement)
        assertEquals(FilesSection.BROWSE, c.state.value.filesSection)
        c.close()
    }

    @Test fun missingGroupedServerIndexDoesNotMislabelExistingBrowseRows() = runTest {
        val wanted = FileBrowseArrangement(group = "size")
        val api = object : Service() {
            override suspend fun childrenArranged(
                accessToken: String, parentId: Long, offset: Int,
                arrangement: FileBrowseArrangement,
            ): NodeRange {
                if (arrangement == FileBrowseArrangement())
                    return children(accessToken, parentId, offset)
                return NodeRange(listOf(folder, file), 2, 0)
            }
        }
        api.listing = { _, offset -> NodeRange(
            if (offset == 0) listOf(folder, file) else emptyList(), 2, offset) }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        val original = c.state.value.items
        c.changeFilesArrangement(wanted); runCurrent()
        assertEquals(FileBrowseArrangement(), c.state.value.filesArrangement)
        assertEquals(original, c.state.value.items)
        assertTrue(c.state.value.filesGroups.isEmpty())
        assertTrue(c.state.value.loaded)
        assertNotNull(c.state.value.error)
        c.retry(); runCurrent()
        assertNull(c.state.value.error)
        assertEquals(original, c.state.value.items)
        c.close()
    }

}
