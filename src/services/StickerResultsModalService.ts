import { TemplateService } from './TemplateService';

export type StickerResultsModalMode = 'scanning' | 'complete';

export interface StickerDetection {
  id: string;
  box: { x: number; y: number; width: number; height: number };
}

export interface StickerResultsModalController {
  addDetected(detected: StickerDetection): void;
  setComplete(summary?: string): void;
  close(): void;
  isCancellable(): boolean;
  redrawFrame(drawImage: (ctx: CanvasRenderingContext2D) => void): void;
  resetDetections(): void;
}

class StickerResultsModalService {
  constructor(private readonly templates: TemplateService) {}

  open(
    sourceCanvas: HTMLCanvasElement,
    mode: StickerResultsModalMode = 'scanning',
    onCancel?: () => void
  ): StickerResultsModalController {
    const overlay = this.templates.cloneElement<HTMLDivElement>('modal-shell');
    if (mode === 'scanning') {
      overlay.classList.add('sticker-results-modal--scanning');
    }

    const dialog = overlay.querySelector('.modal-shell__dialog') as HTMLDivElement | null;
    const title = overlay.querySelector('.modal-shell__title') as HTMLHeadingElement | null;
    const closeButton = overlay.querySelector('.modal-shell__close') as HTMLButtonElement | null;
    const status = overlay.querySelector('.modal-shell__status') as HTMLParagraphElement | null;
    const body = overlay.querySelector('.modal-shell__body') as HTMLDivElement | null;
    const footer = overlay.querySelector('.modal-shell__footer') as HTMLElement | null;

    if (!dialog || !title || !closeButton || !status || !body || !footer) {
      throw new Error('Sticker results modal template is missing required elements.');
    }

    const content = this.templates.cloneFragment('sticker-results-modal-content');
    const contentBody = content.querySelector('.sticker-results-modal__body-content') as HTMLElement | null;
    const contentFooter = content.querySelector('.sticker-results-modal__footer-content') as HTMLElement | null;
    const imageWrap = content.querySelector('.sticker-results-modal__image-wrap') as HTMLDivElement | null;
    const list = content.querySelector('.sticker-results-modal__list') as HTMLUListElement | null;
    const stopButton = content.querySelector('.sticker-results-modal__stop') as HTMLButtonElement | null;
    const dismissButton = content.querySelector('.sticker-results-modal__dismiss') as HTMLButtonElement | null;

    if (!contentBody || !contentFooter || !imageWrap || !list || !stopButton || !dismissButton) {
      throw new Error('Sticker results content template is missing required elements.');
    }

    body.replaceChildren(...Array.from(contentBody.children));
    footer.replaceChildren(...Array.from(contentFooter.children));

    const displayCanvas = sourceCanvas;
    displayCanvas.classList.add('sticker-results-modal__canvas');
    const highlights: StickerDetection[] = [];

    const repaintHighlights = () => {
      if (highlights.length === 0) {
        return;
      }
      const ctx = displayCanvas.getContext('2d');
      if (!ctx) {
        return;
      }
      const strokeWidth = Math.max(2, Math.round(Math.min(displayCanvas.width, displayCanvas.height) / 250));
      ctx.lineWidth = strokeWidth;
      const fontSize = Math.max(14, Math.round(Math.min(displayCanvas.width, displayCanvas.height) / 35));
      const padding = Math.round(fontSize * 0.3);
      ctx.font = `600 ${fontSize}px var(--font-family-mono), monospace`;
      ctx.textBaseline = 'top';

      highlights.forEach((highlight, index) => {
        ctx.strokeStyle = index % 2 === 0 ? '#22c55e' : '#f59e0b';
        ctx.strokeRect(highlight.box.x, highlight.box.y, highlight.box.width, highlight.box.height);

        const label = highlight.id;
        const textMetrics = ctx.measureText(label);
        const labelWidth = textMetrics.width + padding * 2;
        const labelHeight = fontSize + padding * 2;
        const labelX = highlight.box.x;
        const labelY = Math.max(0, highlight.box.y - labelHeight);

        ctx.fillStyle = index % 2 === 0 ? '#22c55e' : '#f59e0b';
        ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
        ctx.fillStyle = '#0f172a';
        ctx.fillText(label, labelX + padding, labelY + padding);
      });
    };

    if (mode !== 'scanning' || !onCancel) {
      stopButton.hidden = true;
    }

    imageWrap.replaceChildren(displayCanvas);
    list.replaceChildren(this.createStickerResultsEmptyItem('No stickers detected yet.'));

    let previousActive: HTMLElement | null = null;
    let isClosed = false;
    let currentMode: StickerResultsModalMode = mode;

    const renderTitle = () => {
      if (currentMode === 'scanning') {
        title.textContent = highlights.length === 0 ? 'Scanning image…' : `Scanning… (${highlights.length} found)`;
      } else {
        title.textContent = highlights.length === 0
          ? 'No stickers detected'
          : `Detected ${highlights.length} sticker${highlights.length === 1 ? '' : 's'}`;
      }
    };

    const renderStatus = () => {
      if (currentMode === 'scanning') {
        status.textContent = 'Reading sticker IDs from the image. This can take a moment.';
      } else if (highlights.length === 0) {
        status.textContent = 'We couldn\'t find any sticker IDs in this image. Try a clearer photo with better lighting.';
      } else {
        status.textContent = 'Review the highlights below, then close this dialog.';
      }
    };

    const renderDismissButton = () => {
      dismissButton.textContent = currentMode === 'scanning'
        ? 'Scanning…'
        : (highlights.length === 0 ? 'Close' : 'Done');
      dismissButton.disabled = currentMode === 'scanning';
      closeButton.disabled = currentMode === 'scanning';
      stopButton.hidden = currentMode !== 'scanning' || !onCancel;
    };

    const renderList = () => {
      list.innerHTML = '';
      if (highlights.length === 0) {
        list.appendChild(this.createStickerResultsEmptyItem(
          currentMode === 'scanning'
            ? 'No stickers detected yet.'
            : 'We couldn\'t find any sticker IDs in this image. Try a clearer photo with better lighting.'
        ));
        return;
      }

      highlights.forEach((highlight) => {
        list.appendChild(this.createStickerResultsListItem(highlight.id));
      });
    };

    const closeModal = () => {
      if (isClosed) {
        return;
      }
      isClosed = true;
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      document.removeEventListener('keydown', onKeyDown);
      if (previousActive && typeof previousActive.focus === 'function') {
        previousActive.focus();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && currentMode === 'complete') {
        closeModal();
      }
    };

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay && currentMode === 'complete') {
        closeModal();
      }
    });
    closeButton.addEventListener('click', () => {
      if (currentMode === 'complete') {
        closeModal();
      }
    });
    dismissButton.addEventListener('click', () => {
      if (currentMode === 'complete') {
        closeModal();
      }
    });
    stopButton.addEventListener('click', () => {
      if (currentMode !== 'scanning' || !onCancel) {
        return;
      }
      stopButton.disabled = true;
      stopButton.textContent = 'Stopping…';
      try {
        onCancel();
      } catch (callbackError) {
        console.error('[sticker-results-modal] onCancel threw:', callbackError);
      }
    });

    renderTitle();
    renderStatus();
    renderDismissButton();
    renderList();

    previousActive = document.activeElement as HTMLElement | null;
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown);
    if (currentMode === 'complete') {
      dismissButton.focus();
    } else if (onCancel) {
      stopButton.focus();
    }

    return {
      addDetected(detected) {
        if (isClosed) {
          return;
        }
        highlights.push(detected);
        renderTitle();
        renderList();
        repaintHighlights();
      },
      setComplete(_summary) {
        if (isClosed || currentMode === 'complete') {
          return;
        }
        currentMode = 'complete';
        overlay.classList.remove('sticker-results-modal--scanning');
        renderTitle();
        renderStatus();
        renderDismissButton();
        if (!isClosed) {
          dismissButton.focus();
        }
      },
      close() {
        closeModal();
      },
      isCancellable() {
        return currentMode === 'scanning' && !isClosed && Boolean(onCancel);
      },
      redrawFrame(drawImage) {
        if (isClosed) {
          return;
        }
        const ctx = displayCanvas.getContext('2d');
        if (!ctx) {
          return;
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        drawImage(ctx);
        ctx.restore();
        repaintHighlights();
      },
      resetDetections() {
        if (isClosed) {
          return;
        }
        highlights.length = 0;
        renderTitle();
        renderList();
        const ctx = displayCanvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        }
      },
    };
  }

  private createStickerResultsListItem(id: string): HTMLLIElement {
    const item = this.templates.cloneElement<HTMLLIElement>('sticker-results-modal-list-item');
    const idEl = item.querySelector('.sticker-results-modal__id') as HTMLSpanElement | null;
    if (idEl) {
      idEl.textContent = id;
    }
    return item;
  }

  private createStickerResultsEmptyItem(message: string): HTMLLIElement {
    const item = this.templates.cloneElement<HTMLLIElement>('sticker-results-modal-empty');
    item.textContent = message;
    return item;
  }
}

export default StickerResultsModalService;