package com.tfluid.xdrive

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import com.tfluid.xdrive.core.*
import android.graphics.Bitmap
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Real Compose controls with a fixture service, not live Server or physical-device proof. */
class DriveAppTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var failNext = false
    private var paging = false
    private var filesSortFixture = false
    private val filesSortQueries = mutableListOf<FileBrowseArrangement>()
    private var failOnSecondPage = false
    private var manyFiles = false
    private var favoriteDeletes = 0
    private var createCalls = 0
    private var renameCalls = 0
    private var trashCalls = 0
    private var batchTrashCalls = 0
    private var batchCopyCalls = 0
    private var batchMoveCalls = 0
    private var batchTransferFixture = false
    private val batchSecondFile = DriveNode(71, 1, "second.txt", "file",
        size = 24, revision = 3)
    private var copyCalls = 0
    private var moveCalls = 0
    private var extraRootFile = false
    private var textPreviewFixture = false
    private var textPreviewReads = 0
    private var locateLargeFolder = false
    private var locateRangeReads = 0
    private val locatedFile = DriveNode(1155, 1, "target-155.txt", "file", 12, revision = 2)
    private val mutableRootRows = mutableListOf(DriveNode(2, 1, "假期照片", "dir", revision = 1))
    private var galleryAutoPagingFixture = false
    private var galleryManyPhotos = false
    private var galleryTimelineFixture = false
    private var galleryVideoFixture = false
    private var galleryMixedViewerFixture = false
    private var galleryLivePhotoFixture = false
    private var galleryLIVPFixture = false
    private var liveStillReads = 0
    private var liveMotionRequests = 0
    private var liveMotionClosed = 0
    private var galleryOversizeFixture = false
    private var filesViewerFixture = false
    private var filesAudioFixture = false
    private val filesAudioNode = DriveNode(50, 1, "music.mp3", "file", size = 40, revision = 3)
    private var filesAudioSessions = 0
    private var filesAudioClosures = 0
    private var filesPdfFixture = false
    private var filesPdfReads = 0
    private val filesPdfFixtureBytes: ByteArray by lazy {
        val document = android.graphics.pdf.PdfDocument()
        try {
            for (number in 1..2) {
                val page = document.startPage(
                    android.graphics.pdf.PdfDocument.PageInfo.Builder(
                        320, 440, number).create())
                val paint = android.graphics.Paint().apply { textSize = 18f }
                page.canvas.drawText("Owner PDF ${number}", 22f, 46f, paint)
                document.finishPage(page)
            }
            ByteArrayOutputStream().also { document.writeTo(it) }.toByteArray()
        } finally { document.close() }
    }
    private val filesPdfNode: DriveNode by lazy {
        DriveNode(51, 1, "private.pdf", "file",
            filesPdfFixtureBytes.size.toLong(), revision = 3)
    }
    private val filesViewerNode = DriveNode(49, 1, "snapshot.jpg", "file",
        size = 32L * 1024 * 1024 + 1L, revision = 2)
    private var filesViewerDetailReads = 0
    private var galleryThumbnailFailuresRemaining = 0
    private var galleryThumbnailReads = 0
    private var videoTransportClosed = 0
    private val galleryOffsets = mutableListOf<Int>()
    private var galleryRangeReads = 0
    private val galleryTimelineRequests = mutableListOf<Pair<Int, Boolean>>()
    private val gallerySearchQueries = mutableListOf<String>()
    private val galleryKindQueries = mutableListOf<Pair<String, String>>()
    private val gallerySortQueries = mutableListOf<Pair<String, String>>()
    private val galleryFavoriteCalls = mutableListOf<Pair<List<Long>, Boolean>>()
    private val galleryTagsCalls = mutableListOf<Pair<List<Long>, List<String>>>()
    private val galleryAlbumAdds = mutableListOf<Pair<String, List<Long>>>()
    private var galleryManualAlbumFixture = false
    private var galleryCoverFixture = false
    private var galleryCustomCover = false
    private var galleryCoverRevision = 2L
    private val galleryCoverCalls = mutableListOf<Long>()
    private var galleryRemoveMemberFixture = false
    private var galleryMemberRemoved = false
    private var galleryMemberRemoveCalls = 0
    private var galleryCollectionCreateFixture = false
    private var galleryCreatedManual: GalleryAlbum? = null
    private val galleryManualCreates = mutableListOf<String>()
    private val galleryManualRenames = mutableListOf<String>()
    private var galleryManualDeletes = 0
    private var galleryThumbnailRetryFixture = false
    private val galleryThumbnailCalls = AtomicInteger()
    private val galleryFixture = GalleryAsset(
        DriveNode(40, 1, "相册照片.jpg", "file", size = 44, revision = 1), "image",
        capturedAt = "2026-10-24T00:00:00Z", hasThumbnail = true)
    private val service = object : XDriveService {
        override suspend fun login(username: String, password: String) = AuthSession("fixture", "fixture-refresh", username)
        override suspend fun refresh(refreshToken: String) = AuthSession("fixture", "fixture-refresh", "owner")
        override suspend fun logout(refreshToken: String) = Unit
        override suspend fun changePassword(accessToken: String, currentPassword: String, newPassword: String) = AuthSession("fixture", "fixture-refresh", "owner")
        override suspend fun root(accessToken: String) = DriveNode(1, name = "", type = "dir")
        override suspend fun galleryAlbums(accessToken: String): List<GalleryAlbum> {
            check(accessToken == "fixture")
            if (galleryCoverFixture) return listOf(
                GalleryAlbum("manual:cover", "manual", "封面测试",
                    1, galleryCoverRevision, 0, 40),
            )
            if (galleryRemoveMemberFixture) return listOf(
                GalleryAlbum("manual:member", "manual", "假期", 
                    if (galleryMemberRemoved) 0 else 1,
                    if (galleryMemberRemoved) 3 else 2, 0,
                    if (galleryMemberRemoved) null else 40),
            )
            if (galleryCollectionCreateFixture) return listOfNotNull(galleryCreatedManual)
            if (!galleryManualAlbumFixture) throw ApiException(501, "Albums fixture disabled")
            return listOf(
                GalleryAlbum("manual:fixture", "manual", "旅行", 0, 1, 0),
                GalleryAlbum("smart:fixture", "smart", "最近", 0, 1, 0),
            )
        }
        override suspend fun createGalleryManualAlbum(
            accessToken: String, name: String,
        ): GalleryAlbum {
            check(accessToken == "fixture" && galleryCollectionCreateFixture && name == "旅行")
            galleryManualCreates += name
            return GalleryAlbum("manual:fixture-created", "manual", name, 0, 1, 0)
                .also { galleryCreatedManual = it }
        }
        override suspend fun renameGalleryManualAlbum(
            accessToken: String, album: GalleryAlbum, name: String,
        ): GalleryAlbum {
            check(accessToken == "fixture" && galleryCollectionCreateFixture &&
                galleryCreatedManual == album && name == "夏季")
            galleryManualRenames += name
            return album.copy(name = name, revision = album.revision + 1)
                .also { galleryCreatedManual = it }
        }
        override suspend fun deleteGalleryManualAlbum(
            accessToken: String, album: GalleryAlbum,
        ) {
            check(accessToken == "fixture" && galleryCollectionCreateFixture &&
                galleryCreatedManual == album)
            galleryManualDeletes++
            galleryCreatedManual = null
        }
        override suspend fun galleryAlbumPage(
            accessToken: String, albumId: String, offset: Int,
            initialLatest: Boolean,
        ): GalleryPage {
            check(accessToken == "fixture")
            if (galleryCoverFixture && albumId == "manual:cover")
                return GalleryPage(listOf(galleryFixture), 1, 0)
            check(galleryRemoveMemberFixture && albumId == "manual:member")
            return GalleryPage(if (galleryMemberRemoved) emptyList() else listOf(galleryFixture),
                if (galleryMemberRemoved) 0 else 1, 0)
        }
        override suspend fun gallerySetManualAlbumCover(
            accessToken: String, album: GalleryAlbum, nodeId: Long,
        ): GalleryAlbum {
            check(accessToken == "fixture" && galleryCoverFixture &&
                album.id == "manual:cover" &&
                album.revision == galleryCoverRevision &&
                nodeId in listOf(0L, 40L))
            galleryCoverCalls += nodeId
            galleryCoverRevision++
            galleryCustomCover = nodeId != 0L
            return album.copy(revision = galleryCoverRevision,
                coverNodeId = 40)
        }
        override suspend fun galleryRemoveFromManualAlbum(
            accessToken: String, album: GalleryAlbum, item: GalleryAsset,
        ): GalleryAlbum {
            check(accessToken == "fixture" && galleryRemoveMemberFixture &&
                album.id == "manual:member" && album.revision == 2L &&
                album.itemCount == 1L && item.node.id == galleryFixture.node.id)
            galleryMemberRemoveCalls++
            galleryMemberRemoved = true
            return album.copy(revision = 3, itemCount = 0, coverNodeId = null)
        }
        override suspend fun galleryAddToManualAlbum(
            accessToken: String, album: GalleryAlbum, items: List<GalleryAsset>,
        ): GalleryAlbum {
            check(accessToken == "fixture" && album.id == "manual:fixture" &&
                album.revision == 1L && items.map { it.node.id } == listOf(40L))
            galleryAlbumAdds += album.id to items.map { it.node.id }
            return album.copy(revision = 2, itemCount = 1)
        }
        override suspend fun galleryTagsBatch(
            accessToken: String, items: List<GalleryAsset>, tags: List<String>,
        ): Int {
            check(accessToken == "fixture" && items.size in 1..200 &&
                items.all { it.node.id == 40L && it.node.revision == 1L })
            galleryTagsCalls += items.map { it.node.id } to tags
            return items.size
        }
        override suspend fun galleryFavoriteBatch(
            accessToken: String, items: List<GalleryAsset>, favorite: Boolean,
        ): Int {
            check(accessToken == "fixture" && items.size in 1..200 &&
                items.all { it.node.id == 40L && it.node.revision == 1L })
            galleryFavoriteCalls += (items.map { it.node.id } to favorite)
            return items.size
        }
        override suspend fun galleryPage(accessToken: String, offset: Int,
            initialLatest: Boolean): GalleryPage {
            galleryRangeReads++
            if (galleryTimelineFixture) {
                galleryTimelineRequests += offset to initialLatest
                val groups = GalleryTimelineSets(
                    year = listOf(GalleryTimelineGroup("2025", 60, 0),
                        GalleryTimelineGroup("2026", 61, 60)),
                    month = listOf(GalleryTimelineGroup("2025-12", 60, 0),
                        GalleryTimelineGroup("2026-10", 61, 60)),
                    day = listOf(GalleryTimelineGroup("unknown", 60, 0),
                        GalleryTimelineGroup("2026-10-25", 61, 60)),
                )
                if (initialLatest)
                    return GalleryPage(listOf(galleryFixture), 121, 120, timeline = groups)
                return GalleryPage((offset until minOf(offset + 60, 121)).map { index ->
                    if (index == 120) galleryFixture else GalleryAsset(
                        DriveNode(1000L + index, 1L, "photo-$index.jpg",
                            "file", size = 44, revision = 1),
                        "image", hasThumbnail = true)
                }, 121, offset)
            }
            if (galleryLivePhotoFixture) return GalleryPage(listOf(GalleryAsset(
                DriveNode(48, 1,
                    if (galleryLIVPFixture) "live.livp" else "paired.jpg",
                    "file", size = if (galleryLIVPFixture)
                        80L * 1024 * 1024 else 44L, revision = 2),
                "image", livePhoto = true, hasThumbnail = true)), 1, 0)
            if (galleryMixedViewerFixture) return GalleryPage(listOf(
                galleryFixture,
                GalleryAsset(DriveNode(45, 1, "clip.mp4", "file", size = 100, revision = 2),
                    "video", durationMs = 10_000L, hasThumbnail = true),
                GalleryAsset(DriveNode(46, 1, "last.jpg", "file", size = 44, revision = 2),
                    "image", hasThumbnail = true),
            ), 3, 0)
            if (galleryVideoFixture) return GalleryPage(listOf(GalleryAsset(
                DriveNode(45, 1, "clip.mp4", "file", size = 100, revision = 2),
                "video", durationMs = 10_000L, hasThumbnail = true)), 1, 0)
            if (galleryOversizeFixture) return GalleryPage(listOf(GalleryAsset(
                DriveNode(46, 1, "large.jpg", "file",
                    size = 32L * 1024 * 1024 + 1, revision = 2),
                "image", hasThumbnail = true)), 1, 0)
            if (galleryManyPhotos) {
            val originals = (0 until 60).map { index ->
                GalleryAsset(DriveNode(1000L + index, 1L,
                    "相片-${index}.jpg", "file", size = 44, revision = 1),
                    "image", hasThumbnail = true)
            }
            return GalleryPage(originals, 60, 0)
            }
            if (!galleryAutoPagingFixture) return GalleryPage(listOf(galleryFixture), 1, 0)
            galleryOffsets += if (initialLatest) 180 else offset
            return if (initialLatest) GalleryPage(listOf(galleryFixture), 181, 180)
            else GalleryPage((offset until offset + 60).map { index ->
                GalleryAsset(
                    DriveNode(1000L + index, 1L, "相片-${index}.jpg", "file",
                        size = 44, revision = 1), "image", hasThumbnail = true)
            }, 181, offset)
        }
        override suspend fun gallerySearchPage(accessToken: String, offset: Int,
            initialLatest: Boolean, search: String): GalleryPage {
            gallerySearchQueries += search
            return GalleryPage(listOf(GalleryAsset(
                DriveNode(46, 1, "search-result.jpg", "file", size = 64, revision = 1),
                "image", hasThumbnail = true)), 1, 0)
        }
        override suspend fun gallerySortedPage(accessToken: String, offset: Int,
            initialLatest: Boolean, search: String, kind: String, albumId: String?,
            sortBy: String, sortDir: String): GalleryPage {
            gallerySortQueries += sortBy to sortDir
            return GalleryPage(listOf(GalleryAsset(DriveNode(48L, 1L, "sorted.jpg",
                "file", size = 44, revision = 1), "image", hasThumbnail = true)), 1, 0)
        }
    override suspend fun galleryKindPage(accessToken: String, offset: Int,
            initialLatest: Boolean, search: String, kind: String): GalleryPage {
            galleryKindQueries += search to kind
            return GalleryPage(listOf(GalleryAsset(
                DriveNode(if (kind == "video") 47L else 48L, 1,
                    if (kind == "video") "filtered.mp4" else "filtered.jpg",
                    "file", size = 64, revision = 1),
                kind, hasThumbnail = true)), 1, 0)
        }
        override suspend fun filesPdfDownload(
            accessToken: String, original: DriveNode,
            openDestination: () -> java.io.OutputStream,
            onProgress: (Long) -> Unit,
        ): Long {
            check(filesPdfFixture && accessToken == "fixture" && original == filesPdfNode)
            filesPdfReads++
            openDestination().use { it.write(filesPdfFixtureBytes) }
            onProgress(filesPdfFixtureBytes.size.toLong())
            return filesPdfFixtureBytes.size.toLong()
        }
        override suspend fun filesAudioPlayback(accessToken: String, node: DriveNode):
            OwnerVideoPlayback {
            check(filesAudioFixture && accessToken == "fixture" && node == filesAudioNode)
            filesAudioSessions++
            return OwnerVideoPlayback(
                "https://fixture.invalid/api/v1/files/50/content",
                okhttp3.OkHttpClient.Builder().addInterceptor {
                    throw java.io.IOException("Fixture deliberately has no MP3 bytes")
                }.build(), node.size,
            ) { filesAudioClosures++ }
        }
        override suspend fun filesMediaItem(
            accessToken: String, node: DriveNode,
        ): GalleryAsset {
            check(filesViewerFixture && accessToken == "fixture" && node == filesViewerNode)
            filesViewerDetailReads++
            return GalleryAsset(node, "image", hasThumbnail = true)
        }
        override suspend fun galleryThumbnail(accessToken: String, nodeId: Long,
            revision: Long): ByteArray {
            galleryThumbnailReads++
            if (galleryThumbnailFailuresRemaining > 0) {
                galleryThumbnailFailuresRemaining--
                throw ApiException(503, "Fixture one-shot unavailable thumbnail")
            }
            if (galleryOversizeFixture || filesViewerFixture || galleryVideoFixture ||
                galleryMixedViewerFixture || galleryLivePhotoFixture) {
                val small = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
                return try {
                    val output = ByteArrayOutputStream()
                    check(small.compress(Bitmap.CompressFormat.JPEG, 75, output))
                    output.toByteArray()
                } finally {
                    small.recycle()
                }
            }
            if (!galleryThumbnailRetryFixture) return byteArrayOf(1, 2, 3)
            if (galleryThumbnailCalls.incrementAndGet() == 1) return byteArrayOf(1, 2, 3)
            val bitmap = android.graphics.Bitmap.createBitmap(
                16, 16, android.graphics.Bitmap.Config.ARGB_8888)
            val output = java.io.ByteArrayOutputStream()
            try {
                check(bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, output))
                return output.toByteArray()
            } finally {
                bitmap.recycle()
            }
        }
        override suspend fun galleryLivePhotoStill(
            accessToken: String, node: DriveNode,
            onProgress: (Long, Long?) -> Unit,
        ): ByteArray {
            check(galleryLivePhotoFixture && galleryLIVPFixture &&
                node.id == 48L && node.revision == 2L)
            liveStillReads++
            val bitmap = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888)
            return try {
                val output = ByteArrayOutputStream()
                check(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, output))
                val data = output.toByteArray()
                onProgress(data.size.toLong(), data.size.toLong())
                data
            } finally { bitmap.recycle() }
        }
        override suspend fun galleryLivePhotoMotionPlayback(
            accessToken: String, node: DriveNode,
        ): OwnerVideoPlayback {
            check(galleryLivePhotoFixture && node.id == 48L && node.revision == 2L)
            liveMotionRequests++
            return OwnerVideoPlayback(
                "https://fixture.invalid/api/v1/media-live-photo-motion/48?ticket=fixture",
                okhttp3.OkHttpClient.Builder().addInterceptor {
                    throw java.io.IOException("Fixture motion codec unavailable")
                }.build(), 0L,
            ) { liveMotionClosed++ }
        }
        override fun galleryVideoPlayback(accessToken: String, node: DriveNode): OwnerVideoPlayback =
            OwnerVideoPlayback(
                "https://fixture.invalid/api/v1/files/" + node.id + "/content",
                okhttp3.OkHttpClient.Builder().addInterceptor {
                    throw java.io.IOException("Fixture intentionally has no MP4")
                }.build(), node.size,
            ) { videoTransportClosed++ }
        override suspend fun fileRecent(accessToken: String) = listOf(
            DriveCollectionItem(DriveNode(2, 1, "假期照片", "dir"), "假期照片",
                listOf(DriveCrumb(1, ""), DriveCrumb(2, "假期照片"))))
        override suspend fun fileFavorites(accessToken: String) = listOf(
            DriveCollectionItem(DriveNode(7, 1, "favorite.txt", "file", 120), "favorite.txt",
                listOf(DriveCrumb(1, ""), DriveCrumb(7, "favorite.txt"))))
        override suspend fun searchFiles(accessToken: String, query: String, cursor: String): FileSearchPage =
            if (locateLargeFolder) FileSearchPage(listOf(
                DriveCollectionItem(locatedFile, "outdated/path/target-155.txt",
                    listOf(DriveCrumb(888, "stale")))), "")
            else FileSearchPage(listOf(
                DriveCollectionItem(DriveNode(7, 1, "favorite.txt", "file", 120), "favorite.txt",
                    listOf(DriveCrumb(1, "")))), "")
        override suspend fun nodeLocation(accessToken: String, nodeId: Long): OwnedNodeLocation {
            check(locateLargeFolder && nodeId == locatedFile.id)
            return OwnedNodeLocation(nodeId, locatedFile.revision, 1, listOf(DriveCrumb(1, "")))
        }
        override suspend fun childPosition(
            accessToken: String, parentId: Long, nodeId: Long,
        ): DirectoryItemPosition {
            check(locateLargeFolder && parentId == 1L && nodeId == locatedFile.id)
            return DirectoryItemPosition(nodeId, locatedFile.revision, 155)
        }
        override suspend fun unfavoriteFile(accessToken: String, nodeId: Long) {
            if (nodeId == 7L) favoriteDeletes++
        }
        override suspend fun createDirectory(accessToken: String, parentId: Long, name: String): DriveNode {
            createCalls++
            val created = DriveNode(800 + createCalls.toLong(), parentId, name, "dir", revision = 1)
            mutableRootRows += created
            return created
        }
        override suspend fun renameNode(accessToken: String, original: DriveNode, name: String): DriveNode {
            renameCalls++
            val updated = original.copy(name = name, revision = original.revision + 1)
            val index = mutableRootRows.indexOfFirst { it.id == original.id }
            if (index >= 0) mutableRootRows[index] = updated
            return updated
        }
        override suspend fun trashNode(accessToken: String, original: DriveNode) {
            trashCalls++
            mutableRootRows.removeAll { it.id == original.id }
        }
        override suspend fun trashNodes(accessToken: String, originals: List<DriveNode>) {
            batchTrashCalls++
            val ids = originals.map { it.id }.toSet()
            mutableRootRows.removeAll { it.id in ids }
            if (70L in ids) extraRootFile = false
        }
        override suspend fun batchCopyNodes(
            accessToken: String, originals: List<DriveNode>, parentId: Long,
        ): List<DriveNode> {
            check(batchTransferFixture && accessToken == "fixture" && parentId == 1L &&
                originals.map { it.id } == listOf(71L, 70L))
            batchCopyCalls++
            val copies = originals.mapIndexed { index, node ->
                node.copy(id = 170L + index, parentId = parentId,
                    name = node.name + " - 副本", revision = 1)
            }
            mutableRootRows += copies
            return copies
        }
        override suspend fun batchMoveNodes(
            accessToken: String, originals: List<DriveNode>, parentId: Long,
        ): List<DriveNode> {
            check(batchTransferFixture && accessToken == "fixture" && parentId == 2L &&
                originals.map { it.id } == listOf(71L, 70L))
            batchMoveCalls++
            extraRootFile = false
            batchTransferFixture = false
            return originals.map { it.copy(parentId = parentId,
                revision = it.revision + 1) }
        }
        override suspend fun copyNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode {
            copyCalls++
            return original.copy(id = 770 + copyCalls.toLong(), parentId = parentId, revision = 1)
        }
        override suspend fun moveNode(accessToken: String, original: DriveNode, parentId: Long): DriveNode {
            moveCalls++
            if (original.id == 70L) extraRootFile = false
            return original.copy(parentId = parentId, revision = original.revision + 1)
        }
        override suspend fun textFilePreview(
            accessToken: String, node: DriveNode,
        ): FileTextPreview {
            check(textPreviewFixture && node.id == 3L && node.revision == 2L)
            textPreviewReads++
            return FileTextPreview("hello xDrive", false, node.size)
        }
        override suspend fun childrenArranged(
            accessToken: String, parentId: Long, offset: Int,
            arrangement: FileBrowseArrangement,
        ): NodeRange {
            if (arrangement == FileBrowseArrangement())
                return children(accessToken, parentId, offset)
            check(filesSortFixture && accessToken == "fixture")
            filesSortQueries += arrangement
            val original = children(accessToken, parentId, offset)
            return original.copy(
                items = if (arrangement.order == "desc")
                    original.items.reversed() else original.items,
                groups = if (arrangement.group == "type" && parentId == 1L &&
                    original.items.size == 2 && original.items[0].isDirectory &&
                    original.items[1].name.endsWith(".txt"))
                    listOf(
                        FileBrowseGroupIndex("folder", 1, 0),
                        FileBrowseGroupIndex("ext:txt", 1, 1),
                    ) else emptyList()
            )
        }
        override suspend fun children(accessToken: String, parentId: Long, offset: Int): NodeRange {
            if (failNext || (paging && offset == 100 && failOnSecondPage)) {
                failNext = false; failOnSecondPage = false; throw ApiException(503, "unavailable")
            }
            if (locateLargeFolder && parentId == 1L) {
                locateRangeReads++
                val rows = (0..200).drop(offset).take(100).map { index ->
                    when (index) {
                        0 -> DriveNode(2, 1, "假期照片", "dir", revision = 1)
                        155 -> locatedFile
                        else -> DriveNode(1000L + index, 1, "file-$index.txt", "file",
                            size = 12, revision = 1)
                    }
                }
                return NodeRange(rows, 201, offset)
            }
            val rows = if (paging && offset == 100) listOf(DriveNode(4, 1, "第二页.txt", "file", 2048))
                else if (manyFiles && parentId == 1L) listOf(DriveNode(2, 1, "假期照片", "dir")) +
                    (1..99).map { index -> if (index == 49)
                        DriveNode(200, 1, "第二相册", "dir")
                        else DriveNode(100L + index, 1, "item-$index.txt", "file", 128) }
                else if (parentId == 1L) mutableRootRows.toList() +
                    (if (batchTransferFixture) listOf(batchSecondFile) else emptyList()) +
                    (if (filesAudioFixture) listOf(filesAudioNode) else emptyList()) +
                    (if (filesPdfFixture) listOf(filesPdfNode) else emptyList()) +
                    (if (filesViewerFixture) listOf(filesViewerNode) else emptyList()) +
                    (if (extraRootFile) listOf(DriveNode(70, 1, "复制目标.txt", "file", 120, revision = 2))
                        else emptyList())
                else listOf(DriveNode(3, 2, "测试.txt", "file", 12,
                    revision = if (textPreviewFixture) 2 else 0,
                    updatedAt = "2026-10-23T00:00:00Z"))
            return NodeRange(rows, if (paging) 101 else rows.size.toLong(), offset)
        }
    }
    private val connectFactoryCalls = AtomicInteger()
    private val controller = DriveController(scope, { connectFactoryCalls.incrementAndGet(); service })
    @After fun cleanup() { controller.close(); scope.cancel() }

    private fun startAndLogin(
        onDownload: ((DriveNode) -> Unit)? = null,
        onUpload: (() -> Unit)? = null,
    ) {
        // Read the real Compose IME inset from composition (not a fixed delay
        // or a guessed keyboard state). Done hides the keyboard; only click
        // once the actual inset and on-screen submit have both settled.
        val imeBottomPx = AtomicInteger(-1)
        compose.setContent {
            val observedImeBottom = WindowInsets.ime.getBottom(LocalDensity.current)
            SideEffect { imeBottomPx.set(observedImeBottom) }
            XDriveTheme {
                DriveApp(controller, onDownload = onDownload, onUpload = onUpload)
            }
        }
        compose.onNodeWithTag("server").performTextInput("https://drive.example")
        compose.onNodeWithTag("server").assertTextEquals("https://drive.example")
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-password")
        compose.onNodeWithTag("password").performImeAction()
        // The real button must be visible and enabled after the real keyboard
        // reports its bottom inset as zero. Preserve the original 10s bound.
        // Only scrolling is retried while its viewport animates, not login.
        try {
            compose.waitUntil(timeoutMillis = 10_000) {
                if (imeBottomPx.get() != 0) false
                else {
                    val submit = compose.onNodeWithTag("auth-submit")
                    runCatching { submit.performScrollTo() }.isSuccess &&
                        runCatching { submit.assertIsDisplayed().assertIsEnabled() }.isSuccess
                }
            }
        } catch (failure: androidx.compose.ui.test.ComposeTimeoutException) {
            val current = controller.state.value
            throw AssertionError(
                "Fixture submit not ready: imeBottomPx=${imeBottomPx.get()}, " +
                    "screen=${current.screen}, loading=${current.loading}, " +
                    "errorPresent=${!current.error.isNullOrBlank()}, " +
                    "factories=${connectFactoryCalls.get()}",
                failure,
            )
        }
        compose.onNodeWithTag("auth-submit").assertIsDisplayed().assertIsEnabled().performClick()
        try {
            compose.waitUntil(timeoutMillis = 10_000) {
                controller.state.value.screen == Screen.FILES && controller.state.value.loaded
            }
        } catch (failure: androidx.compose.ui.test.ComposeTimeoutException) {
            // Fixture-only state; no server, user, password, token, path or
            // Compose semantics text is written into public CI logs.
            val current = controller.state.value
            throw AssertionError(
                "Fixture login did not reach loaded Files: " +
                    "screen=${current.screen}, loading=${current.loading}, " +
                    "loaded=${current.loaded}, itemCount=${current.items.size}, " +
                    "pathDepth=${current.path.size}, factories=${connectFactoryCalls.get()}, " +
                    "errorPresent=${current.error != null}, imeBottomPx=${imeBottomPx.get()}",
                failure,
            )
        }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun nativeTransfersOpenFromFilesAndGalleryWithoutInventingHistory() {
        startAndLogin()
        compose.onNodeWithTag("native-transfer-open").assertIsDisplayed().performClick()
        compose.onNodeWithTag("native-transfer-center").assertExists()
        compose.onNodeWithTag("native-transfer-empty").assertIsDisplayed()
        compose.onNodeWithText("本次登录的上传与下载 · 最近最多 20 项").assertExists()
        compose.onNodeWithTag("native-transfer-close").performClick()
        compose.onNodeWithTag("native-transfer-center").assertDoesNotExist()

        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.onNodeWithTag("native-transfer-open").assertIsDisplayed().performClick()
        compose.onNodeWithTag("native-transfer-empty").assertExists()
        compose.onNodeWithTag("native-transfer-close").performClick()

        // The normal Account menu still controls Owner logout independently.
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.LOGIN
        }
        compose.onNodeWithTag("native-transfer-open").assertDoesNotExist()
        compose.runOnIdle {
            org.junit.Assert.assertTrue(controller.state.value.nativeTransfers.isEmpty())
        }
    }

    @Test fun batchTrashRequiresExplicitConfirmationAndNeverDeletesOnCancel() {
        startAndLogin()
        compose.onNodeWithTag("xdrive-mobile-app-header").assertIsDisplayed()
        compose.onNodeWithTag("files-select-mode").performClick()
        compose.onNodeWithTag("files-item-2").performClick()
        // The clickable row merges Checkbox semantics in the default tree.
        compose.runOnIdle {
            org.junit.Assert.assertEquals(setOf(2L), controller.state.value.browseSelectedIds)
        }
        compose.onNodeWithTag("files-select-2", useUnmergedTree = true).assertIsSelected()
        compose.onNodeWithText("1 项已选择（最多 200）").assertIsDisplayed()
        compose.onNodeWithTag("files-batch-trash-action").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(0, batchTrashCalls) }
        compose.onNodeWithTag("files-batch-trash-cancel").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(0, batchTrashCalls) }
        compose.onNodeWithTag("files-batch-trash-action").performClick()
        compose.onNodeWithTag("files-batch-trash-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            batchTrashCalls == 1 && !controller.state.value.loading &&
                controller.state.value.items.none { it.id == 2L }
        }
        compose.onNodeWithTag("files-item-2").assertDoesNotExist()
        compose.onNodeWithText("此文件夹为空").assertIsDisplayed()
        compose.runOnIdle {
            org.junit.Assert.assertFalse(controller.state.value.browseSelectionMode)
        }
    }

    @Test fun selectingInGridDoesNotOpenFolderAndCanExitSelectionMode() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("图标").performClick()
        compose.onNodeWithTag("files-grid").assertExists()
        compose.onNodeWithTag("files-select-mode").performClick()
        compose.onNodeWithTag("files-item-2").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(setOf(2L), controller.state.value.browseSelectedIds)
            org.junit.Assert.assertEquals(1, controller.state.value.path.size)
        }
        compose.onNodeWithTag("files-select-mode").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertTrue(controller.state.value.browseSelectedIds.isEmpty())
        }
        compose.onNodeWithTag("files-grid").assertExists()
    }

    @Test fun showInFolderSelectsExactFileOnFirstFrameInListAndGrid() {
        locateLargeFolder = true
        startAndLogin()
        compose.onNodeWithTag("files-global-search-input").performTextInput("target")
        compose.onNodeWithTag("files-global-search-submit").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.SEARCH &&
                controller.state.value.collectionLoaded &&
                controller.state.value.collectionItems.singleOrNull()?.node?.id == 1155L
        }
        compose.onNodeWithTag("files-collection-item-1155", useUnmergedTree = true)
            .performTouchInput { longClick() }
        compose.onNodeWithText("显示所在位置").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.BROWSE &&
                controller.state.value.focusedBrowseNodeId == 1155L &&
                controller.state.value.loaded && !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(100, controller.state.value.browseWindowStart)
            org.junit.Assert.assertEquals(55, controller.state.value.focusedBrowseIndex)
            org.junit.Assert.assertEquals(100, controller.state.value.items.size)
            // One initial page plus one precisely positioned Range.
            org.junit.Assert.assertEquals(2, locateRangeReads)
        }
        compose.onNodeWithTag("files-item-1155").assertIsDisplayed().assertIsSelected()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("图标").performClick()
        compose.onNodeWithTag("files-item-1155").assertIsDisplayed().assertIsSelected()
        compose.runOnIdle { org.junit.Assert.assertEquals(2, locateRangeReads) }
    }

    @Test fun manualAlbumCreateConfirmsOnceThenShowsServerOwnerCard() {
        galleryCollectionCreateFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-open-collections").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryPrimaryTab == GalleryPrimaryTab.COLLECTIONS &&
                controller.state.value.galleryAlbumsLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-albums-empty").assertExists()
        compose.onNodeWithTag("gallery-create-manual-album").assertIsEnabled().performClick()
        compose.onNodeWithTag("gallery-create-manual-dialog").assertExists()
        compose.onNodeWithTag("gallery-create-manual-confirm").assertIsNotEnabled()
        compose.onNodeWithTag("gallery-create-manual-name").performTextInput("旅行")
        compose.onNodeWithTag("gallery-create-manual-confirm").assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded &&
                controller.state.value.galleryAlbums.singleOrNull()?.id == "manual:fixture-created" &&
                !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf("旅行"), galleryManualCreates)
        }
        compose.onNodeWithTag("gallery-album-item-manual:fixture-created").assertExists()
    }

    @Test fun manualAlbumNativeMoreRenameAndConfirmedDeleteLeaveOriginalFiles() {
        galleryCollectionCreateFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-open-collections").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-create-manual-album").performClick()
        compose.onNodeWithTag("gallery-create-manual-name").performTextInput("旅行")
        compose.onNodeWithTag("gallery-create-manual-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded &&
                controller.state.value.galleryAlbums.singleOrNull()?.name == "旅行" &&
                !controller.state.value.loading
        }

        compose.onNodeWithTag("gallery-manual-more-manual:fixture-created").performClick()
        compose.onNodeWithTag("gallery-manual-rename-manual:fixture-created")
            .assertIsDisplayed().performClick()
        compose.onNodeWithTag("gallery-manual-rename-dialog").assertExists()
        compose.onNodeWithTag("gallery-manual-rename-name").performTextReplacement("夏季")
        compose.onNodeWithTag("gallery-manual-rename-confirm")
            .assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded &&
                controller.state.value.galleryAlbums.singleOrNull()?.name == "夏季" &&
                !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf("夏季"), galleryManualRenames)
            org.junit.Assert.assertEquals(0, galleryManualDeletes)
        }

        compose.onNodeWithTag("gallery-manual-more-manual:fixture-created").performClick()
        compose.onNodeWithTag("gallery-manual-delete-manual:fixture-created")
            .assertIsDisplayed().performClick()
        compose.onNodeWithTag("gallery-manual-delete-dialog").assertExists()
        compose.onNodeWithText("不会删除原始照片", substring = true).assertExists()
        compose.onNodeWithTag("gallery-manual-delete-confirm")
            .assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded &&
                controller.state.value.galleryAlbums.isEmpty() &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-albums-empty").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1, galleryManualDeletes)
            org.junit.Assert.assertNull(galleryCreatedManual)
        }
    }

    @Test fun nativeGallerySearchUsesRealOwnerRangeAndClearsWithoutCrossOwnerRows() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.galleryLoaded }
        compose.onNodeWithTag("gallery-search-button").performClick()
        compose.onNodeWithTag("gallery-search-input").performTextInput("sunset")
        compose.onNodeWithTag("gallery-search-apply").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySearchQuery == "sunset" &&
                controller.state.value.galleryItems.singleOrNull()?.node?.id == 46L
        }
        compose.runOnIdle { org.junit.Assert.assertEquals(listOf("sunset"), gallerySearchQueries) }
        compose.onNodeWithTag("gallery-search-clear").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySearchQuery.isEmpty() &&
                controller.state.value.galleryItems.singleOrNull()?.node?.id == 40L
        }
    }



    @Test fun gallerySelectionReviewRemovesAndClearsOnlyActualSelectedOwnerRows() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-select-mode").assertIsDisplayed().performClick()
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-selected-mark-40", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("gallery-selection-review-open").assertIsDisplayed().performClick()
        compose.onNodeWithTag("gallery-selection-review").assertExists()
        compose.onNodeWithTag("gallery-selected-review-item-40").assertExists()
        compose.onNodeWithTag("gallery-selection-remove-40").assertIsEnabled().performClick()
        compose.runOnIdle {
            org.junit.Assert.assertTrue(controller.state.value.gallerySelectedItems.isEmpty())
            org.junit.Assert.assertTrue(controller.state.value.gallerySelectionMode)
            org.junit.Assert.assertTrue(galleryFavoriteCalls.isEmpty())
            org.junit.Assert.assertTrue(galleryTagsCalls.isEmpty())
        }
        compose.onNodeWithTag("gallery-review-empty").assertIsDisplayed()
        compose.onNodeWithTag("gallery-review-return").performClick()
        compose.onNodeWithTag("gallery-selection-actions").assertExists()
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-selection-review-open").performClick()
        compose.onNodeWithTag("gallery-review-clear").assertIsEnabled().performClick()
        compose.runOnIdle {
            org.junit.Assert.assertTrue(controller.state.value.gallerySelectedItems.isEmpty())
            org.junit.Assert.assertTrue(galleryFavoriteCalls.isEmpty())
            org.junit.Assert.assertTrue(galleryTagsCalls.isEmpty())
        }
        compose.onNodeWithTag("gallery-review-return").performClick()
        compose.onNodeWithTag("gallery-selection-done").performClick()
        compose.onNodeWithTag("gallery-bottom-dock").assertIsDisplayed()
    }

    @Test fun manualAlbumNativeCoverCustomAndAutomaticUseOneOwnerPutEach() {
        galleryCoverFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-open-collections").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded &&
                controller.state.value.galleryAlbums.singleOrNull()?.id == "manual:cover" &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-album-item-manual:cover").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySelectedAlbum?.id == "manual:cover" &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 1 &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-select-mode").performClick()
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-selection-more").performClick()
        compose.onNodeWithTag("gallery-selection-set-album-cover")
            .assertIsDisplayed().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySelectedAlbum?.revision == 3L &&
                !controller.state.value.gallerySelectionMode &&
                !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf(40L), galleryCoverCalls)
            org.junit.Assert.assertTrue(galleryCustomCover)
        }
        compose.onNodeWithTag("gallery-album-back").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded &&
                controller.state.value.galleryAlbums.singleOrNull()?.revision == 3L &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-manual-more-manual:cover").performClick()
        compose.onNodeWithTag("gallery-manual-auto-cover-manual:cover")
            .assertIsDisplayed().performClick()
        compose.onNodeWithTag("gallery-manual-auto-cover-dialog").assertExists()
        compose.onNodeWithText("仍可能显示相册中的首张照片", substring = true)
            .assertExists()
        compose.onNodeWithTag("gallery-manual-auto-cover-confirm")
            .assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded &&
                controller.state.value.galleryAlbums.singleOrNull()?.revision == 4L &&
                !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf(40L, 0L), galleryCoverCalls)
            org.junit.Assert.assertFalse(galleryCustomCover)
        }
        compose.onNodeWithTag("gallery-album-item-manual:cover").assertExists()
    }

    @Test fun selectedManualAlbumMemberCanBeRemovedWithoutDeletingOriginalPhoto() {
        galleryRemoveMemberFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-open-collections").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-album-item-manual:member").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySelectedAlbum?.id == "manual:member" &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 1 &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-select-mode").performClick()
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-selection-more").assertIsEnabled().performClick()
        compose.onNodeWithTag("gallery-selection-remove-album-member")
            .assertIsDisplayed().performClick()
        compose.onNodeWithTag("gallery-remove-album-member-dialog").assertExists()
        compose.onNodeWithText("不会删除原始照片", substring = true).assertExists()
        compose.onNodeWithTag("gallery-remove-album-member-confirm")
            .assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.isEmpty() &&
                controller.state.value.gallerySelectedAlbum?.itemCount == 0L &&
                !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1, galleryMemberRemoveCalls)
            org.junit.Assert.assertTrue(galleryMemberRemoved)
            org.junit.Assert.assertFalse(controller.state.value.gallerySelectionMode)
        }
        compose.onNodeWithTag("gallery-album-back").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySelectedAlbum == null &&
                controller.state.value.galleryAlbumsLoaded
        }
        compose.onNodeWithTag("gallery-album-item-manual:member").assertExists()
    }

    @Test fun selectedGalleryAddsToManualAlbumAndRestoresPwaDock() {
        galleryManualAlbumFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-select-mode").performClick()
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-selection-more").assertIsEnabled().performClick()
        compose.onNodeWithTag("gallery-selection-add-album").assertIsDisplayed().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryAlbumsLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-album-picker").assertExists()
        compose.onNodeWithTag("gallery-add-album-manual:fixture")
            .assertIsEnabled().performClick()
        compose.onNodeWithTag("gallery-album-confirm").assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            !controller.state.value.gallerySelectionMode && !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(
                listOf("manual:fixture" to listOf(40L)), galleryAlbumAdds)
        }
        compose.onNodeWithTag("gallery-bottom-dock").assertIsDisplayed()
    }

    @Test fun galleryNativeSelectionAddsRealServerTagsAndRestoresDock() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-select-mode").performClick()
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-selection-more").assertIsEnabled().performClick()
        compose.onNodeWithTag("gallery-selection-tags").assertIsDisplayed().performClick()
        compose.onNodeWithTag("gallery-tags-dialog").assertExists()
        compose.onNodeWithTag("gallery-tags-input").performTextInput("旅行, Family")
        compose.onNodeWithTag("gallery-tags-confirm").assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            !controller.state.value.gallerySelectionMode &&
                !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(
                listOf(listOf(40L) to listOf("Family", "旅行")), galleryTagsCalls)
        }
        compose.onNodeWithTag("gallery-bottom-dock").assertIsDisplayed()
    }

    @Test fun galleryNativeSelectionFavoritesCurrentOwnerTileWithoutOpeningViewer() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-select-mode").assertIsDisplayed().performClick()
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-selected-mark-40", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("gallery-photo-viewer").assertDoesNotExist()
        compose.onNodeWithTag("gallery-selection-actions").assertIsDisplayed()
        compose.onNodeWithTag("gallery-selection-favorite").assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            !controller.state.value.loading &&
                controller.state.value.galleryItems.singleOrNull()?.favorite == true &&
                !controller.state.value.gallerySelectionMode
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf(listOf(40L) to true),
                galleryFavoriteCalls)
        }
        compose.onNodeWithTag("gallery-bottom-dock").assertIsDisplayed()
        compose.onNodeWithTag("gallery-item-40").assertExists()
    }

    @Test fun nativeGalleryKindFilterUsesServerAndResetsPositionOnChangedScope() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.galleryLoaded }
        compose.onNodeWithTag("gallery-bottom-dock").assertIsDisplayed()
        compose.onNodeWithTag("gallery-library-tab").assertIsDisplayed()
        // No returned Owner index means no artificial timeline.
        compose.onNodeWithTag("gallery-time-dock").assertDoesNotExist()
        val left = compose.onNodeWithTag("gallery-library-tab")
            .fetchSemanticsNode().boundsInRoot.center
        val middle = compose.onNodeWithTag("gallery-open-collections")
            .fetchSemanticsNode().boundsInRoot.center
        val right = compose.onNodeWithTag("gallery-search-button")
            .fetchSemanticsNode().boundsInRoot.center
        org.junit.Assert.assertTrue(left.x < middle.x && middle.x < right.x)
        org.junit.Assert.assertTrue(kotlin.math.abs(left.y - right.y) < 16f)
        // The actual Collections tab replaces the interim Classification
        // shortcut; classification remains usable in the Gallery header.
        compose.onNodeWithTag("gallery-kind-filter").performClick()
        compose.onNodeWithTag("gallery-kind-sheet").assertExists()
        compose.onNodeWithTag("gallery-kind-video").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryMediaKind == "video" &&
                controller.state.value.galleryItems.singleOrNull()?.node?.id == 47L
        }
        compose.onNodeWithTag("gallery-kind-filter")
            .assert(SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription, "仅视频"))
        compose.onNodeWithTag("gallery-search-button").performClick()
        compose.onNodeWithTag("gallery-search-input").performTextInput("sunset")
        compose.onNodeWithTag("gallery-search-apply").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.gallerySearchQuery == "sunset" &&
                controller.state.value.galleryMediaKind == "video"
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf("" to "video", "sunset" to "video"),
                galleryKindQueries)
        }
        compose.onNodeWithTag("gallery-kind-filter").performClick()
        compose.onNodeWithTag("gallery-kind-all").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryMediaKind.isEmpty() &&
                controller.state.value.galleryItems.singleOrNull()?.node?.id == 46L
        }
    }

    @Test fun nativeGallerySortUsesOwnerRangeAndRestoresChronologicalDefault() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-view-options").performClick()
        compose.onNodeWithTag("gallery-sort-added-desc").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            val st = controller.state.value
            st.galleryLoaded && !st.loading && st.gallerySortBy == "added" &&
                st.gallerySortDir == "desc" &&
                st.galleryItems.singleOrNull()?.node?.id == 48L
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf("added" to "desc"), gallerySortQueries)
            org.junit.Assert.assertEquals(0, controller.state.value.galleryOffset)
        }
        compose.onNodeWithTag("gallery-time-dock").assertDoesNotExist()
        compose.onNodeWithTag("gallery-view-options").performClick()
        compose.onNodeWithTag("gallery-sort-captured-asc").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            val st = controller.state.value
            st.galleryLoaded && !st.loading && st.gallerySortBy == "captured" &&
                st.gallerySortDir == "asc" &&
                st.galleryItems.singleOrNull()?.node?.id == 40L
        }
    }

    @Test fun nativeGalleryTimeScaleUsesOwnerIndexedJumpAndResetsToLatest() {
        galleryTimelineFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        // The latest tail is intentionally sparse (one row at index 120).
        // The existing Gallery lifecycle is allowed exactly one real
        // earlier Range prefetch before the user's first date jump.
        compose.waitUntil(timeoutMillis = 10_000) {
            val state = controller.state.value
            state.galleryLoaded && !state.loading &&
                state.galleryTimelineSets != null &&
                state.galleryItems.size == 61 && state.galleryOffset == 60
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(
                listOf(0 to true, 60 to false), galleryTimelineRequests)
            org.junit.Assert.assertEquals(121L, controller.state.value.galleryTotal)
        }
        val beforeJump = galleryTimelineRequests.size
        compose.onNodeWithTag("gallery-time-dock").assertIsDisplayed()
        compose.onNodeWithTag("gallery-time-scale-day").assertDoesNotExist()
        compose.onNodeWithTag("gallery-time-scale-year").performClick()
        compose.onNodeWithTag("gallery-time-groups").assertExists()
        compose.onNodeWithTag("gallery-time-group-2026").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            val state = controller.state.value
            state.galleryLoaded && !state.loading &&
                state.galleryJumpIndex == 60 &&
                state.galleryItems.firstOrNull()?.node?.id == 1060L
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(121L, controller.state.value.galleryTotal)
            org.junit.Assert.assertEquals(60, controller.state.value.galleryOffset)
            org.junit.Assert.assertEquals(60, controller.state.value.galleryItems.size)
            // The actual date click must issue exactly one indexed Owner GET.
            // Do not count the legitimate sparse-tail prefetch as a duplicate.
            org.junit.Assert.assertEquals(
                listOf(60 to false), galleryTimelineRequests.drop(beforeJump))
        }
        val beforeAll = galleryTimelineRequests.size
        compose.onNodeWithTag("gallery-time-scale-all").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            val state = controller.state.value
            state.galleryLoaded && !state.loading &&
                state.galleryJumpIndex == null &&
                state.galleryTimelineSets != null &&
                state.galleryItems.lastOrNull()?.node?.id == 40L
        }
        compose.runOnIdle {
            val requests = galleryTimelineRequests.drop(beforeAll)
            org.junit.Assert.assertTrue("All must reload real latest",
                requests.isNotEmpty())
            org.junit.Assert.assertEquals(0 to true, requests.first())
            // An optional follow-up 60-row prefetch is a separate read.
            org.junit.Assert.assertTrue("No redundant latest or older scans",
                requests.size <= 2 && requests.drop(1).all { it == (60 to false) })
            org.junit.Assert.assertTrue(controller.state.value.galleryOffset in
                listOf(60, 120))
            org.junit.Assert.assertEquals(40L,
                controller.state.value.galleryItems.last().node.id)
        }
    }

    @Test fun nativeGalleryDisplayOptionsAdjustRealGridWithoutReloadingOwnerPhotos() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded && !controller.state.value.loading
        }
        var readsBefore = 0
        compose.runOnIdle { readsBefore = galleryRangeReads }
        compose.onNodeWithTag("gallery-view-options").performClick()
        compose.onNodeWithTag("gallery-zoom-out").performClick()
        compose.onNodeWithTag("gallery-view-options")
            .assert(SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription, "缩略图密度 4 档，方形裁切"))
        compose.onNodeWithTag("gallery-view-options").performClick()
        compose.onNodeWithTag("gallery-aspect-contain").performClick()
        compose.onNodeWithTag("gallery-view-options")
            .assert(SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription, "缩略图密度 4 档，完整比例"))
        // Display changes cannot trigger a second Owner Range or invalidate a tile.
        compose.runOnIdle {
            org.junit.Assert.assertEquals(readsBefore, galleryRangeReads)
            org.junit.Assert.assertEquals(40L, controller.state.value.galleryItems.single().node.id)
        }
        compose.onNodeWithTag("gallery-item-40", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-view-options")
            .assert(SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription, "缩略图密度 4 档，完整比例"))
    }
    @Test fun filesThumbnailFailureRetriesOnlyFromMenuThenReusesImageInGrid() {
        // Real Compose Files list/grid with a generated decodable JPEG. No
        // Gallery wall, external media provider, or dummy thumbnail overlay.
        galleryVideoFixture = true // Fixture's 8px real JPEG response.
        galleryThumbnailFailuresRemaining = 1
        mutableRootRows += DriveNode(72, 1, "真实封面.jpg", "file", size = 2048, revision = 3)
        startAndLogin()
        compose.waitUntil(timeoutMillis = 10_000) { galleryThumbnailReads == 1 }
        compose.waitForIdle()
        compose.onNodeWithTag("files-item-72").assertIsDisplayed()
        compose.onNodeWithTag("files-thumbnail-ready-72", useUnmergedTree = true)
            .assertDoesNotExist() // Failed derivative must show the file glyph.
        compose.onNodeWithTag("files-item-72").performTouchInput { longClick() }
        compose.onNodeWithTag("files-thumbnail-retry-72").assertIsDisplayed().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("files-thumbnail-ready-72", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.runOnIdle { org.junit.Assert.assertEquals(2, galleryThumbnailReads) }
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("图标").performClick()
        compose.onNodeWithTag("files-grid").assertExists()
        compose.onNodeWithTag("files-thumbnail-ready-72", useUnmergedTree = true).assertExists()
        compose.runOnIdle { org.junit.Assert.assertEquals(2, galleryThumbnailReads) }
    }

    @Test fun nativeGalleryOpensRealOwnerPhotoWallAndReturnsToFiles() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.onNodeWithTag("gallery-wall").assertExists()
        compose.onNodeWithTag("gallery-item-40", useUnmergedTree = true).assertExists()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-files").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES
        }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun galleryThumbnailFailureRequiresUserRetryAndThenShowsImage() {
        galleryThumbnailRetryFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-thumbnail-failed-40", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.waitForIdle()
        // Invalid first thumbnail never automatically creates a request storm.
        compose.runOnIdle { org.junit.Assert.assertEquals(1, galleryThumbnailCalls.get()) }
        // No operation icon on the tile: explicit long-press retries instead.
        compose.onNodeWithTag("gallery-item-40", useUnmergedTree = true)
            .performTouchInput { longClick() }
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-thumbnail-ready-40", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-thumbnail-failed-40", useUnmergedTree = true)
            .assertDoesNotExist()
        // One initial error + one explicit long-press retry. Opening the
        // Viewer is a separate lifecycle and must not be counted as another
        // Gallery tile retry.
        compose.runOnIdle { org.junit.Assert.assertEquals(2, galleryThumbnailCalls.get()) }
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.onNodeWithText("相册照片.jpg").assertIsDisplayed()
        // The synthetic original is not decodable. The real native Viewer
        // reuses the currently decoded Owner/revision JPEG from the Gallery
        // bitmap cache: fallback must not issue a third thumbnail HTTP request
        // or start any background retry loop.
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-fallback", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-photo-fallback").assertIsDisplayed()
        // One failed tile + one user-triggered tile retry; the Viewer shares
        // the decoded JPEG and never repeats its authenticated thumbnail GET.
        compose.runOnIdle { org.junit.Assert.assertEquals(2, galleryThumbnailCalls.get()) }
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-thumbnail-ready-40", useUnmergedTree = true).assertExists()
        compose.runOnIdle { org.junit.Assert.assertEquals(2, galleryThumbnailCalls.get()) }
    }

    @Test fun GalleryAutomaticallyFetchesOlderOwnerRangeAtScrolledTop() {
        galleryAutoPagingFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        // Initial latest single tile triggers one bounded sparse-tail prefetch.
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryOffset == 120 &&
                controller.state.value.galleryItems.size == 61
        }
        compose.onNodeWithTag("gallery-grid").performScrollToIndex(0)
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryOffset == 60 &&
                controller.state.value.galleryItems.size == 121
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf(180, 120, 60), galleryOffsets)
            org.junit.Assert.assertEquals(
                40L, controller.state.value.galleryItems.last().node.id)
            org.junit.Assert.assertNull(controller.state.value.error)
        }
    }

    @Test fun nativePhotoTileOpensImageViewerAndBackPreservesGallery() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.onNodeWithTag("gallery-item-40", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertNull(controller.state.value.galleryViewer)
            org.junit.Assert.assertEquals(Screen.GALLERY, controller.state.value.screen)
        }
    }

    @Test fun oversizedNativePhotoUsesBoundedOwnerThumbnailAndLabelsDegradedPreview() {
        galleryOversizeFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-thumbnail-ready-46",
                useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        val readsBeforeViewer = galleryThumbnailReads
        compose.onNodeWithTag("gallery-item-46", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-fallback").fetchSemanticsNodes().isNotEmpty()
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(readsBeforeViewer, galleryThumbnailReads)
        }
        compose.onNodeWithTag("gallery-photo-image").assertExists()
        compose.onNodeWithTag("gallery-photo-fallback").assertIsDisplayed()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertNull(controller.state.value.galleryViewer)
        }
    }

    @Test fun failedNativePhotoRequiresExplicitRetryAndRecoversSameOwnerThumbnail() {
        galleryOversizeFixture = true
        galleryThumbnailFailuresRemaining = 2
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded && galleryThumbnailReads > 0 &&
                compose.onAllNodesWithTag("gallery-thumbnail-failed-46",
                    useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        // A missing Gallery tile and then the Viewer fallback fail once each.
        // No cached success exists in this fixture; manual Retry is the third
        // authenticated request and may never start on its own.
        compose.onNodeWithTag("gallery-item-46", useUnmergedTree = true).performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-retry").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-photo-image").assertDoesNotExist()
        compose.onNodeWithTag("gallery-photo-retry").assertIsDisplayed()
        val failureReads = galleryThumbnailReads
        compose.waitForIdle()
        org.junit.Assert.assertEquals(failureReads, galleryThumbnailReads)
        compose.onNodeWithTag("gallery-photo-retry").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-fallback").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-photo-image").assertIsDisplayed()
        compose.onNodeWithTag("gallery-photo-retry").assertDoesNotExist()
        org.junit.Assert.assertEquals(failureReads + 1, galleryThumbnailReads)
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
    }

    @Test fun photoViewerBackRestoresActualGalleryScrollAnchor() {
        galleryManyPhotos = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 60
        }
        compose.onNodeWithTag("gallery-grid").performScrollToIndex(30)
        compose.onNodeWithTag("gallery-item-1030", useUnmergedTree = true)
            .assertIsDisplayed().performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-item-1030", useUnmergedTree = true)
            .assertIsDisplayed()
        compose.runOnIdle {
            org.junit.Assert.assertNull(controller.state.value.galleryViewer)
        }
    }

    @Test fun leavingGalleryClearsOldViewportButViewerBackKeepsCurrentAnchor() {
        galleryManyPhotos = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 60
        }
        compose.onNodeWithTag("gallery-grid").performScrollToIndex(0)
        compose.onNodeWithTag("gallery-item-1000", useUnmergedTree = true)
            .assertIsDisplayed()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-files").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES
        }
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 60
        }
        // Re-entering a Gallery session must start at newest, rather than
        // restoring the former session's oldest tile at index zero.
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-item-1059", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-item-1059", useUnmergedTree = true)
            .assertIsDisplayed()
    }

    @Test fun galleryViewerSwipeChangesOnlyVerifiedAdjacentOwnerPhotos() {
        galleryManyPhotos = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 60
        }
        compose.onNodeWithTag("gallery-grid").performScrollToIndex(30)
        compose.onNodeWithTag("gallery-item-1030", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-photo-gesture").performTouchInput { swipeLeft() }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1031L,
                controller.state.value.galleryViewer?.node?.id)
        }
        compose.onNodeWithTag("gallery-photo-gesture").performTouchInput { swipeRight() }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1030L,
                controller.state.value.galleryViewer?.node?.id)
        }
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-item-1030", useUnmergedTree = true)
            .assertIsDisplayed()
    }

    @Test fun nativeLIVPStillIsReadFromSignedResourceNotOuterZip() {
        galleryLivePhotoFixture = true
        galleryLIVPFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.onNodeWithTag("gallery-item-48", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.waitUntil(timeoutMillis = 10_000) {
            liveStillReads == 1 &&
                compose.onAllNodesWithTag("gallery-photo-image").fetchSemanticsNodes()
                    .isNotEmpty()
        }
        compose.onNodeWithTag("gallery-photo-image").assertIsDisplayed()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1, liveStillReads)
            org.junit.Assert.assertEquals(0, liveMotionRequests)
        }
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
    }

    @Test fun nativeLivePhotoNeedsExplicitHoldAndReleasesPrivateMotionOnUp() {
        galleryLivePhotoFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded &&
                compose.onAllNodesWithTag("gallery-thumbnail-ready-48",
                    useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-item-48", useUnmergedTree = true).performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-image").fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(0, liveMotionRequests)
        }
        compose.onNodeWithTag("gallery-photo-gesture").performTouchInput { longClick() }
        compose.waitUntil(timeoutMillis = 10_000) { liveMotionRequests == 1 }
        compose.waitUntil(timeoutMillis = 10_000) { liveMotionClosed == 1 }
        compose.onNodeWithTag("gallery-photo-image").assertIsDisplayed()
        compose.onNodeWithTag("gallery-live-motion-surface").assertDoesNotExist()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1, liveMotionRequests)
            org.junit.Assert.assertEquals(1, liveMotionClosed)
        }
    }

    @Test fun nativeVideoOpensMedia3AndClosesOwnerStream() {
        galleryVideoFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.GALLERY &&
                controller.state.value.galleryLoaded
        }
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-thumbnail-ready-45",
                useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        val readsBeforeViewer = galleryThumbnailReads
        compose.onNodeWithTag("gallery-item-45", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("gallery-video-viewer").assertExists()
        compose.onNodeWithTag("gallery-video-player").assertExists()
        compose.onNodeWithTag("gallery-video-poster").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(readsBeforeViewer, galleryThumbnailReads)
        }
        compose.onNodeWithTag("gallery-video-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertNull(controller.state.value.galleryViewer)
            org.junit.Assert.assertEquals(1, videoTransportClosed)
        }
    }

    @Test fun nativeMixedGalleryViewerSwipesPhotosAndVideoAndReleasesMedia3Stream() {
        galleryMixedViewerFixture = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryLoaded &&
                controller.state.value.galleryItems.size == 3 &&
                compose.onAllNodesWithTag("gallery-thumbnail-ready-40",
                    useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("gallery-item-40", useUnmergedTree = true).performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-image").fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.onNodeWithTag("gallery-photo-gesture").performTouchInput { swipeLeft() }
        // Prove the actual photo -> video state changed, then wait for the
        // lifecycle-collected Compose viewer to render; no blind sleep.
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryViewer?.node?.id == 45L &&
                compose.onAllNodesWithTag("gallery-video-viewer").fetchSemanticsNodes()
                    .isNotEmpty()
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(45L, controller.state.value.galleryViewer?.node?.id)
            org.junit.Assert.assertEquals(0, videoTransportClosed)
        }
        // A seek/control-area drag stays with native Media3. Only a swipe in
        // the content area may navigate; the observer never consumes touches.
        compose.onNodeWithTag("gallery-video-viewer").performTouchInput {
            val bottom = height * 0.94f
            swipe(
                start = androidx.compose.ui.geometry.Offset(width * 0.9f, bottom),
                end = androidx.compose.ui.geometry.Offset(width * 0.1f, bottom),
            )
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(45L, controller.state.value.galleryViewer?.node?.id)
            org.junit.Assert.assertEquals(0, videoTransportClosed)
        }
        // Passive observer sees the swipe before native Media3 controls, and
        // changing the Viewer closes the old Owner Range immediately.
        compose.onNodeWithTag("gallery-video-viewer").performTouchInput { swipeLeft() }
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryViewer?.node?.id == 46L &&
                compose.onAllNodesWithTag("gallery-photo-viewer").fetchSemanticsNodes()
                    .isNotEmpty()
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(46L, controller.state.value.galleryViewer?.node?.id)
            org.junit.Assert.assertEquals(1, videoTransportClosed)
        }
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("gallery-photo-image").fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.onNodeWithTag("gallery-photo-gesture").performTouchInput { swipeRight() }
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryViewer?.node?.id == 45L &&
                compose.onAllNodesWithTag("gallery-video-viewer").fetchSemanticsNodes()
                    .isNotEmpty()
        }
        compose.onNodeWithTag("gallery-video-viewer").performTouchInput { swipeRight() }
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.galleryViewer?.node?.id == 40L &&
                compose.onAllNodesWithTag("gallery-photo-viewer").fetchSemanticsNodes()
                    .isNotEmpty()
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(40L, controller.state.value.galleryViewer?.node?.id)
            org.junit.Assert.assertEquals(2, videoTransportClosed)
        }
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.onNodeWithTag("gallery-wall").assertExists()
    }

    @Test fun galleryInfoOffersRealOwnerPhotoSafDownloadAndNoPlaceholderWhenUnavailable() {
        val downloads = mutableListOf<Long>()
        startAndLogin(onDownload = { downloads += it.id })
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("switch-to-gallery").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.galleryLoaded }
        compose.onNodeWithTag("gallery-item-40").performClick()
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.onNodeWithTag("gallery-photo-info").performClick()
        compose.onNodeWithTag("gallery-download-action").assertExists().assertIsEnabled().performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(listOf(40L), downloads) }
    }

    @Test fun nativeExportPickerUsesTypedDocumentIntentAndRejectsNonDocumentUri() {
        val contract = NativeCreateDocument()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val image = contract.createIntent(context, NativeExportDocument("family.jpeg", "image/jpeg"))
        org.junit.Assert.assertEquals(Intent.ACTION_CREATE_DOCUMENT, image.action)
        org.junit.Assert.assertEquals("image/jpeg", image.type)
        org.junit.Assert.assertEquals("family.jpeg", image.getStringExtra(Intent.EXTRA_TITLE))
        org.junit.Assert.assertTrue(image.hasCategory(Intent.CATEGORY_OPENABLE))

        val video = contract.createIntent(context, NativeExportDocument("clip.mov", "video/quicktime"))
        org.junit.Assert.assertEquals("video/quicktime", video.type)
        val forbidden = Intent().setData(Uri.parse("file:///data/local/tmp/foreign"))
        org.junit.Assert.assertNull(contract.parseResult(Activity.RESULT_OK, forbidden))
        org.junit.Assert.assertNull(contract.parseResult(Activity.RESULT_CANCELED,
            Intent().setData(Uri.parse("content://fake/export"))))
        val accepted = Uri.parse("content://fixture/export")
        org.junit.Assert.assertEquals(accepted, contract.parseResult(Activity.RESULT_OK,
            Intent().setData(accepted)))
    }

    @Test fun filesPdfVerifiedTwoPagesBackAndPrivateTempCleanup() {
        filesPdfFixture = true
        startAndLogin()
        val pathBefore = controller.state.value.path.map { it.id }
        compose.onNodeWithTag("files-item-51").assertExists().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesPdfViewer == filesPdfNode
        }
        compose.onNodeWithTag("files-pdf-viewer").assertExists()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("files-pdf-page-ready").fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose.onNodeWithTag("files-pdf-page-count").assertTextEquals("1 / 2")
        compose.onNodeWithTag("files-pdf-next").assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithTag("files-pdf-page-ready").fetchSemanticsNodes()
                .isNotEmpty() &&
                compose.onAllNodesWithTag("files-pdf-page-count")
                    .fetchSemanticsNodes().isNotEmpty() &&
                controller.state.value.filesPdfViewer == filesPdfNode
        }
        compose.onNodeWithTag("files-pdf-page-count").assertTextEquals("2 / 2")
        compose.onNodeWithContentDescription("PDF 第 2 页").assertExists()
        compose.onNodeWithTag("files-pdf-close").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesPdfViewer == null &&
                compose.onAllNodesWithTag("files-item-51").fetchSemanticsNodes()
                    .isNotEmpty()
        }
        compose.onNodeWithTag("files").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(pathBefore,
                controller.state.value.path.map { it.id })
            org.junit.Assert.assertEquals(1, filesPdfReads)
        }
        val dir = java.io.File(InstrumentationRegistry.getInstrumentation()
            .targetContext.cacheDir, "owner-native-pdf")
        compose.waitUntil(timeoutMillis = 10_000) {
            dir.listFiles().orEmpty().none { it.name.startsWith("preview-") &&
                it.name.endsWith(".pdf") }
        }
    }

    @Test fun filesAudioUsesNativeMedia3AndReturnsToOriginalFilesWithoutRefreshing() {
        filesAudioFixture = true
        startAndLogin()
        val before = controller.state.value.path.map { it.id }
        compose.onNodeWithTag("files-item-50").assertExists().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesAudioViewer == filesAudioNode
        }
        compose.onNodeWithTag("files-audio-viewer").assertExists()
        compose.waitUntil(timeoutMillis = 10_000) { filesAudioSessions == 1 }
        compose.onNodeWithTag("files-audio-close").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesAudioViewer == null &&
                filesAudioClosures == 1
        }
        compose.onNodeWithTag("files").assertExists()
        compose.onNodeWithTag("files-item-50").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(before, controller.state.value.path.map { it.id })
        }
    }

    @Test fun filesImageUsesSameOwnerViewerAndReturnsToOriginalBrowse() {
        filesViewerFixture = true
        startAndLogin()
        val beforePath = controller.state.value.path.map { it.id }
        compose.onNodeWithTag("files-item-49").assertExists().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.viewerReturnToFiles &&
                controller.state.value.galleryViewer?.node == filesViewerNode &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("gallery-photo-viewer").assertExists()
        compose.onNodeWithTag("gallery-photo-close").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES &&
                controller.state.value.galleryViewer == null
        }
        compose.onNodeWithTag("files").assertExists()
        compose.onNodeWithTag("files-item-49").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(beforePath,
                controller.state.value.path.map { it.id })
            org.junit.Assert.assertEquals(1, filesViewerDetailReads)
        }
    }

    @Test fun nativeUploadActionStartsRealSafPickerCallback() {
        var picks = 0
        startAndLogin(onUpload = { picks++ })
        compose.onNodeWithContentDescription("账户菜单").assertIsDisplayed().performClick()
        // The actual platform popup can finish positioning after Compose idle.
        // Boundedly scroll/observe the same real enabled SAF item; never retry
        // the upload click or replace its callback with a synthetic invocation.
        try {
            compose.waitUntil(timeoutMillis = 10_000) {
                runCatching {
                    compose.onNodeWithTag("files-upload-action")
                        .performScrollTo().assertIsDisplayed().assertIsEnabled()
                }.isSuccess
            }
        } catch (failure: androidx.compose.ui.test.ComposeTimeoutException) {
            val current = controller.state.value
            throw AssertionError(
                "SAF upload action not visible: screen=${current.screen}, " +
                    "loading=${current.loading}, loaded=${current.loaded}",
                failure,
            )
        }
        compose.onNodeWithTag("files-upload-action")
            .assertIsDisplayed().assertIsEnabled().performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(1, picks) }
    }

    @Test fun nativeBrowseSelectionCopiesTwoOwnerFilesViaOneAtomicPost() {
        batchTransferFixture = true
        extraRootFile = true
        startAndLogin()
        compose.onNodeWithTag("files-select-mode").performClick()
        // Server fixture is folder 2, file 71, then file 70. Scroll each
        // actual node into the 320x640 emulator viewport before touching it.
        compose.onNodeWithTag("files").performScrollToIndex(2)
        compose.onNodeWithTag("files-item-70").assertIsDisplayed().performClick()
        compose.onNodeWithTag("files").performScrollToIndex(1)
        compose.onNodeWithTag("files-item-71").assertIsDisplayed().performClick()
        compose.onNodeWithTag("files-batch-copy-action")
            .assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-source-summary")
            .assertTextEquals("批量 2 项")
        compose.onNodeWithTag("files-destination-confirm")
            .assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            batchCopyCalls == 1 && controller.state.value.destinationKind == null &&
                !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1, batchCopyCalls)
            org.junit.Assert.assertEquals(0, batchMoveCalls)
            org.junit.Assert.assertFalse(controller.state.value.browseSelectionMode)
            org.junit.Assert.assertTrue(
                controller.state.value.items.any { it.id == 170L } &&
                controller.state.value.items.any { it.id == 171L })
        }
    }

    @Test fun nativeBrowseBatchMoveRequiresVerifiedOtherFolderAndOnePost() {
        batchTransferFixture = true
        extraRootFile = true
        startAndLogin()
        compose.onNodeWithTag("files-select-mode").performClick()
        // Server fixture is folder 2, file 71, then file 70. Scroll each
        // actual node into the 320x640 emulator viewport before touching it.
        compose.onNodeWithTag("files").performScrollToIndex(2)
        compose.onNodeWithTag("files-item-70").assertIsDisplayed().performClick()
        compose.onNodeWithTag("files").performScrollToIndex(1)
        compose.onNodeWithTag("files-item-71").assertIsDisplayed().performClick()
        compose.onNodeWithTag("files-batch-move-action")
            .assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-confirm").assertIsNotEnabled()
        compose.onNodeWithTag("files-destination-item-2").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationPath.lastOrNull()?.id == 2L &&
                controller.state.value.destinationLoaded &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-confirm")
            .assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            batchMoveCalls == 1 && controller.state.value.destinationKind == null &&
                !controller.state.value.loading
        }
        compose.runOnIdle {
            org.junit.Assert.assertEquals(1, batchMoveCalls)
            org.junit.Assert.assertEquals(0, batchCopyCalls)
            org.junit.Assert.assertFalse(controller.state.value.browseSelectionMode)
            org.junit.Assert.assertTrue(controller.state.value.items.none {
                it.id in setOf(70L, 71L) })
            org.junit.Assert.assertEquals(1L, controller.state.value.path.last().id)
        }
    }

    @Test fun nativeDownloadMenuUsesOnlyRealCurrentFile() {
        extraRootFile = true
        val downloads = mutableListOf<Long>()
        startAndLogin(onDownload = { downloads += it.id })
        compose.onNodeWithTag("files-item-70").performTouchInput { longClick() }
        compose.onNodeWithTag("files-download-action").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf(70L), downloads)
            org.junit.Assert.assertTrue(controller.state.value.fileExportPending == null)
        }
    }

    @Test fun nativeCopyPickerSelectsVerifiedChildFolder() {
        extraRootFile = true
        startAndLogin()
        compose.onNodeWithTag("files-item-70").performTouchInput { longClick() }
        compose.onNodeWithText("复制到…").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-item-2").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationPath.lastOrNull()?.id == 2L &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            copyCalls == 1 && !controller.state.value.loading &&
                controller.state.value.destinationKind == null
        }
        compose.onNodeWithTag("files-item-70").assertExists()
    }

    @Test fun nativeMovePickerRejectsSameParentThenMovesIntoFolder() {
        extraRootFile = true
        startAndLogin()
        // The real Compose LazyColumn may not mount its second row while the
        // IME/viewport settles. Verify actual Owner rows before scrolling to
        // the fixture target; never synthesize a click or retry a write.
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.loaded &&
                controller.state.value.filesSection == FilesSection.BROWSE &&
                controller.state.value.items.any { it.id == 70L }
        }
        val targetIndex = controller.state.value.items.indexOfFirst { it.id == 70L }
        compose.onNodeWithTag("files").performScrollToIndex(targetIndex)
        compose.onNodeWithTag("files-item-70").assertIsDisplayed()
            .performTouchInput { longClick() }
        compose.onNodeWithText("移动到…").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-confirm").assertIsNotEnabled()
        compose.onNodeWithTag("files-destination-item-2").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.destinationPath.lastOrNull()?.id == 2L &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("files-destination-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            moveCalls == 1 && !controller.state.value.loading &&
                controller.state.value.items.none { it.id == 70L }
        }
        compose.onNodeWithTag("files-item-70").assertDoesNotExist()
    }

    @Test fun createFolderFromMoreUsesActualServerAndValidatesName() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("files-create-folder-action").performClick()
        compose.onNodeWithTag("files-edit-name").performTextInput("CON")
        compose.onNodeWithTag("files-edit-confirm").assertIsNotEnabled()
        compose.onNodeWithTag("files-edit-name").performTextReplacement("新相册")
        compose.onNodeWithTag("files-edit-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            createCalls == 1 && !controller.state.value.loading &&
                controller.state.value.items.any { it.name == "新相册" }
        }
        compose.onNodeWithText("新相册").assertIsDisplayed()
    }

    @Test fun longPressRenameUsesRevisionedServerPatchAndShowsNewName() {
        startAndLogin()
        compose.onNodeWithTag("files-item-2").performTouchInput { longClick() }
        compose.onNodeWithText("重命名").performClick()
        compose.onNodeWithTag("files-edit-name").performTextReplacement("照片备份")
        compose.onNodeWithTag("files-edit-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            renameCalls == 1 && !controller.state.value.loading &&
                controller.state.value.items.any { it.name == "照片备份" }
        }
        compose.onNodeWithText("照片备份").assertIsDisplayed()
    }

    @Test fun deleteToTrashRequiresConfirmationAndCancelCannotWrite() {
        startAndLogin()
        compose.onNodeWithTag("files-item-2").performTouchInput { longClick() }
        compose.onNodeWithText("移到回收站").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(0, trashCalls) }
        compose.onNodeWithText("取消").performClick()
        compose.runOnIdle { org.junit.Assert.assertEquals(0, trashCalls) }
        compose.onNodeWithTag("files-item-2").performTouchInput { longClick() }
        compose.onNodeWithText("移到回收站").performClick()
        compose.onNodeWithTag("files-edit-confirm").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            trashCalls == 1 && !controller.state.value.loading &&
                controller.state.value.items.none { it.id == 2L }
        }
        compose.onNodeWithTag("files-item-2").assertDoesNotExist()
        compose.onNodeWithText("此文件夹为空").assertIsDisplayed()
    }

    @Test fun nativeFilesTextPreviewShowsBoundedRealOwnerTextAndReclaimsOnClose() {
        textPreviewFixture = true
        startAndLogin()
        compose.onNodeWithText("假期照片").performClick()
        compose.onNodeWithText("测试.txt").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.fileTextPreview?.text == "hello xDrive" &&
                !controller.state.value.fileTextPreviewLoading
        }
        compose.onNodeWithTag("files-text-preview-content").assertIsDisplayed()
        compose.onNodeWithText("hello xDrive").assertIsDisplayed()
        compose.runOnIdle { org.junit.Assert.assertEquals(1, textPreviewReads) }
        compose.onNodeWithText("关闭").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertNull(controller.state.value.fileTextPreview)
            org.junit.Assert.assertNull(controller.state.value.selected)
        }
        compose.onNodeWithContentDescription("返回上级").performClick()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.runOnIdle { org.junit.Assert.assertNull(controller.state.value.fileTextPreview) }
    }

    @Test fun loginBrowseDetailsBackAndLogout() {
        startAndLogin()
        compose.onNodeWithText("假期照片").performClick()
        compose.onNodeWithText("测试.txt").performClick()
        compose.onNode(hasText("12 B") and hasAnyAncestor(isDialog())).assertIsDisplayed()
        compose.onNodeWithText("关闭").performClick()
        compose.onNodeWithContentDescription("返回上级").performClick()
        compose.onNodeWithText("假期照片").assertIsDisplayed()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("退出登录").performClick()
        compose.onNodeWithTag("password").assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        compose.onNodeWithText("假期照片").assertDoesNotExist()
    }

    @Test fun failedDirectoryLoadOffersRetryWithoutChangingPath() {
        startAndLogin()
        compose.runOnIdle { failNext = true }
        compose.onNodeWithText("假期照片").performClick()
        compose.onNodeWithTag("request-error").assertIsDisplayed()
        compose.onNodeWithText("重试").performClick()
        compose.onNodeWithText("测试.txt").assertIsDisplayed()
        compose.onNodeWithTag("request-error").assertDoesNotExist()
    }

    @Test fun cleartextRequiresExplicitOptIn() {
        compose.setContent { XDriveTheme { DriveApp(controller) } }
        compose.onNodeWithTag("server").performTextInput("http://drive.example:1080")
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-password")
        // The unified form never stores a cleartext HTTP refresh credential.
        compose.onNodeWithTag("keep-login").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.error != null }
        compose.onNodeWithTag("request-error").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("connection-advanced").performScrollTo().performClick()
        compose.onNodeWithTag("allow-http").performScrollTo().performClick()
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.screen == Screen.FILES && controller.state.value.loaded
        }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun unifiedLoginValidatesLanAndClearsStaleOriginSettings() {
        compose.setContent { XDriveTheme { DriveApp(controller) } }
        compose.onNodeWithTag("server").performTextInput("https://drive.example")
        compose.onNodeWithTag("username").performTextInput("owner")
        compose.onNodeWithTag("password").performTextInput("fixture-password")
        compose.onNodeWithTag("lan-ip").performScrollTo().performTextInput("192.168.2.999")
        compose.onNodeWithTag("auth-submit").performScrollTo().performClick()
        compose.onNodeWithTag("request-error").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("lan-ip").performScrollTo().performTextReplacement("192.168.2.4")
        compose.onNodeWithTag("server").performScrollTo().performTextReplacement("https://other.example")
        compose.onNodeWithTag("lan-ip").performScrollTo()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        // Routing is now automatic; the old three-mode/public IP UI must stay removed.
        compose.onNodeWithTag("route-auto").assertDoesNotExist()
        compose.onNodeWithTag("route-lan").assertDoesNotExist()
        compose.onNodeWithTag("route-public").assertDoesNotExist()
        compose.onNodeWithTag("public-ip").assertDoesNotExist()
    }

    @Test fun continuousScrollFailureKeepsFirstPageAndRetryAppends() {
        paging = true
        failOnSecondPage = true
        startAndLogin()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.error != null }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
        compose.onNodeWithText("保留上次成功读取的目录。").assertIsDisplayed()
        compose.onNodeWithText("重试").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.offset == 100 && !controller.state.value.loading
        }
        compose.onNodeWithText("第二页.txt").assertExists()
        compose.onNodeWithText("假期照片").assertExists()
    }

    @Test fun longPressOnFolderOpensActionsWithoutEnteringIt() {
        startAndLogin()
        compose.onNodeWithTag("files-item-2").performTouchInput { longClick() }
        compose.onNodeWithText("属性").assertIsDisplayed()
        compose.runOnIdle { org.junit.Assert.assertEquals(1, controller.state.value.path.size) }
        compose.onNodeWithText("属性").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.selected?.id == 2L }
        compose.onNodeWithText("关闭").performClick()
        compose.runOnIdle { org.junit.Assert.assertNull(controller.state.value.selected) }
    }

    @Test fun listGridSwitchRetainsVisibleItemAnchor() {
        manyFiles = true
        startAndLogin()
        compose.onNodeWithTag("files").performScrollToIndex(50)
        compose.onNodeWithText("item-50.txt").assertIsDisplayed()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("图标").performClick()
        compose.onNodeWithTag("files-grid").assertExists()
        compose.onNodeWithText("item-50.txt").assertExists()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("列表").performClick()
        compose.onNodeWithTag("files").assertExists()
        compose.onNodeWithText("item-50.txt").assertExists()
    }

    @Test fun returningFromFolderRestoresPriorFirstPageViewport() {
        manyFiles = true
        startAndLogin()
        compose.onNodeWithTag("files").performScrollToIndex(49)
        compose.onNodeWithText("第二相册").assertIsDisplayed().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.path.size == 2 && !controller.state.value.loading
        }
        compose.onNodeWithContentDescription("返回上级").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.path.size == 1 && controller.state.value.loaded && !controller.state.value.loading
        }
        compose.onNodeWithText("item-50.txt").assertIsDisplayed()
    }

    @Test fun folderPathMenuReturnsToServerVerifiedAncestor() {
        startAndLogin()
        compose.onNodeWithText("假期照片").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.path.size == 2 && !controller.state.value.loading }
        compose.onNodeWithTag("files-path-menu").performClick()
        compose.onNodeWithTag("files-path-1").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.path.size == 1 && controller.state.value.loaded }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun searchAllFilesUsesServerResultRatherThanCurrentDirectoryRows() {
        startAndLogin()
        compose.onNodeWithTag("files-global-search-input").performTextInput("favorite")
        compose.onNodeWithTag("files-global-search-submit").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.SEARCH &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-collection").assertExists()
        compose.onNodeWithTag("files-collection-item-7").assertExists()
        compose.onNodeWithContentDescription("返回上级").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.BROWSE
        }
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun searchLaunchedFromFavoritesReturnsToFavoritesViaBack() {
        startAndLogin()
        compose.onNodeWithTag("files-section-favorites").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.FAVORITES &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-search-results-input").performTextInput("holiday")
        compose.onNodeWithTag("files-search-results-submit").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.SEARCH &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithContentDescription("返回上级").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.FAVORITES &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-collection-item-7").assertExists()
    }

    @Test fun recentBrowseFavoritesAreRealOwnerLoadedSections() {
        startAndLogin()
        compose.onNodeWithTag("files-section-recent").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.RECENT &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-collection-item-2").assertExists()
        compose.onNodeWithTag("files-section-favorites").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.FAVORITES &&
                controller.state.value.collectionLoaded && !controller.state.value.loading
        }
        compose.onNodeWithTag("files-collection-item-7").assertExists()
        compose.onNodeWithTag("files-section-browse").performClick()
        compose.onNodeWithTag("files").assertExists()
        compose.onNodeWithText("假期照片").assertIsDisplayed()
    }

    @Test fun favoriteLongPressRemovalChangesRealCollectionOnlyAfterAck() {
        startAndLogin()
        compose.onNodeWithTag("files-section-favorites").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.collectionLoaded }
        compose.onNodeWithTag("files-collection-item-7").performTouchInput { longClick() }
        compose.onNodeWithText("取消收藏").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            favoriteDeletes == 1 && controller.state.value.collectionItems.isEmpty() &&
                !controller.state.value.loading
        }
        compose.onNodeWithText("暂无收藏的文件").assertIsDisplayed()
    }

    @Test fun recentFolderOpensServerVerifiedBrowseLocation() {
        startAndLogin()
        compose.onNodeWithTag("files-section-recent").performClick()
        compose.waitUntil(timeoutMillis = 10_000) { controller.state.value.collectionLoaded }
        compose.onNodeWithTag("files-collection-item-2").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesSection == FilesSection.BROWSE &&
                controller.state.value.path.size == 2 && !controller.state.value.loading
        }
        compose.onNodeWithText("测试.txt").assertExists()
    }

    @Test fun switchListAndGridKeepsTheSameFolderNavigation() {
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("图标").performClick()
        compose.onNodeWithTag("files-grid").assertExists()
        compose.onNodeWithText("假期照片").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.path.size == 2 && controller.state.value.loaded
        }
        compose.onNodeWithText("测试.txt").assertExists()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("列表").performClick()
        compose.onNodeWithTag("files").assertExists()
    }

    @Test fun nativeFilesArrangementUsesRealOwnerOrderingAndAppliesOnlyOnConfirmedPage() {
        filesSortFixture = true
        extraRootFile = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("files-arrangement-open").assertIsDisplayed().performClick()
        compose.onNodeWithTag("files-arrangement-dialog").assertExists()
        compose.onNodeWithTag("files-arrange-sort-size").performClick()
        compose.onNodeWithTag("files-arrange-direction").performClick()
        compose.onNodeWithTag("files-arrange-folders-first").performClick()
        compose.onNodeWithTag("files-arrange-apply").assertIsEnabled().performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            !controller.state.value.loading &&
                controller.state.value.filesArrangement ==
                    FileBrowseArrangement("size", "desc", false)
        }
        compose.onNodeWithTag("files-item-70").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(
                listOf(FileBrowseArrangement("size", "desc", false)), filesSortQueries)
        }
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("files-arrangement-open").performClick()
        compose.onNodeWithTag("files-arrangement-dialog").assertExists()
        compose.onNodeWithTag("files-arrange-apply").assertIsNotEnabled()
        compose.onNodeWithText("取消").performClick()
    }

    @Test fun nativeFilesGroupIndexRendersCanonicalHeadersInListAndGrid() {
        filesSortFixture = true
        extraRootFile = true
        startAndLogin()
        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithTag("files-arrangement-open").performClick()
        compose.onNodeWithTag("files-arrange-group-type")
            .performScrollTo().performClick()
        compose.onNodeWithTag("files-arrange-apply").performClick()
        compose.waitUntil(timeoutMillis = 10_000) {
            controller.state.value.filesArrangement.group == "type" &&
                controller.state.value.filesGroups.size == 2 &&
                !controller.state.value.loading
        }
        compose.onNodeWithTag("files-group-folder").assertExists()
        compose.onNodeWithTag("files-group-ext:txt").assertExists()
        compose.onNodeWithTag("files-item-2").assertExists()
        compose.onNodeWithTag("files-item-70").assertExists()

        compose.onNodeWithContentDescription("账户菜单").performClick()
        compose.onNodeWithText("图标").performClick()
        compose.onNodeWithTag("files-grid").assertExists()
        compose.onNodeWithTag("files-group-folder").assertExists()
        compose.onNodeWithTag("files-group-ext:txt").assertExists()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(
                listOf(FileBrowseArrangement(group = "type")), filesSortQueries)
        }
    }

}
