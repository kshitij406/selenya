import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { addDays, type Prediction } from '../engine/cycle'
import { useHorizontalDrag } from '../lib/useHorizontalDrag'

interface DateStripProps {
  selectedDate: string
  prediction: Prediction
  onSelectDate: (date: string) => void
  /** Actual current date, marked with a TODAY caption and never dotted. */
  today: string
}

/** Monday of the week containing `date`. */
function weekStartFor(date: string): string {
  const weekday = new Date(date + 'T12:00:00').getDay()
  return addDays(date, -((weekday + 6) % 7))
}

/**
 * Monday–Sunday week containing the selected date, with logged and estimated
 * markers.
 *
 * The previous and next weeks are always rendered either side of the current
 * one, so a horizontal drag reveals real neighbouring dates as it moves rather
 * than sliding a blank panel in.
 */
export function DateStrip({ selectedDate, prediction, onSelectDate, today }: DateStripProps) {
  const currentWeekStart = weekStartFor(selectedDate)
  const weekStarts = [-7, 0, 7].map((offset) => addDays(currentWeekStart, offset))

  const drag = useHorizontalDrag({
    onCommit: (direction) => onSelectDate(addDays(selectedDate, direction * 7)),
  })

  // All three rendered weeks are queried together so a neighbour never appears
  // unmarked for a frame as it slides into view.
  const visibleDays = weekStarts.flatMap((start) =>
    Array.from({ length: 7 }, (_, index) => addDays(start, index)),
  )
  const loggedDates = useLiveQuery(async () => {
    // Plain toArray() + in-memory filter, not Dexie's .where()/.filter()
    // Collection API — doesn't support cursor-based queries (see db/encryption.ts).
    const visibleSet = new Set(visibleDays)
    const logs = await db.dailyLogs.toArray()
    return new Set(
      logs
        .filter((log) => visibleSet.has(log.date) && log.flow !== undefined)
        .map((log) => log.date),
    )
  }, [currentWeekStart])

  return (
    <div
      className={`date-strip-shell${drag.dragging ? ' is-dragging' : ''}`}
      role="group"
      aria-label="Days in selected week. Swipe sideways for another week."
      {...drag.handlers}
    >
      <div
        className="date-strip-track"
        style={{
          transform: `translate3d(calc(-33.3333% + ${drag.offset}px), 0, 0)`,
          transition: drag.dragging ? 'none' : undefined,
        }}
      >
        {weekStarts.map((weekStart) => (
          <div className="date-strip" key={weekStart} aria-hidden={weekStart !== currentWeekStart}>
            {Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).map((date) => {
              const [, , dayNum] = date.split('-')
              const dow = new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
                weekday: 'narrow',
              })
              const fullDate = new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })
              const isLogged = loggedDates?.has(date) ?? false
              const inFertileWindow = Boolean(
                prediction.fertileWindow &&
                  date >= prediction.fertileWindow.start &&
                  date <= prediction.fertileWindow.end,
              )
              const isToday = date === today
              // Days that have not happened yet cannot have been logged, so
              // they read as an outline the user can still fill in.
              const isFuture = date > today
              const cls = ['date-cell']
              if (date === selectedDate) cls.push('sel')
              if (isToday) cls.push('is-today')
              if (isFuture) cls.push('is-future')
              if (isLogged) cls.push('logged')
              if (inFertileWindow) cls.push('fertile')
              if (date === prediction.ovulationDate) cls.push('predicted-ovulation')
              const annotations = [
                isToday ? 'today' : '',
                isLogged ? 'period logged' : '',
                date === prediction.ovulationDate
                  ? 'estimated ovulation'
                  : inFertileWindow
                    ? 'estimated fertile window'
                    : '',
              ].filter(Boolean)
              return (
                <button
                  key={date}
                  type="button"
                  className={cls.join(' ')}
                  aria-label={`${fullDate}${annotations.length ? `, ${annotations.join(', ')}` : ''}`}
                  aria-current={date === selectedDate ? 'date' : undefined}
                  tabIndex={weekStart === currentWeekStart ? undefined : -1}
                  onClick={() => onSelectDate(date)}
                >
                  <span className="date-cell-caption">{isToday ? 'Today' : dow}</span>
                  <span className="num">{Number(dayNum)}</span>
                  <span className="date-cell-dot" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
