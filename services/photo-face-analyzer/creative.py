from __future__ import annotations

import hashlib
import os
from pathlib import Path
import threading
from typing import Any

import cv2 as cv
import numpy as np

CREATIVE_PROTOCOL_VERSION = 1
CREATIVE_ANALYZER_NAME = "xdrive-opencv-efficientsam"
CREATIVE_MODEL_NAME = "image_segmentation_efficientsam_ti_2025april_int8.onnx"
CREATIVE_MODEL_VERSION = "2025april-int8"
CREATIVE_MODEL_SHA256 = "5ecc8d59a2802c32246e68553e1cf8ce74cf74ba707b84f206eb9181ff774b4e"
CREATIVE_MODEL_LICENSE = "Apache-2.0"
CREATIVE_MODEL_LICENSE_URL = (
    "https://github.com/opencv/opencv_zoo/tree/"
    "47534e27c9851bb1128ccc0102f1145e27f23f98/"
    "models/image_segmentation_efficientsam"
)
CREATIVE_INPUT_SIZE = 1024
CREATIVE_MAX_PROMPT_POINTS = 6
CREATIVE_MAX_STROKES = 64
CREATIVE_MAX_STROKE_POINTS = 256
CREATIVE_OUTPUT_MIME = "image/png"
CREATIVE_PIPELINE_VERSION = (
    f"opencv-{cv.__version__}-cpu-efficientsam-ti-2025april-int8"
    "-1024-prompt-mask-cutout-telea-erase-v1"
)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class CreativeRuntime:
    def __init__(self, model_path: str | None = None) -> None:
        self.model_path = Path(
            model_path
            or os.environ.get(
                "XD_CREATIVE_SEGMENTER_MODEL",
                f"/models/{CREATIVE_MODEL_NAME}",
            )
        )
        if not self.model_path.is_file():
            raise RuntimeError(
                f"required creative model file is missing: {self.model_path.name}"
            )
        actual = _sha256_file(self.model_path)
        if actual != CREATIVE_MODEL_SHA256:
            raise RuntimeError(
                "creative model sha256 mismatch for "
                f"{self.model_path.name}: got {actual}"
            )
        self.model = cv.dnn.readNet(str(self.model_path))
        self.model.setPreferableBackend(cv.dnn.DNN_BACKEND_OPENCV)
        self.model.setPreferableTarget(cv.dnn.DNN_TARGET_CPU)
        self.input_names = [
            "batched_images",
            "batched_point_coords",
            "batched_point_labels",
        ]
        self.output_names = ["output_masks", "iou_predictions"]
        self.lock = threading.Lock()

    def info(self) -> dict[str, Any]:
        return {
            "protocol_version": CREATIVE_PROTOCOL_VERSION,
            "name": CREATIVE_ANALYZER_NAME,
            "pipeline_version": CREATIVE_PIPELINE_VERSION,
            "segment_model": {
                "name": "EfficientSAM-Ti",
                "version": CREATIVE_MODEL_VERSION,
                "sha256": CREATIVE_MODEL_SHA256,
                "license": CREATIVE_MODEL_LICENSE,
                "license_url": CREATIVE_MODEL_LICENSE_URL,
            },
            "capabilities": ["cutout", "erase"],
            "runtime": {
                "framework": "opencv_dnn",
                "version": cv.__version__,
                "device": "cpu",
            },
        }

    @staticmethod
    def validate_points(points: Any) -> list[dict[str, Any]]:
        if not isinstance(points, list):
            raise ValueError("creative points must be an array")
        if len(points) < 1 or len(points) > CREATIVE_MAX_PROMPT_POINTS:
            raise ValueError(
                "creative points must contain between 1 and "
                f"{CREATIVE_MAX_PROMPT_POINTS} entries"
            )
        out: list[dict[str, Any]] = []
        has_foreground = False
        for raw in points:
            if not isinstance(raw, dict) or set(raw) != {"x", "y", "foreground"}:
                raise ValueError("creative point fields are invalid")
            x = raw.get("x")
            y = raw.get("y")
            foreground = raw.get("foreground")
            if (
                isinstance(x, bool)
                or isinstance(y, bool)
                or not isinstance(x, (int, float))
                or not isinstance(y, (int, float))
                or not isinstance(foreground, bool)
            ):
                raise ValueError("creative point values are invalid")
            x = float(x)
            y = float(y)
            if not np.isfinite(x) or not np.isfinite(y) or x < 0 or x > 1 or y < 0 or y > 1:
                raise ValueError("creative point is outside normalized bounds")
            has_foreground = has_foreground or foreground
            out.append({"x": x, "y": y, "foreground": foreground})
        if not has_foreground:
            raise ValueError("creative cutout requires a foreground point")
        return out

    @staticmethod
    def validate_strokes(strokes: Any) -> list[dict[str, Any]]:
        if not isinstance(strokes, list):
            raise ValueError("creative strokes must be an array")
        if len(strokes) < 1 or len(strokes) > CREATIVE_MAX_STROKES:
            raise ValueError(
                "creative strokes must contain between 1 and "
                f"{CREATIVE_MAX_STROKES} entries"
            )
        out: list[dict[str, Any]] = []
        for raw in strokes:
            if not isinstance(raw, dict) or set(raw) != {"radius", "points"}:
                raise ValueError("creative stroke fields are invalid")
            radius = raw.get("radius")
            points = raw.get("points")
            if (
                isinstance(radius, bool)
                or not isinstance(radius, (int, float))
                or not np.isfinite(float(radius))
                or float(radius) < 0.002
                or float(radius) > 0.15
                or not isinstance(points, list)
                or len(points) < 1
                or len(points) > CREATIVE_MAX_STROKE_POINTS
            ):
                raise ValueError("creative erase stroke is invalid")
            normalized_points: list[dict[str, float]] = []
            for point in points:
                if not isinstance(point, dict) or set(point) != {"x", "y"}:
                    raise ValueError("creative erase stroke point fields are invalid")
                x = point.get("x")
                y = point.get("y")
                if (
                    isinstance(x, bool)
                    or isinstance(y, bool)
                    or not isinstance(x, (int, float))
                    or not isinstance(y, (int, float))
                ):
                    raise ValueError("creative erase stroke point values are invalid")
                x = float(x)
                y = float(y)
                if not np.isfinite(x) or not np.isfinite(y) or x < 0 or x > 1 or y < 0 or y > 1:
                    raise ValueError("creative erase stroke point is outside normalized bounds")
                normalized_points.append({"x": x, "y": y})
            out.append({"radius": float(radius), "points": normalized_points})
        return out

    @staticmethod
    def _preprocess(
        image: np.ndarray,
        points: list[dict[str, Any]],
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[tuple[int, int]]]:
        height, width = image.shape[:2]
        rgb = cv.cvtColor(image, cv.COLOR_BGR2RGB)
        resized = cv.resize(
            rgb,
            (CREATIVE_INPUT_SIZE, CREATIVE_INPUT_SIZE),
            interpolation=cv.INTER_LINEAR,
        )
        image_blob = cv.dnn.blobFromImage(
            resized.astype(np.float32, copy=False) / 255.0
        )
        coords = np.zeros((CREATIVE_MAX_PROMPT_POINTS, 2), dtype=np.float32)
        labels = np.full((CREATIVE_MAX_PROMPT_POINTS, 1), -1, dtype=np.float32)
        background: list[tuple[int, int]] = []
        for index, point in enumerate(points):
            px = min(width - 1, max(0, int(round(point["x"] * (width - 1)))))
            py = min(height - 1, max(0, int(round(point["y"] * (height - 1)))))
            coords[index] = [
                float(px) * CREATIVE_INPUT_SIZE / width,
                float(py) * CREATIVE_INPUT_SIZE / height,
            ]
            labels[index, 0] = 1.0 if point["foreground"] else 0.0
            if not point["foreground"]:
                background.append((px, py))
        return (
            image_blob,
            np.array([[coords]], dtype=np.float32),
            np.array([[labels]], dtype=np.float32),
            background,
        )

    @staticmethod
    def _select_mask(
        output_masks: np.ndarray,
        output_ious: np.ndarray,
        width: int,
        height: int,
        background_points: list[tuple[int, int]],
    ) -> np.ndarray:
        masks = output_masks[0, 0, :, :, :] >= 0
        ious = output_ious[0, 0, :]
        order = np.argsort(ious)[::-1]
        resized: list[np.ndarray] = []
        for index in order:
            mask = (masks[int(index)] * 255).astype(np.uint8)
            resized.append(
                cv.resize(mask, (width, height), interpolation=cv.INTER_NEAREST)
            )
        if not resized:
            raise RuntimeError("EfficientSAM returned no masks")
        for mask in resized:
            if not any(mask[y, x] != 0 for x, y in background_points):
                return mask
        return resized[0]

    def _segment_mask(
        self,
        image: np.ndarray,
        points: list[dict[str, Any]],
    ) -> np.ndarray:
        height, width = image.shape[:2]
        image_blob, points_blob, labels_blob, background = self._preprocess(
            image, points
        )
        with self.lock:
            self.model.setInput(image_blob, self.input_names[0])
            self.model.setInput(points_blob, self.input_names[1])
            self.model.setInput(labels_blob, self.input_names[2])
            output_masks, output_ious = self.model.forward(self.output_names)
        return self._select_mask(
            output_masks, output_ious, width, height, background
        )

    @staticmethod
    def _encode_png(image: np.ndarray) -> tuple[bytes, int, int]:
        height, width = image.shape[:2]
        ok, encoded = cv.imencode(
            ".png",
            image,
            [cv.IMWRITE_PNG_COMPRESSION, 3],
        )
        if not ok:
            raise RuntimeError("creative PNG encoding failed")
        return encoded.tobytes(), width, height

    def cutout(
        self,
        image: np.ndarray,
        points: list[dict[str, Any]],
    ) -> tuple[bytes, int, int]:
        points = self.validate_points(points)
        if image.ndim != 3 or image.shape[2] != 3:
            raise RuntimeError("creative input image dimensions are invalid")
        mask = self._segment_mask(image, points)
        bgra = cv.cvtColor(image, cv.COLOR_BGR2BGRA)
        bgra[:, :, 3] = mask
        return self._encode_png(bgra)

    @staticmethod
    def _stroke_mask(
        image: np.ndarray,
        strokes: list[dict[str, Any]],
    ) -> np.ndarray:
        height, width = image.shape[:2]
        scale = max(1, min(width, height))
        mask = np.zeros((height, width), dtype=np.uint8)
        for stroke in strokes:
            radius = max(1, int(round(stroke["radius"] * scale)))
            pixels = [
                (
                    min(width - 1, max(0, int(round(point["x"] * (width - 1))))),
                    min(height - 1, max(0, int(round(point["y"] * (height - 1))))),
                )
                for point in stroke["points"]
            ]
            for point in pixels:
                cv.circle(mask, point, radius, 255, -1)
            for start, end in zip(pixels, pixels[1:]):
                cv.line(mask, start, end, 255, radius * 2)
        return mask

    @staticmethod
    def _stroke_prompt_points(
        strokes: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        points = [
            {"x": point["x"], "y": point["y"], "foreground": True}
            for stroke in strokes
            for point in stroke["points"]
        ]
        if len(points) <= CREATIVE_MAX_PROMPT_POINTS:
            return points
        indexes = np.linspace(
            0,
            len(points) - 1,
            num=CREATIVE_MAX_PROMPT_POINTS,
            dtype=np.int32,
        )
        return [points[int(index)] for index in indexes]

    def erase(
        self,
        image: np.ndarray,
        strokes: list[dict[str, Any]],
    ) -> tuple[bytes, int, int]:
        strokes = self.validate_strokes(strokes)
        if image.ndim != 3 or image.shape[2] != 3:
            raise RuntimeError("creative input image dimensions are invalid")
        brush_mask = self._stroke_mask(image, strokes)
        prompt_points = self._stroke_prompt_points(strokes)
        segment_mask = self._segment_mask(image, prompt_points)
        coverage = float(np.count_nonzero(segment_mask)) / float(segment_mask.size)
        mask = brush_mask
        if 0.0 < coverage <= 0.65:
            mask = cv.bitwise_or(mask, segment_mask)
        mask = cv.dilate(mask, np.ones((3, 3), dtype=np.uint8), iterations=1)
        radius = max(3.0, min(image.shape[:2]) * 0.01)
        result = cv.inpaint(image, mask, radius, cv.INPAINT_TELEA)
        return self._encode_png(result)

    def generate(
        self,
        image: np.ndarray,
        task: dict[str, Any],
    ) -> tuple[bytes, str, int, int]:
        kind = task.get("kind")
        if kind == "cutout":
            if task.get("cutout_mode") != "object":
                raise ValueError("cutout_mode must be object")
            if task.get("strokes") not in (None, []):
                raise ValueError("cutout does not accept erase strokes")
            data, width, height = self.cutout(image, task.get("points"))
        elif kind == "erase":
            if task.get("points") not in (None, []) or task.get("cutout_mode") not in (None, ""):
                raise ValueError("erase does not accept cutout prompts")
            data, width, height = self.erase(image, task.get("strokes"))
        else:
            raise ValueError("creative kind must be erase or cutout")
        return data, CREATIVE_OUTPUT_MIME, width, height
