# xDrive Photo Face Analyzer — third-party components

The reference analyzer is optional and separate from the CGO-free xDrive Server.

## OpenCV Zoo model provenance

The image build downloads the two model files from OpenCV Zoo commit
`47534e27c9851bb1128ccc0102f1145e27f23f98` and verifies their Git LFS
SHA-256 object IDs before the image can be built.

| Component | File | SHA-256 | License |
| --- | --- | --- | --- |
| YuNet | `face_detection_yunet_2023mar.onnx` | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` | MIT |
| SFace | `face_recognition_sface_2021dec.onnx` | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` | Apache-2.0 |

The full upstream YuNet and SFace license texts are downloaded from the same
pinned OpenCV Zoo commit into `/licenses/YUNET_LICENSE.txt` and
`/licenses/SFACE_LICENSE.txt` during the image build.

Sources:

- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface

## Runtime packages

The image pins:

- `opencv-python-headless==4.14.0.94`
- `numpy==2.5.3`

The OpenCV Python wheel includes its own license and third-party notices in the
installed Python distribution. The headless package is used because the
analyzer has no GUI/display dependency.

## Processing contract

The reference pipeline is CPU-only in this release:

1. YuNet detection: confidence 0.9, NMS 0.3, top-K 5000.
2. SFace alignment with the five YuNet landmarks via `alignCrop`.
3. SFace 128-dimensional feature extraction.
4. L2 normalization.
5. little-endian float32 serialization.

Any change to these semantics must change the analyzer `pipeline_version`, so
xDrive invalidates and rebuilds derived embeddings rather than comparing
vectors produced by incompatible preprocessing.
