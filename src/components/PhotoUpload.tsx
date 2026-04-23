"use client";

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

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

export type PhotoUploadProps = {
  /** 모든 슬롯의 사진이 바뀔 때마다 호출됩니다. data URL 또는 null입니다. */
  onPhotosChange?: (photos: PhotoSlotState) => void;
  /** 루트 컨테이너에 추가할 Tailwind 클래스 */
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

export function PhotoUpload({ onPhotosChange, className }: PhotoUploadProps) {
  const [photos, setPhotos] = useState<PhotoSlotState>(INITIAL_PHOTOS);
  const inputRefs = useRef<Record<FaceSide, HTMLInputElement | null>>({
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
      } catch {
        // MVP: 조용히 무시. 이후 토스트 등으로 확장 가능
      }
    },
    [commitPhotos],
  );

  const clearPhoto = useCallback(
    (side: FaceSide) => {
      commitPhotos((prev) => ({ ...prev, [side]: null }));
    },
    [commitPhotos],
  );

  const openPicker = useCallback((side: FaceSide) => {
    inputRefs.current[side]?.click();
  }, []);

  return (
    <div className={className}>
      {/* English Banner Style */}
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3.5 backdrop-blur-md">
        <span className="text-lg">💧</span>
        <p className="text-sm leading-relaxed text-zinc-300">
          <strong className="font-semibold text-white">Accuracy Tip: </strong> 
          Wet your hair with a spray bottle and tie it tightly with a hair tie. 
          This helps the AI identify your head shape precisely.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {SIDE_ORDER.map((side) => {
          const src = photos[side];
          const label = SIDE_LABELS[side];

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
                  <span className="text-sm font-medium text-zinc-200">
                    {label}
                  </span>
                </button>
              ) : (
                <div className="relative h-full w-full overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 사용자 업로드 동적 data URL */}
                  <img
                    src={src}
                    alt={`${label} preview`}
                    className="h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/30" />
                  <button
                    type="button"
                    onClick={() => clearPhoto(side)}
                    className="pointer-events-auto absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-black/70"
                    aria-label={`Delete ${label}`}
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                  <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex justify-center p-2">
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
    </div>
  );
}
