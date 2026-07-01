import { FifaCollection } from '../models/fifa/index.ts';
import type { FifaSticker } from '../models/fifa/index.ts';
import {
  StickerCollectionViewService,
  StickerResultsModalController,
  StickerResultsModalService,
  TradeModalService,
  TemplateService,
  IndexedDbDataStoreService
} from '../services/index.ts';
import { FifaScanImageService } from '../services/fifa/index.ts';
import TesseractReaderService from '../services/TesseractReaderService.ts';
import PreprocessingPool from '../workers/PreprocessingPool.ts';
import { wireAddFromCameraButton } from './addFromCameraButton.ts';
import { wireAddFromImageButton } from './addFromImageButton.ts';
import { wireTradeButton } from './wireTradeButton.ts';
import { initializeBootstrap } from './bootstrap';

/**
 * Determines which collection to load based on the URL and page mode.
 * 
 * - If mode=create, shows a form to create a new FIFA collection.
 * - If id=X is provided, loads that collection.
 * - Otherwise, returns null (collection picker will handle it).
 */
async function resolveCollectionId(
  catalog: any,
  registryService: any
): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const idParam = params.get('id');

  if (mode === 'create') {
    try {
      // Catalog entries should already be loaded by bootstrap
      const catalogEntries = catalog.list();
      console.log('Catalog entries:', catalogEntries);
      
      if (catalogEntries.length === 0) {
        throw new Error('No catalog entries available');
      }
      
      // Try to use FIFA if available, otherwise use first entry
      let entry = catalog.get('fifa26');
      console.log('FIFA entry from catalog.get("fifa26"):', entry);
      
      if (!entry) {
        console.warn('FIFA entry not found, using first available catalog entry');
        entry = catalogEntries[0];
        console.log('Using first entry instead:', entry);
      }
      
      if (!entry) {
        throw new Error('No catalog entry selected');
      }

      // Show the creation form with the entry name as default
      const formEl = document.getElementById('collection-creation-form');
      const formInput = formEl?.querySelector<HTMLInputElement>('[data-creation-name]');
      const formForm = formEl?.querySelector<HTMLFormElement>('[data-creation-form]');
      const cancelBtn = formEl?.querySelector<HTMLButtonElement>('[data-creation-cancel]');
      
      if (!formEl || !formInput || !formForm || !cancelBtn) {
        throw new Error('Creation form elements not found');
      }

      // Pre-fill with the catalog entry name
      formInput.value = entry.name;
      formEl.classList.remove('hidden');

      return new Promise((resolve) => {
        const onSubmit = async (e: Event) => {
          e.preventDefault();
          const customName = formInput.value.trim();
          
          if (!customName) {
            console.error('Collection name is empty');
            return;
          }

          try {
            console.log('Creating collection with name:', customName);
            
            // Generate a unique instance ID using timestamp to allow multiple instances
            // of the same catalog entry (e.g., multiple FIFA collections)
            const instanceId = `${entry.id}-${Date.now()}`;
            console.log('Generated instance ID:', instanceId);
            
            await registryService.createFromCatalog(entry, { 
              instanceId,
              customName 
            });
            
            // Clean up the URL to remove create mode
            window.history.replaceState(null, '', `./collection?id=${instanceId}`);
            console.log('Collection created successfully:', instanceId);
            
            formEl.classList.add('hidden');
            formForm.removeEventListener('submit', onSubmit);
            cancelBtn.removeEventListener('click', onCancel);
            resolve(instanceId);
          } catch (createError) {
            console.error('Failed to create collection:', createError);
            formEl.classList.add('hidden');
            formForm.removeEventListener('submit', onSubmit);
            cancelBtn.removeEventListener('click', onCancel);
            
            const errorEl = document.getElementById('collection-init-error');
            if (errorEl) {
              errorEl.classList.remove('hidden');
            }
            resolve(null);
          }
        };

        const onCancel = () => {
          formEl.classList.add('hidden');
          formForm.removeEventListener('submit', onSubmit);
          cancelBtn.removeEventListener('click', onCancel);
          window.history.replaceState(null, '', './');
          resolve(null);
        };

        formForm.addEventListener('submit', onSubmit);
        cancelBtn.addEventListener('click', onCancel);
      });
    } catch (error) {
      console.error('Failed to initialize collection creation:', error);
      
      // Show error screen
      const errorEl = document.getElementById('collection-init-error');
      if (errorEl) {
        errorEl.classList.remove('hidden');
      }
      return null;
    }
  }

  return idParam;
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialize shared bootstrap services (includes loaded catalog)
    const { manager, registry, catalog } = await initializeBootstrap();
    const collectionId = await resolveCollectionId(catalog, registry);

    if (!collectionId) {
      const empty = document.getElementById('sticker-grid-empty-no-collection');
      empty?.classList.remove('hidden');
      return;
    }

    // Build the per-collection item store on the same shared connection
    // First, get the collection metadata to get the correct item type for validation
    const collectionMeta = await registry.get(collectionId);
    const itemType = collectionMeta?.itemType;
    
    const itemStore = new IndexedDbDataStoreService<FifaSticker>(
      collectionId,
      manager,
      itemType as any
    );
    await itemStore.init();

    const collection = new FifaCollection(
      collectionId,
      undefined,
      itemStore,
      registry
    );
    collection.addEventListener('error', (event) => {
      const detail = (event as CustomEvent<{ reason: string }>).detail;
      console.error('Collection failed to initialise:', detail);
    });
    const templates = new TemplateService();
  const searchFilterElement = document.getElementById('search-filter') as HTMLInputElement;
  const selectElement = document.getElementById('collection-filter') as HTMLSelectElement;
  const showOwnedCheckbox = document.getElementById('show-owned') as HTMLInputElement;
  const showMissingCheckbox = document.getElementById('show-missing') as HTMLInputElement;
  const showDuplicatesCheckbox = document.getElementById('show-duplicates') as HTMLInputElement;
  const showNamesCheckbox = document.getElementById('show-names') as HTMLInputElement;
  const addFromImageButton = document.getElementById('add-from-image') as HTMLButtonElement | null;
  const addFromCameraButton = document.getElementById('add-from-camera') as HTMLButtonElement | null;
  const tradeButton = document.getElementById('trade-button') as HTMLButtonElement | null;
  const tradeToast = document.getElementById('trade-toast') as HTMLDivElement | null;
  const tradeToastMessage = document.getElementById('trade-toast-message') as HTMLSpanElement | null;
  const tradeToastDismiss = document.getElementById('trade-toast-dismiss') as HTMLButtonElement | null;
  const imageCanvas = document.querySelector('.image-canvas') as HTMLCanvasElement | null;
  const stickerGrid = document.querySelector('.sticker-grid') as HTMLElement;
  const stickerEmptyState = document.querySelector('.sticker-grid__empty') as HTMLElement | null;
  // Stats card elements — each may be null if the markup is absent,
  // in which case the service silently skips stat rendering.
  const statsPercentage = document.getElementById('stats-percentage');
  const statsBarFill = document.getElementById('stats-bar-fill');
  const statsOwned = document.getElementById('stats-owned');
  const statsMissing = document.getElementById('stats-missing');
  const statsDuplicates = document.getElementById('stats-duplicates');
  const stickerView = new StickerCollectionViewService(templates, {
    searchFilterElement,
    selectElement,
    showOwnedCheckbox,
    showMissingCheckbox,
    showDuplicatesCheckbox,
    showNamesCheckbox,
    stickerGrid,
    emptyStateElement: stickerEmptyState,
    statsElements:
      statsPercentage && statsBarFill && statsOwned && statsMissing && statsDuplicates
        ? {
            percentage: statsPercentage,
            barFill: statsBarFill,
            owned: statsOwned,
            missing: statsMissing,
            duplicates: statsDuplicates,
          }
        : null,
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
    // Update page heading with collection name
    const titleElement = document.getElementById('collection-title');
    if (titleElement) {
      titleElement.textContent = collection.name;
    }
    
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

      // Seed the stats card with the full base sticker list so missing
      // counts are correct from the first paint (before any user action).
      stickerView.renderStats(baseStickers);

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

            const toastVariants = ['trade-toast--success', 'trade-toast--error', 'trade-toast--info'];
            toastVariants.forEach((variant) => tradeToast.classList.remove(variant));
            tradeToast.classList.add('trade-toast--success');
            tradeToastMessage.textContent = `Trade complete: gave ${result.givenCount}, received ${result.receivedCount}.`;
            tradeToast.classList.remove('hidden');
          },
        });
      }

      if (tradeToastDismiss && tradeToast) {
        const toastVariants = ['trade-toast--success', 'trade-toast--error', 'trade-toast--info'];

        const applyToastVariant = (variantClass: string) => {
          toastVariants.forEach((variant) => tradeToast.classList.remove(variant));
          tradeToast.classList.remove('hidden');
          tradeToast.classList.add(variantClass);
        };

        tradeToastDismiss.addEventListener('click', () => {
          tradeToast.classList.add('hidden');
          toastVariants.forEach((variant) => tradeToast.classList.remove(variant));
        });
      }

      searchFilterElement.addEventListener('input', () => stickerView.applyFilters());
      selectElement.addEventListener('change', () => stickerView.applyFilters());
      showOwnedCheckbox.addEventListener('change', () => stickerView.applyFilters());
      showMissingCheckbox.addEventListener('change', () => stickerView.applyFilters());
      showDuplicatesCheckbox.addEventListener('change', () => stickerView.applyFilters());
      showNamesCheckbox.addEventListener('change', () => stickerView.applyFilters());

      stickerView.applyFilters();
    });
  });
} catch (error) {
  console.error('Failed to initialize collection page:', error);
  const errorEl = document.getElementById('collection-init-error');
  if (errorEl) {
    errorEl.classList.remove('hidden');
    const backButton = errorEl.querySelector('button[data-back]');
    if (backButton) {
      backButton.addEventListener('click', () => {
        window.history.back();
      });
      }
    }
  }
});
