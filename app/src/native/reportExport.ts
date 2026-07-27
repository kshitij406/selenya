import { getLunaraNativeBridge } from './bridge'
import { isNative } from './runtime'

interface NativeReportBridge {
  printReport(options: { jobName: string }): Promise<void>
  shareReport(options: { jobName: string }): Promise<void>
}

export interface ReportExportDependencies {
  native?: boolean
  bridge?: Pick<NativeReportBridge, 'printReport'>
  browserPrint?: () => void
}

/**
 * Opens the platform print/export sheet for the currently rendered report.
 *
 * `window.print()` is intentionally limited to the browser path: WKWebView and
 * Android WebView do not reliably surface a print dialog for that call.
 */
export async function exportCurrentReport(
  jobName = 'Selenya cycle report',
  dependencies: ReportExportDependencies = {},
): Promise<void> {
  const native = dependencies.native ?? isNative

  if (native) {
    const bridge =
      dependencies.bridge ?? getLunaraNativeBridge<NativeReportBridge>()
    await bridge.printReport({ jobName })
    return
  }

  const browserPrint = dependencies.browserPrint ?? (() => window.print())
  browserPrint()
}

/**
 * Renders the currently displayed report to a real PDF file and opens the
 * platform document share sheet (Mail/Messages/AirDrop/Drive/etc.) — distinct
 * from `exportCurrentReport`, which opens the print dialog. Native-only: on
 * web there is no PDF-generation or share-sheet API to fall back to, so
 * callers should hide the share action outside a native build (`isNative`).
 */
export async function shareCurrentReport(
  jobName = 'Selenya cycle report',
  dependencies: { bridge?: Pick<NativeReportBridge, 'shareReport'> } = {},
): Promise<void> {
  const bridge = dependencies.bridge ?? getLunaraNativeBridge<NativeReportBridge>()
  await bridge.shareReport({ jobName })
}
