/**
 * Off-main-thread image preprocessor for the sticker scanner.
 *
 * Receives `ImageData` payloads from the main thread and either:
 *  - runs the grayscale + contrast-stretch + variant transform used by
 *    `FifaScanImageService.preprocessIdCrop`, or
 *  - runs the dark/bright/transition counts used by
 *    `FifaScanImageService.isLikelyTextRegion`.
 *
 * Both operations are pure pixel iteration over Uint8ClampedArray buffers
 * and run comfortably in a worker so the UI thread stays responsive while
 * the scan is in progress.
 */

type PreprocessVariant = 'raw' | 'normal' | 'inverted' | 'binary';

type PreprocessRequest = {
  type: 'preprocess';
  id: number;
  payload: {
    imageData: ImageData;
    variant: PreprocessVariant;
  };
};

type LikelihoodRequest = {
  type: 'likelihood';
  id: number;
  payload: {
    imageData: ImageData;
  };
};

type WorkerRequest = PreprocessRequest | LikelihoodRequest;

type PreprocessSuccess = {
  type: 'preprocess';
  id: number;
  ok: true;
  imageData: ImageData;
};

type PreprocessError = {
  type: 'preprocess';
  id: number;
  ok: false;
  error: string;
};

type LikelihoodResponse = {
  type: 'likelihood';
  id: number;
  isLikelyText: boolean;
};

type WorkerResponse = PreprocessSuccess | PreprocessError | LikelihoodResponse;

const ctx = self as DedicatedWorkerGlobalScope;

const processPreprocess = ({ id, payload }: PreprocessRequest): PreprocessSuccess | PreprocessError => {
  try {
    const { imageData, variant } = payload;
    const pixels = imageData.data;

    // Convert to grayscale and compute the luminance histogram in one pass.
    let min = 255;
    let max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.5) | 0;
      pixels[i] = lum;
      pixels[i + 1] = lum;
      pixels[i + 2] = lum;
      if (lum < min) {
        min = lum;
      }
      if (lum > max) {
        max = lum;
      }
    }

    // Aggressive contrast stretching pushes dark/light pixels further
    // apart so the OCR engine has more to work with. The `raw` variant
    // bypasses this for crops where contrast stretching actually loses
    // information (e.g. very low-light or already-high-contrast crops).
    const range = max - min || 1;
    for (let i = 0; i < pixels.length; i += 4) {
      const val = pixels[i];
      let output: number;
      if (variant === 'raw') {
        output = val;
      } else {
        const normalized = (val - min) / range;
        const enhanced = (normalized * 255 + 0.5) | 0;
        if (variant === 'inverted') {
          output = 255 - enhanced;
        } else if (variant === 'binary') {
          output = enhanced >= 135 ? 255 : 0;
        } else {
          output = enhanced;
        }
      }
      pixels[i] = output;
      pixels[i + 1] = output;
      pixels[i + 2] = output;
    }

    return { type: 'preprocess', id, ok: true, imageData };
  } catch (error) {
    return {
      type: 'preprocess',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const processLikelihood = ({ id, payload }: LikelihoodRequest): LikelihoodResponse => {
  const { imageData } = payload;
  const pixels = imageData.data;

  let darkPixels = 0;
  let brightPixels = 0;
  let transitions = 0;
  let previousIsDark: boolean | null = null;

  for (let i = 0; i < pixels.length; i += 4) {
    const lum = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2] + 0.5) | 0;
    const isDark = lum < 100;
    if (isDark) {
      darkPixels += 1;
    }
    if (lum > 200) {
      brightPixels += 1;
    }
    if (previousIsDark !== null && previousIsDark !== isDark) {
      transitions += 1;
    }
    previousIsDark = isDark;
  }

  const totalPixels = Math.max(1, imageData.width * imageData.height);
  const darkRatio = darkPixels / totalPixels;
  const brightRatio = brightPixels / totalPixels;
  const transitionRatio = transitions / totalPixels;

  // Text-like regions usually have mixed dark/light pixels and frequent
  // intensity transitions. The thresholds match the original
  // main-thread implementation so detection behaviour is preserved.
  const isLikelyText =
    darkRatio > 0.008 &&
    darkRatio < 0.85 &&
    brightRatio > 0.08 &&
    transitionRatio > 0.008;

  return { type: 'likelihood', id, isLikelyText };
};

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  let response: WorkerResponse;
  let transferables: Transferable[] = [];
  if (message.type === 'preprocess') {
    const result = processPreprocess(message);
    // The preprocess pass mutates the input buffer in place, so the
    // result's underlying buffer is the same ArrayBuffer we were just
    // handed. Transferring it back to the main thread avoids a second
    // structured-clone copy of the (potentially large) pixel buffer.
    if (result.ok) {
      transferables = [result.imageData.data.buffer];
    }
    response = result;
  } else if (message.type === 'likelihood') {
    response = processLikelihood(message);
  } else {
    return;
  }
  ctx.postMessage(response, transferables);
});