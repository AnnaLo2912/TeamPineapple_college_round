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

    if (!isEditableElement(target)) {
      const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
      target = inputs.find(el => isEditableElement(el) && el.offsetParent !== null) || null;
    }

    if (!target || !isEditableElement(target)) {
      return { success: false, error: 'No focused text field found on webpage. Click an input box first!' };
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

      // Match strategy: exact match > startsWith > includes
      let bestMatch = candidateOptions.find(o => o.text.toLowerCase() === termLower);
      if (!bestMatch) {
        bestMatch = candidateOptions.find(o => o.text.toLowerCase().startsWith(termLower));
      }
      if (!bestMatch) {
        bestMatch = candidateOptions.find(o => o.text.toLowerCase().includes(termLower));
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
   * Chrome Extension Message Listener
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case 'INSERT_DICTATION':
        sendResponse(insertDictatedText(request.text));
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

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
    return true;
  });

  console.log('[Handsfree] Content script active on:', window.location.href);
})();
