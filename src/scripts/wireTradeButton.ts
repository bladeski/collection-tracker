import type {
  TradeConfirmResult,
  TradeGiveOption,
  TradeModalController,
  TradeReceiveOption,
  TradeSelection,
} from '../services';

export interface WireTradeButtonDependencies {
  button: HTMLButtonElement;
  tradeModal: {
    open(options: {
      giveOptions: TradeGiveOption[];
      receiveOptions: TradeReceiveOption[];
      onConfirm: (selection: TradeSelection) => Promise<TradeConfirmResult>;
      onClose?: () => void;
      onConfirmed?: (result: TradeConfirmResult) => void;
    }): TradeModalController;
  };
  getGiveOptions: () => TradeGiveOption[];
  getReceiveOptions: () => TradeReceiveOption[];
  confirmTrade: (selection: TradeSelection) => Promise<TradeConfirmResult>;
  onSuccess: (result: TradeConfirmResult) => void;
}

export const wireTradeButton = (dependencies: WireTradeButtonDependencies): void => {
  let isModalOpen = false;
  let controller: TradeModalController | null = null;

  dependencies.button.addEventListener('click', () => {
    if (isModalOpen) {
      return;
    }

    isModalOpen = true;
    controller = dependencies.tradeModal.open({
      giveOptions: dependencies.getGiveOptions(),
      receiveOptions: dependencies.getReceiveOptions(),
      onConfirm: async (selection) => dependencies.confirmTrade(selection),
      onClose: () => {
        isModalOpen = false;
        controller = null;
      },
      onConfirmed: (result) => {
        dependencies.onSuccess(result);
      },
    });
  });
};
