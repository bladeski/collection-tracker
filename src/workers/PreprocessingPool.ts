/**
 * Pool of dedicated workers that run image-preprocessing tasks off the
 * main thread. Used by `FifaScanImageService` for grayscale/contrast
 * transforms and text-likelihood scoring so the UI thread stays
 * responsive during a multi-sticker scan.
 *
 * Each worker handles one task at a time (workers can't parallelise a
 * single message handler) but the pool lets multiple workers share the
 * load. Tasks are routed round-robin so work is spread evenly.
 *
 * If the environment cannot construct workers (very old browser, file://
 * origin restrictions, etc.) the pool transparently falls back to
 * inlining the work on the main thread so the public API stays the same.
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

type WorkerResponse =
  | { type: 'preprocess'; id: number; ok: true; imageData: ImageData }
  | { type: 'preprocess'; id: number; ok: false; error: string }
  | { type: 'likelihood'; id: number; isLikelyText: boolean };

type PendingTask =
  | {
      kind: 'preprocess';
      resolve: (imageData: ImageData) => void;
      reject: (error: Error) => void;
    }
  | {
      kind: 'likelihood';
      resolve: (isLikelyText: boolean) => void;
      reject: (error: Error) => void;
    };

interface WorkerEntry {
  worker: Worker;
  busy: boolean;
  nextId: number;
}

interface PreprocessingPoolOptions {
  /** Number of workers to spawn. Defaults to hardwareConcurrency - 1 (capped). */
  size?: number;
  /** Absolute upper bound on the pool size, regardless of hardwareConcurrency. */
  maxSize?: number;
  /**
   * Lower bound on the pool size, used as a fallback when the
   * environment does not expose `navigator.hardwareConcurrency`.
   */
  fallbackSize?: number;
}

const DEFAULT_MAX_SIZE = 4;
const DEFAULT_FALLBACK_SIZE = 2;

/**
 * Pick a sensible pool size for the current environment. We avoid using
 * every available core so the browser's other tabs/window scripts aren't
 * starved.
 */
const resolvePoolSize = (options: PreprocessingPoolOptions): number => {
  const hardware = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  const fallback = options.fallbackSize ?? DEFAULT_FALLBACK_SIZE;
  if (typeof hardware === 'number' && Number.isFinite(hardware) && hardware > 1) {
    return Math.max(1, Math.min(options.maxSize ?? DEFAULT_MAX_SIZE, hardware - 1));
  }
  return fallback;
};

/**
 * Inline (main-thread) implementation of the preprocess transform. Used
 * as a fallback when workers can't be created. The math is identical to
 * the worker so behaviour is preserved.
 */
const runPreprocessOnMainThread = (
  imageData: ImageData,
  variant: PreprocessVariant
): ImageData => {
  const pixels = imageData.data;
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
  return imageData;
};

/**
 * Inline (main-thread) implementation of the text-likelihood check.
 * Used as a fallback when workers can't be created.
 */
const runLikelihoodOnMainThread = (imageData: ImageData): boolean => {
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

  return (
    darkRatio > 0.008 &&
    darkRatio < 0.85 &&
    brightRatio > 0.08 &&
    transitionRatio > 0.008
  );
};

/**
 * Collect ArrayBuffers that can be moved (rather than copied) when
 * posting a worker request. For an ImageData the only transferable is
 * its underlying `data` buffer; this is the single largest allocation
 * we ship across the worker boundary. Each buffer can only appear in
 * the transfer list once, so we de-dupe.
 */
const collectTransferables = (request: WorkerRequest): Transferable[] => {
  const seen = new Set<ArrayBuffer>();
  const transferables: Transferable[] = [];
  const visit = (imageData: ImageData | undefined) => {
    if (!imageData) {
      return;
    }
    const buffer = imageData.data.buffer;
    if (!seen.has(buffer)) {
      seen.add(buffer);
      transferables.push(buffer);
    }
  };
  if (request.type === 'preprocess') {
    visit(request.payload.imageData);
  } else if (request.type === 'likelihood') {
    visit(request.payload.imageData);
  }
  return transferables;
};

export default class PreprocessingPool {
  private readonly workers: WorkerEntry[] = [];
  private readonly pendingByWorker = new Map<Worker, PendingTask>();
  private readonly queue: Array<{ request: WorkerRequest; task: PendingTask }> = [];
  private nextRequestId = 1;
  private readonly usingFallback: boolean;
  private terminated = false;

