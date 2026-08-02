import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Regression test for the "toolbar/legend unreachable via scroll" bug:
// the calendar toolbar, edit-note, legend, and disclaimer must live
// OUTSIDE the infinitely-growing `.overlay-body.cal-scroll` region, in a
// static wrapper rendered between `.overlay-head` and `.overlay-body`.
// If someone moves them back inside the scroller, the backward
// infinite-scroll growth (top sentinel) makes them unreachable again.
describe('CalendarScreen JSX structure', () => {
  const source = readFileSync(fileURLToPath(new URL('./CalendarScreen.tsx', import.meta.url)), 'utf8')

  it('keeps toolbar, edit-note, legend, and disclaimer outside the scrollable region', () => {
    const staticWrapperIndex = source.indexOf('className="calendar-static"')
    const scrollerIndex = source.indexOf('className="overlay-body cal-scroll"')
    const toolbarIndex = source.indexOf('className="calendar-toolbar"')
    const editNoteIndex = source.indexOf('className="calendar-edit-note"')
    const legendIndex = source.indexOf('className="card calendar-legend calendar-legend-compact"')
    const disclaimerIndex = source.indexOf('className="muted cal-disclaimer"')

    expect(staticWrapperIndex).toBeGreaterThan(-1)
    expect(scrollerIndex).toBeGreaterThan(-1)
    expect(toolbarIndex).toBeGreaterThan(-1)
    expect(editNoteIndex).toBeGreaterThan(-1)
    expect(legendIndex).toBeGreaterThan(-1)
    expect(disclaimerIndex).toBeGreaterThan(-1)

    // .calendar-static must come before .overlay-body.cal-scroll in DOM order.
    expect(staticWrapperIndex).toBeLessThan(scrollerIndex)

    // All four static elements must be inside .calendar-static, i.e. between
    // the static wrapper and the scroller, not after it.
    for (const index of [toolbarIndex, editNoteIndex, legendIndex, disclaimerIndex]) {
      expect(index).toBeGreaterThan(staticWrapperIndex)
      expect(index).toBeLessThan(scrollerIndex)
    }

    // The scroller must start with the `picking` conditional, not the toolbar.
    const afterScroller = source.slice(scrollerIndex, scrollerIndex + 400)
    expect(afterScroller).toContain('picking ?')
    expect(afterScroller).not.toContain('calendar-toolbar')

    // Each static element must appear exactly once in the source, so a
    // duplicate copy placed inside the scroller (while leaving the static
    // one in place) can't slip past the `indexOf`-based checks above.
    expect(source.split('calendar-toolbar').length - 1).toBe(1)
    expect(source.split('card calendar-legend calendar-legend-compact').length - 1).toBe(1)
    expect(source.split('cal-disclaimer').length - 1).toBe(1)
  })
})
