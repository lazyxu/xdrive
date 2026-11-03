package com.tfluid.xdrive

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeNotesNavigationTest {
    @Test fun notesFromAllUsesDynamicSlotAndNeverChangesFiveFixedTabs() {
        val initial = NativeHomeNavigation()
        assertEquals(listOf("全部", "最近", "图库", "文件", "我的"), initial.labels)
        val opened = initial.open(NativeHomeShortcut.NOTES)
        assertEquals(NativeHomeTab.DYNAMIC, opened.selected)
        assertEquals(NativeDynamicFeature.NOTES, opened.dynamicFeature)
        assertEquals(listOf("全部", "备忘录", "图库", "文件", "我的"), opened.labels)
        assertEquals(NativeHomeTab.GALLERY, opened.select(NativeHomeTab.GALLERY).selected)
        assertEquals(NativeDynamicFeature.NOTES,
            opened.select(NativeHomeTab.GALLERY).dynamicFeature)
        assertEquals(listOf(NativeHomeShortcut.NOTES), opened.recentShortcuts)
        val restricted = opened.restrictTo(emptySet())
        assertEquals(null, restricted.dynamicFeature)
        assertEquals(NativeHomeTab.ALL, restricted.selected)
    }

    @Test fun onlyPersonalMarkdownNotesCanBeEditedInNativeUI() {
        val mine = com.tfluid.xdrive.core.OwnerNoteRow(
            "12345678-1234-1234-1234-123456789abc", "mine", "标题", 11, 2,
            "a".repeat(64), 10, "2026-11-03T00:00:00Z")
        assertTrue(mine.writable)
        assertFalse(mine.copy(source = "ios_notes").writable)
        assertEquals(NativeHomeTab.DYNAMIC, NativeHomeNavigation()
            .openDynamic(NativeDynamicFeature.NOTES).selected)
    }
}