  constructor(options: PreprocessingPoolOptions = {}) {
    const targetSize = Math.max(1, options.size ?? resolvePoolSize(options));

    // Try to construct workers; fall back to inline execution on any
    // failure so the API stays usable in restricted environments.
    if (typeof Worker === 'undefined') {
      this.usingFallback = true;
      return;
    }

    let constructed = 0;
    for (let i = 0; i < targetSize; i++) {
      try {
        const worker = new Worker(
          new URL('./imagePreprocessing.worker.ts', import.meta.url),
          { type: 'module' }
        );
        const entry: WorkerEntry = { worker, busy: false, nextId: 0 };
        worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
          this.handleResponse(worker, event.data);
        });
        worker.addEventListener('error', (event) => {
          this.handleWorkerError(worker, event);
        });
        this.workers.push(entry);
        constructed += 1;
      } catch {
        // Worker construction can fail for CSP reasons; stop trying.
        break;
      }
    }

    this.usingFallback = constructed === 0;
  }

  /**
   * Number of worker threads backing this pool. Falls back to 1 when
   * workers can't be created (work runs on the main thread in that case).
   */
  get size(): number {
    return this.workers.length || 1;
  }

  get isUsingFallback(): boolean {
    return this.usingFallback;
  }

  /**
   * Run the grayscale + contrast transform on the supplied ImageData.
   * Returns a new ImageData with the processed pixels in place.
   */
  async preprocess(imageData: ImageData, variant: PreprocessVariant): Promise<ImageData> {
    this.throwIfTerminated();
    if (this.usingFallback) {
      return runPreprocessOnMainThread(imageData, variant);
    }
    return new Promise<ImageData>((resolve, reject) => {
      const id = this.nextRequestId++;
      const request: PreprocessRequest = {
        type: 'preprocess',
        id,
        payload: { imageData, variant },
      };
      const task: PendingTask = {
        kind: 'preprocess',
        resolve,
        reject,
      };
      this.enqueue({ request, task });
    });
  }

  /**
   * Score whether the supplied ImageData looks like a text region.
   */
  async isLikelyText(imageData: ImageData): Promise<boolean> {
    this.throwIfTerminated();
    if (this.usingFallback) {
      return runLikelihoodOnMainThread(imageData);
    }
    return new Promise<boolean>((resolve, reject) => {
      const id = this.nextRequestId++;
      const request: LikelihoodRequest = {
        type: 'likelihood',
        id,
        payload: { imageData },
      };
      const task: PendingTask = {
        kind: 'likelihood',
        resolve,
        reject,
      };
      this.enqueue({ request, task });
    });
  }

  /**
   * Terminate all workers. Pending tasks are rejected. The pool cannot
   * be reused after this call.
   */
  terminate(): void {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    for (const task of this.queue) {
      task.task.reject(new Error('Preprocessing pool terminated.'));
    }
    this.queue.length = 0;
    for (const entry of this.workers) {
      this.pendingByWorker.delete(entry.worker);
      entry.worker.terminate();
    }
    this.workers.length = 0;
  }

  private throwIfTerminated(): void {
    if (this.terminated) {
      throw new Error('Preprocessing pool has been terminated.');
    }
  }

  private enqueue(item: { request: WorkerRequest; task: PendingTask }): void {
    const idleWorker = this.workers.find((entry) => !entry.busy);
    if (idleWorker) {
      this.dispatch(idleWorker, item);
      return;
    }
    this.queue.push(item);
  }

  private dispatch(entry: WorkerEntry, item: { request: WorkerRequest; task: PendingTask }): void {
    entry.busy = true;
    this.pendingByWorker.set(entry.worker, item.task);
    // Transfer the underlying pixel buffer to the worker instead of
    // structured-cloning it. For a large ID crop the .data buffer is the
    // single largest allocation we ship across the worker boundary, and
    // structured-cloning it would copy every byte. The worker rebuilds
    // the ImageData view over the transferred buffer, and we rebuild it
    // back on the main thread when the response arrives.
    const transferables = collectTransferables(item.request);
    entry.worker.postMessage(item.request, transferables);
  }

  private handleResponse(worker: Worker, response: WorkerResponse): void {
    const task = this.pendingByWorker.get(worker);
    if (!task) {
      return;
    }
    this.pendingByWorker.delete(worker);

    const entry = this.workers.find((candidate) => candidate.worker === worker);
    if (entry) {
      entry.busy = false;
    }

    try {
      if (response.type === 'preprocess') {
        if (task.kind !== 'preprocess') {
          return;
        }
        if (response.ok) {
          task.resolve(response.imageData);
        } else {
          task.reject(new Error(`Preprocess failed: ${response.error}`));
        }
      } else if (response.type === 'likelihood') {
        if (task.kind !== 'likelihood') {
          return;
        }
        task.resolve(response.isLikelyText);
      }
    } finally {
      this.pumpQueue();
    }
  }

  private handleWorkerError(worker: Worker, event: ErrorEvent): void {
    const task = this.pendingByWorker.get(worker);
    if (task) {
      this.pendingByWorker.delete(worker);
      task.reject(new Error(event.message || 'Worker error during preprocessing.'));
    }
    // Drop this worker from the pool; remaining workers can still serve.
    const index = this.workers.findIndex((entry) => entry.worker === worker);
    if (index !== -1) {
      const [removed] = this.workers.splice(index, 1);
      removed.worker.terminate();
    }
    this.pumpQueue();
  }

  private pumpQueue(): void {
    while (this.queue.length > 0) {
      const idleWorker = this.workers.find((entry) => !entry.busy);
      if (!idleWorker) {
        return;
      }
      const next = this.queue.shift();
      if (!next) {
        return;
      }
      this.dispatch(idleWorker, next);
    }
  }
}