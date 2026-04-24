import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

export type FacePixelPoint = { x: number; y: number };

const WASM_FILES_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;

async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_FILES_BASE_URL);
      return await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          delegate: "GPU",
        },
        runningMode: "IMAGE",
        numFaces: 1,
        minFaceDetectionConfidence: 0.35,
        minFacePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    })();
  }
  return await faceLandmarkerPromise;
}

function pickFirstFaceLandmarks(result: FaceLandmarkerResult) {
  const first = result.faceLandmarks?.[0];
  if (!first || first.length === 0) return null;
  return first;
}

/**
 * 업로드된 이미지(HTMLImageElement)를 분석해 468개 얼굴 랜드마크의 픽셀 좌표를 반환합니다.
 * - 반환 좌표는 "원본 이미지(naturalWidth/Height)" 기준 픽셀 좌표입니다.
 */
export async function analyzeFace(
  imageElement: HTMLImageElement,
): Promise<FacePixelPoint[]> {
  if (!imageElement.complete || imageElement.naturalWidth === 0) {
    await new Promise<void>((resolve, reject) => {
      const onLoad = () => resolve();
      const onError = () => reject(new Error("Could not load image."));
      imageElement.addEventListener("load", onLoad, { once: true });
      imageElement.addEventListener("error", onError, { once: true });
    });
  }


  const landmarker = await getFaceLandmarker();
  const result = landmarker.detect(imageElement);
  const normalized = pickFirstFaceLandmarks(result);
  if (!normalized) return [];

  const w = imageElement.naturalWidth;
  const h = imageElement.naturalHeight;

  return normalized.map((pt) => ({
    x: pt.x * w,
    y: pt.y * h,
  }));
}

