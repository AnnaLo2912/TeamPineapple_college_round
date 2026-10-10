/**
 * Handsfree - Content Script
 * Handles input focus tracking, text insertion, webpage reading extraction, and TTS section highlighting
 */

(() => {
  let lastFocusedElement = null;
  let pageSections = [];
  let currentSectionIndex = -1;
  let activeHighlightEl = null;

  /**
   * Check if an element is an editable text field
   */
  function isEditableElement(el) {
    if (!el) return false;
    const tagName = el.tagName ? el.tagName.toLowerCase() : '';
    
    if (tagName === 'textarea') return true;
    if (tagName === 'input') {
      const type = (el.type || 'text').toLowerCase();
      const validTypes = ['text', 'search', 'email', 'url', 'tel', 'password', 'number', ''];
      return validTypes.includes(type);
    }
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      return true;
    }
    return false;
  }

  /**
   * Track focused elements across webpage
   */
  document.addEventListener('focusin', (e) => {
    if (isEditableElement(e.target)) {
      lastFocusedElement = e.target;
    }
  }, true);

  document.addEventListener('click', (e) => {
    if (isEditableElement(e.target)) {
      lastFocusedElement = e.target;
    }
  }, true);

  /**
   * Safely insert dictated text into target input without auto-submitting forms
   */
  function insertDictatedText(text) {
    let target = lastFocusedElement || document.activeElement;

    if (!target || !isEditableElement(target)) {
      return { success: false, error: 'No focused text field found in current question.' };
    }

    const tagName = target.tagName ? target.tagName.toLowerCase() : '';

    if (tagName === 'input' || tagName === 'textarea') {
      const start = target.selectionStart !== null ? target.selectionStart : target.value.length;
      const end = target.selectionEnd !== null ? target.selectionEnd : target.value.length;
      const value = target.value || '';

      let prefixSpace = '';
      if (start > 0 && !/\s$/.test(value.slice(0, start)) && !/^\s/.test(text)) {
        prefixSpace = ' ';
      }

      const inserted = prefixSpace + text;
      const newValue = value.slice(0, start) + inserted + value.slice(end);

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(target, newValue);
      } else {
        target.value = newValue;
      }

      const newCursorPos = start + inserted.length;
      if (typeof target.setSelectionRange === 'function') {
        target.setSelectionRange(newCursorPos, newCursorPos);
      }

      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));

    } else if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
      target.focus();
      document.execCommand('insertText', false, text);
    }

    flashHighlight(target);
    return { success: true, element: target.tagName };
  }

  function flashHighlight(el) {
    if (!el) return;
    const origOutline = el.style.outline;
    const origTransition = el.style.transition;

    el.style.transition = 'outline 0.2s ease';
    el.style.outline = '3px solid #6366f1';

    setTimeout(() => {
      el.style.outline = origOutline;
      el.style.transition = origTransition;
    }, 1200);
  }

  /**
   * Extract radio buttons, checkboxes, and option labels ONLY for a specific question card
   */
  function extractOptionsForContainer(el) {
    if (!el) return [];
    
    // Scoped strictly to question card containers (never global form or main wrapper)
    const card = el.closest('.freebirdFormviewerViewItemsItemItem, .geGbSc, .Qr258d, [role="listitem"], fieldset');
    if (!card) return [];
    
    const optSelector = [
      '[role="radio"]',
      '[role="checkbox"]',
      'input[type="radio"]',
      'input[type="checkbox"]',
      '.docssharedWizToggleLabeledContainer',
      '.bzFqB',
      '.aN114e'
    ].join(', ');

    const rawOptElements = Array.from(card.querySelectorAll(optSelector));
    const options = [];
    const seenOptTexts = new Set();

    rawOptElements.forEach(optEl => {
      let labelText = (
        optEl.getAttribute('aria-label') ||
        optEl.innerText ||
        optEl.querySelector('.docssharedWizToggleLabeledLabelText, .aN114e, label, span')?.innerText ||
        ''
      ).trim();

      labelText = labelText.replace(/\s+/g, ' ').trim();

      if (!labelText || labelText.length < 1) return;
      if (seenOptTexts.has(labelText.toLowerCase())) return;

      seenOptTexts.add(labelText.toLowerCase());
      options.push({
        text: labelText,
        element: optEl
      });
    });

    return options;
  }

  /**
   * Extract main readable content sections from active webpage
   * Deduplicates question blocks so each question is a single section with attached options
   */
  function extractReadableSections() {
    pageSections = [];
    currentSectionIndex = -1;

    // 1. Identify distinct Google Forms question cards or fieldsets
    const rawQuestionCards = Array.from(document.querySelectorAll('.geGbSc, .Qr258d, .freebirdFormviewerViewItemsItemItem, [role="listitem"], fieldset'));
    
    const candidateNodes = [];

    rawQuestionCards.forEach(card => {
      if (card.offsetParent === null) return;
      const style = window.getComputedStyle(card);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

      const titleEl = card.querySelector('.M7eF9d, .freebirdFormviewerViewItemsItemItemTitle, [role="heading"]') || card.querySelector('input, textarea, [role="radio"], [role="checkbox"]');
      if (titleEl && !candidateNodes.some(existing => existing.contains(card))) {
        candidateNodes.push(card);
      }
    });

    // 2. Also collect top-level form title / header elements (outside question cards)
    const headerElements = Array.from(document.querySelectorAll('.FwuAfe, .freebirdFormviewerViewHeaderHeader, h1, h2, h3, h4, h5, h6, [role="heading"]'));
    headerElements.forEach(hdr => {
      if (hdr.offsetParent === null) return;
      if (hdr.closest('.geGbSc, .Qr258d, .freebirdFormviewerViewItemsItemItem, [role="listitem"], fieldset')) return;
      
      const text = (hdr.innerText || '').trim();
      if (text.length >= 2 && !candidateNodes.some(existing => existing.contains(hdr))) {
        candidateNodes.push(hdr);
      }
    });

    // Sort candidate nodes by vertical position on page
    candidateNodes.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return rectA.top - rectB.top;
    });

    const ignoredTextSubstrings = [
      'does this form look suspicious',
      'report abuse',
      'never submit passwords through google forms',
      'terms of service',
      'privacy policy',
      'google forms'
    ];

    const seenTexts = new Set();

    candidateNodes.forEach(el => {
      const text = (el.innerText || '').trim();
      if (!text || text.length < 2) return;

      const lowerText = text.toLowerCase();
      for (const phrase of ignoredTextSubstrings) {
        if (lowerText.includes(phrase)) return;
      }

      // Find question title text (.M7eF9d or first heading)
      const titleEl = el.querySelector('.M7eF9d, .freebirdFormviewerViewItemsItemItemTitle, [role="heading"], h1, h2, h3, h4, h5, h6') || el;
      let rawTitle = (titleEl.innerText || '').trim();
      if (!rawTitle) rawTitle = text.split('\n')[0].trim();

      let titleText = rawTitle.replace(/[\*\:\_\s]+$/, '').replace(/\s+/g, ' ').trim();
      if (!titleText || titleText.length < 2) return;

      // Extract options strictly inside this item card
      const options = extractOptionsForContainer(el);

      if (seenTexts.has(titleText.toLowerCase())) return;
      seenTexts.add(titleText.toLowerCase());

      const tag = el.tagName.toUpperCase();
      const role = el.getAttribute('role') || '';

      let formattedText = titleText;
      if (tag.startsWith('H') || role === 'heading' || el.classList.contains('M7eF9d') || el.querySelector('.M7eF9d') || el.classList.contains('FwuAfe')) {
        formattedText = `Heading: ${titleText}`;
      }

      if (options.length > 0) {
        const optListStr = options.map(o => o.text).join(', ');
        formattedText = `${formattedText}. Options are: ${optListStr}`;
      }

      pageSections.push({
        index: pageSections.length,
        text: formattedText,
        rawText: titleText,
        element: el,
        tag: tag,
        options: options.map(o => ({ text: o.text }))
      });
    });

    console.log(`[Handsfree] Extracted ${pageSections.length} clean readable sections from page.`);
    return pageSections;
  }

  /**
   * Automatically focus associated input/textarea element for a section
   */
  function autoFocusInputForSection(el) {
    if (!el) return;

    // 1. If el itself is an editable input
    if (isEditableElement(el)) {
      el.focus();
      lastFocusedElement = el;
      return;
    }

    // 2. Look inside el for an editable input
    const childInput = el.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]');
    if (childInput && isEditableElement(childInput)) {
      childInput.focus();
      lastFocusedElement = childInput;
      return;
    }

    // 3. Find parent container (like a question card in Google Forms) and look for input inside it
    const parentContainer = el.closest('.freebirdFormviewerViewItemsItemItem, .geGbSc, .Qr258d, [role="listitem"], form, fieldset, section') || el.parentElement;
    if (parentContainer) {
      const containerInput = parentContainer.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]');
      if (containerInput && isEditableElement(containerInput)) {
        containerInput.focus();
        lastFocusedElement = containerInput;
        return;
      }
    }

    // 4. Check adjacent siblings for an input field
    let sibling = el.nextElementSibling;
    let count = 0;
    while (sibling && count < 3) {
      if (isEditableElement(sibling)) {
        sibling.focus();
        lastFocusedElement = sibling;
        return;
      }
      const sibInput = sibling.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]');
      if (sibInput && isEditableElement(sibInput)) {
        sibInput.focus();
        lastFocusedElement = sibInput;
        return;
      }
      sibling = sibling.nextElementSibling;
      count++;
    }

    // 5. If no text input field found (e.g. Radio/Checkbox question), reset lastFocusedElement
    lastFocusedElement = null;
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      try { document.activeElement.blur(); } catch (e) {}
    }
  }

  /**
   * Highlight and scroll to active reading section
   */
  function highlightSection(index) {
    if (activeHighlightEl) {
      activeHighlightEl.style.outline = '';
      activeHighlightEl.style.backgroundColor = '';
      activeHighlightEl.style.borderRadius = '';
      activeHighlightEl = null;
    }

    if (index < 0 || index >= pageSections.length) return null;

    const section = pageSections[index];
    const el = section.element;

    if (el) {
      el.style.transition = 'all 0.3s ease';
      el.style.outline = '2px solid #818cf8';
      el.style.backgroundColor = 'rgba(99, 102, 241, 0.12)';
      el.style.borderRadius = '6px';
      activeHighlightEl = el;

      // Scroll element into middle of view
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Automatically focus associated input field for Google Forms / web forms
      autoFocusInputForSection(el);
    }

    currentSectionIndex = index;
    return section;
  }

  /**
   * Clear current section highlight
   */
  function clearHighlight() {
    if (activeHighlightEl) {
      activeHighlightEl.style.outline = '';
      activeHighlightEl.style.backgroundColor = '';
      activeHighlightEl.style.borderRadius = '';
      activeHighlightEl = null;
    }
  }

  /**
   * Smoothly scroll webpage up or down
   */
  function scrollPage(direction) {
    const distance = window.innerHeight * 0.6;
    if (direction === 'down') {
      window.scrollBy({ top: distance, behavior: 'smooth' });
    } else if (direction === 'up') {
      window.scrollBy({ top: -distance, behavior: 'smooth' });
    }
  }

  /**
   * Get selected text on webpage
   */
  function getSelectedText() {
    const selection = window.getSelection();
    return selection ? selection.toString().trim() : '';
  }

  /**
   * Select radio button(s) or checkbox(es) by voice transcript match
   * Supports single selection ("select male") or multiple selection ("select pizza and burger")
   */
  function selectOptionByVoice(queryText, sectionIndex) {
    if (!queryText) return { success: false, error: 'No option specified' };

    let cleanQuery = queryText.toLowerCase()
      .replace(/^select\s+/i, '')
      .replace(/^choose\s+/i, '')
      .replace(/^pick\s+/i, '')
      .replace(/^check\s+/i, '')
      .replace(/[^\w\s\,]/g, '')
      .trim();

    // Split by "and" or "," for multi-selection (e.g. "pizza and burger")
    const searchTerms = cleanQuery.split(/\s+and\s+|\s*,\s*/).map(t => t.trim()).filter(t => t.length > 0);
    if (searchTerms.length === 0) searchTerms.push(cleanQuery);

    let candidateOptions = [];

    if (sectionIndex !== undefined && sectionIndex >= 0 && sectionIndex < pageSections.length) {
      const sec = pageSections[sectionIndex];
      if (sec && sec.element) {
        candidateOptions = extractOptionsForContainer(sec.element);
      }
    }

    if (candidateOptions.length === 0) {
      const allOptEls = Array.from(document.querySelectorAll('[role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"], .docssharedWizToggleLabeledContainer'));
      candidateOptions = allOptEls.map(el => {
        const labelText = (el.getAttribute('aria-label') || el.innerText || el.querySelector('.docssharedWizToggleLabeledLabelText, label, span')?.innerText || '').trim();
        return { text: labelText, element: el };
      }).filter(o => o.text.length > 0);
    }

    const selectedResults = [];

    for (const term of searchTerms) {
      if (!term) continue;
      const termLower = term.toLowerCase();

      // Match strategy: exact match > startsWith > includes > phrase contains option
      let bestMatch = candidateOptions.find(o => o.text.toLowerCase() === termLower);
      if (!bestMatch) {
        bestMatch = candidateOptions.find(o => o.text.toLowerCase().startsWith(termLower));
      }
      if (!bestMatch) {
        bestMatch = candidateOptions.find(o => o.text.toLowerCase().includes(termLower));
      }
      if (!bestMatch) {
        bestMatch = candidateOptions.find(o => termLower.includes(o.text.toLowerCase()) && o.text.length >= 3);
      }

      if (bestMatch && bestMatch.element) {
        const targetEl = bestMatch.element;

        // Trigger click event
        targetEl.click();

        // Also update native input state if applicable
        if (targetEl.tagName === 'INPUT') {
          targetEl.checked = true;
          targetEl.dispatchEvent(new Event('change', { bubbles: true }));
          targetEl.dispatchEvent(new Event('input', { bubbles: true }));
        }

        flashHighlight(targetEl);
        selectedResults.push(bestMatch.text);
      }
    }

    if (selectedResults.length > 0) {
      return {
        success: true,
        selected: selectedResults,
        message: `Selected: ${selectedResults.join(', ')}`
      };
    }

    return {
      success: false,
      error: `No option matching "${cleanQuery}". Available: ${candidateOptions.map(o => o.text).join(', ')}`
    };
  }

  /**
   * Delete previous word in focused text input
   */
  function backspaceLastWord() {
    let target = lastFocusedElement || document.activeElement;
    if (!isEditableElement(target)) {
      const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
      target = inputs.find(el => isEditableElement(el) && el.offsetParent !== null) || null;
    }

    if (!target || !isEditableElement(target)) {
      return { success: false, error: 'No active text field focused.' };
    }

    const tagName = target.tagName ? target.tagName.toLowerCase() : '';

    if (tagName === 'input' || tagName === 'textarea') {
      let value = target.value || '';
      if (!value) return { success: true, message: 'Text field is empty.' };

      // Remove last word and trailing whitespace
      const newValue = value.replace(/\s*\S+\s*$/, '');

      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(target, newValue);
      } else {
        target.value = newValue;
      }

      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      flashHighlight(target);
      return { success: true, message: 'Deleted previous word.' };
    } else if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
      target.focus();
      document.execCommand('undo', false, null);
      flashHighlight(target);
      return { success: true, message: 'Deleted previous word.' };
    }

    return { success: false, error: 'Cannot backspace on target element.' };
  }

  /**
   * Clear all text in focused input field
   */
  function clearInputText() {
    let target = lastFocusedElement || document.activeElement;
    if (!isEditableElement(target)) {
      const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
      target = inputs.find(el => isEditableElement(el) && el.offsetParent !== null) || null;
    }

    if (!target || !isEditableElement(target)) {
      return { success: false, error: 'No active text field focused.' };
    }

    const tagName = target.tagName ? target.tagName.toLowerCase() : '';

    if (tagName === 'input' || tagName === 'textarea') {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(target, '');
      } else {
        target.value = '';
      }

      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      flashHighlight(target);
      return { success: true, message: 'Cleared text field.' };
    } else if (target.isContentEditable || target.getAttribute('contenteditable') === 'true') {
      target.innerHTML = '';
      flashHighlight(target);
      return { success: true, message: 'Cleared text field.' };
    }

    return { success: false, error: 'Cannot clear target element.' };
  }

  /**
   * Uncheck checked radio buttons / checkboxes in active section or page
   */
  function undoCheckedOptions(sectionIndex) {
    let card = null;
    if (sectionIndex !== undefined && sectionIndex >= 0 && sectionIndex < pageSections.length) {
      const sec = pageSections[sectionIndex];
      if (sec && sec.element) card = sec.element;
    }

    if (!card) {
      card = document.body;
    }

    const checkedEls = Array.from(card.querySelectorAll('[role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"], input[type="radio"]:checked, input[type="checkbox"]:checked, .docssharedWizToggleLabeledContainer[aria-checked="true"]'));

    if (checkedEls.length === 0) {
      const clearBtn = card.querySelector('.freebirdFormviewerViewItemsItemClearSelectionButton, [role="button"][data-tooltip*="Clear"], button[aria-label*="Clear"]');
      if (clearBtn) {
        clearBtn.click();
        flashHighlight(clearBtn);
        return { success: true, message: 'Cleared section options.' };
      }
      return { success: false, error: 'No checked options found to uncheck.' };
    }

    checkedEls.forEach(el => {
      el.click();
      if (el.tagName === 'INPUT') {
        el.checked = false;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      flashHighlight(el);
    });

    return { success: true, message: `Unchecked ${checkedEls.length} option(s).` };
  }

  /**
   * Submit active web form or Google Form
   */
  function submitFormOnPage() {
    const selectors = [
      '.freebirdFormviewerViewNavigationSubmitButton',
      '.uArLdd[role="button"]',
      'div[role="button"][jsname="M2pvEf"]',
      'button[type="submit"]',
      'input[type="submit"]',
      '[role="button"][aria-label*="Submit"]',
      '[role="button"][aria-label*="Send"]'
    ];

    let submitBtn = null;
    for (const sel of selectors) {
      const candidate = document.querySelector(sel);
      if (candidate && candidate.offsetParent !== null) {
        submitBtn = candidate;
        break;
      }
    }

    if (!submitBtn) {
      const allBtns = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"]'));
      submitBtn = allBtns.find(b => {
        if (b.offsetParent === null) return false;
        const text = (b.innerText || b.value || b.getAttribute('aria-label') || '').toLowerCase().trim();
        return text === 'submit' || text === 'send' || text.includes('submit form');
      });
    }

    if (submitBtn) {
      flashHighlight(submitBtn);
      submitBtn.click();
      return { success: true, message: 'Form submitted successfully!' };
    }

    return { success: false, error: 'Could not find Submit button on page.' };
  }

  // ==========================================
  // NUMBERED LINK OVERLAY SYSTEM (Click-by-Voice)
  // ==========================================

  let hintsOverlay = null;
  let activeHints = [];
  let isHintsVisible = false;
  let hintThrottleTimer = null;

  function isElementVisibleForHints(el) {
    if (!el || el.offsetParent === null) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    // Viewport visibility check (with modest buffer for smooth scrolling)
    const viewHeight = window.innerHeight || document.documentElement.clientHeight;
    const viewWidth = window.innerWidth || document.documentElement.clientWidth;
    return (
      rect.bottom >= -50 &&
      rect.top <= viewHeight + 50 &&
      rect.right >= -50 &&
      rect.left <= viewWidth + 50
    );
  }

  function getOrCreateHintsOverlay() {
    if (!hintsOverlay || !hintsOverlay.isConnected) {
      hintsOverlay = document.createElement('div');
      hintsOverlay.id = 'handsfree-hints-overlay';
      hintsOverlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2147483640;
      `;
      document.body.appendChild(hintsOverlay);

      window.addEventListener('scroll', handleHintScrollResize, { passive: true });
      window.addEventListener('resize', handleHintScrollResize, { passive: true });
    }
    return hintsOverlay;
  }

  function handleHintScrollResize() {
    if (!isHintsVisible) return;
    if (hintThrottleTimer) return;
    hintThrottleTimer = setTimeout(() => {
      hintThrottleTimer = null;
      updateHintBadgePositions();
    }, 40);
  }

  function updateHintBadgePositions() {
    if (!isHintsVisible) return;
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    activeHints.forEach(hint => {
      if (!hint.element.isConnected) {
        if (hint.badgeEl) hint.badgeEl.style.display = 'none';
        return;
      }
      const rect = hint.element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        if (hint.badgeEl) hint.badgeEl.style.display = 'none';
        return;
      }
      hint.badgeEl.style.display = 'block';
      hint.badgeEl.style.left = `${rect.left + scrollX}px`;
      hint.badgeEl.style.top = `${rect.top + scrollY}px`;
    });
  }

  function showNumberedLinks() {
    clearNumberedLinks();
    const overlay = getOrCreateHintsOverlay();

    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[role="button"]:not([disabled])',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[onclick]',
      '[data-clickable]',
      'summary'
    ];

    const rawElements = Array.from(document.querySelectorAll(selectors.join(', ')));
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    let count = 0;
    const seenElements = new Set();

    rawElements.forEach(el => {
      if (seenElements.has(el)) return;
      if (!isElementVisibleForHints(el)) return;
      if (el.closest('#handsfree-hints-overlay, #handsfree-overlay-root')) return;

      count++;
      seenElements.add(el);

      const rect = el.getBoundingClientRect();
      const badge = document.createElement('span');
      badge.className = 'handsfree-hint-badge';
      badge.textContent = count;
      badge.setAttribute('data-hint-number', count);
      badge.style.cssText = `
        position: absolute;
        left: ${rect.left + scrollX}px;
        top: ${rect.top + scrollY}px;
        background: linear-gradient(135deg, #ffd700 0%, #f59e0b 100%);
        color: #0b0f19;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        font-weight: 800;
        line-height: 1;
        padding: 2px 5px;
        border-radius: 4px;
        border: 1px solid #ffffff;
        box-shadow: 0 2px 6px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,0,0,0.2);
        pointer-events: none;
        user-select: none;
        z-index: 2147483645;
        transform: translate(-4px, -8px);
        transition: transform 0.15s ease, background 0.2s ease;
      `;

      overlay.appendChild(badge);
      activeHints.push({
        number: count,
        element: el,
        badgeEl: badge
      });
    });

    isHintsVisible = true;
    console.log(`[Handsfree] Displayed ${activeHints.length} numbered link badges`);
    return { success: true, count: activeHints.length };
  }

  function clearNumberedLinks() {
    if (hintsOverlay) {
      hintsOverlay.innerHTML = '';
    }
    activeHints = [];
    isHintsVisible = false;
    return { success: true };
  }

  function toggleNumberedLinks() {
    if (isHintsVisible) {
      return clearNumberedLinks();
    } else {
      return showNumberedLinks();
    }
  }

  function clickNumberedLink(targetNum) {
    const num = parseInt(targetNum, 10);
    if (isNaN(num)) return { success: false, error: 'Invalid link number provided.' };

    // Auto-generate hints if not active
    if (!isHintsVisible || activeHints.length === 0) {
      showNumberedLinks();
    }

    const item = activeHints.find(h => h.number === num);
    if (!item || !item.element) {
      return { success: false, error: `Link #${num} not found. (Page has ${activeHints.length} numbered elements)` };
    }

    const el = item.element;
    flashHighlight(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const tagName = el.tagName.toLowerCase();
    const isInput = tagName === 'input' || tagName === 'textarea' || el.isContentEditable;

    if (isInput) {
      el.focus();
      lastFocusedElement = el;
      if (tagName === 'input' && (el.type === 'radio' || el.type === 'checkbox')) {
        el.click();
      }
    } else {
      el.click();
      el.focus();
    }

    const label = (
      el.innerText ||
      el.value ||
      el.getAttribute('aria-label') ||
      el.title ||
      `Element #${num}`
    ).trim().replace(/\s+/g, ' ').slice(0, 50);

    // Visual feedback: green pulse on the clicked badge
    if (item.badgeEl) {
      item.badgeEl.style.background = '#10b981';
      item.badgeEl.style.color = '#ffffff';
      item.badgeEl.style.transform = 'translate(-4px, -10px) scale(1.25)';
      setTimeout(() => {
        if (item.badgeEl) {
          item.badgeEl.style.background = 'linear-gradient(135deg, #ffd700 0%, #f59e0b 100%)';
          item.badgeEl.style.color = '#0b0f19';
          item.badgeEl.style.transform = 'translate(-4px, -8px) scale(1)';
        }
      }, 800);
    }

    return {
      success: true,
      number: num,
      label,
      tagName
    };
  }

  /**
   * Chrome Extension Message Listener
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'INSERT_DICTATION':
        sendResponse(insertDictatedText(request.text));
        break;

      case 'BACKSPACE_WORD':
        sendResponse(backspaceLastWord());
        break;

      case 'CLEAR_TEXT':
        sendResponse(clearInputText());
        break;

      case 'UNDO_CHECKED_OPTIONS':
        sendResponse(undoCheckedOptions(request.sectionIndex));
        break;

      case 'SUBMIT_FORM':
        sendResponse(submitFormOnPage());
        break;

      case 'SELECT_OPTION':
        sendResponse(selectOptionByVoice(request.text, request.sectionIndex));
        break;

      case 'GET_READABLE_SECTIONS':
        const sections = extractReadableSections();
        sendResponse({
          success: true,
          count: sections.length,
          sections: sections.map(s => ({ index: s.index, text: s.text, tag: s.tag, options: s.options }))
        });
        break;

      case 'HIGHLIGHT_SECTION':
        const sec = highlightSection(request.index);
        sendResponse({ success: !!sec, section: sec ? { index: sec.index, text: sec.text } : null });
        break;

      case 'CLEAR_HIGHLIGHT':
        clearHighlight();
        sendResponse({ success: true });
        break;

      case 'SCROLL':
        scrollPage(request.direction);
        sendResponse({ success: true });
        break;

      case 'GET_SELECTED_TEXT':
        sendResponse({ success: true, text: getSelectedText() });
        break;

      case 'PING_CONTENT_SCRIPT':
        sendResponse({ success: true });
        break;

      case 'SHOW_NUMBERED_LINKS':
        sendResponse(showNumberedLinks());
        break;

      case 'HIDE_NUMBERED_LINKS':
        sendResponse(clearNumberedLinks());
        break;

      case 'TOGGLE_NUMBERED_LINKS':
        sendResponse(toggleNumberedLinks());
        break;

      case 'CLICK_NUMBERED_LINK':
        sendResponse(clickNumberedLink(request.number));
        break;

      case 'GET_NUMBERED_LINKS_STATUS':
        sendResponse({ success: true, isVisible: isHintsVisible, count: activeHints.length });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
    return true;
  });

  console.log('[Handsfree] Content script active on:', window.location.href);
})();
