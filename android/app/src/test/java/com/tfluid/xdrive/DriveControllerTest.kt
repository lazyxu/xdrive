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
    private val root = DriveNode(1, name = "", type = "dir")
    private val folder = DriveNode(2, 1, "照片", "dir", revision = 1)
    private val file = DriveNode(3, 1, "readme.txt", "file", 42, revision = 1)

    private open inner class Service : XDriveService {
        val calls = mutableListOf<Pair<Long, Int>>()
        var required = false
        var failure: Exception? = null
        var refreshed = 0
        var refreshFailure: Exception? = null
        var loggedOut = false
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

    @Test fun changingFolderCancelsInFlightExportAndClearsDownloadChrome() = runTest {
        val api = Service().apply { downloadGate = CompletableDeferred() }
        val c = controller(this, api)
        c.login("owner", "password"); runCurrent()
        assertTrue(c.prepareFileExport(file))
        var discarded = 0
        val output = ByteArrayOutputStream()
        c.saveFileExport({ output }, { discarded++ }); runCurrent()
        assertTrue(c.state.value.fileDownloadActive)
        assertEquals(3L, c.state.value.fileDownloadBytes)
        c.open(folder); runCurrent() // New Owner navigation cancels the pending file transfer.
        assertEquals(1, api.downloadReads)
        assertEquals(1, discarded)
        assertEquals(2L, c.state.value.path.last().id)
        assertFalse(c.state.value.fileDownloadActive)
        assertFalse(c.state.value.fileDownloadSaved)
        assertEquals(0L, c.state.value.fileDownloadBytes)
        assertEquals(null, c.state.value.fileExportPending)
        assertTrue(output.size() < 5)
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
}
