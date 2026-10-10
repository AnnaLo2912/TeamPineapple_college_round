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
   * Set native input/textarea value without triggering prototype Illegal invocation
   */
  function setElementNativeValue(el, val) {
    if (!el) return;
    try {
      const isTextArea = el instanceof HTMLTextAreaElement || (el.tagName && el.tagName.toLowerCase() === 'textarea');
      const proto = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) {
        setter.call(el, val);
      } else {
        el.value = val;
      }
    } catch (e) {
      try {
        el.value = val;
      } catch (err) {
        console.warn('[Handsfree] Failed to set element value:', err);
      }
    }
  }

  /**
   * Safely insert dictated text into target input without auto-submitting forms
   */
  function insertDictatedText(text) {
    let target = lastFocusedElement || document.activeElement;

    if (!target || !isEditableElement(target)) {
      target = eyesFreeSearchInput || findPrimarySearchInput();
      if (target && isEditableElement(target)) {
        lastFocusedElement = target;
        try { target.focus(); } catch (e) {}
      }
    }

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

      setElementNativeValue(target, newValue);

      const newCursorPos = start + inserted.length;
      if (typeof target.setSelectionRange === 'function') {
        try { target.setSelectionRange(newCursorPos, newCursorPos); } catch (e) {}
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

      setElementNativeValue(target, newValue);

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
      setElementNativeValue(target, '');

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

  // =========================================================================
  // Eyes-Free Blind & Visually Impaired Navigation Engine
  // =========================================================================

  let isBlindModeActive = false;
  let blindModeAudioCtx = null;
  let currentSearchResults = [];
  let eyesFreeSearchInput = null;
  let lastDictatedElement = null;

  function getBlindAudioContext() {
    try {
      if (!blindModeAudioCtx || blindModeAudioCtx.state === 'closed') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) blindModeAudioCtx = new AudioCtx();
      }
      if (blindModeAudioCtx && blindModeAudioCtx.state === 'suspended') {
        blindModeAudioCtx.resume().catch(() => {});
      }
      return blindModeAudioCtx;
    } catch (e) {
      return null;
    }
  }

  // --- Earcon Audio Synthesizer (Web Audio API) ---

  function playEarconActivate() {
    try {
      const ctx = getBlindAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.0001, now + idx * 0.08);
        gain.gain.linearRampToValueAtTime(0.18, now + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.25);
      });
    } catch (e) {
      console.warn('[Handsfree Earcon] Activate error:', e);
    }
  }

  function playEarconFocus() {
    try {
      const ctx = getBlindAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {
      console.warn('[Handsfree Earcon] Focus error:', e);
    }
  }

  function playEarconDictationStart() {
    try {
      const ctx = getBlindAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.07);
        gain.gain.setValueAtTime(0.12, now + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.07);
        osc.stop(now + i * 0.07 + 0.18);
      });
    } catch (e) {
      console.warn('[Handsfree Earcon] Dictation start error:', e);
    }
  }

  function playEarconDictationEnd() {
    try {
      const ctx = getBlindAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [659.25, 523.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.07);
        gain.gain.setValueAtTime(0.12, now + i * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.07);
        osc.stop(now + i * 0.07 + 0.18);
      });
    } catch (e) {
      console.warn('[Handsfree Earcon] Dictation end error:', e);
    }
  }

  function playEarconClick() {
    try {
      const ctx = getBlindAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {
      console.warn('[Handsfree Earcon] Click error:', e);
    }
  }

  function playEarconError() {
    try {
      const ctx = getBlindAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      [220, 180].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.12, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.14);
      });
    } catch (e) {
      console.warn('[Handsfree Earcon] Error earcon error:', e);
    }
  }

  function playEarconResultPing() {
    try {
      const ctx = getBlindAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(783.99, now); // G5
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {
      console.warn('[Handsfree Earcon] Ping error:', e);
    }
  }

  // --- Screen Dictator Speech Synthesizer ---

  let screenDictatorDebounceTimer = null;
  let lastSpokenScreenText = '';
  let isScreenSpeaking = false;

  function speakScreenText(text, interrupt = true) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text || text.trim().length === 0) {
        resolve();
        return;
      }
      isScreenSpeaking = true;
      pauseInTabVoiceListening();

      if (interrupt) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
      const UtteranceClass = window.SpeechSynthesisUtterance;
      if (!UtteranceClass) {
        isScreenSpeaking = false;
        resolve();
        return;
      }
      const utterance = new UtteranceClass(text.trim());
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';

      const finish = () => {
        isScreenSpeaking = false;
        setTimeout(() => {
          resumeInTabVoiceListening();
        }, 300);
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    });
  }

  function getElementScreenDescription(el) {
    if (!el || !(el instanceof HTMLElement)) return '';
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const type = (el.getAttribute('type') || '').toLowerCase();

    let name = (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('alt') ||
      ''
    ).trim();

    if (!name && el.getAttribute('aria-labelledby')) {
      const lbl = document.getElementById(el.getAttribute('aria-labelledby'));
      if (lbl) name = (lbl.innerText || lbl.textContent || '').trim();
    }
    if (!name) {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) name = (lbl.innerText || lbl.textContent || '').trim();
      }
      const parentLbl = el.closest('label');
      if (parentLbl) name = (parentLbl.innerText || parentLbl.textContent || '').trim();
    }
    if (!name) {
      name = (el.innerText || el.textContent || '').trim();
    }
    name = name.replace(/\s+/g, ' ').slice(0, 100);

    let roleText = '';
    if (role === 'searchbox' || tag === 'textarea' && el.name === 'q' || tag === 'input' && (type === 'search' || el.name === 'q')) {
      roleText = 'Search box';
    } else if (role === 'button' || tag === 'button' || tag === 'input' && (type === 'submit' || type === 'button')) {
      roleText = 'Button';
    } else if (tag === 'a' || role === 'link') {
      roleText = 'Link';
    } else if (tag.startsWith('h') && tag.length === 2 || role === 'heading') {
      roleText = 'Heading';
    } else if (tag === 'input' && type === 'checkbox' || role === 'checkbox') {
      const chk = el.checked || el.getAttribute('aria-checked') === 'true';
      roleText = `Checkbox, ${chk ? 'checked' : 'not checked'}`;
    } else if (tag === 'input' && type === 'radio' || role === 'radio') {
      const chk = el.checked || el.getAttribute('aria-checked') === 'true';
      roleText = `Radio button, ${chk ? 'selected' : 'not selected'}`;
    } else if (tag === 'input' || tag === 'textarea') {
      roleText = type === 'password' ? 'Password field' : 'Text input';
    }

    let valText = '';
    if (tag === 'input' || tag === 'textarea') {
      const v = el.value || '';
      if (v && type !== 'password') valText = `, value: ${v.slice(0, 50)}`;
    }

    if (name && roleText) return `${roleText}: ${name}${valText}`;
    if (name) return `${name}${valText}`;
    if (roleText) return roleText;
    return '';
  }

  function dictateElement(el) {
    if (!el || el === lastDictatedElement) return;
    if (screenDictatorDebounceTimer) clearTimeout(screenDictatorDebounceTimer);

    screenDictatorDebounceTimer = setTimeout(() => {
      lastDictatedElement = el;
      const desc = getElementScreenDescription(el);
      if (desc && desc !== lastSpokenScreenText) {
        lastSpokenScreenText = desc;
        speakScreenText(desc, true);
      }
    }, 180);
  }

  // --- Eyes-Free Search Bar Snapping & Glide ---

  function findPrimarySearchInput() {
    const selectors = [
      'textarea[name="q"]',
      'input[name="q"]',
      'textarea[aria-label*="Search" i]',
      'input[aria-label*="Search" i]',
      '[role="searchbox"]',
      'input[type="search"]',
      'input[title*="Search" i]',
      'input[placeholder*="Search" i]',
      'input#search',
      'form[role="search"] textarea',
      'form[role="search"] input'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && !el.disabled && (el.offsetParent !== null || el.getClientRects().length > 0)) {
        return el;
      }
    }
    return null;
  }

  function glideToSearchInput() {
    const input = findPrimarySearchInput();
    if (!input) {
      playEarconError();
      speakScreenText('Search bar not found on this page.');
      return { success: false, error: 'Search input not found' };
    }

    eyesFreeSearchInput = input;
    lastFocusedElement = input;

    ensureBlindIndicatorStyles();

    // Smooth animated glide into center
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus();

    // High-contrast glowing accessibility indicator
    const origOutline = input.style.outline;
    const origBoxShadow = input.style.boxShadow;
    const origTransition = input.style.transition;
    input.style.transition = 'all 0.3s ease';
    input.style.outline = '4px solid #f59e0b';
    input.style.boxShadow = '0 0 24px rgba(245, 158, 11, 0.8)';

    setTimeout(() => {
      input.style.outline = origOutline;
      input.style.boxShadow = origBoxShadow;
      input.style.transition = origTransition;
    }, 3500);

    playEarconFocus();
    updateBlindIndicator('🔍 Focused Search Bar', false);
    speakScreenText('Search bar ready. Speak your query, then say Done.');
    return { success: true, message: 'Glided to search input and focused' };
  }

  function finishQuery(queryParam) {
    const input = eyesFreeSearchInput || lastFocusedElement || findPrimarySearchInput();
    if (input && queryParam) {
      setElementNativeValue(input, queryParam);
    }
    const query = (queryParam || (input ? input.value : '') || '').trim();

    playEarconDictationEnd();
    if (query) {
      speakScreenText(`Query entered: ${query}. Say Search to execute.`);
      return { success: true, query };
    } else {
      speakScreenText('Search input is empty. Speak your search term first.');
      return { success: false, error: 'Empty query' };
    }
  }

  function executeSearchQuery(queryParam) {
    const input = eyesFreeSearchInput || lastFocusedElement || findPrimarySearchInput();
    const query = (queryParam || (input ? input.value : '') || '').trim();

    playEarconClick();
    if (query) {
      speakScreenText(`Searching for: ${query}...`);
    } else {
      speakScreenText('Executing search...');
    }

    if (input && query) {
      setElementNativeValue(input, query);
    }

    let submitted = false;
    if (input) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, which: 13, code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, code: 'Enter', bubbles: true }));

      const form = input.closest('form');
      if (form) {
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], [aria-label*="Search" i]');
        if (submitBtn) {
          submitBtn.click();
          submitted = true;
        } else {
          try {
            form.submit();
            submitted = true;
          } catch (e) {}
        }
      }
    }

    // Direct Google search fallback if not submitted via form or no input
    if (query && (!submitted || !input)) {
      setTimeout(() => {
        window.location.href = 'https://www.google.com/search?q=' + encodeURIComponent(query);
      }, 350);
    }

    return { success: true, query };
  }

  // --- Search Results Sequential Reader ---

  function extractSearchResults() {
    currentSearchResults = [];
    const selectors = [
      '#search h3',
      '#rso h3',
      'div.g h3',
      '[data-sokoban-container] h3',
      '.yuRUbf h3',
      'main a h3',
      'main h3 a',
      'article h3',
      '.result__title'
    ];

    const rawHeadings = Array.from(document.querySelectorAll(selectors.join(', ')));
    const seenUrls = new Set();

    rawHeadings.forEach((h3) => {
      const text = (h3.innerText || h3.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text || text.length < 3) return;

      const anchor = h3.closest('a') || h3.querySelector('a') || h3.parentElement?.closest('a');
      if (!anchor || !anchor.href) return;

      const url = anchor.href;
      if (url.startsWith('javascript:') || url.includes('google.com/search') || seenUrls.has(url)) return;

      seenUrls.add(url);
      currentSearchResults.push({
        number: currentSearchResults.length + 1,
        title: text,
        url: url,
        element: anchor
      });
    });

    return currentSearchResults.slice(0, 8); // Top 8 clean results
  }

  function readSearchResults() {
    const results = extractSearchResults();
    if (results.length === 0) {
      playEarconError();
      speakScreenText('No search results found on this page. Say Go to search for a new query.');
      return { success: false, error: 'No search results found' };
    }

    playEarconResultPing();
    const resultSummaries = results.map(r => `Result ${r.number}: ${r.title}`).join('. ');
    const announcement = `Found ${results.length} results. ${resultSummaries}. Say "Click link" followed by a number to open.`;
    speakScreenText(announcement);
    return { success: true, count: results.length, results: results.map(r => ({ number: r.number, title: r.title, url: r.url })) };
  }

  function clickSearchResult(num) {
    const targetNum = parseInt(num, 10);
    if (isNaN(targetNum)) return { success: false, error: 'Invalid result number.' };

    if (currentSearchResults.length === 0) {
      extractSearchResults();
    }

    const item = currentSearchResults.find(r => r.number === targetNum);
    if (!item || !item.element) {
      playEarconError();
      speakScreenText(`Result ${targetNum} not found. Say Read results to hear available items.`);
      return { success: false, error: `Result ${targetNum} not found.` };
    }

    playEarconClick();
    speakScreenText(`Opening Result ${targetNum}: ${item.title}`);
    flashHighlight(item.element);

    setTimeout(() => {
      if (item.element) item.element.click();
      else window.location.href = item.url;
    }, 400);

    return { success: true, number: targetNum, title: item.title, url: item.url };
  }

  // --- In-Tab Continuous Speech Recognition & Eyes-Free Engine ---
  let blindIndicatorEl = null;

  function ensureBlindIndicatorStyles() {}

  function updateBlindIndicator(text, isRecording = true) {
    if (!document.body) return;
    if (!blindIndicatorEl) {
      blindIndicatorEl = document.createElement('div');
      blindIndicatorEl.id = 'handsfree-blind-status-badge';
      blindIndicatorEl.setAttribute('role', 'status');
      blindIndicatorEl.setAttribute('aria-live', 'polite');
      blindIndicatorEl.style.cssText = 'position:fixed!important;bottom:24px!important;right:24px!important;background:#0f172a!important;border:2px solid #f59e0b!important;border-radius:9999px!important;padding:8px 16px!important;color:#f8fafc!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif!important;font-size:13px!important;font-weight:600!important;display:flex!important;align-items:center!important;gap:10px!important;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5),0 0 15px rgba(245,158,11,0.4)!important;z-index:2147483647!important;pointer-events:none!important;transition:all 0.25s ease!important;';
      document.body.appendChild(blindIndicatorEl);
    }
    blindIndicatorEl.style.display = isBlindModeActive ? 'flex' : 'none';
    const dotColor = isRecording ? '#ef4444' : '#10b981';
    blindIndicatorEl.innerHTML = `<span style="width:10px!important;height:10px!important;border-radius:50%!important;background:${dotColor}!important;display:inline-block!important;"></span><span>${text}</span>`;
  }

  let inTabVoiceActive = false;
  let inTabVoiceMuted = false;

  function startInTabVoiceListening() {
    if (!isBlindModeActive) return;
    inTabVoiceActive = true;
    inTabVoiceMuted = false;
    updateBlindIndicator('🦻 Eyes-Free Active: Speak your query or command', true);
  }

  function stopInTabVoiceListening() {
    inTabVoiceActive = false;
    if (blindIndicatorEl) {
      blindIndicatorEl.style.display = 'none';
    }
  }

  function pauseInTabVoiceListening() {
    inTabVoiceMuted = true;
  }

  function resumeInTabVoiceListening() {
    inTabVoiceMuted = false;
  }

  function handleInTabVoiceCommand(transcript) {
    if (!transcript || isScreenSpeaking) return;
    const clean = transcript.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    console.log('[Handsfree InTab Command] Heard:', clean);

    updateBlindIndicator(`🗣️ "${clean}"`, false);
    setTimeout(() => {
      if (isBlindModeActive && inTabVoiceActive) {
        updateBlindIndicator('🎤 Listening: Say "Go to search"', true);
      }
    }, 3000);

    // Normalize word numbers 1-10
    const wordNums = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
    let norm = clean;
    for (const [w, d] of Object.entries(wordNums)) {
      norm = norm.replace(new RegExp(`\\b${w}\\b`, 'g'), d);
    }

    // 1. Direct Search Bar Auto-Focus & Glide
    if (
      norm === 'cursor go to search' ||
      norm === 'go to search' ||
      norm === 'search bar' ||
      norm === 'focus search' ||
      norm === 'find search' ||
      norm === 'search input'
    ) {
      glideToSearchInput();
      return;
    }

    // 2. Query Done
    if (norm === 'done' || norm === 'finished' || norm === 'query done' || norm === 'done typing' || norm === 'search done') {
      finishQuery();
      return;
    }

    // 3. Execute Search
    if (norm === 'search' || norm === 'execute search' || norm === 'submit search' || norm === 'run search' || norm === 'google search') {
      executeSearchQuery();
      return;
    }

    // 4. Read Links / Results
    if (norm === 'read links' || norm === 'read results' || norm === 'read top links' || norm === 'read search results' || norm === 'read result links') {
      readSearchResults();
      return;
    }

    // 5. Click Link N / Result N
    const clickMatch = norm.match(/^(?:click|open)\s+(?:link\s+|result\s+)?(\d{1,2})$/) || norm.match(/^(?:link|result)\s+(\d{1,2})$/);
    if (clickMatch && clickMatch[1]) {
      const num = parseInt(clickMatch[1], 10);
      const res = clickSearchResult(num);
      if (!res.success) {
        clickNumberedLink(num);
      }
      return;
    }

    // 6. Scroll
    if (norm === 'scroll down' || norm === 'page down') {
      window.scrollBy({ top: window.innerHeight * 0.75, behavior: 'smooth' });
      playEarconClick();
      return;
    }
    if (norm === 'scroll up' || norm === 'page up') {
      window.scrollBy({ top: -window.innerHeight * 0.75, behavior: 'smooth' });
      playEarconClick();
      return;
    }

    // 7. Clear Text
    if (norm === 'clear' || norm === 'clear text' || norm === 'clear input' || norm === 'clear search') {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement)) {
        activeEl.value = '';
        activeEl.dispatchEvent(new Event('input', { bubbles: true }));
        activeEl.dispatchEvent(new Event('change', { bubbles: true }));
        playEarconClick();
        speakScreenText('Cleared text.');
      }
      return;
    }

    // 8. Stop / Cancel
    if (norm === 'stop' || norm === 'stop reading' || norm === 'cancel') {
      window.speechSynthesis.cancel();
      playEarconClick();
      return;
    }

    // 9. Dictate into Active Input
    const activeEl = document.activeElement;
    if (activeEl && (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement)) {
      let payload = transcript;
      let trailing = null;

      if (/\b(?:done|finished)$/i.test(payload)) {
        trailing = 'done';
        payload = payload.replace(/\b(?:done|finished)$/i, '').trim();
      } else if (/\b(?:search)$/i.test(payload)) {
        trailing = 'search';
        payload = payload.replace(/\b(?:search)$/i, '').trim();
      }

      if (payload) {
        insertDictatedText(payload);
        playEarconDictationStart();
      }

      if (trailing === 'done') {
        setTimeout(() => finishQuery(), 300);
      } else if (trailing === 'search') {
        setTimeout(() => executeSearchQuery(), 400);
      }
      return;
    }
  }

  // --- Eyes-Free Blind Mode Activation & Persistence ---

  function setBlindMode(enabled) {
    isBlindModeActive = !!enabled;
    chrome.storage.local.set({ blindModeEnabled: isBlindModeActive });

    if (isBlindModeActive) {
      playEarconActivate();
      speakScreenText('Eyes-Free Blind Navigation enabled.');
      startInTabVoiceListening();

      const isGoogle = /google\.[a-z.]+/i.test(window.location.hostname);
      const isSearch = window.location.pathname.includes('/search');

      if (isGoogle && !isSearch) {
        setTimeout(() => glideToSearchInput(), 800);
      } else if (isGoogle && isSearch) {
        setTimeout(() => {
          speakScreenText('Google results loaded. Say Read results to listen to headlines, or Go to search to search again.');
        }, 800);
      }
    } else {
      stopInTabVoiceListening();
      speakScreenText('Eyes-Free Blind Navigation disabled.');
    }
    return { success: true, isBlindMode: isBlindModeActive };
  }

  // Auto-Activation Check on Page Load
  chrome.storage.local.get(['blindModeEnabled'], (result) => {
    if (result && result.blindModeEnabled) {
      isBlindModeActive = true;
      const host = window.location.hostname.toLowerCase();
      const isGoogle = host.includes('google.');
      const isSearch = window.location.pathname.includes('/search');

      setTimeout(() => {
        playEarconActivate();
        startInTabVoiceListening();
        if (isGoogle && !isSearch) {
          glideToSearchInput();
        } else if (isGoogle && isSearch) {
          speakScreenText('Google results loaded. Say Read results to listen to headlines, or Go to search to search again.');
        } else {
          speakScreenText('Eyes-Free navigation active on page. Speak your commands.');
        }
      }, 700);
    }
  });

  // Eyes-Free Global Focus Dictator
  document.addEventListener('focusin', (e) => {
    if (isBlindModeActive && e.target && e.target instanceof HTMLElement) {
      dictateElement(e.target);
    }
  }, true);

  // Eyes-Free Keyboard Shortcut: Alt+B
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.code === 'KeyB' || e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      setBlindMode(!isBlindModeActive);
    }
  });

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

      case 'SET_BLIND_MODE':
        sendResponse(setBlindMode(request.enabled));
        break;

      case 'GET_BLIND_MODE_STATUS':
        sendResponse({ success: true, isBlindMode: isBlindModeActive });
        break;

      case 'GO_TO_SEARCH':
        sendResponse(glideToSearchInput());
        break;

      case 'FINISH_QUERY':
        sendResponse(finishQuery(request.query));
        break;

      case 'EXECUTE_SEARCH':
        sendResponse(executeSearchQuery(request.query));
        break;

      case 'READ_SEARCH_RESULTS':
        sendResponse(readSearchResults());
        break;

      case 'CLICK_SEARCH_RESULT':
        sendResponse(clickSearchResult(request.number));
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
    return true;
  });

  console.log('[Handsfree] Content script active on:', window.location.href);
})();
