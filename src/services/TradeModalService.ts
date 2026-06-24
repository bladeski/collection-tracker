import { TemplateService } from './TemplateService';

export interface TradeGiveOption {
  id: string;
  duplicateCount: number;
}

export interface TradeReceiveOption {
  id: string;
}

export interface TradeSelection {
  giveIds: string[];
  receiveIds: string[];
}

export interface TradeConfirmResult {
  givenCount: number;
  receivedCount: number;
}

export interface TradeModalOpenOptions {
  giveOptions: TradeGiveOption[];
  receiveOptions: TradeReceiveOption[];
  onConfirm: (selection: TradeSelection) => Promise<TradeConfirmResult>;
  onClose?: () => void;
  onConfirmed?: (result: TradeConfirmResult) => void;
}

export interface TradeModalController {
  close(): void;
}

type TradeStep = 'selection' | 'summary';

class TradeModalService {
  constructor(private readonly templates: TemplateService) {}

  open(options: TradeModalOpenOptions): TradeModalController {
    const overlay = this.templates.cloneElement<HTMLDivElement>('modal-shell');
    overlay.classList.add('trade-modal');

    const dialog = overlay.querySelector('.modal-shell__dialog') as HTMLDivElement | null;
    const title = overlay.querySelector('.modal-shell__title') as HTMLHeadingElement | null;
    const closeButton = overlay.querySelector('.modal-shell__close') as HTMLButtonElement | null;
    const status = overlay.querySelector('.modal-shell__status') as HTMLParagraphElement | null;
    const body = overlay.querySelector('.modal-shell__body') as HTMLDivElement | null;
    const footer = overlay.querySelector('.modal-shell__footer') as HTMLElement | null;

    if (!dialog || !title || !closeButton || !status || !body || !footer) {
      throw new Error('Trade modal template is missing required elements.');
    }

    const content = this.templates.cloneFragment('trade-modal-content');
    const contentBody = content.querySelector('.trade-modal__body-content') as HTMLElement | null;
    const contentFooter = content.querySelector('.trade-modal__footer-content') as HTMLElement | null;

    if (!contentBody || !contentFooter) {
      throw new Error('Trade modal content template is missing required elements.');
    }

    body.replaceChildren(...Array.from(contentBody.children));
    footer.replaceChildren(...Array.from(contentFooter.children));

    const selectionStep = body.querySelector('.trade-modal__selection-step') as HTMLElement | null;
    const summaryStep = body.querySelector('.trade-modal__summary-step') as HTMLElement | null;
    const giveSearchInput = body.querySelector('#trade-give-search') as HTMLInputElement | null;
    const receiveSearchInput = body.querySelector('#trade-receive-search') as HTMLInputElement | null;
    const giveList = body.querySelector('.trade-modal__give-list') as HTMLUListElement | null;
    const receiveList = body.querySelector('.trade-modal__receive-list') as HTMLUListElement | null;
    const summaryGiveList = body.querySelector('.trade-modal__summary-give') as HTMLUListElement | null;
    const summaryReceiveList = body.querySelector('.trade-modal__summary-receive') as HTMLUListElement | null;
    const cancelButton = footer.querySelector('.trade-modal__cancel') as HTMLButtonElement | null;
    const backButton = footer.querySelector('.trade-modal__back') as HTMLButtonElement | null;
    const nextButton = footer.querySelector('.trade-modal__next') as HTMLButtonElement | null;
    const confirmButton = footer.querySelector('.trade-modal__confirm') as HTMLButtonElement | null;
    const errorText = footer.querySelector('.trade-modal__error') as HTMLParagraphElement | null;

    if (
      !selectionStep
      || !summaryStep
      || !giveSearchInput
      || !receiveSearchInput
      || !giveList
      || !receiveList
      || !summaryGiveList
      || !summaryReceiveList
      || !cancelButton
      || !backButton
      || !nextButton
      || !confirmButton
      || !errorText
    ) {
      throw new Error('Trade modal content is missing required controls.');
    }

    const selectedGiveIds = new Set<string>();
    const selectedReceiveIds = new Set<string>();
    let step: TradeStep = 'selection';
    let pending = false;
    let isDirty = false;
    let confirmed = false;
    let previousActive: HTMLElement | null = null;
    let isClosed = false;

    const renderHeader = () => {
      title.textContent = step === 'selection' ? 'Trade Stickers' : 'Confirm Trade';
      status.textContent = step === 'selection'
        ? 'Select duplicates to give and missing stickers to receive. Search filters by ID prefix.'
        : 'Review the IDs below before confirming this trade.';
    };

    const clearError = () => {
      errorText.textContent = '';
      errorText.classList.add('hidden');
    };

    const showError = (message: string) => {
      errorText.textContent = message;
      errorText.classList.remove('hidden');
    };

    const isNextAllowed = () => selectedGiveIds.size + selectedReceiveIds.size > 0;

    const renderActions = () => {
      const isSelection = step === 'selection';
      backButton.hidden = isSelection;
      nextButton.hidden = !isSelection;

      nextButton.disabled = pending || !isNextAllowed();
      confirmButton.disabled = pending || isSelection;
      closeButton.disabled = pending;

      cancelButton.textContent = pending ? 'Working…' : 'Cancel';
      cancelButton.disabled = pending;
      backButton.disabled = pending;
      nextButton.textContent = pending ? 'Working…' : 'Next';
      confirmButton.textContent = pending ? 'Confirming…' : 'Confirm';
    };

    const createEmptyItem = (message: string) => {
      const item = this.templates.cloneElement<HTMLLIElement>('trade-modal-empty-item');
      item.textContent = message;
      return item;
    };

    const renderSelectionList = () => {
      const giveSearch = giveSearchInput.value.trim().toLowerCase();
      const receiveSearch = receiveSearchInput.value.trim().toLowerCase();

      giveList.innerHTML = '';
      const matchingGive = options.giveOptions.filter((option) => option.id.toLowerCase().startsWith(giveSearch));
      if (matchingGive.length === 0) {
        giveList.appendChild(createEmptyItem('No duplicate stickers match this filter.'));
      } else {
        matchingGive.forEach((option) => {
          const item = this.templates.cloneElement<HTMLLIElement>('trade-modal-give-item');
          const idEl = item.querySelector('.trade-modal__id') as HTMLSpanElement | null;
          const countEl = item.querySelector('.trade-modal__count') as HTMLSpanElement | null;
          const checkbox = item.querySelector('.trade-modal__checkbox') as HTMLInputElement | null;

          if (!idEl || !countEl || !checkbox) {
            throw new Error('Trade modal give row template is missing required elements.');
          }

          idEl.textContent = option.id;
          countEl.textContent = `Dupes: ${option.duplicateCount}`;
          checkbox.checked = selectedGiveIds.has(option.id);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              selectedGiveIds.add(option.id);
            } else {
              selectedGiveIds.delete(option.id);
            }
            isDirty = true;
            clearError();
            renderActions();
          });

          giveList.appendChild(item);
        });
      }

      receiveList.innerHTML = '';
      const matchingReceive = options.receiveOptions.filter((option) => option.id.toLowerCase().startsWith(receiveSearch));
      if (matchingReceive.length === 0) {
        receiveList.appendChild(createEmptyItem('No missing stickers match this filter.'));
      } else {
        matchingReceive.forEach((option) => {
          const item = this.templates.cloneElement<HTMLLIElement>('trade-modal-receive-item');
          const idEl = item.querySelector('.trade-modal__id') as HTMLSpanElement | null;
          const checkbox = item.querySelector('.trade-modal__checkbox') as HTMLInputElement | null;

          if (!idEl || !checkbox) {
            throw new Error('Trade modal receive row template is missing required elements.');
          }

          idEl.textContent = option.id;
          checkbox.checked = selectedReceiveIds.has(option.id);
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
              selectedReceiveIds.add(option.id);
            } else {
              selectedReceiveIds.delete(option.id);
            }
            isDirty = true;
            clearError();
            renderActions();
          });

          receiveList.appendChild(item);
        });
      }
    };

    const renderSummaryList = () => {
      summaryGiveList.innerHTML = '';
      summaryReceiveList.innerHTML = '';

      const selectedGive = options.giveOptions
        .filter((option) => selectedGiveIds.has(option.id))
        .map((option) => option.id);
      const selectedReceive = options.receiveOptions
        .filter((option) => selectedReceiveIds.has(option.id))
        .map((option) => option.id);

      if (selectedGive.length === 0) {
        summaryGiveList.appendChild(createEmptyItem('No stickers selected to give.'));
      } else {
        selectedGive.forEach((id) => {
          const item = this.templates.cloneElement<HTMLLIElement>('trade-modal-summary-item');
          const idEl = item.querySelector('.trade-modal__id') as HTMLSpanElement | null;
          if (!idEl) {
            throw new Error('Trade modal summary template is missing required elements.');
          }
          idEl.textContent = id;
          summaryGiveList.appendChild(item);
        });
      }

      if (selectedReceive.length === 0) {
        summaryReceiveList.appendChild(createEmptyItem('No stickers selected to receive.'));
      } else {
        selectedReceive.forEach((id) => {
          const item = this.templates.cloneElement<HTMLLIElement>('trade-modal-summary-item');
          const idEl = item.querySelector('.trade-modal__id') as HTMLSpanElement | null;
          if (!idEl) {
            throw new Error('Trade modal summary template is missing required elements.');
          }
          idEl.textContent = id;
          summaryReceiveList.appendChild(item);
        });
      }
    };

    const renderStep = () => {
      const isSelection = step === 'selection';
      selectionStep.classList.toggle('hidden', !isSelection);
      summaryStep.classList.toggle('hidden', isSelection);

      if (isSelection) {
        renderSelectionList();
      } else {
        renderSummaryList();
      }

      renderHeader();
      renderActions();
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
      options.onClose?.();

      if (previousActive && typeof previousActive.focus === 'function') {
        previousActive.focus();
      }
    };

    const maybeCloseModal = () => {
      if (pending) {
        return;
      }

      if (isDirty && !confirmed) {
        const shouldDiscard = window.confirm('Discard your current trade selections?');
        if (!shouldDiscard) {
          return;
        }
      }

      closeModal();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        maybeCloseModal();
      }
    };

    giveSearchInput.addEventListener('input', () => {
      renderSelectionList();
    });
    receiveSearchInput.addEventListener('input', () => {
      renderSelectionList();
    });

    closeButton.addEventListener('click', () => {
      maybeCloseModal();
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        maybeCloseModal();
      }
    });
    cancelButton.addEventListener('click', () => {
      maybeCloseModal();
    });

    nextButton.addEventListener('click', () => {
      if (!isNextAllowed() || pending) {
        return;
      }
      clearError();
      step = 'summary';
      renderStep();
      if (!backButton.hidden) {
        backButton.focus();
      }
    });

    backButton.addEventListener('click', () => {
      if (pending) {
        return;
      }
      clearError();
      step = 'selection';
      renderStep();
      giveSearchInput.focus();
    });

    confirmButton.addEventListener('click', async () => {
      if (pending) {
        return;
      }

      clearError();
      pending = true;
      renderActions();

      try {
        const result = await options.onConfirm({
          giveIds: options.giveOptions
            .filter((option) => selectedGiveIds.has(option.id))
            .map((option) => option.id),
          receiveIds: options.receiveOptions
            .filter((option) => selectedReceiveIds.has(option.id))
            .map((option) => option.id),
        });

        confirmed = true;
        options.onConfirmed?.(result);
        closeModal();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to confirm trade. Please try again.';
        showError(message);
      } finally {
        pending = false;
        renderActions();
      }
    });

    previousActive = document.activeElement as HTMLElement | null;
    renderStep();
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown);
    giveSearchInput.focus();

    return {
      close() {
        maybeCloseModal();
      },
    };
  }
}

export default TradeModalService;