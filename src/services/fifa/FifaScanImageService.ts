import Tesseract from 'tesseract.js';
import { IImageReaderService } from '../../interfaces';
import PreprocessingPool from '../../workers/PreprocessingPool';

interface CropWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

type PreprocessVariant = 'raw' | 'normal' | 'inverted' | 'binary';

export interface DetectedSticker {
  /** The sticker ID (e.g. "ARG10"). */
  id: string;
  /** Bounding box of the sticker location in the original canvas coordinates. */
  box: CropWindow;
}

/**
 * Optional progress hook invoked while scanning an image for multiple stickers.
 * Use this to surface real-time feedback (e.g. drawing highlight rectangles
 * on the scanned image as each sticker is located).
 */
export type ScanProgressCallback = (detected: DetectedSticker) => void;

/**
 * Thrown from `extractStickerIds` when the caller aborts the scan via the
 * supplied `AbortSignal`. The current in-flight OCR call is allowed to
 * finish (we never tear down a wasm worker mid-call) but no further
 * regions, tiles, or variants will be processed.
 */
export class ScanCancelledError extends Error {
  constructor() {
    super('Sticker scan was cancelled.');
    this.name = 'ScanCancelledError';
  }
}

export default class FifaScanImageService {
  imageReaderService: IImageReaderService;
  preprocessingPool: PreprocessingPool;
  private readonly debug = true;
  private readonly minCropWidth = 56;
  private readonly minCropHeight = 18;
  private static yieldCounter = 0;

  constructor(
    imageReaderService: IImageReaderService,
    preprocessingPool?: PreprocessingPool
  ) {
    this.imageReaderService = imageReaderService;
    // Allow the caller to inject a worker pool so the same pool can be
    // shared across multiple scans; fall back to a fresh pool otherwise.
    this.preprocessingPool = preprocessingPool ?? new PreprocessingPool();
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }

  private error(...args: unknown[]): void {
    if (this.debug) {
      console.error(...args);
    }
  }

