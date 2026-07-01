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
  emptyStateElement?: HTMLElement | null;
  statsElements?: StatsElements | null;
}

export interface StatsElements {
  percentage: HTMLElement;
  barFill: HTMLElement;
  owned: HTMLElement;
  missing: HTMLElement;
  duplicates: HTMLElement;
}

export interface StickerSummary {
  id: string;
  name: string;
}

export interface TeamSummary {
  id: string;
  name: string;
}

export interface CollectionStats {
  total: number;
  owned: number;
  missing: number;
  duplicates: number;
  /** Percentage 0..100, rounded to one decimal. */
  percentage: number;
}

class StickerCollectionViewService {
  private readonly teamSectionsById = new Map<string, HTMLElement>();
  private readonly stickerRowsById = new Map<string, StickerRowState>();
  private readonly stickerRowsByTeamId = new Map<string, StickerRowState[]>();
  private readonly filterSubtitle =
    (document.querySelector('#filter-summary') as HTMLElement | null) ??
    (document.querySelector('.summary-subtitle') as HTMLElement | null);

  /** Cached reference to the base sticker list, used to compute missing count. */
  private baseStickers: FifaSticker[] = [];

  /** Cached reference to the base sticker lookup map (id -> sticker). */
  private readonly baseStickersById = new Map<string, FifaSticker>();

  /** Cached references to stat card DOM nodes (may be null if no stats card). */
  private readonly statsRefs: StatsElements | null;

  /** Last rendered stats values, used to pulse the percentage on change. */
  private lastStats: CollectionStats | null = null;

  constructor(
    private readonly templates: TemplateService,
    private readonly elements: StickerCollectionViewElements
  ) {
    this.statsRefs = elements.statsElements ?? null;
  }

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
    // Count change affects overall collection stats — refresh them.
    this.updateStats();
  }

  /**
   * Cache the base sticker list so we can compute the missing count
   * (anything in the base list that hasn't been collected yet) and seed
   * the stats card with initial zero values.
   *
   * Call this once after `renderTeams` and before the first
   * `updateStickerRowById` event.
   */
  renderStats(baseStickers: FifaSticker[]): void {
    this.baseStickers = baseStickers.slice();
    this.baseStickersById.clear();
    this.baseStickers.forEach((sticker) => {
      this.baseStickersById.set(sticker.id, sticker);
    });
    this.updateStats();
  }

  /**
   * Recompute collection stats from the current sticker row counts and
   * write them into the stats card DOM (if present). The percentage
   * value briefly pulses when it changes to draw the eye.
   */
  updateStats(): void {
    const stats = this.computeStats();
    if (!this.statsRefs) {
      return;
    }

    const { percentage, owned, missing, duplicates } = stats;

    this.statsRefs.percentage.textContent = `${stats.percentage}%`;
    this.statsRefs.barFill.style.width = `${stats.percentage}%`;
    this.statsRefs.owned.textContent = String(owned);
    this.statsRefs.missing.textContent = String(missing);
    this.statsRefs.duplicates.textContent = String(duplicates);

    // Brief pulse on the percentage to highlight a change.
    if (
      this.lastStats !== null &&
      this.lastStats.percentage !== stats.percentage &&
      typeof this.statsRefs.percentage.animate === 'function'
    ) {
      const el = this.statsRefs.percentage;
      el.classList.add('stats-card__percentage--pulse');
      window.setTimeout(() => {
        el.classList.remove('stats-card__percentage--pulse');
      }, 600);
    }

    this.lastStats = stats;
  }

  /** Pure computation of owned / missing / duplicate counts. */
  private computeStats(): CollectionStats {
    let owned = 0;
    let duplicates = 0;
    this.stickerRowsById.forEach((row) => {
      const count = Number(row.item.dataset.count ?? '0') || 0;
      if (count > 0) {
        owned += 1;
      }
      if (count > 1) {
        duplicates += count - 1;
      }
    });

    const total = this.baseStickers.length;
    // Missing = base stickers that the user has never collected.
    const missingIds = new Set(this.baseStickers.map((s) => s.id));
    this.stickerRowsById.forEach((row) => {
      const count = Number(row.item.dataset.count ?? '0') || 0;
      if (count > 0 && row.item.dataset.stickerId) {
        missingIds.delete(row.item.dataset.stickerId);
      }
    });
    const missing = missingIds.size;

    const percentage = total === 0 ? 0 : Math.round((owned / total) * 1000) / 10;

    return { total, owned, missing, duplicates, percentage };
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

      // Suffix indicates when the visible set is further narrowed by
      // search text or a team selection — gives the user context that
      // what they see is not the full filter result.
      const narrowingParts: string[] = [];
      if (searchValue !== '') {
        narrowingParts.push(`“${searchValue}”`);
      }
      if (selectedValue !== 'all') {
        narrowingParts.push(`team ${selectedValue}`);
      }
      const suffix = narrowingParts.length > 0 ? ` · ${narrowingParts.join(' · ')}` : '';

      this.filterSubtitle.textContent = `${filterNames} stickers${suffix}`;

      // Color-code the indicator dot by the active filter scope.
      this.filterSubtitle.classList.remove(
        'summary-subtitle--missing',
        'summary-subtitle--duplicate'
      );
      if (filterNames === 'Missing') {
        this.filterSubtitle.classList.add('summary-subtitle--missing');
      } else if (filterNames === 'Duplicate') {
        this.filterSubtitle.classList.add('summary-subtitle--duplicate');
      }
    }

    const filterById = selectedValue === 'all' ? null : selectedValue;
    let visibleRowCount = 0;

    this.stickerRowsById.forEach((stickerRow, stickerId) => {
      const isHidden =
        (filterById !== null && stickerRow.item.dataset.teamId !== filterById)
        || (searchValue !== '' && !stickerId.toLowerCase().includes(searchValue));
      stickerRow.item.classList.toggle('hidden', isHidden);
      if (!isHidden) {
        visibleRowCount += 1;
      }
    });

    this.teamSectionsById.forEach((teamItem, teamId) => {
      const teamMatchesSelect = selectedValue === 'all' || selectedValue === teamId;
      const stickerRows = this.stickerRowsByTeamId.get(teamId) ?? [];
      const visibleInTeam = stickerRows.some((stickerRow) => !stickerRow.item.classList.contains('hidden'));
      teamItem.classList.toggle('hidden', !teamMatchesSelect || !visibleInTeam);
    });

    const hasVisibleContent = visibleRowCount > 0 && this.teamSectionsById.size > 0;
    if (this.elements.emptyStateElement) {
      this.elements.emptyStateElement.classList.toggle('hidden', hasVisibleContent);
    }
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
      stickerRow.removeButton.disabled = count === 0;
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
      stickerRow.count.textContent = duplicateCount > 0
        ? String(duplicateCount)
        : '';
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