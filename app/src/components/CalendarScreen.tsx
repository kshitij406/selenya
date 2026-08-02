import { useLiveQuery } from 'dexie-react-hooks'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  clearHealthImportProvenance,
  db,
  getOvulations,
  getPeriodStarts,
  getSetting,
  SK,
} from '../db/schema'
import { addDays, predict, toEpochDay, type Prediction } from '../engine/cycle'
import { localToday, monthLabel } from '../lib/dates'
import { useApp } from '../state/appStore'

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const STICKY_DOW_HEIGHT = 40

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function dayClass(
  date: string,
  today: string,
  logged: Set<string>,
  prediction: Prediction | null,
  avgPeriodDays: number,
): string {
  const cls: string[] = ['cal-day']
  if (logged.has(date)) cls.push('period')
  else if (prediction?.nextPeriodStart) {
    const e = toEpochDay(date)
    const start = toEpochDay(prediction.nextPeriodStart)
    if (e >= start && e < start + avgPeriodDays) cls.push('predicted')
  }
  if (!cls.includes('period') && !cls.includes('predicted') && prediction?.fertileWindow) {
    const e = toEpochDay(date)
    if (prediction.ovulationDate === date) cls.push('ovulation')
    else if (
      e >= toEpochDay(prediction.fertileWindow.start) &&
      e <= toEpochDay(prediction.fertileWindow.end)
    )
      cls.push('fertile')
  }
  if (date === today) cls.push('today-mark')
  return cls.join(' ')
}

function monthIndex(year: number, month: number): number {
  return year * 12 + month
}

function fromMonthIndex(index: number): { year: number; month: number } {
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 }
}

