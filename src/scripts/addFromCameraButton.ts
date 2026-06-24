import type { FifaSticker } from '../models/fifa';
import type { StickerResultsModalController } from '../services';
import type { FifaScanImageService } from '../services/fifa';

export interface AddFromCameraButtonDependencies {
  button: HTMLButtonElement;
  imageCanvas: HTMLCanvasElement | null;
  imageScanService: FifaScanImageService;
  stickerResultsModal: {
    open(
      sourceCanvas: HTMLCanvasElement,
      mode?: 'scanning' | 'complete',
      onCancel?: () => void
    ): StickerResultsModalController;
  };
  getValidStickerIds: () => string[];
  getValidTeamIds: () => string[];
  getBaseStickerById: (stickerId: string) => FifaSticker | undefined;
  addStickerToCollection: (sticker: FifaSticker) => Promise<FifaSticker | undefined>;
  updateStickerRowById: (stickerId: string, stickerName: string, count: number) => void;
  applyFilters: () => void;
  initializeCamera: () => Promise<MediaStream>;
  wait: (ms: number) => Promise<void>;
  scaleDetectionBox: (
    box: { x: number; y: number; width: number; height: number },
    scale: number
  ) => { x: number; y: number; width: number; height: number };
}

export const wireAddFromCameraButton = (dependencies: AddFromCameraButtonDependencies): void => {
  let isInProgress = false;

  dependencies.button.addEventListener('click', async () => {
    if (isInProgress) {
      return;
    }

    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let modalController: StickerResultsModalController | null = null;

    const stopCameraAndHideCanvas = () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      if (video) {
        video.pause();
        video.srcObject = null;
        video = null;
      }
      if (dependencies.imageCanvas) {
        dependencies.imageCanvas.style.display = 'none';
      }
    };

    const collectedDetections: { id: string; box: { x: number; y: number; width: number; height: number } }[] = [];
    const seenIds = new Set<string>();
    const abortController = new AbortController();

    try {
      isInProgress = true;
      dependencies.button.disabled = true;

      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = 640;
      previewCanvas.height = 480;
      const ocrCanvas = document.createElement('canvas');
      ocrCanvas.width = previewCanvas.width;
      ocrCanvas.height = previewCanvas.height;

      modalController = dependencies.stickerResultsModal.open(previewCanvas, 'scanning', () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      });

      stream = await dependencies.initializeCamera();
      video = document.createElement('video');
      video.srcObject = stream;
      video.setAttribute('autoplay', '');
      video.setAttribute('playsinline', '');
      await video.play();

      const startTime = Date.now();
      const timeoutMs = 10000;
      const scanIntervalMs = 500;

      const captureFrameInto = (target: HTMLCanvasElement): boolean => {
        if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
          return false;
        }
        if (target.width !== video.videoWidth || target.height !== video.videoHeight) {
          target.width = video.videoWidth;
          target.height = video.videoHeight;
          if (target === previewCanvas) {
            ocrCanvas.width = target.width;
            ocrCanvas.height = target.height;
          }
        }
        const ctx = target.getContext('2d');
        if (!ctx) {
          return false;
        }
        ctx.drawImage(video, 0, 0, target.width, target.height);
        return true;
      };

      while (!abortController.signal.aborted) {
        if (Date.now() - startTime > timeoutMs) {
          console.info('Camera scan reached 10s window with no further detections.');
          break;
        }

        if (!captureFrameInto(ocrCanvas)) {
          await dependencies.wait(scanIntervalMs);
          continue;
        }

        modalController.redrawFrame((ctx) => {
          ctx.drawImage(ocrCanvas, 0, 0);
        });

        const normalizedSize = Math.min(1400, Math.max(ocrCanvas.width, ocrCanvas.height));
        const largestOriginal = Math.max(ocrCanvas.width, ocrCanvas.height);
        const scale = largestOriginal <= normalizedSize
          ? 1
          : normalizedSize / largestOriginal;
        const inverseScale = scale === 0 ? 1 : 1 / scale;

        try {
          await dependencies.imageScanService.extractStickerIds(
            ocrCanvas,
            dependencies.getValidStickerIds(),
            dependencies.getValidTeamIds(),
            (detected) => {
              const scaledBox = dependencies.scaleDetectionBox(detected.box, inverseScale);
              if (seenIds.has(detected.id)) {
                return;
              }
              seenIds.add(detected.id);
              collectedDetections.push({ id: detected.id, box: scaledBox });
              modalController?.addDetected({ id: detected.id, box: scaledBox });
            },
            abortController.signal
          );
        } catch (scanError) {
          if (!abortController.signal.aborted) {
            console.error('Camera frame scan error:', scanError);
          }
          if (abortController.signal.aborted) {
            break;
          }
        }

        if (abortController.signal.aborted) {
          break;
        }

        await dependencies.wait(scanIntervalMs);
      }

      if (abortController.signal.aborted) {
        console.info('Camera scan cancelled by user.');
      }

      modalController.setComplete();

      for (const detected of collectedDetections) {
        const baseSticker = dependencies.getBaseStickerById(detected.id);
        if (!baseSticker) {
          continue;
        }

        const updatedSticker = await dependencies.addStickerToCollection({ ...baseSticker, count: 1 });
        dependencies.updateStickerRowById(
          detected.id,
          baseSticker.name,
          updatedSticker?.count ?? 1
        );
      }

      dependencies.applyFilters();
    } catch (error) {
      console.error('Failed to scan and add stickers from camera:', error);
      modalController?.setComplete();
    } finally {
      stopCameraAndHideCanvas();
      isInProgress = false;
      dependencies.button.disabled = false;
    }
  });
};