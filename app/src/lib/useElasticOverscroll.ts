import { useEffect } from 'react'

/**
 * Hand-built rubber-band/overshoot scroll effect.
 *
 * Capacitor's Android WebView has no iOS-style elastic bounce — it paints a
 * Material "glow" at scroll bounds instead — so a fast fling into the top or
 * bottom of a list stops dead. That reads as abrupt. Native `overscroll-behavior`
 * can't fix this (it only controls chaining/refresh, not the stretch itself),
 * so this hook fakes the iOS curve with touch tracking + CSS transforms.
 *
 * One delegated listener set on `document` covers every scroll container in
 * the app (current and future) instead of a hook call per container. Touch
 * listeners are passive and never call preventDefault: Chromium marks
 * touchmove non-cancelable once a scroll gesture has committed, so a
 * preventDefault-based drag is unreliable on Android, and passive listeners
 * are also required to avoid a scroll-perf regression app-wide. The visual
 * pull is done entirely with a transform on the scroller itself, which does
 * not fight the browser's own scroll position.
 *
 * A second phase compensates for the case where the finger has already
 * lifted before a fast fling reaches the end: the `scroll` handler measures
 * velocity and plays a brief momentum "overshoot and spring back" on its own.
 * That phase is guarded so it can only ever follow a real finger gesture
 * (see TOUCH_RECENCY_MS) — several screens do programmatic smooth-scrolling
 * (tab re-tap, onboarding step change, assistant auto-scroll-to-bottom) that
 * must never visibly bounce.
 */

const RESIST_C = 0.55 // Apple's rubber-band coefficient
const MAX_PULL_PX = 96
const ENGAGE_SLOP_PX = 3
const AXIS_RATIO = 1.2 // |dy| must exceed |dx| * 1.2 to engage (protects horizontal swipe gestures elsewhere)
const MIN_SCROLLABLE = 24
const MIN_HEIGHT = 120
const SPRING_MS = 420
const SPRING_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const FLING_MIN_V = 0.35 // px/ms at the bound to trigger a momentum bounce
const FLING_GAIN = 14
const FLING_MAX_PX = 56
const FLING_OUT_MS = 130
const FLING_OUT_EASE = 'cubic-bezier(0.33, 0, 0.67, 1)'
const TOUCH_RECENCY_MS = 1200 // momentum bounce only follows a real finger fling, not a programmatic scrollTo

/** Apple's rubber-band curve: asymptotic pull that never exceeds MAX_PULL_PX. */
export function rubberBand(distance: number, extent: number): number {
  const d = Math.max(extent, 1)
  const b = (1 - 1 / ((Math.abs(distance) * RESIST_C) / d + 1)) * d
  return Math.sign(distance) * Math.min(b, MAX_PULL_PX)
}

interface TouchState {
  el: HTMLElement
  x0: number
  y0: number
  engaged: boolean
  dir: 0 | 1 | -1
  height: number
}

interface ScrollSample {
  top: number
  t: number
}

// Module-level so the scroll-phase guard can see across the whole document
// without threading state through every listener.
let activeTouch = false
let lastTouchEndAt = 0
// The scroller element (if any) the most recent touch actually started on,
// tracked from touchstart rather than cleared at touchend: the momentum-fling
// phase this guards runs on `scroll` events that fire *after* the finger has
// already lifted (that's the whole point of that phase — the finger let go
// before the fling reached the boundary), so this has to survive past
// touchend for the recency window to mean anything. A tap that lands on a
// tab-bar icon or a footer button (not inside a real scroller) sets this to
// `null`, which is what actually blocks a subsequent programmatic scrollTo
// from qualifying — not the timestamp alone.
let lastEngagedEl: Element | null = null

/** Elements with a spring/fling animation in flight, so a second one doesn't stack. */
const animating = new WeakSet<HTMLElement>()
/** Last known scroll position/time per tracked element, for velocity. */
const lastSample = new WeakMap<HTMLElement, ScrollSample>()
/** Pending cleanup timers per element, so re-entry can cancel a stale one. */
const clearTimers = new WeakMap<HTMLElement, number>()

function isNoElastic(el: Element): boolean {
  return el.hasAttribute('data-no-elastic')
}

function isVerticallyScrollable(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') return false
  if (el.clientHeight < MIN_HEIGHT) return false
  if (el.scrollHeight - el.clientHeight < MIN_SCROLLABLE) return false
  return true
}

/** Walk up from the touch target to the nearest eligible vertical scroller. */
function findScroller(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof Element ? target.parentElement : null
  while (el && el !== document.body) {
    if (isNoElastic(el)) return null
    if (el instanceof HTMLElement && isVerticallyScrollable(el)) return el
    el = el.parentElement
  }
  return null
}

function clearInlineStyle(el: HTMLElement) {
  el.style.transition = ''
  el.style.transform = ''
  el.style.willChange = ''
}