export function CalendarScreen() {
  const { setCalendarOpen, openSheet } = useApp()
  const today = localToday()
  const [y0, m0] = today.split('-').map(Number)
  const todayIndex = monthIndex(y0, m0 - 1)

  const [range, setRange] = useState({ back: 12, forward: 2 })
  const [labelIndex, setLabelIndex] = useState(todayIndex)
  const [picking, setPicking] = useState(false)
  const [pickerYear, setPickerYear] = useState(y0)
  const [editingPeriods, setEditingPeriods] = useState(false)
  const [pendingJump, setPendingJump] = useState<number | null>(null)

  const scroller = useRef<HTMLDivElement>(null)
  const monthRefs = useRef(new Map<number, HTMLElement>())
  const topSentinel = useRef<HTMLDivElement>(null)
  const bottomSentinel = useRef<HTMLDivElement>(null)
  const prepend = useRef<{ height: number; top: number } | null>(null)

  const indices = useMemo(() => {
    const list: number[] = []
    for (let i = todayIndex - range.back; i <= todayIndex + range.forward; i++) list.push(i)
    return list
  }, [range.back, range.forward, todayIndex])

  const data = useLiveQuery(async () => {
    const [periodStarts, ovulations, flowLogs, cycleLength] = await Promise.all([
      getPeriodStarts(),
      getOvulations(),
      // Plain toArray() + in-memory filter/map: encrypted tables don't
      // support Dexie's cursor-based .filter() (see db/encryption.ts).
      db.dailyLogs.toArray().then((logs) => logs.filter((l) => l.flow !== undefined).map((l) => l.date)),
      getSetting(SK.cycleLength),
    ])
    return {
      prediction: predict(
        { periodStarts, ovulations, today },
        { baselineCycleLength: Number(cycleLength) || undefined },
      ),
      logged: new Set(flowLogs),
    }
  }, [today])

  async function togglePeriodDate(date: string) {
    const existing = await db.dailyLogs.get(date)
    if (existing?.flow) {
      const next = clearHealthImportProvenance(existing, 'flow')
      delete next.flow
      if (Object.keys(next).length === 1) await db.dailyLogs.delete(date)
      else await db.dailyLogs.put(next)
    } else {
      await db.dailyLogs.put({
        ...clearHealthImportProvenance(existing ?? { date }, 'flow'),
        flow: 'medium',
      })
    }
  }

  const openDate = useCallback(
    (date: string) => {
      if (editingPeriods) {
        void togglePeriodDate(date)
        return
      }
      setCalendarOpen(false)
      openSheet(date)
    },
    [editingPeriods, setCalendarOpen, openSheet],
  )

  function jumpTo(index: number) {
    setRange((r) => ({
      back: Math.max(r.back, todayIndex - index),
      forward: Math.max(r.forward, index - todayIndex),
    }))
    setPendingJump(index)
    setPicking(false)
  }

  function goToday() {
    if (picking) {
      setPicking(false)
      jumpTo(todayIndex)
    } else if (indices.includes(todayIndex)) {
      const el = monthRefs.current.get(todayIndex)
      const sc = scroller.current
      if (el && sc) {
        sc.scrollTo({
          top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - STICKY_DOW_HEIGHT,
          behavior: 'smooth',
        })
      }
    } else {
      jumpTo(todayIndex)
    }
  }

  function chooseMonth(month: number) {
    jumpTo(monthIndex(pickerYear, month))
  }

  // Initial scroll position: today's month at the top of the scrollport.
  useLayoutEffect(() => {
    const el = monthRefs.current.get(todayIndex)
    const sc = scroller.current
    if (!el || !sc) return
    sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - STICKY_DOW_HEIGHT
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Header label sync while scrolling.
  useEffect(() => {
    const sc = scroller.current
    if (!sc) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const index = Number((entry.target as HTMLElement).dataset.monthIndex)
          if (!Number.isNaN(index)) {
            setLabelIndex((current) => (current === index ? current : index))
          }
        }
      },
      { root: sc, rootMargin: '-44% 0px -52% 0px', threshold: 0 },
    )
    for (const i of indices) {
      const el = monthRefs.current.get(i)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [indices, picking])

  // Window growth via top/bottom sentinels.
  useEffect(() => {
    const sc = scroller.current
    const top = topSentinel.current
    const bottom = bottomSentinel.current
    if (!sc || !top || !bottom) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          if (entry.target === top) {
            prepend.current = { height: sc.scrollHeight, top: sc.scrollTop }
            setRange((r) => ({ ...r, back: Math.min(r.back + 12, 60) }))
          } else if (entry.target === bottom) {
            setRange((r) => ({ ...r, forward: Math.min(r.forward + 6, 24) }))
          }
        }
      },
      { root: sc, rootMargin: '600px 0px' },
    )
    observer.observe(top)
    observer.observe(bottom)
    return () => observer.disconnect()
  }, [picking])

  // Prepend scroll-position compensation.
  useLayoutEffect(() => {
    const sc = scroller.current
    if (!sc || !prepend.current) return
    sc.scrollTop = prepend.current.top + (sc.scrollHeight - prepend.current.height)
    prepend.current = null
  }, [range.back])

  // Jump-to-month completion.
  useLayoutEffect(() => {
    if (pendingJump === null) return
    const el = monthRefs.current.get(pendingJump)
    const sc = scroller.current
    if (!el || !sc) return
    sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - STICKY_DOW_HEIGHT
    setPendingJump(null)
  }, [indices, pendingJump])

  return (
    <div className="overlay">
      <div className="overlay-head">
        <button className="back-btn" onClick={() => setCalendarOpen(false)} aria-label="Back">
          ‹
        </button>
        <button
          className="calendar-title-button"
          onClick={() => (picking ? jumpTo(labelIndex) : setPicking(true))}
          aria-label={picking ? 'Show calendar' : 'Show year overview'}
        >
          <h2>
            {picking
              ? pickerYear
              : monthLabel(fromMonthIndex(labelIndex).year, fromMonthIndex(labelIndex).month)}
          </h2>
          <span>{picking ? '⌃' : '⌄'}</span>
        </button>
        <span className="overlay-head-spacer" aria-hidden="true" />
      </div>

      <div className="calendar-static">
        <div className="calendar-toolbar">
          <button
            className={editingPeriods ? 'active' : ''}
            onClick={() => {
              setEditingPeriods((editing) => !editing)
              setPicking(false)
            }}
          >
            {editingPeriods ? 'Done editing' : 'Edit period dates'}
          </button>
          <button onClick={goToday}>Today</button>
        </div>

        {editingPeriods && (
          <div className="calendar-edit-note">
            Tap days to add or remove period flow. You can add intensity and details afterward.
          </div>
        )}

        <div className="card calendar-legend calendar-legend-compact">
          <div className="row">
            <span className="cal-day period" style={{ width: 16, maxHeight: 16, aspectRatio: '1' }} />
            <span className="muted">Logged period</span>
          </div>
          <div className="row">
            <span className="cal-day predicted" style={{ width: 16, maxHeight: 16, aspectRatio: '1' }} />
            <span className="muted">Predicted period</span>
          </div>
          <div className="row">
            <span className="cal-day fertile" style={{ width: 16, maxHeight: 16, aspectRatio: '1' }} />
            <span className="muted">Fertile window (estimate)</span>
          </div>
          <div className="row">
            <span className="cal-day ovulation" style={{ width: 16, maxHeight: 16, aspectRatio: '1' }} />
            <span className="muted">Predicted ovulation</span>
          </div>
        </div>
        <p className="muted cal-disclaimer">
          Tap any day to log or edit. Fertility estimates must not be used as contraception.
        </p>
      </div>

      <div className="overlay-body cal-scroll" ref={scroller}>
        {picking ? (
          <div className="cal-year-pick">
            <div className="row cal-year-nav">
              <button className="back-btn" onClick={() => setPickerYear((y) => y - 1)} aria-label="Previous year">
                ‹
              </button>
              <strong>{pickerYear}</strong>
              <button className="back-btn" onClick={() => setPickerYear((y) => y + 1)} aria-label="Next year">
                ›
              </button>
            </div>
            <div className="year-grid">
              {Array.from({ length: 12 }).map((_, month) => {
                const miniFirst = new Date(pickerYear, month, 1)
                const miniDays = new Date(pickerYear, month + 1, 0).getDate()
                const miniLead = (miniFirst.getDay() + 6) % 7
                return (
                  <button key={month} className="mini-month" onClick={() => chooseMonth(month)}>
                    <strong>{monthLabel(pickerYear, month).split(' ')[0]}</strong>
                    <span className="mini-days" aria-hidden="true">
                      {Array.from({ length: miniLead }).map((_, index) => <i key={`b-${index}`} />)}
                      {Array.from({ length: miniDays }).map((_, index) => {
                        const date = iso(pickerYear, month, index + 1)
                        const logged = data?.logged.has(date)
                        return <i key={date} className={logged ? 'logged' : ''}>{index + 1}</i>
                      })}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            <div className="cal-grid cal-dow-row">
              {DOW.map((d, i) => (
                <div key={i} className="cal-dow">{d}</div>
              ))}
            </div>
            <div ref={topSentinel} className="cal-sentinel" />
            {indices.map((i) => (
              <div
                key={i}
                ref={(el) => {
                  if (el) monthRefs.current.set(i, el)
                  else monthRefs.current.delete(i)
                }}
                data-month-index={i}
              >
                <MonthBlock
                  index={i}
                  today={today}
                  logged={data?.logged ?? new Set()}
                  prediction={data?.prediction ?? null}
                  onPick={openDate}
                />
              </div>
            ))}
            <div ref={bottomSentinel} className="cal-sentinel" />
          </>
        )}
      </div>
    </div>
  )
}

const MonthBlock = memo(function MonthBlock({
  index,
  today,
  logged,
  prediction,
  onPick,
}: {
  index: number
  today: string
  logged: Set<string>
  prediction: Prediction | null
  onPick: (date: string) => void
}) {
  const { year, month } = fromMonthIndex(index)
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadBlanks = (first.getDay() + 6) % 7
  return (
    <section className="cal-month">
      <h3 className="cal-month-name">{monthLabel(year, month).split(' ')[0]}</h3>
      <div className="cal-grid">
        {Array.from({ length: leadBlanks }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const date = iso(year, month, i + 1)
          return (
            <button
              key={date}
              className={dayClass(date, today, logged, prediction, 5)}
              onClick={() => onPick(date)}
            >
              {i + 1}
            </button>
          )
        })}
      </div>
    </section>
  )
})

export { addDays }
