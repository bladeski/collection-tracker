import { FifaCollection } from '../models/fifa';
import type { FifaSticker } from '../models/fifa';
import {
  StickerCollectionViewService,
  StickerResultsModalController,
  StickerResultsModalService,
  TradeModalService,
  TemplateService
} from '../services';
import { FifaScanImageService } from '../services/fifa';
import TesseractReaderService from '../services/TesseractReaderService';
import PreprocessingPool from '../workers/PreprocessingPool';
import { wireAddFromCameraButton } from './addFromCameraButton.ts';
import { wireAddFromImageButton } from './addFromImageButton.ts';
import { wireTradeButton } from './wireTradeButton.ts';

document.addEventListener('DOMContentLoaded', () => {
  const collection = new FifaCollection();
  const templates = new TemplateService();
  const searchFilterElement = document.getElementById('search-filter') as HTMLInputElement;
  const selectElement = document.getElementById('collection-filter') as HTMLSelectElement;
  const showOwnedCheckbox = document.getElementById('show-owned') as HTMLInputElement;
  const showMissingCheckbox = document.getElementById('show-missing') as HTMLInputElement;
  const showDuplicatesCheckbox = document.getElementById('show-duplicates') as HTMLInputElement;
  const addFromImageButton = document.getElementById('add-from-image') as HTMLButtonElement | null;
  const addFromCameraButton = document.getElementById('add-from-camera') as HTMLButtonElement | null;
  const tradeButton = document.getElementById('trade-button') as HTMLButtonElement | null;
  const tradeToast = document.getElementById('trade-toast') as HTMLDivElement | null;
  const tradeToastMessage = document.getElementById('trade-toast-message') as HTMLSpanElement | null;
  const tradeToastDismiss = document.getElementById('trade-toast-dismiss') as HTMLButtonElement | null;
  const imageCanvas = document.querySelector('.image-canvas') as HTMLCanvasElement | null;
  const stickerGrid = document.querySelector('.sticker-grid') as HTMLElement;
  const stickerView = new StickerCollectionViewService(templates, {
    searchFilterElement,
    selectElement,
    showOwnedCheckbox,
    showMissingCheckbox,
    showDuplicatesCheckbox,
    stickerGrid,
  });
  const stickerResultsModal = new StickerResultsModalService(templates);
  const tradeModal = new TradeModalService(templates);
  let isImageScanInProgress = false;
  let isCameraScanInProgress = false;

  const selectImageFile = (): Promise<File | null> =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        resolve(input.files?.[0] ?? null);
      };
      input.click();
    });

  const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Unable to load selected image.'));
      };
      image.src = objectUrl;
    });

  const initializeCamera = (): Promise<MediaStream> =>
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  collection.addEventListener('initialised', () => {
    collection.getTeams().then((teams) => {
      const baseStickers = collection.getItems(true);
      const validStickerIds = Array.from(new Set(baseStickers.map((sticker) => sticker.id)));
      const validTeamIds = teams.map(team => team.id);
      const baseStickerById = new Map(baseStickers.map((sticker) => [sticker.id, sticker]));
      const imageReaderService = new TesseractReaderService(
        {
          langs: 'eng',
          workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v7/dist/worker.min.js',
          warmup: true,
        }
      );
      // Share a single worker pool between the image and camera flows so
      // preprocessing tasks can run in parallel without spinning up a
      // second pool per scan.
      const preprocessingPool = new PreprocessingPool();
      const imageScanService = new FifaScanImageService(imageReaderService, preprocessingPool);

      // Free the workers when the page unloads so we don't leave
      // dangling worker threads in the browser.
      window.addEventListener('beforeunload', () => {
        preprocessingPool.terminate();
      });

      stickerView.renderTeams(
        teams,
        (teamId) => collection.getTeamStickers(teamId, true),
        async (sticker: FifaSticker) => {
          await collection.addItem({ ...sticker, count: 1 });
          const updatedSticker = collection.getItemById(sticker.id);
          stickerView.updateStickerRowById(
            sticker.id,
            sticker.name,
            updatedSticker?.count ?? sticker.count
          );
        },
        async (sticker: FifaSticker) => {
          await collection.removeItem(sticker);
          const updatedSticker = collection.getItemById(sticker.id);
          stickerView.updateStickerRowById(
            sticker.id,
            sticker.name,
            updatedSticker?.count ?? 0
          );
        }
      );

      if (addFromImageButton) {
        wireAddFromImageButton({
          button: addFromImageButton,
          imageScanService,
          stickerResultsModal,
          getValidStickerIds: () => validStickerIds,
          getValidTeamIds: () => validTeamIds,
          getBaseStickerById: (stickerId: string) => baseStickerById.get(stickerId),
          addStickerToCollection: async (sticker: FifaSticker) => {
            await collection.addItem(sticker);
            return collection.getItemById(sticker.id);
          },
          updateStickerRowById: (stickerId: string, stickerName: string, count: number) => {
            stickerView.updateStickerRowById(stickerId, stickerName, count);
          },
          applyFilters: () => stickerView.applyFilters(),
          selectImageFile,
          loadImageFromFile,
          wait,
          scaleDetectionBox: (box: { x: number; y: number; width: number; height: number }, scale: number) => ({
            x: Math.round(box.x * scale),
            y: Math.round(box.y * scale),
            width: Math.round(box.width * scale),
            height: Math.round(box.height * scale),
          }),
        });
      }

      if (addFromCameraButton) {
        wireAddFromCameraButton({
          button: addFromCameraButton,
          imageCanvas,
          imageScanService,
          stickerResultsModal,
          getValidStickerIds: () => validStickerIds,
          getValidTeamIds: () => validTeamIds,
          getBaseStickerById: (stickerId: string) => baseStickerById.get(stickerId),
          addStickerToCollection: async (sticker: FifaSticker) => {
            await collection.addItem(sticker);
            return collection.getItemById(sticker.id);
          },
          updateStickerRowById: (stickerId: string, stickerName: string, count: number) => {
            stickerView.updateStickerRowById(stickerId, stickerName, count);
          },
          applyFilters: () => stickerView.applyFilters(),
          initializeCamera,
          wait,
          scaleDetectionBox: (box: { x: number; y: number; width: number; height: number }, scale: number) => ({
            x: Math.round(box.x * scale),
            y: Math.round(box.y * scale),
            width: Math.round(box.width * scale),
            height: Math.round(box.height * scale),
          }),
        });
      }

      if (tradeButton) {
        wireTradeButton({
          button: tradeButton,
          tradeModal,
          getGiveOptions: () => collection
            .getSpares()
            .map((sticker) => ({
              id: sticker.id,
              duplicateCount: Math.max(0, sticker.count - 1),
            })),
          getReceiveOptions: () => collection
            .getMissingItems()
            .map((sticker) => ({ id: sticker.id })),
          confirmTrade: async (selection) => {
            const operations: Array<{ type: 'give' | 'receive'; id: string }> = [];
            const affectedIds = new Set<string>();

            try {
              for (const giveId of selection.giveIds) {
                const ownedSticker = collection.getItemById(giveId);
                if (!ownedSticker || ownedSticker.count <= 1) {
                  throw new Error(`Cannot trade sticker ${giveId} because it has no duplicates.`);
                }
                await collection.removeItem(ownedSticker);
                operations.push({ type: 'give', id: giveId });
                affectedIds.add(giveId);
              }

              for (const receiveId of selection.receiveIds) {
                const baseSticker = baseStickerById.get(receiveId);
                if (!baseSticker) {
                  throw new Error(`Sticker ${receiveId} was not found in the base data.`);
                }
                await collection.addItem({ ...baseSticker, count: 1 });
                operations.push({ type: 'receive', id: receiveId });
                affectedIds.add(receiveId);
              }
            } catch (error) {
              let rollbackFailed = false;

              for (const operation of [...operations].reverse()) {
                try {
                  if (operation.type === 'give') {
                    const baseSticker = baseStickerById.get(operation.id);
                    if (!baseSticker) {
                      rollbackFailed = true;
                      continue;
                    }
                    await collection.addItem({ ...baseSticker, count: 1 });
                  } else {
                    const receivedSticker = collection.getItemById(operation.id);
                    if (!receivedSticker) {
                      rollbackFailed = true;
                      continue;
                    }
                    await collection.removeItem(receivedSticker);
                  }
                } catch (rollbackError) {
                  console.error('Rollback operation failed:', rollbackError);
                  rollbackFailed = true;
                }
              }

              throw new Error(
                rollbackFailed
                  ? 'Trade failed and rollback was incomplete. Please verify your collection and retry.'
                  : (error instanceof Error ? error.message : 'Trade failed. Please retry.')
              );
            }

            affectedIds.forEach((stickerId) => {
              const baseSticker = baseStickerById.get(stickerId);
              if (!baseSticker) {
                return;
              }
              const updatedSticker = collection.getItemById(stickerId);
              stickerView.updateStickerRowById(
                stickerId,
                baseSticker.name,
                updatedSticker?.count ?? 0
              );
            });
            stickerView.applyFilters();

            return {
              givenCount: selection.giveIds.length,
              receivedCount: selection.receiveIds.length,
            };
          },
          onSuccess: (result) => {
            if (!tradeToast || !tradeToastMessage) {
              return;
            }

            tradeToastMessage.textContent = `Trade complete: gave ${result.givenCount}, received ${result.receivedCount}.`;
            tradeToast.classList.remove('hidden');
          },
        });
      }

      if (tradeToastDismiss && tradeToast) {
        tradeToastDismiss.addEventListener('click', () => {
          tradeToast.classList.add('hidden');
        });
      }

      searchFilterElement.addEventListener('input', () => stickerView.applyFilters());
      selectElement.addEventListener('change', () => stickerView.applyFilters());
      showOwnedCheckbox.addEventListener('change', () => stickerView.applyFilters());
      showMissingCheckbox.addEventListener('change', () => stickerView.applyFilters());
      showDuplicatesCheckbox.addEventListener('change', () => stickerView.applyFilters());

      stickerView.applyFilters();
    });
  });
});
