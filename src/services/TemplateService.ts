export type TemplateKey =
  | 'collection-filter-option'
  | 'team-section'
  | 'sticker-item'
  | 'modal-shell'
  | 'sticker-results-modal-content'
  | 'sticker-results-modal-list-item'
  | 'sticker-results-modal-empty';

class TemplateService {
  constructor(private readonly root: ParentNode = document) {}

  private getTemplate(templateKey: TemplateKey): HTMLTemplateElement {
    const selector = `#${CSS.escape(templateKey)}`;
    const template = this.root.querySelector(selector) as HTMLTemplateElement | null;

    if (!template) {
      throw new Error(`Missing template: ${templateKey}`);
    }

    return template;
  }

  cloneElement<T extends Element>(templateKey: TemplateKey): T {
    const template = this.getTemplate(templateKey);
    const element = template.content.firstElementChild?.cloneNode(true) as T | null;

    if (!element) {
      throw new Error(`Template has no root element: ${templateKey}`);
    }

    return element;
  }

  cloneFragment(templateKey: TemplateKey): DocumentFragment {
    return this.getTemplate(templateKey).content.cloneNode(true) as DocumentFragment;
  }
}

export default TemplateService;