"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

/** 정면/후면: 턱·이마·볼·관자(귀 쪽) 위주 윤곽 */
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

/** 인앱 카메라 오버레이 — 모든 슬롯 공통 (원거리 + 얼굴/눈 맞춤) */
const CAMERA_OVERLAY_HEADLINE = "팔을 쭉 뻗어 눈과 얼굴 윤곽을 맞춰주세요";

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

  const [cameraSide, setCameraSide] = useState<FaceSide | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
      setCameraError("이 브라우저는 카메라를 지원하지 않습니다.");
      return;
    }
    setCameraError(null);
    setVideoReady(false);
    try {
      stopStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" } },
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
          setCameraError("카메라 화면을 불러올 수 없습니다.");
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
          : "카메라에 접근할 수 없습니다. 권한을 확인해 주세요.";
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

  const openCamera = useCallback((side: FaceSide) => {
    setCameraError(null);
    setCameraSide(side);
  }, []);

  const closeCamera = useCallback(() => {
    setCameraSide(null);
  }, []);

  const captureFromVideo = useCallback(() => {
    const video = videoRef.current;
    const side = cameraSide;
    if (!video || !side) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      setCameraError("카메라가 아직 준비되지 않았습니다. 잠시 후 다시 눌러주세요.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // 화면(거울)과 동일: 비디오 버퍼는 미러가 아니므로 X축 뒤집기
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    commitPhotos((prev) => ({ ...prev, [side]: dataUrl }));
    setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
    setErrorMsg((prev) => ({ ...prev, [side]: null }));
    setCameraSide(null);
  }, [cameraSide, commitPhotos]);

  const clearPhoto = useCallback(
    (side: FaceSide) => {
      commitPhotos((prev) => ({ ...prev, [side]: null }));
      setLandmarksBySide((prev) => ({ ...prev, [side]: null }));
      setIsAnalyzing((prev) => ({ ...prev, [side]: false }));
      setErrorMsg((prev) => ({ ...prev, [side]: null }));
    },
    [commitPhotos],
  );

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
                  4면 사진을 촬영하면 AI가 두상 윤곽을 굵게 스캔해 보여줘요.
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
                  {src === null ? (
                    <button
                      type="button"
                      onClick={() => openCamera(side)}
                      className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-500/60 bg-zinc-900/40 px-2 text-center text-zinc-300 transition hover:border-zinc-400 hover:bg-zinc-800/50 active:scale-[0.99]"
                    >
                      <PlusIcon className="h-8 w-8 text-zinc-400" />
                      <span className="text-sm font-medium text-zinc-200">{label}</span>
                    </button>
                  ) : (
                    <div className="relative h-full w-full overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900">
                      {/* eslint-disable-next-line @next/next/no-img-element -- 캡처 data URL */}
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
                          onClick={() => openCamera(side)}
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
              aria-label="닫기"
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
              }}
            />

            <div
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-4"
              aria-hidden
            >
              <div className="flex w-full max-w-sm flex-col items-center">
                <p className="mb-3 text-center text-sm font-semibold leading-snug text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.8)] sm:mb-4 sm:max-w-md sm:text-base">
                  {CAMERA_OVERLAY_HEADLINE}
                </p>
                {/* 약 40~45% 뷰포트 높이 + 여권식 얼굴/눈 맞춤: 큰 타원 + 상단 눈형 원 2개 */}
                <div
                  className="relative h-[min(42.5dvh,45dvh,400px)] w-[min(30dvh,78vw,280px)] max-h-[45vh] shrink-0"
                >
                  <div
                    className="absolute inset-0 rounded-[100%] border-2 border-dashed border-white/90"
                    style={{
                      boxShadow: "0 0 0 100vmax rgba(0,0,0,0.45)",
                    }}
                  />
                  <div className="absolute inset-x-0 top-[24%] flex items-start justify-center gap-[clamp(1.5rem,12vw,3.25rem)] sm:top-[27%]">
                    <div className="h-[clamp(1.6rem,5.5vw,2.4rem)] w-[clamp(1.6rem,5.5vw,2.4rem)] shrink-0 rounded-full border border-dashed border-white/75" />
                    <div className="h-[clamp(1.6rem,5.5vw,2.4rem)] w-[clamp(1.6rem,5.5vw,2.4rem)] shrink-0 rounded-full border border-dashed border-white/75" />
                  </div>
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
              onClick={captureFromVideo}
              disabled={!!cameraError || !videoReady}
              className="w-full rounded-2xl bg-white py-4 text-center text-base font-extrabold text-zinc-950 shadow ring-1 ring-white/20 transition enabled:active:scale-[0.99] enabled:hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              촬영하기
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
