import type { TemplateKey } from './TemplateService';
import type { FifaSticker } from '../models/fifa';
import TemplateService from './TemplateService';

export interface StickerCollectionViewElements {
  searchFilterElement: HTMLInputElement;
  selectElement: HTMLSelectElement;
  showOwnedCheckbox: HTMLInputElement;
  showMissingCheckbox: HTMLInputElement;
  showDuplicatesCheckbox: HTMLInputElement;
  showNamesCheckbox: HTMLInputElement;
  stickerGrid: HTMLElement;
}

export interface StickerSummary {
  id: string;
  name: string;
}

export interface TeamSummary {
  id: string;
  name: string;
}

class StickerCollectionViewService {
  private readonly teamSectionsById = new Map<string, HTMLElement>();
  private readonly stickerRowsById = new Map<string, StickerRowState>();
  private readonly stickerRowsByTeamId = new Map<string, StickerRowState[]>();
  private readonly filterSubtitle = document.querySelector('.summary-subtitle') as HTMLHeadingElement | null;

  constructor(
    private readonly templates: TemplateService,
    private readonly elements: StickerCollectionViewElements
  ) {}

  renderTeams(
    teams: TeamSummary[],
    getTeamStickers: (teamId: string) => FifaSticker[],
    onAddSticker: (sticker: FifaSticker) => Promise<void> | void,
    onRemoveSticker: (sticker: FifaSticker) => Promise<void> | void
  ): void {
    teams.forEach((team) => {
      this.elements.selectElement.appendChild(this.createCollectionFilterOption(team.id, team.name));

      const teamSection = this.createTeamSection(team.id, team.name);
      const stickerList = teamSection.querySelector('ul.team-list') as HTMLUListElement | null;
      if (!stickerList) {
        throw new Error('Team section template is missing a sticker list.');
      }

      getTeamStickers(team.id).forEach((sticker) => {
        const stickerRow = this.createStickerItem(sticker, async () => {
          await onAddSticker(sticker);
        }, async () => {
          await onRemoveSticker(sticker);
        });
        this.stickerRowsById.set(sticker.id, stickerRow);
        const teamStickerRows = this.stickerRowsByTeamId.get(team.id) ?? [];
        teamStickerRows.push(stickerRow);
        this.stickerRowsByTeamId.set(team.id, teamStickerRows);
        this.syncStickerRow(stickerRow, sticker.id, sticker.name, sticker.count);
        stickerList.appendChild(stickerRow.item);
      });

      this.teamSectionsById.set(team.id, teamSection);
      this.elements.stickerGrid.appendChild(teamSection);
    });
  }

  updateStickerRowById(stickerId: string, stickerName: string, count: number): void {
    const stickerRow = this.stickerRowsById.get(stickerId);
    if (!stickerRow) {
      return;
    }

    this.syncStickerRow(stickerRow, stickerId, stickerName, count);
  }

  applyFilters(): void {
    const selectedValue = this.elements.selectElement.value;
    const searchValue = this.elements.searchFilterElement.value.trim().toLowerCase();

    this.elements.stickerGrid.classList.toggle('show-missing', this.elements.showMissingCheckbox.checked);
    this.elements.stickerGrid.classList.toggle('show-owned', this.elements.showOwnedCheckbox.checked);
    this.elements.stickerGrid.classList.toggle('show-duplicates', this.elements.showDuplicatesCheckbox.checked);
    this.elements.stickerGrid.classList.toggle('show-names', this.elements.showNamesCheckbox.checked);

    if (this.filterSubtitle) {
      const filterNames =
        this.elements.showOwnedCheckbox.checked && this.elements.showMissingCheckbox.checked
          ? 'All'
          : this.elements.showOwnedCheckbox.checked
            ? 'Owned'
            : this.elements.showMissingCheckbox.checked
              ? 'Missing'
              : this.elements.showDuplicatesCheckbox.checked
                ? 'Duplicate'
                : 'No';
      this.filterSubtitle.textContent = `${filterNames} stickers`;
    }

    const filterById = selectedValue === 'all' ? null : selectedValue;
    this.stickerRowsById.forEach((stickerRow, stickerId) => {
      stickerRow.item.classList.toggle('hidden', 
        (filterById !== null && stickerRow.item.dataset.teamId !== filterById)
        || (searchValue !== '' && !stickerId.toLowerCase().includes(searchValue))
      );
    });

    this.teamSectionsById.forEach((teamItem, teamId) => {
      const teamMatchesSelect = selectedValue !== 'all' || selectedValue === teamId;
      const stickerRows = this.stickerRowsByTeamId.get(teamId) ?? [];

      setTimeout(() => {
        teamItem.classList.toggle('hidden', 
          !stickerRows.some(stickerRow => stickerRow.item.computedStyleMap().get('display')?.toString() !== 'none')
          && !teamMatchesSelect
        );
      });
    });
  }

