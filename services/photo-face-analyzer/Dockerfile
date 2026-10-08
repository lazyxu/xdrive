FROM python:3.12-slim-bookworm AS runtime

LABEL org.opencontainers.image.source="https://github.com/lazyxu/xdrive" \
      org.opencontainers.image.description="xDrive Photo Intelligence test/runtime dependencies"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    XD_FACE_YUNET_MODEL=/models/face_detection_yunet_2023mar.onnx \
    XD_FACE_SFACE_MODEL=/models/face_recognition_sface_2021dec.onnx \
    XD_SMART_CLASSIFIER_MODEL=/models/image_classification_mobilenetv2_2022apr.onnx \
    XD_SMART_OCR_DETECTOR_MODEL=/models/text_detection_cn_ppocrv3_2023may.onnx \
    XD_SMART_OCR_RECOGNIZER_MODEL=/models/text_recognition_CRNN_CN_2021nov.onnx \
    XD_SMART_IMAGENET_LABELS=/models/imagenet1k_labels.txt \
    XD_SMART_OCR_CHARSET=/models/crnn_cn_charset.txt \
    XD_CREATIVE_SEGMENTER_MODEL=/models/image_segmentation_efficientsam_ti_2025april_int8.onnx \
    XD_SEMANTIC_VISION_MODEL=/models/siglip2_vision_int8.onnx \
    XD_SEMANTIC_TEXT_MODEL=/models/siglip2_text_int8.onnx \
    XD_SEMANTIC_TOKENIZER=/models/siglip2_tokenizer.json \
    XD_FACE_SOCKET=/run/xdrive-photo-face/photo-face.sock

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/xdrive-photo-face-runtime
COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY fetch_models.py ./fetch_models.py
RUN python fetch_models.py /models /licenses \
    && chmod -R a=rX /models /licenses \
    && cd / \
    && rm -rf /opt/xdrive-photo-face-runtime

WORKDIR /workspace

FROM runtime AS final

ARG VERSION=dev
ARG BUILD_COMMIT=

LABEL org.opencontainers.image.source="https://github.com/lazyxu/xdrive" \
      org.opencontainers.image.description="xDrive Photo Intelligence reference analyzer" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$BUILD_COMMIT"

WORKDIR /app
COPY analyzer.py /app/analyzer.py
COPY creative.py /app/creative.py
COPY THIRD_PARTY.md /licenses/XDRIVE_PHOTO_FACE_THIRD_PARTY.md

RUN mkdir -p /run/xdrive-photo-face \
    && chown 65532:65532 /run/xdrive-photo-face \
    && chmod 0770 /run/xdrive-photo-face
USER 65532:65532

ENTRYPOINT ["python", "/app/analyzer.py"]
