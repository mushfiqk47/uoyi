"""Local YuNet + SFace facecam detection helper used by web-server.cjs.

Reads one JSON object from stdin:
  {"imageBase64": "...", "referenceBase64": "...optional previous frame..."}
Writes one JSON object to stdout:
  {"faces":[{"x","y","w","h","score"}], "best":0, "count":N}
Coordinates are normalized 0..1 relative to the input image.
"""
import base64
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YUNET = os.path.join(ROOT, "models", "yunet.onnx")
SFACE = os.path.join(ROOT, "models", "sface.onnx")

_detector = cv2.FaceDetectorYN.create(YUNET, "", (320, 320), 0.72, 0.3, 5000)
_recognizer = cv2.FaceRecognizerSF.create(SFACE, "") if os.path.exists(SFACE) else None


def decode(data):
    raw = base64.b64decode(data)
    arr = np.frombuffer(raw, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def embedding(image, face):
    if _recognizer is None or face is None:
        return None
    try:
        aligned = _recognizer.alignCrop(image, face)
        feat = _recognizer.feature(aligned)
        return feat
    except Exception:
        return None


def main():
    payload = json.loads(sys.stdin.read())
    image = decode(payload.get("imageBase64", ""))
    if image is None:
        print(json.dumps({"faces": [], "best": -1, "count": 0, "error": "Could not decode image"}))
        return
    h, w = image.shape[:2]
    _detector.setInputSize((w, h))
    _, found = _detector.detect(image)
    faces = []
    if found is not None:
        for f in found:
            faces.append({
                "x": float(f[0]) / w, "y": float(f[1]) / h,
                "w": float(f[2]) / w, "h": float(f[3]) / h,
                "score": float(f[14]),
            })

    best = -1
    if faces:
        best = max(range(len(faces)), key=lambda i: faces[i]["w"] * faces[i]["h"] * faces[i]["score"])
        ref_data = payload.get("referenceBase64")
        if ref_data and _recognizer is not None and found is not None:
            ref_img = decode(ref_data)
            if ref_img is not None:
                _detector.setInputSize((ref_img.shape[1], ref_img.shape[0]))
                _, ref_found = _detector.detect(ref_img)
                if ref_found is not None and len(ref_found):
                    ref_emb = embedding(ref_img, ref_found[0])
                    if ref_emb is not None:
                        scores = []
                        for i, f in enumerate(found):
                            e = embedding(image, f)
                            score = float(_recognizer.match(ref_emb, e, cv2.FaceRecognizerSF_FR_COSINE)) if e is not None else -1
                            scores.append(score)
                        if scores:
                            best = max(range(len(scores)), key=lambda i: scores[i])

    print(json.dumps({"faces": faces, "best": best, "count": len(faces)}))


if __name__ == "__main__":
    main()
