import Tesseract, { createWorker } from 'tesseract.js';
import { IImageReaderService } from '../interfaces';

// type PageSegMode = '6' | '7';
type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

export interface TesseractReaderServiceOptions {
  /**
   * OCR language(s), e.g. 'eng'
   */
  langs?: string | string[];

  /**
   * OCR Engine Mode. Keep as 1 unless you have a reason to change it.
   */
  oem?: 0 | 1 | 2 | 3;

  /**
   * Explicit worker/core/lang paths.
   * Strongly recommended in browser builds to avoid runtime path issues.
   */
  workerPath?: string;
  corePath?: string;
  langPath?: string;

  /**
   * Enable Tesseract internal logging.
   */
  logger?: (message: unknown) => void;

  /**
   * If true, call recognize() once on a tiny blank image after startup
   * so the first "real" OCR call is less spiky.
   */
  warmup?: boolean;
}

export default class TesseractReaderService implements IImageReaderService {
  private readonly langs: string | string[];
  private readonly oem: 0 | 1 | 2 | 3;
  private readonly logger?: (message: unknown) => void;
  private readonly warmup: boolean;

  /**
   * Parameters that are common to all workers.
   */
  private readonly baseParams: Record<string, string>;

  /**
   * One worker per page segmentation mode.
   */
  private readonly workers: Partial<Record<Tesseract.PSM, Promise<TesseractWorker>>> = {};

  /**
   * One queue per page segmentation mode.
   * Tesseract behaves best when calls on the same worker are serialized.
   */
  private readonly queues: Record<Tesseract.PSM, Promise<string>> = {
    [Tesseract.PSM.OSD_ONLY]: Promise.resolve(''),
    [Tesseract.PSM.AUTO_OSD]: Promise.resolve(''),
    [Tesseract.PSM.AUTO_ONLY]: Promise.resolve(''),
    [Tesseract.PSM.AUTO]: Promise.resolve(''),
    [Tesseract.PSM.SINGLE_BLOCK]: Promise.resolve(''),
    [Tesseract.PSM.SINGLE_LINE]: Promise.resolve(''),
    [Tesseract.PSM.SINGLE_WORD]: Promise.resolve(''),
    [Tesseract.PSM.SINGLE_CHAR]: Promise.resolve(''),
    [Tesseract.PSM.SINGLE_BLOCK_VERT_TEXT]: Promise.resolve(''),
    [Tesseract.PSM.SPARSE_TEXT]: Promise.resolve(''),
    [Tesseract.PSM.SPARSE_TEXT_OSD]: Promise.resolve(''),
    [Tesseract.PSM.CIRCLE_WORD]: Promise.resolve(''),
    [Tesseract.PSM.SINGLE_COLUMN]: Promise.resolve(''),
    [Tesseract.PSM.RAW_LINE]: Promise.resolve(''),
  };

  /**
   * Track whether we already ran a warmup pass for a worker.
   */
  private readonly warmedUp = new Set<Tesseract.PSM>();

  private readonly workerPath?: string;
  private readonly corePath?: string;
  private readonly langPath?: string;


  constructor(options: TesseractReaderServiceOptions = {}) {
    this.langs = options.langs ?? 'eng';
    this.oem = options.oem ?? 1;
    this.logger = options.logger;
    this.warmup = options.warmup ?? false;

    this.workerPath = options.workerPath;
    this.corePath = options.corePath;
    this.langPath = options.langPath;

    this.baseParams = {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
      preserve_interword_spaces: '1',
    };
  }

  /**
   * Optional: call this early in app startup if you want to reduce the
   * latency spike on the first OCR request.
   */
  async init(): Promise<void> {
    await Promise.all([this.getWorker(Tesseract.PSM.SINGLE_BLOCK), this.getWorker(Tesseract.PSM.SINGLE_LINE)]);
  }

  /**
   * Clean up workers when the scan feature is being torn down.
   */
  async terminate(): Promise<void> {
    const workerEntries = Object.entries(this.workers) as Array<[Tesseract.PSM, Promise<TesseractWorker>]>;
    await Promise.allSettled(
      workerEntries.map(async ([mode, workerPromise]) => {
        const worker = await workerPromise;
        await worker.terminate();
        delete this.workers[mode];
        this.warmedUp.delete(mode);
      })
    );

    this.queues[Tesseract.PSM.SINGLE_BLOCK] = Promise.resolve('');
    this.queues[Tesseract.PSM.SINGLE_LINE] = Promise.resolve('');
  }

  
 private buildWorkerOptions(): Record<string, unknown> {
    const workerOptions: Record<string, unknown> = {};

    if (this.workerPath) {
      workerOptions.workerPath = this.workerPath;
    }
    if (this.corePath) {
      workerOptions.corePath = this.corePath;
    }
    if (this.langPath) {
      workerOptions.langPath = this.langPath;
    }
    if (this.logger) {
      workerOptions.logger = this.logger;
    }

    return workerOptions;
  }


  private async getWorker(pageSegMode: Tesseract.PSM): Promise<TesseractWorker> {
    if (!this.workers[pageSegMode]) {
      const workerOptions = this.buildWorkerOptions();

      this.workers[pageSegMode] = createWorker(
        this.langs,
        this.oem,
        workerOptions
      ).then(async (worker) => {
        await worker.setParameters({
          ...this.baseParams,
          tessedit_pageseg_mode: pageSegMode,
        });

        if (this.warmup && !this.warmedUp.has(pageSegMode)) {
          await this.runWarmup(worker);
          this.warmedUp.add(pageSegMode);
        }

        return worker;
      });
    }

    return this.workers[pageSegMode]!;
  }

  private async runWarmup(worker: TesseractWorker): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 24;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.font = '16px sans-serif';
    ctx.fillText('A1', 6, 18);

    try {
      await worker.recognize(canvas);
    } catch {
      // Warmup is opportunistic only.
    }
  }

  private toCanvas(image: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
    if (image instanceof HTMLCanvasElement) {
      return image;
    }

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to get canvas context');
    }

    ctx.drawImage(image, 0, 0);
    return canvas;
  }

  /**
   * OCR one image/crop.
   *
   * - PSM 7 = single text line
   * - PSM 6 = text block
   */
  async readImage(
    image: HTMLImageElement | HTMLCanvasElement,
    pageSegMode: Tesseract.PSM = Tesseract.PSM.SINGLE_LINE
  ): Promise<string> {
    const runRecognition = async (): Promise<string> => {
      const canvas = this.toCanvas(image);

      // Tiny crops are usually noise and often produce poor OCR.
      if (canvas.width < 48 || canvas.height < 16) {
        return '';
      }

      const worker = await this.getWorker(pageSegMode);

      try {
        const result = await worker.recognize(canvas);
        return result?.data?.text ?? '';
      } catch {
        return '';
      }
    };

    // Serialize calls per worker/mode.
    const scheduled = this.queues[pageSegMode].then(runRecognition, runRecognition);
    this.queues[pageSegMode] = scheduled.catch(() => '');
    return scheduled;
  }
}