  private async yieldToBrowser(): Promise<void> {
    // Only yield every 10 iterations to reduce scheduling overhead
    FifaScanImageService.yieldCounter++;
    
    if (FifaScanImageService.yieldCounter % 10 === 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  }

  /**
   * Throws `ScanCancelledError` if the supplied signal has been aborted.
   * Used as a guard at every natural await boundary so a long-running
   * scan can exit promptly without tearing down the wasm OCR worker
   * mid-call.
   */
  private throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new ScanCancelledError();
    }
  }

  private normalizeInputCanvas(
    source: HTMLCanvasElement,
    maxDimension = 1400
  ): HTMLCanvasElement {
    const largestDimension = Math.max(source.width, source.height);
    if (largestDimension <= maxDimension) {
      return source;
    }

    const scale = maxDimension / largestDimension;
    const normalized = document.createElement('canvas');
    normalized.width = Math.max(1, Math.round(source.width * scale));
    normalized.height = Math.max(1, Math.round(source.height * scale));

    const ctx = normalized.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to get canvas context');
    }

    ctx.drawImage(source, 0, 0, normalized.width, normalized.height);
    return normalized;
  }

  private toCanvas(image: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
    if (image instanceof HTMLCanvasElement) {
      return image;
    }

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to get canvas context');
    }
    ctx.drawImage(image, 0, 0);
    return sourceCanvas;
  }

  private static nextCropId = 1;

  private cropCanvasRegion(
    source: HTMLCanvasElement,
    x: number,
    y: number,
    width: number,
    height: number
  ): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = Math.max(1, width);
    out.height = Math.max(1, height);

    // Tag the crop with a unique id so the preprocess cache can
    // distinguish two crops that happen to share the same dimensions
    // (e.g. two windows in a 2x2 grid are both half-width, half-height).
    (out as HTMLCanvasElement & { _scanCacheId?: number })._scanCacheId =
      FifaScanImageService.nextCropId++;

    const ctx = out.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to get canvas context');
    }

    ctx.drawImage(source, x, y, width, height, 0, 0, out.width, out.height);
    return out;
  }

  private clampWindowToCanvas(canvas: HTMLCanvasElement, window: CropWindow): CropWindow | null {
    const x = Math.max(0, Math.round(window.x));
    const y = Math.max(0, Math.round(window.y));
    const width = Math.min(canvas.width - x, Math.max(1, Math.round(window.width)));
    const height = Math.min(canvas.height - y, Math.max(1, Math.round(window.height)));

    if (x >= canvas.width || y >= canvas.height || width <= 0 || height <= 0) {
      return null;
    }

    return { x, y, width, height };
  }

  private async preprocessIdCrop(
    idCanvas: HTMLCanvasElement,
    mode: 'fast' | 'accurate' = 'fast',
    variant: PreprocessVariant = 'normal'
  ): Promise<HTMLCanvasElement> {
    const targetWidth = mode === 'fast' ? 900 : 1400;
    const maxScale = mode === 'fast' ? 10 : 16;
    const scale = Math.max(
      4,
      Math.min(maxScale, Math.round(targetWidth / Math.max(1, idCanvas.width)))
    );

    // The cheap canvas-resize step (drawImage with nearest-neighbour
    // smoothing off) stays on the main thread; it's just a copy and
    // requires a real Canvas2D context. The slow per-pixel grayscale +
    // contrast stretch is delegated to the worker pool so the UI thread
    // stays responsive while many crops are being prepared.
    const scaled = document.createElement('canvas');
    scaled.width = Math.max(1, idCanvas.width * scale);
    scaled.height = Math.max(1, idCanvas.height * scale);

    const scaledCtx = scaled.getContext('2d');
    if (!scaledCtx) {
      throw new Error('Unable to get canvas context');
    }
    scaledCtx.imageSmoothingEnabled = false;
    scaledCtx.drawImage(idCanvas, 0, 0, scaled.width, scaled.height);

    const imageData = scaledCtx.getImageData(0, 0, scaled.width, scaled.height);
    const processed = await this.preprocessingPool.preprocess(imageData, variant);

    const out = document.createElement('canvas');
    out.width = processed.width;
    out.height = processed.height;
    const outCtx = out.getContext('2d');
    if (!outCtx) {
      throw new Error('Unable to get canvas context');
    }
    outCtx.putImageData(processed, 0, 0);
    return out;
  }

  /**
   * Cache of preprocessed canvases keyed by (source id + variant). The
   * scan pipeline tries the same source canvas with several preprocess
   * variants; without this cache each variant triggers a full
   * upscale + ImageData copy + worker roundtrip. Because the source
   * canvas is mutable we key by identity, not content, and clear the
   * cache whenever a new scan starts.
   */
  private readonly preprocessCache = new Map<string, HTMLCanvasElement>();

  /**
   * Cache of text likelihood results to avoid repeated worker roundtrips
   * for the same crop shape/path.
   */
  private readonly textLikelihoodCache = new Map<string, boolean>();

  private async getPreprocessedIdCrop(
    idCanvas: HTMLCanvasElement,
    mode: 'fast' | 'accurate',
    variant: PreprocessVariant
  ): Promise<HTMLCanvasElement> {
    const cacheKey = `${(idCanvas as HTMLCanvasElement & { _scanCacheId?: number })._scanCacheId ?? ''}|${idCanvas.width}x${idCanvas.height}|${mode}|${variant}`;
    const cached = this.preprocessCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const prepared = await this.preprocessIdCrop(idCanvas, mode, variant);
    this.preprocessCache.set(cacheKey, prepared);
    return prepared;
  }

  private clearPreprocessCache(): void {
    this.preprocessCache.clear();
    this.textLikelihoodCache.clear(); // Also clear the text likelihood cache
  }

  private async isLikelyTextRegion(cropCanvas: HTMLCanvasElement): Promise<boolean> {
    // Create a cache key based on dimensions and scan cache ID
    const cacheKey = `${(cropCanvas as HTMLCanvasElement & { _scanCacheId?: number })._scanCacheId ?? ''}|${cropCanvas.width}x${cropCanvas.height}`;
    
    // Check if we have a cached result
    const cached = this.textLikelihoodCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    
    const ctx = cropCanvas.getContext('2d');
    if (!ctx) {
      return false;
    }

    const imageData = ctx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
    const result = await this.preprocessingPool.isLikelyText(imageData);
    
    // Cache the result
    this.textLikelihoodCache.set(cacheKey, result);
    return result;
  }

  // private cleanExtractedId(
  //   raw: string,
  //   idList: string[] = [],
  //   countryCodes: string[] = []
  // ): string | null {
  //   this.log('OCR raw:', raw);

  //   const matches = this.extractAllIdsFromText(raw, idList, countryCodes);
  //   if (matches.length > 0) {
  //     const id = matches[matches.length - 1];
  //     this.log('OCR match found:', id);
  //     return id;
  //   }

  //   this.log('OCR no match found');
  //   return null;
  // }

  private async tryReadId(
    cropCanvas: HTMLCanvasElement,
    regionIndex: number = 0,
    windowIndex: number = 0,
    idList: string[] = [],
    countryCodes: string[] = [],
    mode: 'fast' | 'accurate' = 'fast',
    enforceLikelihood = true
  ): Promise<string | null> {
    try {
      if (cropCanvas.width < this.minCropWidth || cropCanvas.height < this.minCropHeight) {
        this.log(
          `[Region ${regionIndex}, Window ${windowIndex}] Skipping tiny crop ${cropCanvas.width}x${cropCanvas.height}`
        );
        return null;
      }

      // The `isLikelyText` check is most useful for tiny, ambiguous
      // crops. For crops that already cover a substantial portion of
      // the input (e.g. the global header/fallback passes and the
      // per-tile fallback) it almost always returns true and the
      // worker roundtrip just costs time. The threshold matches the
      // 200x150 "obvious-text" minimum that historically always
      // produced a non-empty OCR result.
      const cropArea = cropCanvas.width * cropCanvas.height;
      const skipLikelihood = !enforceLikelihood || cropArea >= 30000;
      if (!skipLikelihood && !(await this.isLikelyTextRegion(cropCanvas))) {
        this.log(
          `[Region ${regionIndex}, Window ${windowIndex}] Skipping low-text-likelihood crop ${cropCanvas.width}x${cropCanvas.height}`
        );
        return null;
      }

      // Use block-level page seg mode for large crops so multi-line text is handled correctly.
      const pageSegMode: Tesseract.PSM = cropArea > 30000 ? Tesseract.PSM.SINGLE_BLOCK : Tesseract.PSM.SINGLE_LINE;

      let raw = '';
      // The sticker ID badge is white text on a dark background, so try
      // 'inverted' first (gives Tesseract dark-on-light which it prefers),
      // then 'normal' as fallback. Accurate mode also adds 'binary'.
      const variantsToTry: PreprocessVariant[] = mode === 'fast' ? ['inverted', 'normal'] : ['inverted', 'normal', 'binary'];
      
      for (const variant of variantsToTry) {
        const preparedCrop = await this.getPreprocessedIdCrop(cropCanvas, mode, variant);
        raw = await this.imageReaderService.readImage(preparedCrop, pageSegMode);
        if (raw.trim()) {
          break;
        }
      }

      this.log(`[Region ${regionIndex}, Window ${windowIndex}] Raw OCR result: "${raw}"`);
      return this.cleanExtractedId(raw, idList, countryCodes);
    } catch (error) {
      this.error(`[Region ${regionIndex}, Window ${windowIndex}] OCR error:`, error);
      return null;
    }
  }

  private buildRegionCandidates(canvas: HTMLCanvasElement): CropWindow[] {
    const { width, height } = canvas;

    return [
      { x: 0, y: 0, width, height },
      { x: width * 0.05, y: height * 0.03, width: width * 0.9, height: height * 0.9 },
      { x: width * 0.12, y: height * 0.06, width: width * 0.76, height: height * 0.84 },
      { x: width * 0.2, y: height * 0.1, width: width * 0.6, height: height * 0.75 },
    ];
  }

  private buildIdWindowCandidates(region: CropWindow): CropWindow[] {
    // Generate 3-5 candidate windows covering the upper-right and center portions where sticker IDs typically appear
    // Using fewer, tighter windows to reduce OCR attempts
    return [
      // Tight crop directly on the dark ID capsule badge (top-right corner).
      // The badge sits at approximately the top 12%, rightmost 30% of the sticker.
      {
        x: region.x + region.width * 0.68,
        y: region.y + region.height * 0.00,
        width: region.width * 0.30,
        height: region.height * 0.14,
      },
      // Top-right capsule (primary location for FIFA sticker IDs)
      {
        x: region.x + region.width * 0.60,
        y: region.y + region.height * 0.02,
        width: region.width * 0.35,
        height: region.height * 0.20,
      },
      // Slightly larger top-right backup
      {
        x: region.x + region.width * 0.55,
        y: region.y + region.height * 0.01,
        width: region.width * 0.40,
        height: region.height * 0.25,
      },
      // Wide top strip backup
      {
        x: region.x + region.width * 0.30,
        y: region.y + region.height * 0.0,
        width: region.width * 0.70,
        height: region.height * 0.20,
      },
    ];
  }

  private buildGlobalHeaderCandidates(canvas: HTMLCanvasElement): CropWindow[] {
    const { width, height } = canvas;
    return [
      // Most single-sticker photos place the ID capsule in the top-right.
      // Try a tight crop first to reduce OCR noise and work.
      { x: width * 0.66, y: height * 0.00, width: width * 0.33, height: height * 0.16 },
      { x: width * 0.10, y: height * 0.00, width: width * 0.85, height: height * 0.24 },
      { x: width * 0.05, y: height * 0.02, width: width * 0.90, height: height * 0.30 },
      { x: width * 0.08, y: height * 0.06, width: width * 0.84, height: height * 0.28 },
    ];
  }

  private buildGlobalFallbackCandidates(canvas: HTMLCanvasElement): CropWindow[] {
    const { width, height } = canvas;
    return [
      { x: width * 0.00, y: height * 0.00, width: width * 1.00, height: height * 0.45 },
      { x: width * 0.00, y: height * 0.00, width: width * 1.00, height: height * 0.60 },
    ];
  }

  async extractStickerId(
    image: HTMLImageElement | HTMLCanvasElement,
    idList?: string[],
    countryCodes?: string[]
  ): Promise<string | null> {
    this.log('Starting sticker ID extraction...');
    // Reset the per-scan preprocess cache so leftover entries from a
    // prior scan can't be reused (the source canvases from that scan
    // may have been mutated in place by the main-thread fallback path).
    this.clearPreprocessCache();
    const canvas = this.normalizeInputCanvas(this.toCanvas(image));
    this.log(`Normalized canvas dimensions: ${canvas.width}x${canvas.height}`);
    const regions = this.buildRegionCandidates(canvas);
    this.log(`Generated ${regions.length} region candidates for ID extraction.`);

    const globalCandidates = this.buildGlobalHeaderCandidates(canvas);
    for (let i = 0; i < globalCandidates.length; i++) {
      const candidate = this.clampWindowToCanvas(canvas, globalCandidates[i]);
      if (!candidate) {
        continue;
      }

      this.log(
        `[global] Processing header candidate ${i}: x=${candidate.x}, y=${candidate.y}, width=${candidate.width}, height=${candidate.height}`
      );

      const headerCrop = this.cropCanvasRegion(
        canvas,
        candidate.x,
        candidate.y,
        candidate.width,
        candidate.height
      );

      const headerId = await this.tryReadId(
        headerCrop,
        -1,
        i,
        idList,
        countryCodes,
        'accurate',
        false
      );
      if (headerId) {
        this.log(`✓ Found sticker ID (global): ${headerId}`);
        return headerId;
      }

      await this.yieldToBrowser();
    }

    const globalFallbacks = this.buildGlobalFallbackCandidates(canvas);
    for (let i = 0; i < globalFallbacks.length; i++) {
      const candidate = this.clampWindowToCanvas(canvas, globalFallbacks[i]);
      if (!candidate) {
        continue;
      }

      this.log(
        `[global-fallback] Processing candidate ${i}: x=${candidate.x}, y=${candidate.y}, width=${candidate.width}, height=${candidate.height}`
      );

      const fallbackCrop = this.cropCanvasRegion(
        canvas,
        candidate.x,
        candidate.y,
        candidate.width,
        candidate.height
      );

      const fallbackId = await this.tryReadId(
        fallbackCrop,
        -2,
        i,
        idList,
        countryCodes,
        'accurate',
        false
      );
      if (fallbackId) {
        this.log(`✓ Found sticker ID (global-fallback): ${fallbackId}`);
        return fallbackId;
      }

      await this.yieldToBrowser();
    }

    const regionPriority = [1, 0, 2, 3];
    const fastWindowPriority = [0, 2]; // Reduced from 8 windows to 3
    const accurateWindowPriority = [0, 2, 1]; // Reduced from 8 windows to 4
    const maxFastAttempts = 2; // Reduced from 6 to 2
    const maxAccurateAttempts = 4; // Reduced from 12 to 4

    const runPass = async (
      mode: 'fast' | 'accurate',
      windowPriority: number[],
      maxAttempts: number
    ): Promise<string | null> => {
      let attempts = 0;
      for (const regionIndex of regionPriority) {
        const region = regions[regionIndex];
        if (!region) {
          continue;
        }

        this.log(
          `[${mode}] Processing region ${regionIndex}: x=${region.x}, y=${region.y}, width=${region.width}, height=${region.height}`
        );
        await this.yieldToBrowser();

        const idWindows = this.buildIdWindowCandidates(region);
        for (const windowIndex of windowPriority) {
          if (attempts >= maxAttempts) {
            return null;
          }

          const window = idWindows[windowIndex];
          if (!window) {
            continue;
          }

          const clamped = this.clampWindowToCanvas(canvas, window);
          if (!clamped) {
            continue;
          }

          attempts += 1;
          this.log(
            `[${mode}] Processing region ${regionIndex}, window ${windowIndex}: x=${clamped.x}, y=${clamped.y}, width=${clamped.width}, height=${clamped.height}`
          );

          const idCrop = this.cropCanvasRegion(
            canvas,
            clamped.x,
            clamped.y,
            clamped.width,
            clamped.height
          );
          const id = await this.tryReadId(
            idCrop,
            regionIndex,
            windowIndex,
            idList,
            countryCodes,
            mode,
            mode === 'fast'
          );
          if (id) {
            this.log(`✓ Found sticker ID (${mode}): ${id}`);
            return id;
          }

          await this.yieldToBrowser();
        }
      }
      return null;
    };

    const fastResult = await runPass('fast', fastWindowPriority, maxFastAttempts);
    if (fastResult) {
      return fastResult;
    }

    const accurateResult = await runPass('accurate', accurateWindowPriority, maxAccurateAttempts);
    if (accurateResult) {
      return accurateResult;
    }

    this.log('✗ No sticker ID found after scanning all regions and windows');
    return null;
  }

  /**
   * Build a grid of tile CropWindows covering the whole canvas for a given
   * rows × cols layout. Returns tiles in reading order (top-to-bottom,
   * left-to-right).
   */
  private buildGridTiles(
    canvas: HTMLCanvasElement,
    rows: number,
    cols: number
  ): CropWindow[] {
    if (rows < 1 || cols < 1) {
      return [];
    }

    const { width, height } = canvas;
    const tileWidth = width / cols;
    const tileHeight = height / rows;
    const tiles: CropWindow[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        tiles.push({
          x: col * tileWidth,
          y: row * tileHeight,
          width: tileWidth,
          height: tileHeight,
        });
      }
    }
    return tiles;
  }

  /**
   * Build horizontal row-strip tiles. The number of rows is derived from the
   * image's aspect ratio so that each tile is approximately square-ish, which
   * matches the natural proportions of a sticker photograph.
   */
  private buildRowStripTiles(canvas: HTMLCanvasElement): CropWindow[] {
    const { width, height } = canvas;
    const aspect = width / Math.max(1, height);

    // Pick a row count that keeps each strip close to a square aspect.
    let rows: number;
    if (aspect >= 2.5) {
      rows = 3;
    } else if (aspect >= 1.6) {
      rows = 2;
    } else {
      rows = 1;
    }

    return this.buildGridTiles(canvas, rows, 1);
  }

  /**
   * Build the union of layout sets we try when scanning an image for
   * multiple stickers: row strips (1-3 rows), 2x2 and 3x2 grids. The order is
   * row-strip first because it is the most common sticker-photo layout.
   * 
   * Optimized to only try layouts that are most likely based on aspect ratio.
   */
  private buildMultiStickerLayouts(canvas: HTMLCanvasElement): CropWindow[][] {
    const { width, height } = canvas;
    const aspect = width / Math.max(1, height);
    
    // Choose layouts based on aspect ratio
    if (aspect >= 2.5) {
      // Very wide image - prioritize row strips
      return [
        this.buildRowStripTiles(canvas),
        this.buildGridTiles(canvas, 2, 2),
      ];
    } else if (aspect >= 1.6) {
      // Moderately wide - try both row strip and 2x2 grid
      return [
        this.buildRowStripTiles(canvas),
        this.buildGridTiles(canvas, 2, 2),
      ];
    } else {
      // Square or tall image - prioritize 2x2 grid
      return [
        this.buildGridTiles(canvas, 2, 2),
        this.buildRowStripTiles(canvas),
      ];
    }
  }

  /**
   * Scan a single tile (or any sub-region) for exactly one sticker ID. Uses
   * the same candidate-region + window strategy as `extractStickerId` but
   * skips the global header/fallback passes, since those are only useful when
   * the whole image is a single sticker.
   */
  private async scanTileForStickerId(
    tile: HTMLCanvasElement,
    tileBox: CropWindow,
    idList?: string[],
    countryCodes?: string[],
    signal?: AbortSignal
  ): Promise<string | null> {
    this.throwIfCancelled(signal);

    // Fast path: run a single OCR pass over the entire tile. Tesseract's
    // block mode (PSM 6) finds text wherever it sits in the image, so for
    // the common "sticker roughly fills the tile" case we can find the ID
    // with one worker roundtrip + one OCR call instead of enumerating 8+
    // candidate windows. This dominates the per-tile cost for grid
    // layouts where each tile is a single sticker photo.
    const directId = await this.tryReadId(
      tile,
      0,
      -1,
      idList,
      countryCodes,
      'fast',
      false
    );
    if (directId) {
      this.log(`✓ Found sticker ID in tile (direct fast): ${directId}`);
      return directId;
    }

    this.throwIfCancelled(signal);

    const regionPriority = [1, 0, 2, 3];
    const fastWindowPriority = [0, 2]; // Reduced from 6 windows to 3
    const accurateWindowPriority = [0, 2, 1]; // Reduced from 8 windows to 4
    const maxFastAttempts = 2; // Reduced from 3 to 2
    const maxAccurateAttempts = 4; // Reduced from 6 to 4

    const runPass = async (
      mode: 'fast' | 'accurate',
      windowPriority: number[],
      maxAttempts: number
    ): Promise<string | null> => {
      let attempts = 0;
      for (const regionIndex of regionPriority) {
        this.throwIfCancelled(signal);
        if (attempts >= maxAttempts) {
          return null;
        }

        const region = this.buildRegionCandidates(tile)[regionIndex];
        if (!region) {
          continue;
        }

        await this.yieldToBrowser();
        this.throwIfCancelled(signal);

        const idWindows = this.buildIdWindowCandidates(region);
        for (const windowIndex of windowPriority) {
          this.throwIfCancelled(signal);
          if (attempts >= maxAttempts) {
            return null;
          }

          const window = idWindows[windowIndex];
          if (!window) {
            continue;
          }

          const clamped = this.clampWindowToCanvas(tile, window);
          if (!clamped) {
            continue;
          }

          attempts += 1;

          const idCrop = this.cropCanvasRegion(
            tile,
            clamped.x,
            clamped.y,
            clamped.width,
            clamped.height
          );
          const id = await this.tryReadId(
            idCrop,
            regionIndex,
            windowIndex,
            idList,
            countryCodes,
            mode,
            mode === 'fast'
          );
          if (id) {
            this.log(`✓ Found sticker ID in tile (${mode}): ${id}`);
            return id;
          }

          await this.yieldToBrowser();
          this.throwIfCancelled(signal);
        }
      }
      return null;
    };

    const fastResult = await runPass('fast', fastWindowPriority, maxFastAttempts);
    if (fastResult) {
      return fastResult;
    }

    this.throwIfCancelled(signal);
    return runPass('accurate', accurateWindowPriority, maxAccurateAttempts);
  }

  /**
   * OCR a horizontal strip from the top of the image where sticker IDs sit
   * (right after the "FIFA WORLD CUP 2026" header) and return every valid
   * sticker ID found, in left-to-right reading order.
   *
   * This handles "row of stickers" compositions (1xN, 2xN, 3xN) far more
   * reliably than per-tile scanning because the OCR sees each sticker's ID
   * in its own spatial position rather than being mixed with neighbouring
   * stickers' text.
   */
  private async scanTopIdBand(
    canvas: HTMLCanvasElement,
    idList?: string[],
    countryCodes?: string[],
    signal?: AbortSignal,
    bandFraction = 0.20
  ): Promise<string[]> {
    const { width, height } = canvas;

    // The ID strip is the top portion of the image. A tighter band keeps OCR
    // focused on the top-right capsule and avoids logo/body-text noise.
    const bandHeight = Math.round(height * bandFraction);
    const bandBox: CropWindow = { x: 0, y: 0, width, height: bandHeight };
    const clamped = this.clampWindowToCanvas(canvas, bandBox);
    if (!clamped) {
      return [];
    }

    const bandCanvas = this.cropCanvasRegion(
      canvas,
      clamped.x,
      clamped.y,
      clamped.width,
      clamped.height
    );

    if (
      bandCanvas.width < this.minCropWidth ||
      bandCanvas.height < this.minCropHeight
    ) {
      return [];
    }

    // Skip very plain bands (no text-like content at all) so we don't waste
    // an OCR call on a completely blank or uniform strip.
    if (!(await this.isLikelyTextRegion(bandCanvas))) {
      this.log('[top-band] Skipping band with low text likelihood');
      return [];
    }

    this.throwIfCancelled(signal);

    // Use block page-seg mode (6) so multiple sticker IDs on the same
    // line are treated as one block. Try 'inverted' first because the ID
    // badge has white text on a dark background; Tesseract works better
    // with dark text on a light background.
    let raw = '';
    const variantsToTry: PreprocessVariant[] = ['inverted', 'normal'];
    
    for (let i = 0; i < variantsToTry.length; i++) {
      this.throwIfCancelled(signal);
      const variant = variantsToTry[i];
      const prepared = await this.getPreprocessedIdCrop(bandCanvas, 'accurate', variant);
      raw = await this.imageReaderService.readImage(prepared, Tesseract.PSM.SINGLE_BLOCK);
      if (raw.trim()) {
        break;
      }
      // Allow the browser to breathe and check for cancellation between
      // the variant attempts even if the first produced empty text.
      await this.yieldToBrowser();
      this.throwIfCancelled(signal);
    }

    this.log(`[top-band] Raw OCR result: "${raw}"`);
    return this.extractAllIdsFromText(raw, idList, countryCodes);
  }

  /**
   * Parse every valid sticker ID out of an OCR string. The OCR may return
   * multiple IDs on a single line (e.g. "ARG10 USA7 MEX3" for three stickers
   * in a row). Unlike `cleanExtractedId` which returns only one ID, this
   * preserves order so callers can map matches back to spatial positions.
   */
  private extractAllIdsFromText(
    raw: string,
    idList: string[] = [],
    countryCodes: string[] = []
  ): string[] {
    if (!raw || !raw.trim()) {
      return [];
    }

    const upper = raw
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // FIFA sticker IDs sit after the "2026" header. When the OCR captures
    // the header we can ignore everything before the year; otherwise we
    // search the full string.
    const parts = upper.split('2026');
    const afterYear = parts.length > 1 ? parts[parts.length - 1].trim() : '';
    const candidates = afterYear.length > 0 ? afterYear : upper;

    // Use a broader detection regex first
    const PATTERN = /\b([A-Z]{2,4})\s*(\d{1,3})(?!\d)\b/g;
    const FALSE_POSITIVES = new Set(['CUP', 'WOR', 'ORL', 'FIF', 'IFA', 'RLD']);
    const allowedPrefixes = new Set(
      countryCodes
        .map((code) => code.toUpperCase())
        .filter((code) => /^[A-Z]{2,3}$/.test(code))
    );

    const matches: string[] = [];
    PATTERN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PATTERN.exec(candidates)) !== null) {
      const prefix = m[1];
      const candidate = prefix + m[2];
      if (FALSE_POSITIVES.has(prefix)) {
        continue;
      }
      if (allowedPrefixes.size > 0 && !allowedPrefixes.has(prefix)) {
        continue;
      }
      if (idList.length > 0 && !idList.includes(candidate)) {
        continue;
      }
      matches.push(candidate);
    }
    return matches;
  }

  private cleanExtractedId(
    raw: string,
    idList: string[] = [],
    countryCodes: string[] = []
  ): string | null {
    this.log('OCR raw:', raw);

    const matches = this.extractAllIdsFromText(raw, idList, countryCodes);
    if (matches.length > 0) {
      // Use catalogue-aware correction for better accuracy
      const correctedMatches = matches.map(match => this.correctOcrError(match, idList, countryCodes));
      const bestMatch = this.findBestMatch(correctedMatches, idList, countryCodes);
      this.log('OCR match found:', bestMatch);
      return bestMatch;
    }

    this.log('OCR no match found');
    return null;
  }

  /**
   * Correct common OCR confusion patterns
   */
  private correctOcrError(id: string, idList: string[], countryCodes: string[]): string {
    // Split into alpha prefix and numeric suffix so digit corrections are
    // only applied to the letter part. Applying 0→O to the number suffix
    // would corrupt valid IDs (e.g. "QAT10" → "QATIO").
    const splitMatch = id.match(/^([A-Z]+)(\d+)$/);
    if (!splitMatch) {
      return id;
    }
    const [, prefix, suffix] = splitMatch;
    const correctedPrefix = prefix
      .replace(/0/g, 'O')
      .replace(/1/g, 'I')
      .replace(/5/g, 'S')
      .replace(/8/g, 'B');
    let corrected = correctedPrefix + suffix;

    // If the corrected version is in our catalogue, use it
    if (idList.includes(corrected) || countryCodes.includes(corrected)) {
      return corrected;
    }

    // Try to find a fuzzy match with minimal edit distance
    const bestFuzzyMatch = this.findClosestMatch(corrected, idList, countryCodes);
    if (bestFuzzyMatch) {
      return bestFuzzyMatch;
    }

    return id; // Return original if no correction applies
  }

  /**
   * Find the best match based on exact match, prefix match, then fuzzy matching
   */
  private findBestMatch(matches: string[], idList: string[], countryCodes: string[]): string | null {
    // Score candidates by priority:
    // 1. Exact match in idList
    // 2. Exact match in countryCodes (prefix)
    // 3. Fuzzy match with minimal edit distance
    // 4. First valid candidate
    
    for (const match of matches) {
      if (idList.includes(match)) {
        return match;
      }
    }

    for (const match of matches) {
      if (countryCodes.includes(match)) {
        return match;
      }
    }

    // Try fuzzy matching
    for (const match of matches) {
      const fuzzyMatch = this.findClosestMatch(match, idList, countryCodes);
      if (fuzzyMatch) {
        return fuzzyMatch;
      }
    }

    // Return first valid match if none of the above apply
    return matches[0] || null;
  }

  /**
   * Find closest match using edit distance
   */
  private findClosestMatch(candidate: string, idList: string[], countryCodes: string[]): string | null {
    const allCandidates = [...idList, ...countryCodes];
    
    let bestMatch = null;
    let minDistance = Infinity;

    for (const item of allCandidates) {
      const distance = this.levenshteinDistance(candidate, item);
      if (distance < minDistance && distance <= 2) { // Only consider matches with small edit distance
        minDistance = distance;
        bestMatch = item;
      }
    }

    return bestMatch;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(0));

    for (let i = 0; i <= a.length; i++) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= b.length; j++) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        if (b[j - 1] === a[i - 1]) {
          matrix[j][i] = matrix[j - 1][i - 1];
        } else {
          matrix[j][i] = Math.min(
            matrix[j - 1][i] + 1, // deletion
            matrix[j][i - 1] + 1, // insertion
            matrix[j - 1][i - 1] + 1 // substitution
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Scan an image for multiple sticker IDs. Splits the image using several
   * layout candidates (row strips, 2x2 and 3x2 grids), runs the per-tile
   * single-sticker scan on each tile, and returns the unique IDs found along
   * with each sticker's bounding box in the original canvas coordinates.
   *
   * If `onProgress` is provided it is invoked synchronously each time a new
   * sticker is detected, so callers can update their UI (e.g. highlight
   * rectangles on the scanned image) in real time.
   *
   * If `signal` is provided the caller can abort the scan by calling
   * `abortController.abort()`. In that case the method throws a
   * `ScanCancelledError` once any in-flight OCR call has finished and no
   * further regions, tiles, or variants will be processed. Stickers
   * already detected and emitted via `onProgress` remain valid; this
   * method does not return partial results — the caller should catch the
   * error and use those prior emissions as the final result set.
   *
   * The primary strategy is a single OCR pass on the top ID band, which
   * captures every sticker ID on the top row in reading order. This is
   * far more reliable than per-tile scans for row-style sticker photos
   * (e.g. 3 stickers in a row), because per-tile OCR often mixes text
   * from adjacent stickers. The per-tile scan is retained as a fallback
   * for grid layouts and other edge cases.
   */
  async extractStickerIds(
    image: HTMLImageElement | HTMLCanvasElement,
    idList?: string[],
    countryCodes?: string[],
    onProgress?: ScanProgressCallback,
    signal?: AbortSignal
  ): Promise<DetectedSticker[]> {
    this.log('Starting multi-sticker ID extraction...');
    this.clearPreprocessCache();
    const canvas = this.normalizeInputCanvas(this.toCanvas(image));
    this.log(`Normalized canvas dimensions: ${canvas.width}x${canvas.height}`);

    const results: DetectedSticker[] = [];
    const seen = new Set<string>();

    const emit = (detected: DetectedSticker) => {
      if (seen.has(detected.id)) {
        return;
      }
      seen.add(detected.id);
      results.push(detected);
      this.log(`✓ Detected sticker ${detected.id}`);
      if (onProgress) {
        try {
          onProgress(detected);
        } catch (callbackError) {
          this.error('[progress] Callback threw:', callbackError);
        }
      }
    };

    // Primary: adaptive per-row top-band scanning.
    // Try the most likely row counts first to reduce OCR calls on common
    // single-sticker photos while still covering 2-3 row layouts.
    const aspect = canvas.width / Math.max(1, canvas.height);
    const rowCountCandidates = aspect >= 1.15
      ? [3, 2, 1]
      : aspect >= 0.9
      ? [2, 1, 3]
      : [1, 2, 3];
    const STRIP_BAND_FRACTION = 0.20;
    let anyBandFound = false;

    for (const rowCount of rowCountCandidates) {
      let passFound = false;
      for (let row = 0; row < rowCount; row++) {
        this.throwIfCancelled(signal);
        const rowHeight = Math.round(canvas.height / rowCount);
        const rowY = row * rowHeight;
        // Last strip absorbs any rounding remainder.
        const stripHeight = row < rowCount - 1 ? rowHeight : canvas.height - rowY;
        const rowStrip = this.cropCanvasRegion(canvas, 0, rowY, canvas.width, stripHeight);
        const rowIds = await this.scanTopIdBand(
          rowStrip,
          idList,
          countryCodes,
          signal,
          STRIP_BAND_FRACTION
        );
        if (rowIds.length > 0) {
          passFound = true;
          anyBandFound = true;
          this.log(
            `[top-band rows=${rowCount}, row=${row}] Found ${rowIds.length} ID(s); assigning columns.`
          );
          const columnWidth = canvas.width / rowIds.length;
          rowIds.forEach((id, index) => {
            emit({
              id,
              box: {
                x: Math.round(index * columnWidth),
                y: rowY,
                width: Math.round(columnWidth),
                height: stripHeight,
              },
            });
          });
        }
        await this.yieldToBrowser();
      }

      // Stop once a row-count layout produces any hits.
      if (passFound) {
        break;
      }
    }

    if (anyBandFound) {
      this.log(`Multi-sticker scan finished. Detected ${results.length} unique sticker(s).`);
      return results;
    }

    // Fallback: per-tile scan across row-strip, 2x2 and 3x2 layouts. This
    // handles single stickers and grid arrangements that the top-band pass
    // can't reliably cover.
    this.log('[top-band] No IDs found; falling back to per-tile scan.');
    const layouts = this.buildMultiStickerLayouts(canvas);

    for (let layoutIndex = 0; layoutIndex < layouts.length; layoutIndex++) {
      this.throwIfCancelled(signal);
      const tiles = layouts[layoutIndex];
      this.log(
        `[layout ${layoutIndex}] Processing ${tiles.length} tiles for multi-sticker scan.`
      );

      for (let tileIndex = 0; tileIndex < tiles.length; tileIndex++) {
        this.throwIfCancelled(signal);
        const tileBox = this.clampWindowToCanvas(canvas, tiles[tileIndex]);
        if (!tileBox) {
          continue;
        }

        const tileCanvas = this.cropCanvasRegion(
          canvas,
          tileBox.x,
          tileBox.y,
          tileBox.width,
          tileBox.height
        );

        const id = await this.scanTileForStickerId(
          tileCanvas,
          tileBox,
          idList,
          countryCodes,
          signal
        );
        if (id) {
          emit({ id, box: tileBox });
        }

        await this.yieldToBrowser();
      }
    }

    this.log(`Multi-sticker scan finished. Detected ${results.length} unique sticker(s).`);
    return results;
  }
}
