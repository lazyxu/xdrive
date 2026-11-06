package com.tfluid.xdrive.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

fun validPhotoContentKey(value: String): Boolean =
    Regex("(?:sha256:|photo-bundle:v1:sha256:)[a-f0-9]{64}").matches(value)

/** Never downgrade a known original identity to a mutable file locator. */
internal fun galleryContentSelection(items: List<GalleryAsset>): Pair<String, JsonElement> {
    require(items.isNotEmpty() && items.size <= 200)
    if (items.all { it.contentKey == null }) {
        return "node_ids" to JsonArray(items.map { JsonPrimitive(it.node.id) })
    }
    require(items.all { it.contentKey?.let(::validPhotoContentKey) == true }) {
        "Some photo originals are still being verified"
    }
    require(items.map { it.contentKey }.toSet().size == items.size)
    return "content_keys" to JsonArray(items.map { JsonPrimitive(it.contentKey!!) })
}

data class GalleryPerson(val id: String, val name: String, val itemCount: Long,
    val suggested: Boolean) {
    val title: String get() = if (suggested) "人物建议" else name.ifBlank { "未命名人物" }
}

fun validGalleryPersonId(id: String, suggested: Boolean): Boolean =
    if (suggested) Regex("auto:v1:[a-f0-9]{64}").matches(id)
    else Regex("person:v1:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}").matches(id)
