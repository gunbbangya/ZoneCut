"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

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

/** 정면/후면: 턱·이마·볼·관자(귀 쪽) 위주 윤곽 — 귀 뒤(234,127) 체인을 빼 누락/부정확해도 흐트러지지 않게 함 */
const FRONT_BACK_OVAL_INDICES: readonly number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132,
] as const;

const ANALYSIS_ERROR_MSG =
  "⚠️ 눈썹과 측면 귀가 잘 보이게 머리를 까고 다시 찍어주세요";

type StyleChoice = "twoBlockFade" | null;

const TWO_BLOCK_LINE: Record<"left" | "right", { temple: number; earTop: number }> = {
  left: { temple: 54, earTop: 127 },
  right: { temple: 300, earTop: 361 },
};

export type PhotoUploadProps = {
  onPhotosChange?: (photos: PhotoSlotState) => void;
  className?: string;
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("파일을 data URL로 읽을 수 없습니다."));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("파일 읽기에 실패했습니다."));
    };
    reader.readAsDataURL(file);
  });
}

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

  const inputRefs = useRef<Record<FaceSide, HTMLInputElement | null>>({
    front: null,
    back: null,
    left: null,
    right: null,
  });

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

  const handleFileChange = useCallback(
    async (side: FaceSide, event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      try {
        const dataUrl = await readFileAsDataUrl(file);
        commitPhotos((prev) => ({ ...prev, [side]: dataUrl }));
        setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
        setErrorMsg((prev) => ({ ...prev, [side]: null }));
      } catch {
        // ignore
      }
    },
    [commitPhotos],
  );

  const clearPhoto = useCallback(
    (side: FaceSide) => {
      commitPhotos((prev) => ({ ...prev, [side]: null }));
      setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
      setIsAnalyzing((prev) => ({ ...prev, [side]: false }));
      setErrorMsg((prev) => ({ ...prev, [side]: null }));
    },
    [commitPhotos],
  );

  const openPicker = useCallback((side: FaceSide) => {
    inputRefs.current[side]?.click();
  }, []);

  const drawLandmarks = useCallback(
    (side: FaceSide) => {
      const img = imgRefs.current[side];
      const canvas = canvasRefs.current[side];
      const points = landmarksBySide[side];
      if (!img || !canvas) return;
      if (!points || points.length === 0) {
        const ctx0 = canvas.getContext("2d");
        if (ctx0) {
          const rect = img.getBoundingClientRect();
          const dpr = window.devicePixelRatio ?? 1;
          canvas.width = Math.max(1, Math.round(rect.width * dpr));
          canvas.height = Math.max(1, Math.round(rect.height * dpr));
          ctx0.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      const rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dpr = typeof window !== "undefined" ? window.devicePixelRatio ?? 1 : 1;
      const targetWidth = Math.max(1, Math.round(rect.width * dpr));
      const targetHeight = Math.max(1, Math.round(rect.height * dpr));

      if (canvas.width !== targetWidth) canvas.width = targetWidth;
      if (canvas.height !== targetHeight) canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const sx = rect.width / img.naturalWidth;
      const sy = rect.height / img.naturalHeight;

      const toCanvas = (p: FacePixelPoint) => {
        const xCss = p.x * sx;
        const yCss = p.y * sy;
        return { x: xCss * dpr, y: yCss * dpr };
      };

      if (side === "left" || side === "right") {
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
    [landmarksBySide],
  );

  const analyzeAndDraw = useCallback(
    async (side: FaceSide) => {
      const img = imgRefs.current[side];
      if (!img) return;

      setErrorMsg((prev) => ({ ...prev, [side]: null }));
      setIsAnalyzing((prev) => ({ ...prev, [side]: true }));
      setLandmarksBySide((prev) => ({ ...prev, [side]: null }));

      try {
        const points = await analyzeFace(img);

        if (points.length === 0) {
          setErrorMsg((prev) => ({ ...prev, [side]: ANALYSIS_ERROR_MSG }));
          setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
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
            setErrorMsg((prev) => ({ ...prev, [side]: ANALYSIS_ERROR_MSG }));
            setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
            return;
          }
        }

        setErrorMsg((prev) => ({ ...prev, [side]: null }));
        setLandmarksBySide((prev) => ({ ...prev, [side]: points }));
        requestAnimationFrame(() => drawLandmarks(side));
      } catch {
        setErrorMsg((prev) => ({ ...prev, [side]: ANALYSIS_ERROR_MSG }));
        setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
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
  }, [drawLandmarks, landmarksBySide]);

  useEffect(() => {
    const onResize = () => {
      for (const s of SIDE_ORDER) requestAnimationFrame(() => drawLandmarks(s));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawLandmarks, landmarksBySide]);

  const allUploaded = SIDE_ORDER.every((s) => photos[s] !== null);
  const allOk =
    allUploaded &&
    SIDE_ORDER.every((s) => !isAnalyzing[s]) &&
    SIDE_ORDER.every((s) => errorMsg[s] === null) &&
    SIDE_ORDER.every(
      (s) => photos[s] === null || (landmarksBySide[s] != null && landmarksBySide[s]!.length > 0),
    );
  const canStartGuide = allOk;

  return (
    <div className={className}>
      {styleChoice === null ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-4 backdrop-blur-md">
            <p className="text-sm font-semibold text-white">
              어떤 스타일로 자를까요?{" "}
              <span className="font-medium text-zinc-300">(Choose your style)</span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              MVP 버전에서는 1가지 스타일만 제공됩니다.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setStyleChoice("twoBlockFade")}
            className="group w-full rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-5 text-left shadow-[0_0_0_1px_rgba(255,255,255,0.04)] transition hover:border-zinc-700 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.08)] active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-white">투블럭 + 상고머리</p>
                <p className="mt-1 text-sm font-medium text-zinc-300">Two-Block &amp; Fade</p>
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                  4면 사진을 업로드하면 AI가 두상 윤곽을 굵게 스캔해 보여줘요.
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

              return (
                <div key={side} className="relative aspect-square min-h-0">
                  <input
                    ref={(el) => {
                      inputRefs.current[side] = el;
                    }}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    aria-label={`Select image for ${label}`}
                    onChange={(e) => void handleFileChange(side, e)}
                  />

                  {src === null ? (
                    <button
                      type="button"
                      onClick={() => openPicker(side)}
                      className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-500/60 bg-zinc-900/40 px-2 text-center text-zinc-300 transition hover:border-zinc-400 hover:bg-zinc-800/50 active:scale-[0.99]"
                    >
                      <PlusIcon className="h-8 w-8 text-zinc-400" />
                      <span className="text-sm font-medium text-zinc-200">{label}</span>
                    </button>
                  ) : (
                    <div className="relative h-full w-full overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 사용자 업로드 동적 data URL */}
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
                        className="pointer-events-none absolute inset-0 h-full w-full"
                        aria-hidden
                      />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/20" />

                      {loading ? (
                        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
                          <div className="flex items-center gap-3 rounded-lg bg-black/60 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/10 backdrop-blur-sm">
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            <span>🤖 Analyzing shape...</span>
                          </div>
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
                          onClick={() => openPicker(side)}
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
                가이드라인 시작하기{" "}
                <span className="font-semibold">(Start Step-by-Step Guide)</span>
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
