package com.tfluid.xdrive.core

/** A current Owner's Node location is an ordered ROOT-to-PARENT chain.
 * The last crumb is the immediate parent, NOT the Owner root for nested nodes.
 * Files/Node ACL is always enforced by the original Owner-authenticated API.
 */
object XDriveClipboardFileLocationPolicy {
    fun accepts(selected: DriveNode, located: OwnedNodeLocation, rootID: Long): Boolean {
        val parentID = selected.parentId ?: return false
        if (rootID <= 0 || selected.id <= 0 || parentID <= 0 ||
            selected.id == rootID || selected.type !in setOf("file", "dir") ||
            selected.name.isBlank() || selected.size < 0 || selected.revision <= 0 ||
            located.nodeId != selected.id || located.parentId != parentID ||
            located.revision != selected.revision) return false
        val ancestors = located.parentDirectories
        // Both ends of the path must agree; intermediate ancestors can exist.
        return ancestors.isNotEmpty() &&
            ancestors.first().id == rootID && ancestors.first().name.isEmpty() &&
            ancestors.last().id == parentID &&
            ancestors.all { it.id > 0 } &&
            ancestors.map { it.id }.toSet().size == ancestors.size &&
            ancestors.none { it.id == selected.id }
    }
}
