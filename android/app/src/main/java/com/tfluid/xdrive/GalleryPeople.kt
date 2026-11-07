package com.tfluid.xdrive

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/** One bounded page; no private person names survive a Controller Owner reset. */
@Composable
internal fun ColumnScope.GalleryPeople(state: DriveState, controller: DriveController) {
    var confirm by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(12.dp)) {
        Text("人物", style = MaterialTheme.typography.headlineSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = state.galleryPeopleSuggested,
                onClick = { controller.openGalleryPeople(true) }, label = { Text("人物建议") },
                enabled = !state.loading)
            FilterChip(selected = !state.galleryPeopleSuggested,
                onClick = { controller.openGalleryPeople(false) }, label = { Text("已确认人物") },
                enabled = !state.loading)
        }
        Text("自动分组仅供参考。相同原件的文件副本只计为一张照片。",
            style = MaterialTheme.typography.bodySmall)
        Row {
            TextButton(onClick = { controller.openGalleryPeople(state.galleryPeopleSuggested,
                state.galleryPeopleOffset) }, enabled = !state.loading) { Text("刷新人物") }
            TextButton(onClick = { confirm = true },
                enabled = !state.loading && !state.galleryFaceRequestAttempted) { Text("重新检测人脸") }
        }
        if (state.galleryFaceRequestAttempted) Text(
            if (state.galleryFaceRequestAccepted) "已提交后台检测，完成后刷新人物。"
            else "检测请求尚未确认，请查看后台任务，避免重复提交。",
            style = MaterialTheme.typography.bodySmall)
        if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (state.error != null) {
            Text("无法读取人物，请检查连接或模型配置。", color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { controller.openGalleryPeople(state.galleryPeopleSuggested,
                state.galleryPeopleOffset) }, enabled = !state.loading) { Text("重试") }
        }
        if (state.galleryPeopleLoaded && state.galleryPeople.isEmpty()) Text("当前没有可显示的人物")
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false },
        title = { Text("重新检测当前账户的人脸？") },
        text = { Text("将重新分析当前账户全部云端照片并更新自动人物建议；已确认人物保留。") },
        confirmButton = { TextButton(onClick = { confirm = false; controller.reanalyzeGalleryFaces() }) { Text("开始检测") } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("取消") } })
    LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("gallery-people-list")) {
        items(state.galleryPeople, key = { it.id }) { person ->
            TextButton(onClick = { controller.openGalleryPerson(person) },
                enabled = !state.loading, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
                    .testTag("gallery-person-${person.id}")) {
                Text(person.title, Modifier.weight(1f))
                Text("${person.itemCount} 张照片")
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = controller::openGalleryLibrary, enabled = !state.loading) { Text("返回图库") }
        TextButton(onClick = { controller.openGalleryPeople(state.galleryPeopleSuggested,
            (state.galleryPeopleOffset - 24).coerceAtLeast(0)) },
            enabled = !state.loading && state.galleryPeopleOffset > 0) { Text("上一页") }
        TextButton(onClick = { controller.openGalleryPeople(state.galleryPeopleSuggested,
            state.galleryPeopleOffset + 24) }, enabled = !state.loading && state.galleryPeople.size == 24) {
            Text("下一页")
        }
    }
}
