import Foundation

@main enum NativeCloudOCRPolicyChecks {
    static func main() throws {
        func decode(_ json: String) throws -> XDriveIOSNativeOCRResult {
            try JSONDecoder().decode(XDriveIOSNativeOCRResult.self, from: Data(json.utf8))
        }
        let text = try decode(#"{"state":"ready","text":"中文测试 XDRIVE 2026"}"#)
        precondition(text.text == "中文测试 XDRIVE 2026")
        precondition(text.message == "识别完成")
        let empty = try decode(#"{"state":"ready"}"#)
        precondition(empty.message == "已识别，未检测到文字")
        for json in [
            #"{"state":"failed","text":"private"}"#,
            #"{"state":"stale","text":"private"}"#,
            #"{"state":"unknown"}"#,
            #"{"state":"ready","text":42}"#,
            "{\"state\":\"ready\",\"text\":\"" + String(repeating: "字", count: 8193) + "\"}",
        ] {
            do { _ = try decode(json); preconditionFailure("accepted invalid OCR") }
            catch is DecodingError { }
        }
        let error = try decode(#"{"state":"failed","reason":"private_model_exception"}"#)
        precondition(error.message == "识别失败")
        let target = XDriveIOSNativeOCRTarget(id: 7, revision: 3, name: "photo.jpg", size: 42)
        let detail = #"{"node":{"id":7,"revision":3,"name":"photo.jpg","size":42,"type":"file"},"ocr":{"state":"ready","text":"中文 XDRIVE"}}"#
        let current = try XDriveIOSNativeOCRPolicy.detail(Data(detail.utf8), target: target)
        precondition(current?.text == "中文 XDRIVE")
        for (old, replacement) in [
            (#""id":7"#, #""id":8"#),
            (#""revision":3"#, #""revision":4"#),
            (#""size":42"#, #""size":43"#),
            (#""name":"photo.jpg""#, #""name":"other.jpg""#),
            (#""type":"file""#, #""type":"dir""#),
        ] {
            do {
                _ = try XDriveIOSNativeOCRPolicy.detail(
                    Data(detail.replacingOccurrences(of: old, with: replacement).utf8), target: target)
                preconditionFailure("accepted wrong media identity")
            } catch XDriveIOSNativeOCRFailure.invalidDetail { }
        }
        try XDriveIOSNativeOCRPolicy.acceptReanalysis(
            Data(#"{"owner_id":11,"accepted":["smart_search"]}"#.utf8), ownerID: 11)
        for receipt in [
            #"{"owner_id":12,"accepted":["smart_search"]}"#,
            #"{"owner_id":11,"accepted":[]}"#,
            #"{"owner_id":11,"accepted":["faces"]}"#,
            #"{"owner_id":11,"accepted":["smart_search","smart_search"]}"#,
        ] {
            do {
                try XDriveIOSNativeOCRPolicy.acceptReanalysis(Data(receipt.utf8), ownerID: 11)
                preconditionFailure("accepted wrong queue receipt")
            } catch XDriveIOSNativeOCRFailure.invalidReceipt { }
        }
        print("Native cloud OCR decoding and stale-result guards passed")
    }
}
