# xDrive Photo Intelligence Analyzer — third-party components

The reference analyzer is optional and separate from the CGO-free xDrive Server.

## OpenCV Zoo model provenance

The image build downloads the following model files from OpenCV Zoo commit
`47534e27c9851bb1128ccc0102f1145e27f23f98` and verifies their SHA-256
identities before the image can be built.

| Component | File | SHA-256 | License |
| --- | --- | --- | --- |
| YuNet | `face_detection_yunet_2023mar.onnx` | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` | MIT |
| SFace | `face_recognition_sface_2021dec.onnx` | `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79` | Apache-2.0 |
| MobileNetV2 | `image_classification_mobilenetv2_2022apr.onnx` | `c0c3f76d93fa3fd6580652a45618618a220fced18babf65774ed169de0432ad5` | Apache-2.0 |
| PP-OCRv3 CN detector | `text_detection_cn_ppocrv3_2023may.onnx` | `03f550c6b406fda8bf54bd8327815f6c7e2edd98cea02348c93d879254366587` | Apache-2.0 |
| CRNN CN recognizer | `text_recognition_CRNN_CN_2021nov.onnx` | `c760bf82d684b87dfabb288e6c0f92d41a8cd6c1780661ca2c3cd10c2065a9ba` | Apache-2.0 |

The corresponding upstream license texts are downloaded from the same pinned
commit into `/licenses`. ImageNet labels and the CRNN CN charset are extracted
at image-build time from the pinned OpenCV Zoo source files; xDrive does not
fetch labels or dictionaries at runtime.

## SigLIP 2 semantic-search provenance

Semantic search uses the Apache-2.0 Google SigLIP 2 Base Patch16 224 model in a
shared multilingual image/text embedding space. The runtime pins the separate
int8 ONNX towers from
`onnx-community/siglip2-base-patch16-224-ONNX` commit
`ba1f3b0843f24bc5417d38e19c37b287d719b2f4` and the Google tokenizer from
commit `997aaec`.

| Component | File | SHA-256 | License |
| --- | --- | --- | --- |
| SigLIP2 vision int8 | `siglip2_vision_int8.onnx` | `0dd31785a2713f1113ef2272472165c69d580473dae38d7b47568ac587795e70` | Apache-2.0 |
| SigLIP2 text int8 | `siglip2_text_int8.onnx` | `3a0603d3a00c05a80a6ded4743c16aaac7b1e62cdcc7e362e7ce418659b96400` | Apache-2.0 |
| SigLIP2 tokenizer | `siglip2_tokenizer.json` | `cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322` | Apache-2.0 |

The image build verifies all three files before publication. The analyzer has no
runtime network dependency.

Sources:

- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/image_classification_mobilenet
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/text_detection_ppocr
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/text_recognition_crnn
- https://huggingface.co/google/siglip2-base-patch16-224
- https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX

## Runtime packages

The image pins:

- `opencv-python-headless==4.14.0.94`
- `numpy==2.5.3`
- `onnxruntime==1.30.0`
- `tokenizers==0.23.2`

The headless OpenCV package is used because the analyzer has no GUI/display
dependency. ONNX Runtime is CPU-only in the reference path. The reference image also
installs Debian FFmpeg for local slideshow/movie encoding; the runtime uses its H.264
encoder only inside the optional Photo Intelligence sidecar and never adds FFmpeg to
the CGO-free xDrive Server.

## Processing contract

The reference face pipeline is CPU-only:

1. YuNet detection: confidence 0.9, NMS 0.3, top-K 5000.
2. SFace alignment with the five YuNet landmarks via `alignCrop`.
3. SFace 128-dimensional feature extraction.
4. L2 normalization.
5. little-endian float32 serialization.

The lexical Smart Search pipeline is CPU-only:

1. MobileNetV2 provides a bounded top-5 ImageNet visual-label vocabulary.
2. PP-OCRv3 CN detects scene-text regions on the xDrive analysis preview.
3. CRNN CN recognizes Chinese, Latin letters, digits, and its pinned symbol set.
4. xDrive stores only rebuildable labels/OCR text.

The semantic Smart Search pipeline is CPU-only:

1. SigLIP2 vision consumes the canonical xDrive analysis preview normalized to
   RGB 224×224 with rescale 1/255 and mean/std 0.5.
2. SigLIP2 text uses the pinned multilingual tokenizer, max 64 tokens and
   `</s>` padding.
3. Both towers emit the same 768-dimensional space.
4. xDrive L2-normalizes and deterministically quantizes each vector to signed
   int8 `i8norm-v1`; PostgreSQL stores only rebuildable derived bytes.
5. Server search ranks only current-version `ready` embeddings. User-authored
   tags, descriptions, people, favorites, albums and originals remain
   authoritative and are never mutated by semantic search.

Any change to these semantics changes the relevant analyzer
`pipeline_version`/model version token, so xDrive invalidates and rebuilds
derived intelligence rather than mixing incompatible generations.


## Gallery creative model provenance

The creative runtime pins OpenCV Zoo EfficientSAM-Ti from commit
`47534e27c9851bb1128ccc0102f1145e27f23f98`.

| Component | File | SHA-256 | License |
| --- | --- | --- | --- |
| EfficientSAM-Ti int8 | `image_segmentation_efficientsam_ti_2025april_int8.onnx` | `5ecc8d59a2802c32246e68553e1cf8ce74cf74ba707b84f206eb9181ff774b4e` | Apache-2.0 |

Source:
- https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/image_segmentation_efficientsam

## Gallery creative processing contract

The first creative-tools generation is CPU-only and fully local to the optional
Photo Intelligence analyzer:

1. EfficientSAM-Ti expands normalized foreground/background point prompts into
   an object mask for Cutout.
2. Smart Erase converts user brush strokes into a bounded seed mask and samples
   foreground prompts for EfficientSAM. The segmented object mask is accepted
   only when it covers at most 65% of the image; otherwise the explicit brush
   mask remains authoritative.
3. OpenCV Telea inpainting fills the accepted erase mask. No remote inference
   service is contacted and no source photo is modified in place.
4. Cutout emits a transparent PNG. Erase emits a PNG. xDrive stores each
   completed result as a new canonical file next to the source while retaining
   a durable generation record and Task Center history.
5. The Server sends only a revision/SHA/version-fenced 2048px creative working
   preview to the local analyzer. The preview is a regenerable cache and can be
   deleted through the existing analysis-preview cleanup class.

Any change to segmentation prompts, erase-mask admission, inpainting semantics,
or the pinned model changes the creative pipeline version so incompatible
generations are never reported as the same analyzer build.
