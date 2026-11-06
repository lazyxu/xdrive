# OCR fixture

`ocr-zh-en.jpg` contains four artificial lines: `中文识别`, `测试照片`,
`XDRIVE`, `SEARCH 2026`. It contains no user photograph or personal data.
The 1024×800 white canvas was rendered with Pillow, Microsoft YaHei at 82px,
black text at `(55, 55 + line * 180)`, then encoded as JPEG at quality 95.
Only rendered pixels are included; no font file is distributed.

Both the real Python analyzer test and Go/PostgreSQL/private-socket integration
consume these exact bytes and assert known Chinese and English text, rather
than treating any nonempty OCR output as an accuracy pass.