function scheduleClear(el: HTMLElement, delayMs: number) {
  const pending = clearTimers.get(el)
  if (pending !== undefined) window.clearTimeout(pending)
  const id = window.setTimeout(() => {
    clearTimers.delete(el)
    animating.delete(el)
    clearInlineStyle(el)
  }, delayMs)
  clearTimers.set(el, id)
}

function cancelSpring(el: HTMLElement) {
  const pending = clearTimers.get(el)
  if (pending !== undefined) {
    window.clearTimeout(pending)
    clearTimers.delete(el)
  }
  animating.delete(el)
  clearInlineStyle(el)
}

export function useElasticOverscroll(): void {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {}

    let state: TouchState | null = null

    const release = () => {
      if (state?.engaged) {
        const el = state.el
        el.style.transition = `transform ${SPRING_MS}ms ${SPRING_EASE}`
        el.style.transform = 'translate3d(0,0,0)'
        scheduleClear(el, SPRING_MS)
      }
      lastTouchEndAt = performance.now()
      activeTouch = false
      state = null
    }

    const abort = () => {
      if (state?.engaged) {
        release()
        return
      }
      activeTouch = false
      state = null
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        abort()
        return
      }
      const el = findScroller(e.target)
      lastEngagedEl = el
      if (!el) return
      const touch = e.touches[0]
      cancelSpring(el) // kill any spring/fling mid-flight on this element
      activeTouch = true
      state = {
        el,
        x0: touch.clientX,
        y0: touch.clientY,
        engaged: false,
        dir: 0,
        height: el.clientHeight,
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!state) return
      const touch = e.touches[0]
      if (!touch) return
      let dy = touch.clientY - state.y0
      const dx = touch.clientX - state.x0
      const el = state.el
      const atTop = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1

      if (!state.engaged) {
        if (Math.abs(dy) < ENGAGE_SLOP_PX) return
        if (Math.abs(dy) <= Math.abs(dx) * AXIS_RATIO) {
          abort()
          return
        }
        if (dy > 0 && atTop) state.dir = 1
        else if (dy < 0 && atBottom) state.dir = -1
        else return
        state.engaged = true
        state.y0 = touch.clientY // re-zero so there's no jump on engage
        el.style.willChange = 'transform'
        el.style.transition = 'none'
        dy = 0
      }

      const offset = rubberBand(dy, state.height)
      if (state.dir === 1 && offset < 0) {
        release()
        return
      }
      if (state.dir === -1 && offset > 0) {
        release()
        return
      }
      el.style.transform = `translate3d(0, ${offset}px, 0)`
    }

    const onTouchEnd = () => release()
    const onTouchCancel = () => release()

    const onScroll = (e: Event) => {
      const el = e.target
      if (!(el instanceof HTMLElement)) return
      if (!isVerticallyScrollable(el)) return

      const now = performance.now()
      const prev = lastSample.get(el)
      // Only trust a sample taken within the last frame or two: native momentum
      // emits a scroll event roughly every 16ms, so a real fling always has a
      // fresh prior sample. A one-off programmatic jump (e.g. the calendar's
      // year-picker landing on a month whose scrollTop clamps at the bottom)
      // compares against a stale, seconds-old sample and would otherwise read
      // as an implausibly fast "fling".
      const v = prev && now - prev.t < 100 ? (el.scrollTop - prev.top) / Math.max(now - prev.t, 1) : 0
      lastSample.set(el, { top: el.scrollTop, t: now })

      // Critical guard: only a real finger fling may trigger the momentum
      // bounce. Programmatic smooth-scrolls (tab re-tap, onboarding step
      // change, assistant auto-scroll) emit real scroll events with real
      // velocity and must never visibly bounce. `lastEngagedEl` is the
      // primary check — it's the only thing that can tell "which element"
      // a touch actually started on; recency alone can't (any tap anywhere,
      // including the one that triggers a programmatic scrollTo, would
      // otherwise keep the window "recent"). A tap on UI chrome outside any
      // scroller (tab bar, onboarding footer buttons) sets this to `null`,
      // which is what actually invalidates a stale match from an earlier
      // gesture — not the timestamp alone.
      if (activeTouch || el !== lastEngagedEl || now - lastTouchEndAt > TOUCH_RECENCY_MS) return

      const atTop = el.scrollTop <= 0
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      if (!atTop && !atBottom) return
      if (Math.abs(v) < FLING_MIN_V) return
      if (animating.has(el)) return

      animating.add(el)
      const amount = Math.min(Math.max(Math.abs(v) * FLING_GAIN, 6), FLING_MAX_PX) * (atTop ? 1 : -1)
      el.style.transition = `transform ${FLING_OUT_MS}ms ${FLING_OUT_EASE}`
      el.style.transform = `translate3d(0, ${amount}px, 0)`
      const outTimer = window.setTimeout(() => {
        el.style.transition = `transform ${SPRING_MS}ms ${SPRING_EASE}`
        el.style.transform = 'translate3d(0,0,0)'
        scheduleClear(el, SPRING_MS)
      }, FLING_OUT_MS)
      clearTimers.set(el, outTimer)
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', onTouchCancel, { passive: true })
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })

    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchCancel)
      document.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [])
}
