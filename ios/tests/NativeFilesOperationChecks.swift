import Foundation

@main
struct XDriveIOSNativeFilesOperationChecks {
    static func require(_ ok: @autoclosure () -> Bool, _ label: String) {
        if !ok() {
            fputs("native Files Undo/Redo failed: \(label)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesOperationPolicy
        let originalID = "150b8a04-ed13-4926-92f1-8223b3da88de"
        let undoID = "1f9d2741-c6d8-4e16-a8f8-a2b311d286a5"
        let redoID = "7657952d-644e-4ccc-8b0e-ea9a33fb4e34"
        func row(_ id: String, type: String, status: String,
                 undoOf: String? = nil, redoOf: String? = nil,
                 undoable: Bool = false, redoable: Bool = false,
                 undoneBy: String? = nil, redoneBy: String? = nil)
            -> XDriveIOSNativeFilesOperation {
            XDriveIOSNativeFilesOperation(
                id: id, type: type, status: status,
                undo_of_id: undoOf, undone_by_id: undoneBy,
                redo_of_id: redoOf, redone_by_id: redoneBy,
                undoable: undoable, redoable: redoable,
                total_items: 2, processed_items: status == "completed" ? 2 : 0,
                created_at: "2026-11-06T00:00:00Z",
                updated_at: "2026-11-06T00:01:00Z"
            )
        }
        let copy = row(originalID, type: "copy", status: "completed", undoable: true)
        let queuedUndo = row(undoID, type: "undo", status: "queued",
                             undoOf: originalID)
        let finishedUndo = row(undoID, type: "undo", status: "completed",
                               undoOf: originalID, redoable: true)
        let queuedRedo = row(redoID, type: "redo", status: "queued",
                             redoOf: undoID)
        require(P.valid(copy), "valid Server completed operation")
        require(P.valid(queuedUndo), "valid queued undo lineage")
        require(P.validHistory([copy, finishedUndo]), "bounded history")
        require(P.canPerform(.undo, for: copy), "server-advertised undo only")
        require(!P.canPerform(.redo, for: copy), "cannot redo original copy")
        require(!P.canPerform(.undo, for: queuedUndo),
                "never undo a queued operation")
        require(P.canPerform(.redo, for: finishedUndo),
                "redo only a completed undo with a Server plan")
        require(P.accepted(queuedUndo, action: .undo, original: copy),
                "202 queued undo with verified original lineage")
        require(P.accepted(queuedRedo, action: .redo, original: finishedUndo),
                "202 queued redo of completed undo")
        require(!P.accepted(queuedRedo, action: .undo, original: copy),
                "wrong action never counts as acknowledged undo")
        require(!P.accepted(finishedUndo, action: .undo, original: copy),
                "HTTP 202 is not a completion receipt")
        require(!P.canPerform(.undo, for: row(
            originalID, type: "move", status: "running", undoable: true
        )), "running operation cannot be undone")
        require(!P.canPerform(.undo, for: row(
            originalID, type: "delete", status: "completed", undoable: true,
            undoneBy: undoID
        )), "lineage already undone cannot be replayed")
        require(!P.canPerform(.redo, for: row(
            undoID, type: "undo", status: "completed", redoable: true,
            redoneBy: redoID
        )), "lineage already redone cannot be replayed")
        require(!P.validHistory([copy, copy]), "reject duplicate operation IDs")
        require(!P.validHistory(Array(repeating: copy, count: 51)),
                "reject unbounded Server response")
        require(P.statusLabel("queued") == "排队中",
                "queued must not be displayed as complete")
        require(P.statusLabel("completed") == "已完成",
                "only terminal completion displays success")
        let payload = Data(("""
            {"id":"\(originalID)","type":"copy","status":"completed",
            "undoable":true,"redoable":false,"total_items":2,
            "processed_items":2,"created_at":"2026-11-06T00:00:00Z",
            "updated_at":"2026-11-06T00:01:00Z"}
            """).utf8)
        let decoded = try? JSONDecoder().decode(
            XDriveIOSNativeFilesOperation.self, from: payload
        )
        require(decoded == copy, "compatible with actual Go FileOperationDTO JSON")
        print("native Files queued Undo/Redo policy passed")
    }
}