  private instantiateTemplate<T extends Element>(templateKey: TemplateKey): T {
    return this.templates.cloneElement<T>(templateKey);
  }

  private createCollectionFilterOption(teamId: string, teamName: string): HTMLOptionElement {
    const option = this.instantiateTemplate<HTMLOptionElement>('collection-filter-option');
    option.value = teamId;
    option.textContent = teamName;
    return option;
  }

  private createTeamSection(teamId: string, teamName: string): HTMLElement {
    const section = this.instantiateTemplate<HTMLElement>('team-section');
    section.dataset.teamId = teamId;
    const id = section.querySelector('.team-section__id') as HTMLSpanElement | null;
    const name = section.querySelector('.team-section__name') as HTMLSpanElement | null;
    if (id) {
      id.textContent = teamId;
    }
    if (name) {
      name.textContent = `(${teamName})`;
    }
    return section;
  }

  private createStickerItem(
    sticker: FifaSticker,
    onAdd: () => void | Promise<void>,
    onRemove: () => void | Promise<void>
  ): StickerRowState {
    const stickerItem = this.instantiateTemplate<HTMLLIElement>('sticker-item');
    stickerItem.dataset.stickerId = sticker.id;
    stickerItem.dataset.stickerName = sticker.name;
    stickerItem.dataset.count = String(sticker.count || 0);

    const addButton = stickerItem.querySelector('.add-sticker-button') as HTMLButtonElement | null;
    if (addButton) {
      addButton.type = 'button';
      addButton.addEventListener('click', () => {
        void Promise.resolve(onAdd()).catch((error) => {
          console.error('[sticker-collection-view] Failed to add sticker:', error);
        });
      });
    }

    const removeButton = stickerItem.querySelector('.remove-sticker-button') as HTMLButtonElement | null;
    if (removeButton) {
      removeButton.type = 'button';
      removeButton.addEventListener('click', () => {
        void Promise.resolve(onRemove()).catch((error) => {
          console.error('[sticker-collection-view] Failed to remove sticker:', error);
        });
      });
    }

    return {
      item: stickerItem,
      id: stickerItem.querySelector('.sticker-id') as HTMLSpanElement | null,
      name: stickerItem.querySelector('.sticker-name') as HTMLSpanElement | null,
      count: stickerItem.querySelector('.sticker-count') as HTMLSpanElement | null,
      addButton,
      removeButton,
    };
  }

  private syncStickerRow(
    stickerRow: StickerRowState,
    stickerId: string,
    stickerName: string,
    count: number
  ): void {
    stickerRow.item.dataset.count = String(count);
    this.setStickerRowText(stickerRow, stickerId, stickerName, count);
    stickerRow.item.classList.toggle('collected', count > 0);
    stickerRow.item.classList.toggle('has-duplicate', count > 1);

    if (stickerRow.removeButton) {
      stickerRow.removeButton.disabled = true;
    }
    if (stickerRow.addButton) {
      stickerRow.addButton.disabled = false;
    }
  }

  private setStickerRowText(
    stickerRow: StickerRowState,
    stickerId: string,
    stickerName: string,
    count: number
  ): void {
    if (stickerRow.id) {
      stickerRow.id.textContent = stickerId;
    }
    if (stickerRow.name) {
      stickerRow.name.textContent = stickerName;
    }
    if (stickerRow.count) {
      const duplicateCount = Math.max(0, count - 1);
      stickerRow.count.textContent = duplicateCount > 0 ?
        `Duplicates: ${duplicateCount}` : '';
    }
  }
}

interface StickerRowState {
  item: HTMLLIElement;
  id: HTMLSpanElement | null;
  name: HTMLSpanElement | null;
  count: HTMLSpanElement | null;
  addButton: HTMLButtonElement | null;
  removeButton: HTMLButtonElement | null;
}

export default StickerCollectionViewService;