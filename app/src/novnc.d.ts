declare module '@novnc/novnc' {
  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: { credentials?: Record<string, string> })
    scaleViewport: boolean
    resizeSession: boolean
    showDotCursor: boolean
    viewOnly: boolean
    disconnect(): void
    sendCredentials(credentials: { password?: string }): void
    addEventListener(type: string, listener: (event: CustomEvent<{ clean: boolean }>) => void): void
  }
}
