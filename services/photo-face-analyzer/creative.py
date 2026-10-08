from __future__ import annotations

import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
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
CREATIVE_MOVIE_MIME = "video/mp4"
CREATIVE_MOVIE_WIDTH = 1920
CREATIVE_MOVIE_HEIGHT = 1080
CREATIVE_MOVIE_FPS = 30
CREATIVE_MOVIE_MIN_FRAMES = 2
CREATIVE_MOVIE_MAX_FRAMES = 30
CREATIVE_MOVIE_MAX_BYTES = 128 * 1024 * 1024
CREATIVE_MOVIE_TIMEOUT_SECONDS = 14 * 60
CREATIVE_MOVIE_TEMPLATES = {"classic", "fill", "ken_burns"}
CREATIVE_COLLAGE_MIME = "image/jpeg"
CREATIVE_COLLAGE_SIZE = 2048
CREATIVE_COLLAGE_GAP = 12
CREATIVE_COLLAGE_MIN_IMAGES = 2
CREATIVE_COLLAGE_MAX_IMAGES = 9
CREATIVE_COLLAGE_MAX_BYTES = 32 * 1024 * 1024
CREATIVE_COLLAGE_TEMPLATES = {"grid", "featured", "columns", "rows"}
CREATIVE_PIPELINE_VERSION = (
    f"opencv-{cv.__version__}-cpu-efficientsam-ti-2025april-int8"
    "-1024-prompt-mask-cutout-telea-erase-ffmpeg-slideshow-v3-collage-v1"
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
        try:
            probe = subprocess.run(
                ["ffmpeg", "-version"],
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise RuntimeError("ffmpeg runtime is unavailable") from exc
        first_line = probe.stdout.splitlines()[0].strip() if probe.stdout else ""
        if not first_line.startswith("ffmpeg version "):
            raise RuntimeError("ffmpeg runtime version is invalid")
        self.ffmpeg_version = first_line.split()[2]

    def info(self) -> dict[str, Any]:
        return {
            "protocol_version": CREATIVE_PROTOCOL_VERSION,
            "name": CREATIVE_ANALYZER_NAME,
            "pipeline_version": (
                CREATIVE_PIPELINE_VERSION + "-ffmpeg-" + self.ffmpeg_version
            ),
            "segment_model": {
                "name": "EfficientSAM-Ti",
                "version": CREATIVE_MODEL_VERSION,
                "sha256": CREATIVE_MODEL_SHA256,
                "license": CREATIVE_MODEL_LICENSE,
                "license_url": CREATIVE_MODEL_LICENSE_URL,
            },
            "capabilities": ["cutout", "erase", "movie", "collage"],
            "runtime": {
                "framework": "opencv_dnn+ffmpeg",
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

    @staticmethod
    def _cover_crop(image: np.ndarray, width: int, height: int) -> np.ndarray:
        if (
            image.ndim != 3
            or image.shape[2] != 3
            or width <= 0
            or height <= 0
        ):
            raise RuntimeError("creative collage image dimensions are invalid")
        source_height, source_width = image.shape[:2]
        if source_width <= 0 or source_height <= 0:
            raise RuntimeError("creative collage source dimensions are invalid")
        scale = max(width / source_width, height / source_height)
        resized_width = max(width, int(round(source_width * scale)))
        resized_height = max(height, int(round(source_height * scale)))
        resized = cv.resize(
            image,
            (resized_width, resized_height),
            interpolation=cv.INTER_AREA if scale < 1 else cv.INTER_CUBIC,
        )
        x = max(0, (resized_width - width) // 2)
        y = max(0, (resized_height - height) // 2)
        return resized[y:y + height, x:x + width]

    @staticmethod
    def _collage_cells(
        template: str,
        count: int,
    ) -> list[tuple[int, int, int, int]]:
        size = CREATIVE_COLLAGE_SIZE
        if template == "columns":
            return [
                (
                    int(round(index * size / count)),
                    0,
                    int(round((index + 1) * size / count)),
                    size,
                )
                for index in range(count)
            ]
        if template == "rows":
            return [
                (
                    0,
                    int(round(index * size / count)),
                    size,
                    int(round((index + 1) * size / count)),
                )
                for index in range(count)
            ]
        if template == "featured":
            featured_width = int(round(size * 0.62))
            if count == 2:
                return [
                    (0, 0, featured_width, size),
                    (featured_width, 0, size, size),
                ]
            remaining = count - 1
            columns = 1 if remaining <= 3 else 2
            rows = int(np.ceil(remaining / columns))
            cells = [(0, 0, featured_width, size)]
            side_width = size - featured_width
            for index in range(remaining):
                row = index // columns
                column = index % columns
                x0 = featured_width + int(round(column * side_width / columns))
                x1 = featured_width + int(round((column + 1) * side_width / columns))
                y0 = int(round(row * size / rows))
                y1 = int(round((row + 1) * size / rows))
                cells.append((x0, y0, x1, y1))
            return cells

        columns = int(np.ceil(np.sqrt(count)))
        rows = int(np.ceil(count / columns))
        cells = []
        for index in range(count):
            row = index // columns
            column = index % columns
            cells.append((
                int(round(column * size / columns)),
                int(round(row * size / rows)),
                int(round((column + 1) * size / columns)),
                int(round((row + 1) * size / rows)),
            ))
        return cells

    @staticmethod
    def _validate_collage_task(
        task: dict[str, Any],
        image_count: int,
    ) -> str:
        if (
            image_count < CREATIVE_COLLAGE_MIN_IMAGES
            or image_count > CREATIVE_COLLAGE_MAX_IMAGES
        ):
            raise ValueError(
                "collage requires between "
                f"{CREATIVE_COLLAGE_MIN_IMAGES} and "
                f"{CREATIVE_COLLAGE_MAX_IMAGES} images"
            )
        if task.get("points") not in (None, []) or task.get("strokes") not in (None, []):
            raise ValueError("collage does not accept cutout or erase prompts")
        if task.get("cutout_mode") not in (None, ""):
            raise ValueError("collage does not accept cutout mode")
        if task.get("movie_frames") not in (None, []):
            raise ValueError("collage does not accept movie frames")
        if task.get("movie_template") not in (None, ""):
            raise ValueError("collage does not accept movie template")
        if task.get("frame_duration_ms") not in (None, 0) or task.get("transition_ms") not in (None, 0):
            raise ValueError("collage does not accept movie timing")
        template = task.get("collage_template")
        if template not in CREATIVE_COLLAGE_TEMPLATES:
            raise ValueError("creative collage template is invalid")
        return template

    def collage(
        self,
        images: list[np.ndarray],
        task: dict[str, Any],
    ) -> tuple[bytes, int, int]:
        template = self._validate_collage_task(task, len(images))
        canvas = np.full(
            (CREATIVE_COLLAGE_SIZE, CREATIVE_COLLAGE_SIZE, 3),
            255,
            dtype=np.uint8,
        )
        cells = self._collage_cells(template, len(images))
        inset = max(1, CREATIVE_COLLAGE_GAP // 2)
        for image, (raw_x0, raw_y0, raw_x1, raw_y1) in zip(images, cells):
            x0 = min(raw_x1 - 1, raw_x0 + inset)
            y0 = min(raw_y1 - 1, raw_y0 + inset)
            x1 = max(x0 + 1, raw_x1 - inset)
            y1 = max(y0 + 1, raw_y1 - inset)
            tile = self._cover_crop(image, x1 - x0, y1 - y0)
            canvas[y0:y1, x0:x1] = tile
        ok, encoded = cv.imencode(
            ".jpg",
            canvas,
            [cv.IMWRITE_JPEG_QUALITY, 92],
        )
        if not ok:
            raise RuntimeError("creative collage JPEG encoding failed")
        data = encoded.tobytes()
        if len(data) == 0 or len(data) > CREATIVE_COLLAGE_MAX_BYTES:
            raise RuntimeError("creative collage result size is invalid")
        return data, CREATIVE_COLLAGE_SIZE, CREATIVE_COLLAGE_SIZE

    def generate_collage(
        self,
        images: list[np.ndarray],
        task: dict[str, Any],
    ) -> tuple[bytes, str, int, int]:
        if task.get("kind") != "collage":
            raise ValueError("creative collage task kind is invalid")
        data, width, height = self.collage(images, task)
        return data, CREATIVE_COLLAGE_MIME, width, height

    @staticmethod
    def _validate_movie_task(
        task: dict[str, Any],
        image_count: int,
    ) -> tuple[float, float, str]:
        if image_count < CREATIVE_MOVIE_MIN_FRAMES or image_count > CREATIVE_MOVIE_MAX_FRAMES:
            raise ValueError(
                "movie requires between "
                f"{CREATIVE_MOVIE_MIN_FRAMES} and {CREATIVE_MOVIE_MAX_FRAMES} frames"
            )
        if task.get("points") not in (None, []) or task.get("strokes") not in (None, []):
            raise ValueError("movie does not accept cutout or erase prompts")
        if task.get("cutout_mode") not in (None, ""):
            raise ValueError("movie does not accept cutout mode")
        duration_ms = task.get("frame_duration_ms")
        transition_ms = task.get("transition_ms")
        template = task.get("movie_template") or "classic"
        if not isinstance(template, str) or template not in CREATIVE_MOVIE_TEMPLATES:
            raise ValueError("creative movie template is invalid")
        if (
            isinstance(duration_ms, bool)
            or not isinstance(duration_ms, int)
            or duration_ms < 1000
            or duration_ms > 5000
        ):
            raise ValueError("creative movie frame duration is invalid")
        if (
            isinstance(transition_ms, bool)
            or not isinstance(transition_ms, int)
            or transition_ms < 0
            or transition_ms > 1000
            or transition_ms >= duration_ms
        ):
            raise ValueError("creative movie transition is invalid")
        return duration_ms / 1000.0, transition_ms / 1000.0, template

    @staticmethod
    def _write_movie_frame(path: Path, image: np.ndarray) -> None:
        if image.ndim != 3 or image.shape[2] != 3:
            raise RuntimeError("creative movie frame dimensions are invalid")
        ok = cv.imwrite(
            str(path),
            image,
            [cv.IMWRITE_PNG_COMPRESSION, 2],
        )
        if not ok:
            raise RuntimeError("creative movie frame encoding failed")

    def movie(
        self,
        images: list[np.ndarray],
        task: dict[str, Any],
    ) -> tuple[bytes, int, int]:
        duration, transition, template = self._validate_movie_task(task, len(images))
        with tempfile.TemporaryDirectory(prefix="xdrive-movie-") as tmp:
            root = Path(tmp)
            frame_paths: list[Path] = []
            for index, image in enumerate(images):
                frame_path = root / f"frame-{index:03d}.png"
                self._write_movie_frame(frame_path, image)
                frame_paths.append(frame_path)

            command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
            for frame_path in frame_paths:
                command.extend([
                    "-loop", "1",
                    "-t", f"{duration:.3f}",
                    "-i", str(frame_path),
                ])

            filters: list[str] = []
            for index in range(len(frame_paths)):
                if template == "classic":
                    presentation = (
                        f"scale={CREATIVE_MOVIE_WIDTH}:{CREATIVE_MOVIE_HEIGHT}:"
                        "force_original_aspect_ratio=decrease,"
                        f"pad={CREATIVE_MOVIE_WIDTH}:{CREATIVE_MOVIE_HEIGHT}:"
                        "(ow-iw)/2:(oh-ih)/2:black,"
                        f"fps={CREATIVE_MOVIE_FPS}"
                    )
                elif template == "fill":
                    presentation = (
                        f"scale={CREATIVE_MOVIE_WIDTH}:{CREATIVE_MOVIE_HEIGHT}:"
                        "force_original_aspect_ratio=increase,"
                        f"crop={CREATIVE_MOVIE_WIDTH}:{CREATIVE_MOVIE_HEIGHT},"
                        f"fps={CREATIVE_MOVIE_FPS}"
                    )
                else:
                    presentation = (
                        f"fps={CREATIVE_MOVIE_FPS},"
                        f"scale={CREATIVE_MOVIE_WIDTH * 2}:{CREATIVE_MOVIE_HEIGHT * 2}:"
                        "force_original_aspect_ratio=increase,"
                        f"crop={CREATIVE_MOVIE_WIDTH * 2}:{CREATIVE_MOVIE_HEIGHT * 2},"
                        "zoompan="
                        "z='min(max(zoom,pzoom)+0.001,1.08)':"
                        "x='iw/2-(iw/zoom/2)':"
                        "y='ih/2-(ih/zoom/2)':"
                        "d=1:"
                        f"s={CREATIVE_MOVIE_WIDTH}x{CREATIVE_MOVIE_HEIGHT}:"
                        f"fps={CREATIVE_MOVIE_FPS}"
                    )
                filters.append(
                    f"[{index}:v]"
                    f"{presentation},"
                    "format=yuv420p,setpts=PTS-STARTPTS"
                    f"[f{index}]"
                )

            if transition > 0:
                current = "f0"
                offset = duration - transition
                for index in range(1, len(frame_paths)):
                    output = f"x{index}"
                    filters.append(
                        f"[{current}][f{index}]"
                        f"xfade=transition=fade:duration={transition:.3f}:"
                        f"offset={offset:.3f}[{output}]"
                    )
                    current = output
                    offset += duration - transition
                output_label = current
            else:
                inputs = "".join(f"[f{index}]" for index in range(len(frame_paths)))
                filters.append(
                    f"{inputs}concat=n={len(frame_paths)}:v=1:a=0[outv]"
                )
                output_label = "outv"

            output_path = root / "movie.mp4"
            command.extend([
                "-filter_complex", ";".join(filters),
                "-map", f"[{output_label}]",
                "-an",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-movflags", "+faststart",
                str(output_path),
            ])
            try:
                completed = subprocess.run(
                    command,
                    check=False,
                    capture_output=True,
                    timeout=CREATIVE_MOVIE_TIMEOUT_SECONDS,
                )
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError("creative movie encoding timed out") from exc
            if completed.returncode != 0:
                stderr = completed.stderr.decode("utf-8", errors="replace").strip()
                if len(stderr) > 1000:
                    stderr = stderr[-1000:]
                raise RuntimeError(
                    "creative movie encoding failed"
                    + (f": {stderr}" if stderr else "")
                )
            data = output_path.read_bytes()
            if len(data) == 0 or len(data) > CREATIVE_MOVIE_MAX_BYTES:
                raise RuntimeError("creative movie result size is invalid")
            if b"ftyp" not in data[:64]:
                raise RuntimeError("creative movie output is not MP4")
            return data, CREATIVE_MOVIE_WIDTH, CREATIVE_MOVIE_HEIGHT

    def generate_movie(
        self,
        images: list[np.ndarray],
        task: dict[str, Any],
    ) -> tuple[bytes, str, int, int]:
        if task.get("kind") != "movie":
            raise ValueError("creative movie task kind is invalid")
        data, width, height = self.movie(images, task)
        return data, CREATIVE_MOVIE_MIME, width, height

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
        elif kind == "movie":
            raise ValueError("movie must use the multi-frame generator")
        elif kind == "collage":
            raise ValueError("collage must use the multi-image generator")
        else:
            raise ValueError("creative kind must be erase, cutout, movie, or collage")
        return data, CREATIVE_OUTPUT_MIME, width, height
