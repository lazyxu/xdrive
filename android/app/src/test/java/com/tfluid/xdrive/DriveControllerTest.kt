package com.tfluid.xdrive

import com.tfluid.xdrive.core.*
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
        var mutationRows = listOf(folder, file)
        var mutationListing = false
        val mutationCalls = mutableListOf<String>()
        var mutationFailure: Exception? = null
        var refreshAfterCommitFailure = false
        var createHandler: suspend (Long, String) -> DriveNode = { parent, name ->
            DriveNode(8, parent, name, "dir", revision = 1)
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
        // Collection breadcrumbs contain stable directory IDs/names, not a
        // revisioned Node snapshot. Never assert a fabricated revision=0
        // against the writable fixture's revision=1.
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
