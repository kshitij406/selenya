import { describe, expect, it, vi } from 'vitest'
import { exportCurrentReport, shareCurrentReport } from './reportExport'

describe('exportCurrentReport', () => {
  it('uses the native print bridge inside a native shell', async () => {
    const printReport = vi.fn().mockResolvedValue(undefined)
    const browserPrint = vi.fn()

    await exportCurrentReport('Private cycle report', {
      native: true,
      bridge: { printReport },
      browserPrint,
    })

    expect(printReport).toHaveBeenCalledWith({ jobName: 'Private cycle report' })
    expect(browserPrint).not.toHaveBeenCalled()
  })

  it('uses the browser print dialog on the web', async () => {
    const printReport = vi.fn().mockResolvedValue(undefined)
    const browserPrint = vi.fn()

    await exportCurrentReport('Private cycle report', {
      native: false,
      bridge: { printReport },
      browserPrint,
    })

    expect(browserPrint).toHaveBeenCalledOnce()
    expect(printReport).not.toHaveBeenCalled()
  })

  it('propagates native export failures so the screen can explain them', async () => {
    const failure = new Error('Print service unavailable')

    await expect(
      exportCurrentReport('Private cycle report', {
        native: true,
        bridge: { printReport: vi.fn().mockRejectedValue(failure) },
      }),
    ).rejects.toBe(failure)
  })
})

describe('shareCurrentReport', () => {
  it('calls the native share bridge with the given job name', async () => {
    const shareReport = vi.fn().mockResolvedValue(undefined)

    await shareCurrentReport('Private cycle report', { bridge: { shareReport } })

    expect(shareReport).toHaveBeenCalledWith({ jobName: 'Private cycle report' })
  })

  it('propagates native share failures so the screen can explain them', async () => {
    const failure = new Error('Share sheet unavailable')

    await expect(
      shareCurrentReport('Private cycle report', {
        bridge: { shareReport: vi.fn().mockRejectedValue(failure) },
      }),
    ).rejects.toBe(failure)
  })
})
