export const CLICKABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[role="button"]:not([disabled])',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[onclick]',
  '[data-clickable]',
  'summary',
]

export const EXCLUDED_TAGS = ['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT']

export const CALIBRATION_POINTS: { x: number; y: number }[] = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
  { x: 0.5, y: 0.5 },
]

export const CURSOR_SIZE = 24
export const DWELL_RING_SIZE = 40
export const TARGET_SIZE = 32
export const PULSE_DURATION = 1500
export const MAGNETIC_RADIUS = 64
export const SNAP_STRENGTH = 0.75
export const DWELL_TIME = 800
export const CLICK_COOLDOWN = 1200

export const DWELL_DETECT_RADIUS = 24
export const DWELL_EDGE_MARGIN = 24
export const DWELL_MIN_HITBOX = 32
export const EDGE_SCROLL_HOLD_MS = 700

export const NUDGE_ACCEL_MS = 180
export const NUDGE_MAX_SPEED = 22
export const DOCK_DWELL_MS = 600

export const SCROLL_ACCEL_MS = 250
export const SCROLL_MIN_SPEED = 1.2
export const SCROLL_MAX_SPEED = 4.5

export const STORAGE_KEYS = {
  CONFIG: 'handsfree_config',
  CALIBRATION_FACE: 'handsfree_calibration_face',
  CALIBRATION_HAND: 'handsfree_calibration_hand',
}