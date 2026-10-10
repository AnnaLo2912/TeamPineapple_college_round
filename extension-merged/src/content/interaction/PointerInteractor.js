const POINTER_ID = 1

function eventInit(x, y, extra) {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    ...extra,
  }
}

function firePointer(type, x, y, buttons = 0) {
  const evt = new PointerEvent(type, {
    ...eventInit(x, y, {
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      isPrimary: true,
      buttons,
      button: buttons ? 0 : -1,
    }),
  })
  return evt
}

function fireMouse(type, x, y, buttons = 0) {
  const evt = new MouseEvent(type, {
    ...eventInit(x, y, {
      button: buttons ? 0 : -1,
      buttons,
    }),
  })
  return evt
}

const MOUSE_EVENTS = {
  pointerover: 'mouseover',
  pointerenter: 'mouseenter',
  pointerdown: 'mousedown',
  pointerup: 'mouseup',
  pointermove: 'mousemove',
}

function targetFor(x, y) {
  return document.elementFromPoint(x, y)
}

function isOverlay(el) {
  return Boolean(el.closest('[class*="handsfree-"]'))
}

let lastHovered = null

function dispatchLeave(el, x, y) {
  el.dispatchEvent(firePointer('pointerout', x, y))
  el.dispatchEvent(fireMouse('mouseout', x, y))
  el.dispatchEvent(firePointer('pointerleave', x, y))
  el.dispatchEvent(fireMouse('mouseleave', x, y))
}

export function resetHover() {
  if (lastHovered && lastHovered.isConnected) {
    dispatchLeave(lastHovered, 0, 0)
  }
  lastHovered = null
}

export function isSliderLike(el) {
  if (!el) return false
  const tag = el.tagName?.toLowerCase()
  if (!tag) return false
  if (tag === 'input' && el.type === 'range') return true
  if (el.getAttribute('role') === 'slider') return true
  const cls = typeof el.className === 'string' ? el.className.toLowerCase() : ''
  if (/(ytp-progress-bar|ytp-volume-slider|scrubber|slider|range)/.test(cls)) return true
  return false
}

export function dispatchHover(x, y, el = null) {
  const target = el || targetFor(x, y)

  if (!target || isOverlay(target)) {
    resetHover()
    return
  }

  if (target !== lastHovered) {
    if (lastHovered && lastHovered.isConnected) {
      dispatchLeave(lastHovered, x, y)
    }
    target.dispatchEvent(firePointer('pointerover', x, y))
    target.dispatchEvent(fireMouse('mouseover', x, y))
    lastHovered = target
  }

  target.dispatchEvent(firePointer('pointermove', x, y))
  target.dispatchEvent(fireMouse('mousemove', x, y))
}

export function dispatchDragStart(el, x, y) {
  for (const type of ['pointerover', 'pointerenter', 'pointerdown', 'mousemove', 'mousedown']) {
    const evt = MOUSE_EVENTS[type]
      ? [firePointer(type, x, y, 1), fireMouse(MOUSE_EVENTS[type], x, y, 1)]
      : [firePointer(type, x, y, 1)]
    for (const e of evt) el.dispatchEvent(e)
  }
}

export function dispatchDragMove(x, y, el = null) {
  const target = el || targetFor(x, y)
  if (!target) return
  target.dispatchEvent(firePointer('pointermove', x, y, 1))
  target.dispatchEvent(fireMouse('mousemove', x, y, 1))
}

export function dispatchDragEnd(el, x, y) {
  el.dispatchEvent(firePointer('pointerup', x, y, 0))
  el.dispatchEvent(fireMouse('mouseup', x, y, 0))
}

export function dispatchClickSequence(el, x, y) {
  const sequence = [
    'pointerover',
    'pointerenter',
    'pointermove',
    'mousedown',
    'pointerdown',
  ]
  for (const type of sequence) {
    const evt = MOUSE_EVENTS[type]
      ? [firePointer(type, x, y, 1), fireMouse(MOUSE_EVENTS[type], x, y, 1)]
      : [firePointer(type, x, y, 1)]
    for (const e of evt) el.dispatchEvent(e)
  }
  el.dispatchEvent(firePointer('pointerup', x, y, 0))
  el.dispatchEvent(fireMouse('mouseup', x, y, 0))
  el.dispatchEvent(
    new MouseEvent('click', {
      ...eventInit(x, y, { button: 0, buttons: 0, detail: 1 }),
    })
  )

  if (isOverlay(el)) {
    dispatchLeave(el, x, y)
  }
}
