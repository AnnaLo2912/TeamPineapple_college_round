/**
 * Screen Element Dictator
 * Native screen reader engine announcing focused/hovered elements, ARIA labels,
 * roles, input types, and values for 100% eyes-free blind navigation.
 */

export class ScreenDictator {
  private lastAnnouncedElement: HTMLElement | null = null;
  private lastSpokenText: string = '';
  private debounceTimer: number | null = null;
  private isSpeaking: boolean = false;

  public get speaking(): boolean {
    return this.isSpeaking;
  }

  /**
   * Speak arbitrary text via native browser SpeechSynthesis.
   * Cancels any ongoing utterance immediately if priority is high.
   */
  public speak(text: string, interrupt: boolean = true): Promise<void> {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text || text.trim().length === 0) {
        resolve();
        return;
      }

      if (interrupt) {
        window.speechSynthesis.cancel();
      }

      const cleanText = text.trim();
      this.lastSpokenText = cleanText;

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 1.05; // Slightly faster for screen reader clarity
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';

      utterance.onend = () => {
        this.isSpeaking = false;
        resolve();
      };

      utterance.onerror = (e) => {
        console.warn('[ScreenDictator] Utterance error:', e);
        this.isSpeaking = false;
        resolve();
      };

      this.isSpeaking = true;
      window.speechSynthesis.speak(utterance);
    });
  }

  /**
   * Stop any ongoing speech immediately
   */
  public stop(): void {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.isSpeaking = false;
  }

  /**
   * Inspect element and return accessible spoken representation
   */
  public getElementDescription(el: HTMLElement): string {
    if (!el || !(el instanceof HTMLElement)) return '';

    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const type = (el.getAttribute('type') || '').toLowerCase();

    // 1. Determine Accessible Name / Label
    let name = (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      (el as HTMLImageElement).alt ||
      ''
    ).trim();

    if (!name && el.getAttribute('aria-labelledby')) {
      const labelledBy = document.getElementById(el.getAttribute('aria-labelledby') || '');
      if (labelledBy) name = (labelledBy.innerText || labelledBy.textContent || '').trim();
    }

    if (!name) {
      // Look for linked label for inputs
      if (el.id) {
        const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (labelEl) name = (labelEl.textContent || '').trim();
      }
      const parentLabel = el.closest('label');
      if (parentLabel) name = (parentLabel.textContent || '').trim();
    }

    if (!name) {
      name = (el.innerText || el.textContent || '').trim();
    }

    // Collapse whitespace and cap length
    name = name.replace(/\s+/g, ' ').slice(0, 120);

    // 2. Determine Role / Type Announcement
    let roleText = '';
    if (role === 'searchbox' || tag === 'textarea' && el.getAttribute('name') === 'q' || (tag === 'input' && (type === 'search' || el.getAttribute('name') === 'q'))) {
      roleText = 'Search box';
    } else if (role === 'button' || tag === 'button' || (tag === 'input' && (type === 'submit' || type === 'button'))) {
      roleText = 'Button';
    } else if (tag === 'a' || role === 'link') {
      roleText = 'Link';
    } else if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || role === 'heading') {
      roleText = 'Heading';
    } else if (tag === 'input' && type === 'checkbox' || role === 'checkbox') {
      const checked = (el as HTMLInputElement).checked || el.getAttribute('aria-checked') === 'true';
      roleText = `Checkbox, ${checked ? 'checked' : 'not checked'}`;
    } else if (tag === 'input' && type === 'radio' || role === 'radio') {
      const checked = (el as HTMLInputElement).checked || el.getAttribute('aria-checked') === 'true';
      roleText = `Radio button, ${checked ? 'selected' : 'not selected'}`;
    } else if (tag === 'input' || tag === 'textarea') {
      roleText = type === 'password' ? 'Password field' : 'Text input';
    } else if (role === 'navigation' || tag === 'nav') {
      roleText = 'Navigation';
    } else if (role) {
      roleText = role.charAt(0).toUpperCase() + role.slice(1);
    }

    // 3. Current value for editable inputs
    let valueText = '';
    if (tag === 'input' || tag === 'textarea') {
      const val = (el as HTMLInputElement).value || '';
      if (val && type !== 'password') {
        valueText = `, value: ${val.slice(0, 60)}`;
      }
    }

    // Format final announcement
    if (name && roleText) {
      return `${roleText}: ${name}${valueText}`;
    } else if (name) {
      return `${name}${valueText}`;
    } else if (roleText) {
      return roleText;
    }
    return '';
  }

  /**
   * Announce an element with debouncing to prevent audio congestion
   */
  public dictateElement(el: HTMLElement, debounceMs: number = 180): void {
    if (!el || el === this.lastAnnouncedElement) return;

    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.lastAnnouncedElement = el;
      const desc = this.getElementDescription(el);
      if (desc && desc !== this.lastSpokenText) {
        this.speak(desc, true);
      }
    }, debounceMs);
  }
}

export const screenDictator = new ScreenDictator();
