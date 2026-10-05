FROM python:3.12-slim-bookworm AS base

ARG VERSION=dev
ARG BUILD_COMMIT=

LABEL org.opencontainers.image.source="https://github.com/lazyxu/xdrive" \
      org.opencontainers.image.description="xDrive Photo Intelligence reference face analyzer" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$BUILD_COMMIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    XD_FACE_YUNET_MODEL=/models/face_detection_yunet_2023mar.onnx \
    XD_FACE_SFACE_MODEL=/models/face_recognition_sface_2021dec.onnx \
    XD_FACE_SOCKET=/run/xdrive-photo-face/photo-face.sock

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir -r /app/requirements.txt

COPY fetch_models.py /app/fetch_models.py
RUN python /app/fetch_models.py /models /licenses \
    && chmod -R a=rX /models /licenses

COPY analyzer.py /app/analyzer.py
COPY THIRD_PARTY.md /licenses/XDRIVE_PHOTO_FACE_THIRD_PARTY.md

FROM base AS test
COPY tests /app/tests
RUN python -m unittest discover -s /app/tests -v
RUN python /app/analyzer.py --self-test
RUN python /app/analyzer.py --benchmark --iterations 1

FROM base AS final
RUN mkdir -p /run/xdrive-photo-face \
    && chown 65532:65532 /run/xdrive-photo-face \
    && chmod 0770 /run/xdrive-photo-face
USER 65532:65532

ENTRYPOINT ["python", "/app/analyzer.py"]
