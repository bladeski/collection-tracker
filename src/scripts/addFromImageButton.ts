import type { FifaSticker } from '../models/fifa';
import type { StickerResultsModalController } from '../services';
import type { FifaScanImageService } from '../services/fifa';

export interface AddFromImageButtonDependencies {
  button: HTMLButtonElement;
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
  selectImageFile: () => Promise<File | null>;
  loadImageFromFile: (file: File) => Promise<HTMLImageElement>;
  wait: (ms: number) => Promise<void>;
  scaleDetectionBox: (
    box: { x: number; y: number; width: number; height: number },
    scale: number
  ) => { x: number; y: number; width: number; height: number };
}

export const wireAddFromImageButton = (dependencies: AddFromImageButtonDependencies): void => {
  let isInProgress = false;

  dependencies.button.addEventListener('click', async () => {
    if (isInProgress) {
      return;
    }

    let modalController: StickerResultsModalController | null = null;
    const collectedDetections: { id: string; box: { x: number; y: number; width: number; height: number } }[] = [];

    try {
      const file = await dependencies.selectImageFile();
      if (!file) {
        return;
      }

      isInProgress = true;
      dependencies.button.disabled = true;
      const image = await dependencies.loadImageFromFile(file);
      await dependencies.wait(0);

      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = image.naturalWidth;
      previewCanvas.height = image.naturalHeight;
      const previewCtx = previewCanvas.getContext('2d');
      if (!previewCtx) {
        throw new Error('Unable to get canvas context');
      }
      previewCtx.drawImage(image, 0, 0);

      const normalizedSize = Math.min(1400, Math.max(image.naturalWidth, image.naturalHeight));
      const largestOriginal = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = largestOriginal <= normalizedSize
        ? 1
        : normalizedSize / largestOriginal;
      const inverseScale = scale === 0 ? 1 : 1 / scale;

      const abortController = new AbortController();

      modalController = dependencies.stickerResultsModal.open(previewCanvas, 'scanning', () => {
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
      });

      let detectedStickers: { id: string; box: { x: number; y: number; width: number; height: number } }[] = [];
      try {
        detectedStickers = await dependencies.imageScanService.extractStickerIds(
          image,
          dependencies.getValidStickerIds(),
          dependencies.getValidTeamIds(),
          (detected) => {
            const scaledBox = dependencies.scaleDetectionBox(detected.box, inverseScale);
            collectedDetections.push({ id: detected.id, box: scaledBox });
            modalController?.addDetected({ id: detected.id, box: scaledBox });
          },
          abortController.signal
        );
      } catch (scanError) {
        if (abortController.signal.aborted) {
          console.info('Image scan cancelled by user.');
        } else {
          throw scanError;
        }
      }

      modalController.setComplete();

      const stickersToAdd = abortController.signal.aborted
        ? collectedDetections
        : (detectedStickers ?? collectedDetections);

      for (const detected of stickersToAdd) {
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
      console.error('Failed to scan and add stickers from image:', error);
      modalController?.setComplete();
    } finally {
      isInProgress = false;
      dependencies.button.disabled = false;
    }
  });
};