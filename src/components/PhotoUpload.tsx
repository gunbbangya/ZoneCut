"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { analyzeFace, type FacePixelPoint } from "../utils/faceAnalyzer";

export type FaceSide = "front" | "back" | "left" | "right";

export type PhotoSlotState = Record<FaceSide, string | null>;

const INITIAL_PHOTOS: PhotoSlotState = {
  front: null,
  back: null,
  left: null,
  right: null,
};

const SIDE_ORDER: readonly FaceSide[] = ["front", "back", "left", "right"] as const;

const SIDE_LABELS: Record<FaceSide, string> = {
  front: "Front View",
  back: "Back View",
  left: "Left Side",
  right: "Right Side",
};

/** Front/back: face oval landmarks (jaw, cheeks, hairline) */
const FRONT_BACK_OVAL_INDICES: readonly number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132,
] as const;

const ANALYSIS_ERROR_MSG =
  "⚠️ Could not detect face. Please tie your hair back to show your eyebrows and ears clearly.";

const MANUAL_MODE_HINT =
  "Drag the dots to match your ear top and eyebrow end";

type StyleChoice = "twoBlockFade" | null;

type ManualBlockLine = { p0: FacePixelPoint; p1: FacePixelPoint };

function defaultManualBlockLine(nw: number, nh: number): ManualBlockLine {
  return {
    p0: { x: nw * 0.18, y: nh * 0.5 },
    p1: { x: nw * 0.82, y: nh * 0.5 },
  };
}

const TWO_BLOCK_LINE: Record<"left" | "right", { temple: number; earTop: number }> = {
  left: { temple: 54, earTop: 127 },
  right: { temple: 300, earTop: 361 },
};

export type PhotoUploadProps = {
  onPhotosChange?: (photos: PhotoSlotState) => void;
  className?: string;
};

function countValid(
  points: FacePixelPoint[],
  indices: readonly number[],
): number {
  let n = 0;
  for (const i of indices) {
    if (points[i] != null) n += 1;
  }
  return n;
}

const CAMERA_HEADLINE_DEFAULT =
  "Extend your arm and align your face with the outline.";

const CAMERA_HEADLINE_BACK =
  "Position the back of your head inside the frame.";

const CAMERA_HEADLINE_SIDE =
  "Turn your head slightly (45 degrees) so your nose tip and one ear are clearly visible.";

function cameraHeadlineForSide(side: FaceSide): string {
  if (side === "back") return CAMERA_HEADLINE_BACK;
  if (side === "left" || side === "right") return CAMERA_HEADLINE_SIDE;
  return CAMERA_HEADLINE_DEFAULT;
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function initialErrorRecord(): Record<FaceSide, string | null> {
  return { front: null, back: null, left: null, right: null };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Could not read file."));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("File read failed."));
    };
    reader.readAsDataURL(file);
  });
}

export function PhotoUpload({ onPhotosChange, className }: PhotoUploadProps) {
  const [styleChoice, setStyleChoice] = useState<StyleChoice>(null);
  const [photos, setPhotos] = useState<PhotoSlotState>(INITIAL_PHOTOS);
  const [isAnalyzing, setIsAnalyzing] = useState<Record<FaceSide, boolean>>({
    front: false,
    back: false,
    left: false,
    right: false,
  });
  const [landmarksBySide, setLandmarksBySide] = useState<
    Record<FaceSide, FacePixelPoint[] | null>
  >({
    front: null,
    back: null,
    left: null,
    right: null,
  });
  const [errorMsg, setErrorMsg] = useState<Record<FaceSide, string | null>>(
    initialErrorRecord,
  );
  const [manualBlockBySide, setManualBlockBySide] = useState<
    Record<FaceSide, ManualBlockLine | null>
  >({ front: null, back: null, left: null, right: null });

  const [cameraSide, setCameraSide] = useState<FaceSide | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [sourceSheetSide, setSourceSheetSide] = useState<FaceSide | null>(null);
  const [captureCountdown, setCaptureCountdown] = useState<2 | 1 | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const guideBoxRef = useRef<HTMLDivElement | null>(null);
  const eyeGuideCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const imgRefs = useRef<Record<FaceSide, HTMLImageElement | null>>({
    front: null,
    back: null,
    left: null,
    right: null,
  });
  const canvasRefs = useRef<Record<FaceSide, HTMLCanvasElement | null>>({
    front: null,
    back: null,
    left: null,
    right: null,
  });
  const blockDragRef = useRef<{
    side: "left" | "right";
    which: 0 | 1;
    pointerId: number;
  } | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const galleryTargetSideRef = useRef<FaceSide | null>(null);
  const captureCountdownTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const commitPhotos = useCallback(
    (updater: (prev: PhotoSlotState) => PhotoSlotState) => {
      setPhotos((prev) => {
        const next = updater(prev);
        onPhotosChange?.(next);
        return next;
      });
    },
    [onPhotosChange],
  );

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.srcObject = null;
    }
  }, []);

  const startStream = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("This browser does not support camera access.");
      return;
    }
    setCameraError(null);
    setVideoReady(false);
    try {
      stopStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { ideal: "user" },
        },
        audio: false,
      });
      streamRef.current = stream;
      const attach = async () => {
        let v = videoRef.current;
        if (!v) {
          await new Promise<void>((r) => {
            requestAnimationFrame(() => r());
          });
          v = videoRef.current;
        }
        if (!v) {
          setCameraError("Could not load the camera view.");
          return;
        }
        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        setVideoReady(false);
        await v.play();
      };
      await attach();
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Could not access the camera. Please check permissions.";
      setCameraError(msg);
    }
  }, [stopStream]);

  useLayoutEffect(() => {
    if (!cameraSide) {
      stopStream();
      setCameraError(null);
      setVideoReady(false);
      return;
    }
    void startStream();
    return () => {
      stopStream();
      setVideoReady(false);
    };
  }, [cameraSide, startStream, stopStream]);

  useEffect(() => {
    if (!cameraSide) {
      return;
    }
    const { style } = document.body;
    const prev = style.overflow;
    style.overflow = "hidden";
    return () => {
      style.overflow = prev;
    };
  }, [cameraSide]);

  useEffect(() => {
    return () => {
      captureCountdownTimersRef.current.forEach((id) => clearTimeout(id));
      captureCountdownTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (sourceSheetSide === null) return;
    const { style } = document.body;
    const prev = style.overflow;
    style.overflow = "hidden";
    return () => {
      style.overflow = prev;
    };
  }, [sourceSheetSide]);

  const drawEyeGuides = useCallback(() => {
    const side = cameraSide;
    const box = guideBoxRef.current;
    const canvas = eyeGuideCanvasRef.current;
    if (!box || !canvas || !side) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (w < 2 || h < 2) return;
    const dpr = window.devicePixelRatio ?? 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    if (side === "back") {
      return;
    }

    if (side === "front") {
      const radiusY = Math.max(7, h * 0.054);
      const radiusX = radiusY * 2.15; // width ≥ 2× height
      const centerY = h / 2;
      const eyeY = centerY - radiusY * 0.1;
      const leftCx = w * 0.27;
      const rightCx = w * 0.73;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 5]);
      for (const cx of [leftCx, rightCx]) {
        ctx.beginPath();
        ctx.ellipse(cx, eyeY, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      return;
    }

    if (side === "left" || side === "right") {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.88)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      const cx = w / 2;
      ctx.moveTo(cx, h * 0.18);
      ctx.lineTo(cx, h * 0.82);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [cameraSide]);

  useLayoutEffect(() => {
    if (!cameraSide) return;
    drawEyeGuides();
    const el = guideBoxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        drawEyeGuides();
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [cameraSide, drawEyeGuides]);

  const clearCaptureCountdown = useCallback(() => {
    captureCountdownTimersRef.current.forEach((id) => clearTimeout(id));
    captureCountdownTimersRef.current = [];
    setCaptureCountdown(null);
  }, []);

  const openCamera = useCallback((side: FaceSide) => {
    setCameraError(null);
    setCameraSide(side);
  }, []);

  const closeCamera = useCallback(() => {
    clearCaptureCountdown();
    setCameraSide(null);
  }, [clearCaptureCountdown]);

  const openSourceSheet = useCallback((side: FaceSide) => {
    setSourceSheetSide(side);
  }, []);

  const closeSourceSheet = useCallback(() => {
    setSourceSheetSide(null);
  }, []);

  const onSourceSheetTakePhoto = useCallback(() => {
    const side = sourceSheetSide;
    if (!side) return;
    setSourceSheetSide(null);
    openCamera(side);
  }, [sourceSheetSide, openCamera]);

  const onSourceSheetChooseGallery = useCallback(() => {
    const side = sourceSheetSide;
    if (!side) return;
    galleryTargetSideRef.current = side;
    setSourceSheetSide(null);
    requestAnimationFrame(() => {
      galleryInputRef.current?.click();
    });
  }, [sourceSheetSide]);

  const handleGalleryFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      const side = galleryTargetSideRef.current;
      galleryTargetSideRef.current = null;
      if (!file || !side) return;
      try {
        const dataUrl = await readFileAsDataUrl(file);
        commitPhotos((prev) => ({ ...prev, [side]: dataUrl }));
        setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
        setErrorMsg((prev) => ({ ...prev, [side]: null }));
        setManualBlockBySide((prev) => ({ ...prev, [side]: null }));
      } catch {
        // ignore
      }
    },
    [commitPhotos],
  );

  const captureFromVideo = useCallback(() => {
    const video = videoRef.current;
    const side = cameraSide;
    if (!video || !side) return;

    // Intrinsic frame dimensions (1:1 with canvas) — preserves full camera resolution
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      setCameraError("The camera is not ready yet. Please try again in a moment.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    // Mirror the frame to match the mirrored on-screen preview
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    clearCaptureCountdown();
    commitPhotos((prev) => ({ ...prev, [side]: dataUrl }));
    setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
    setErrorMsg((prev) => ({ ...prev, [side]: null }));
    setCameraSide(null);
  }, [cameraSide, clearCaptureCountdown, commitPhotos]);

  const beginCaptureCountdown = useCallback(() => {
    if (!videoReady || cameraError || captureCountdown !== null) return;
    clearCaptureCountdown();
    setCaptureCountdown(2);
    const t1 = setTimeout(() => setCaptureCountdown(1), 1000);
    const t2 = setTimeout(() => {
      captureFromVideo();
    }, 2000);
    captureCountdownTimersRef.current = [t1, t2];
  }, [
    videoReady,
    cameraError,
    captureCountdown,
    clearCaptureCountdown,
    captureFromVideo,
  ]);

  const clearPhoto = useCallback(
    (side: FaceSide) => {
      commitPhotos((prev) => ({ ...prev, [side]: null }));
      setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
      setIsAnalyzing((prev) => ({ ...prev, [side]: false }));
      setErrorMsg((prev) => ({ ...prev, [side]: null }));
      setManualBlockBySide((prev) => ({ ...prev, [side]: null }));
    },
    [commitPhotos],
  );

  const drawLandmarks = useCallback(
    (side: FaceSide) => {
      const img = imgRefs.current[side];
      const canvas = canvasRefs.current[side];
      if (!img || !canvas) return;
      if (img.naturalWidth === 0) return;

      const rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dpr = typeof window !== "undefined" ? window.devicePixelRatio ?? 1 : 1;
      const targetWidth = Math.max(1, Math.round(rect.width * dpr));
      const targetHeight = Math.max(1, Math.round(rect.height * dpr));

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const points = landmarksBySide[side];
      const manual = manualBlockBySide[side];
      const sx = rect.width / img.naturalWidth;
      const sy = rect.height / img.naturalHeight;

      const toCanvas = (p: FacePixelPoint) => {
        const xCss = p.x * sx;
        const yCss = p.y * sy;
        return { x: xCss * dpr, y: yCss * dpr };
      };

      if (side === "left" || side === "right") {
        if (manual) {
          const c0 = toCanvas(manual.p0);
          const c1 = toCanvas(manual.p1);
          ctx.setLineDash([12 * dpr, 8 * dpr]);
          ctx.beginPath();
          ctx.moveTo(c0.x, c0.y);
          ctx.lineTo(c1.x, c1.y);
          ctx.strokeStyle = "#FFFF00";
          ctx.lineWidth = 5 * dpr;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.stroke();
          ctx.setLineDash([]);
          const r = 8 * dpr;
          for (const c of [c0, c1]) {
            ctx.beginPath();
            ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
            ctx.fillStyle = "#FFFFFF";
            ctx.fill();
            ctx.strokeStyle = "#FFFF00";
            ctx.lineWidth = 2.5 * dpr;
            ctx.stroke();
          }
          return;
        }
        if (points && points.length > 0) {
          const { temple, earTop } = TWO_BLOCK_LINE[side];
          const a = points[temple];
          const b = points[earTop];
          if (!a || !b) return;
          const p0 = toCanvas(a);
          const p1 = toCanvas(b);
          ctx.setLineDash([10 * dpr, 7 * dpr]);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.strokeStyle = "#FFFF00";
          ctx.lineWidth = 6 * dpr;
          ctx.lineCap = "round";
          ctx.stroke();
          ctx.setLineDash([]);
          const mx = (p0.x + p1.x) / 2;
          const my = (p0.y + p1.y) / 2;
          const label = "Two-Block Line";
          const fontSize = 12 * dpr;
          ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const pad = 3 * dpr;
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(mx - tw / 2 - pad, my - fontSize / 2 - pad, tw + 2 * pad, fontSize + 2 * pad);
          ctx.strokeStyle = "rgba(255,255,0,0.6)";
          ctx.lineWidth = 1 * dpr;
          ctx.strokeRect(mx - tw / 2 - pad, my - fontSize / 2 - pad, tw + 2 * pad, fontSize + 2 * pad);
          ctx.fillStyle = "#fff";
          ctx.fillText(label, mx, my);
        }
        return;
      }

      if (!points || points.length === 0) {
        return;
      }

      if (side === "front" || side === "back") {
        const firstIdx = FRONT_BACK_OVAL_INDICES.find((i) => points[i] != null);
        if (firstIdx === undefined) return;

        const first = points[firstIdx]!;
        ctx.beginPath();
        const pStart = toCanvas(first);
        ctx.moveTo(pStart.x, pStart.y);

        let count = 1;
        for (const i of FRONT_BACK_OVAL_INDICES) {
          if (i === firstIdx) continue;
          const p = points[i];
          if (!p) continue;
          const t = toCanvas(p);
          ctx.lineTo(t.x, t.y);
          count += 1;
        }
        if (count < 3) return;
        ctx.closePath();

        ctx.fillStyle = "rgba(0, 255, 255, 0.1)";
        ctx.fill();
        ctx.strokeStyle = "#00FFFF";
        ctx.lineWidth = 6 * dpr;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
      }
    },
    [landmarksBySide, manualBlockBySide],
  );

  const analyzeAndDraw = useCallback(
    async (side: FaceSide) => {
      const img = imgRefs.current[side];
      if (!img) return;

      setErrorMsg((prev) => ({ ...prev, [side]: null }));
      setManualBlockBySide((prev) => ({ ...prev, [side]: null }));
      setIsAnalyzing((prev) => ({ ...prev, [side]: true }));
      setLandmarksBySide((prev) => ({ ...prev, [side]: null }));

      const activateSideManual = () => {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (nw < 2 || nh < 2) return;
        if (side !== "left" && side !== "right") return;
        setErrorMsg((prev) => ({ ...prev, [side]: null }));
        setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
        setManualBlockBySide((prev) => ({
          ...prev,
          [side]: defaultManualBlockLine(nw, nh),
        }));
      };

      try {
        const points = await analyzeFace(img);

        if (points.length === 0) {
          if (side === "left" || side === "right") {
            activateSideManual();
          } else {
            setErrorMsg((prev) => ({ ...prev, [side]: ANALYSIS_ERROR_MSG }));
            setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
          }
          return;
        }

        if (side === "front" || side === "back") {
          const n = countValid(points, FRONT_BACK_OVAL_INDICES);
          if (n < 8) {
            setErrorMsg((prev) => ({ ...prev, [side]: ANALYSIS_ERROR_MSG }));
            setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
            return;
          }
        }

        if (side === "left" || side === "right") {
          const { temple, earTop } = TWO_BLOCK_LINE[side];
          if (!points[temple] || !points[earTop]) {
            activateSideManual();
            return;
          }
        }

        setErrorMsg((prev) => ({ ...prev, [side]: null }));
        setManualBlockBySide((prev) => ({ ...prev, [side]: null }));
        setLandmarksBySide((prev) => ({ ...prev, [side]: points }));
        requestAnimationFrame(() => drawLandmarks(side));
      } catch {
        if (side === "left" || side === "right") {
          activateSideManual();
        } else {
          setErrorMsg((prev) => ({ ...prev, [side]: ANALYSIS_ERROR_MSG }));
          setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
        }
      } finally {
        setIsAnalyzing((prev) => ({ ...prev, [side]: false }));
      }
    },
    [drawLandmarks],
  );

  useEffect(() => {
    for (const s of SIDE_ORDER) {
      requestAnimationFrame(() => drawLandmarks(s));
    }
  }, [drawLandmarks, landmarksBySide, manualBlockBySide]);

  useEffect(() => {
    const onResize = () => {
      for (const s of SIDE_ORDER) requestAnimationFrame(() => drawLandmarks(s));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawLandmarks, landmarksBySide, manualBlockBySide]);

  const isSlotReadyForGuide = useCallback(
    (s: FaceSide) => {
      if (photos[s] === null) return false;
      if (isAnalyzing[s]) return false;
      if (errorMsg[s] !== null) return false;
      if (s === "left" || s === "right") {
        if (manualBlockBySide[s] != null) return true;
        const lm = landmarksBySide[s];
        return lm != null && lm.length > 0;
      }
      const lm = landmarksBySide[s];
      return lm != null && lm.length > 0;
    },
    [errorMsg, isAnalyzing, landmarksBySide, manualBlockBySide, photos],
  );

  const allUploaded = SIDE_ORDER.every((s) => photos[s] !== null);
  const allOk =
    allUploaded &&
    SIDE_ORDER.every((s) => !isAnalyzing[s]) &&
    SIDE_ORDER.every((s) => isSlotReadyForGuide(s));
  const canStartGuide = allOk;

  const clientToNatural = useCallback(
    (img: HTMLImageElement, clientX: number, clientY: number): FacePixelPoint => {
      const r = img.getBoundingClientRect();
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      let x = ((clientX - r.left) / r.width) * nw;
      let y = ((clientY - r.top) / r.height) * nh;
      x = Math.max(0, Math.min(nw, x));
      y = Math.max(0, Math.min(nh, y));
      return { x, y };
    },
    [],
  );

  const onBlockPointerDown = useCallback(
    (side: "left" | "right", e: ReactPointerEvent<HTMLCanvasElement>) => {
      const manual = manualBlockBySide[side];
      if (!manual) return;
      const img = imgRefs.current[side];
      if (!img) return;
      e.preventDefault();
      const c0c = (() => {
        const r = img.getBoundingClientRect();
        const { p0, p1 } = manual;
        const sx = r.width / img.naturalWidth;
        const sy = r.height / img.naturalHeight;
        return {
          c0: { x: r.left + p0.x * sx, y: r.top + p0.y * sy },
          c1: { x: r.left + p1.x * sx, y: r.top + p1.y * sy },
        };
      })();
      const d0 =
        (e.clientX - c0c.c0.x) * (e.clientX - c0c.c0.x) +
        (e.clientY - c0c.c0.y) * (e.clientY - c0c.c0.y);
      const d1 =
        (e.clientX - c0c.c1.x) * (e.clientX - c0c.c1.x) +
        (e.clientY - c0c.c1.y) * (e.clientY - c0c.c1.y);
      const hitR = 14;
      const hit2 = hitR * hitR;
      const h0 = d0 <= hit2;
      const h1 = d1 <= hit2;
      if (!h0 && !h1) return;
      const dragTarget: 0 | 1 =
        h0 && h1 ? (d0 < d1 ? 0 : 1) : h0 ? 0 : 1;
      blockDragRef.current = { side, which: dragTarget, pointerId: e.pointerId };
      e.currentTarget.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        const img2 = imgRefs.current[side];
        if (!img2) return;
        const np = clientToNatural(img2, ev.clientX, ev.clientY);
        setManualBlockBySide((prev) => {
          const m = prev[side];
          if (!m) return prev;
          if (dragTarget === 0) {
            return { ...prev, [side]: { ...m, p0: np } };
          }
          return { ...prev, [side]: { ...m, p1: np } };
        });
        requestAnimationFrame(() => drawLandmarks(side));
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        blockDragRef.current = null;
        try {
          (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [clientToNatural, drawLandmarks, manualBlockBySide],
  );

  return (
    <div className={className}>
      {styleChoice === null ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 backdrop-blur-md">
            <p className="text-sm font-semibold text-white">Choose your style</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              MVP: one style is available for now.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setStyleChoice("twoBlockFade")}
            className="group w-full rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-5 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.04)] transition hover:border-zinc-700 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08)] active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-white">Two-Block &amp; Fade</p>
                <p className="mt-1 text-sm font-medium text-zinc-300">Four-angle capture</p>
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                  Capture four views and the AI will scan your head shape with a bold outline.
                </p>
              </div>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10 transition group-hover:bg-white/7">
                <span className="text-lg">✂️</span>
              </div>
            </div>
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3.5 backdrop-blur-md">
            <span className="text-lg">💧</span>
            <p className="text-sm leading-relaxed text-zinc-300">
              <strong className="font-semibold text-white">Accuracy Tip: </strong>
              Wet your hair with a spray bottle and tie it tightly with a hair tie. This
              helps the AI identify your head shape precisely.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {SIDE_ORDER.map((side) => {
              const src = photos[side];
              const label = SIDE_LABELS[side];
              const err = errorMsg[side];
              const loading = isAnalyzing[side];
              const isManualBlock =
                (side === "left" || side === "right") && manualBlockBySide[side] != null;

              return (
                <div key={side} className="relative aspect-square min-h-0">
                  {src === null ? (
                    <button
                      type="button"
                      onClick={() => openSourceSheet(side)}
                      className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-500/60 bg-zinc-900/40 px-2 text-center text-zinc-300 transition hover:border-zinc-400 hover:bg-zinc-800/50 active:scale-[0.99]"
                    >
                      <PlusIcon className="h-8 w-8 text-zinc-400" />
                      <span className="text-sm font-medium text-zinc-200">{label}</span>
                    </button>
                  ) : (
                    <div className="relative h-full w-full overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900">
                      {/* eslint-disable-next-line @next/next/no-img-element -- captured data URL */}
                      <img
                        ref={(el) => {
                          imgRefs.current[side] = el;
                        }}
                        src={src}
                        alt={`${label} preview`}
                        className="h-full w-full object-cover"
                        onLoad={() => void analyzeAndDraw(side)}
                      />
                      <canvas
                        ref={(el) => {
                          canvasRefs.current[side] = el;
                        }}
                        className={
                          isManualBlock
                            ? "absolute inset-0 z-[15] h-full w-full cursor-grab touch-none active:cursor-grabbing"
                            : "pointer-events-none absolute inset-0 h-full w-full"
                        }
                        aria-hidden
                        onPointerDown={
                          (side === "left" || side === "right") && isManualBlock
                            ? (e) => {
                                if (side === "left" || side === "right") {
                                  onBlockPointerDown(side, e);
                                }
                              }
                            : undefined
                        }
                      />
                      <div className="pointer-events-none absolute inset-0 z-[5] bg-gradient-to-t from-black/35 via-transparent to-black/20" />

                      {loading ? (
                        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
                          <div className="flex items-center gap-3 rounded-lg bg-black/60 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/10 backdrop-blur-sm">
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            <span>🤖 Analyzing shape...</span>
                          </div>
                        </div>
                      ) : null}

                      {!loading && isManualBlock ? (
                        <div className="pointer-events-none absolute inset-x-0 bottom-14 z-[14] flex justify-center px-2">
                          <p className="max-w-[18rem] rounded-lg bg-black/60 px-3 py-2 text-center text-xs font-medium leading-snug text-white ring-1 ring-white/10">
                            {MANUAL_MODE_HINT}
                          </p>
                        </div>
                      ) : null}

                      {!loading && err ? (
                        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center bg-red-500/30 px-3 text-center backdrop-blur-[2px]">
                          <p className="text-sm font-semibold leading-snug text-white drop-shadow">
                            {err}
                          </p>
                        </div>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => clearPhoto(side)}
                        className="pointer-events-auto absolute right-2 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-black/70"
                        aria-label={`Delete ${label}`}
                      >
                        <CloseIcon className="h-4 w-4" />
                      </button>
                      <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex justify-center p-2">
                        <button
                          type="button"
                          onClick={() => openSourceSheet(side)}
                          className="rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-zinc-900 shadow-sm ring-1 ring-black/10 backdrop-blur-sm transition hover:bg-white"
                        >
                          Retake
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {canStartGuide ? (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  console.log("Start Step-by-Step Guide");
                }}
                className="w-full rounded-2xl bg-white px-5 py-4 text-center text-sm font-extrabold text-zinc-950 shadow-sm ring-1 ring-black/10 transition hover:bg-zinc-100 active:scale-[0.99]"
              >
                Start Step-by-Step Guide
              </button>
            </div>
          ) : null}
        </div>
      )}

      {cameraSide ? (
        <div
          className="fixed inset-0 z-[200] flex flex-col bg-black"
          role="dialog"
          aria-modal
          aria-labelledby="live-camera-title"
        >
          <div className="absolute left-0 right-0 top-0 z-30 flex items-center justify-between p-3">
            <p id="live-camera-title" className="text-sm font-semibold text-white">
              {SIDE_LABELS[cameraSide]}
            </p>
            <button
              type="button"
              onClick={closeCamera}
              className="grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white ring-1 ring-white/20 transition hover:bg-black/70"
              aria-label="Close"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="relative min-h-0 flex-1">
            <video
              ref={videoRef}
              className="h-full w-full object-cover [transform:scaleX(-1)]"
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => {
                setVideoReady(true);
                requestAnimationFrame(() => {
                  drawEyeGuides();
                });
              }}
            />

            {captureCountdown !== null ? (
              <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/25">
                <span className="text-[min(28vw,11rem)] font-black leading-none tabular-nums text-white [text-shadow:0_4px_32px_rgba(0,0,0,0.95)]">
                  {captureCountdown}
                </span>
              </div>
            ) : null}

            <div
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-4"
              aria-hidden
            >
              <div className="flex w-full max-w-sm flex-col items-center">
                <p className="mb-3 text-center text-sm font-semibold leading-snug text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.8)] sm:mb-4 sm:max-w-md sm:text-base">
                  {cameraHeadlineForSide(cameraSide)}
                </p>
                <div
                  ref={guideBoxRef}
                  className="relative h-[min(42.5dvh,45dvh,400px)] w-[min(30dvh,78vw,280px)] max-h-[45vh] shrink-0"
                >
                  <div
                    className="absolute inset-0 z-0 rounded-[100%] border-2 border-dashed border-white/90"
                    style={{
                      boxShadow: "0 0 0 100vmax rgba(0,0,0,0.45)",
                    }}
                  />
                  <canvas
                    ref={eyeGuideCanvasRef}
                    className="pointer-events-none absolute inset-0 z-10 h-full w-full"
                    aria-hidden
                  />
                </div>
              </div>
            </div>
          </div>

          {cameraError ? (
            <div className="z-20 mx-4 mb-2 rounded-lg bg-red-600/90 px-3 py-2 text-sm text-white ring-1 ring-white/20">
              {cameraError}
            </div>
          ) : null}

          <div className="z-20 shrink-0 border-t border-zinc-800/80 bg-zinc-950/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={beginCaptureCountdown}
              disabled={!!cameraError || !videoReady || captureCountdown !== null}
              className="w-full rounded-2xl bg-white py-4 text-center text-base font-extrabold text-zinc-950 shadow ring-1 ring-white/20 transition enabled:active:scale-[0.99] enabled:hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Take Photo
            </button>
          </div>
        </div>
      ) : null}

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void handleGalleryFileChange(e)}
      />

      {sourceSheetSide !== null && styleChoice !== null ? (
        <div className="fixed inset-0 z-[180] flex flex-col justify-end sm:items-center sm:justify-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            aria-label="Close menu"
            onClick={closeSourceSheet}
          />
          <div
            role="dialog"
            aria-modal
            aria-labelledby="source-sheet-title"
            className="relative z-10 w-full max-w-md rounded-t-2xl border border-zinc-700/80 bg-zinc-900 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl transition-transform duration-300 ease-out sm:rounded-2xl sm:border"
          >
            <p
              id="source-sheet-title"
              className="px-2 pb-2 text-center text-xs font-medium text-zinc-500"
            >
              {SIDE_LABELS[sourceSheetSide]}
            </p>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={onSourceSheetTakePhoto}
                className="w-full rounded-xl bg-white py-3.5 text-center text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 active:scale-[0.99]"
              >
                Take Photo
              </button>
              <button
                type="button"
                onClick={onSourceSheetChooseGallery}
                className="w-full rounded-xl border border-zinc-600 bg-zinc-800/80 py-3.5 text-center text-sm font-semibold text-white transition hover:bg-zinc-800 active:scale-[0.99]"
              >
                Choose from Gallery
              </button>
              <button
                type="button"
                onClick={closeSourceSheet}
                className="w-full rounded-xl py-3.5 text-center text-sm font-medium text-zinc-400 transition hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
