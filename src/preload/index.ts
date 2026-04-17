import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // ── File path from drag-drop ──────────────────────────────────────────
  getFilePath: (file: File): string => webUtils.getPathForFile(file),

  // ── Export / file I/O ─────────────────────────────────────────────────
  showSaveDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('show-save-dialog', defaultName),
  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('write-file', filePath, content),
  readFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('read-file', filePath),
  getUserDataPath: (): Promise<string> =>
    ipcRenderer.invoke('get-user-data-path'),

  // ── Dependency management ─────────────────────────────────────────────
  checkDeps: (): Promise<{
    python: { available: boolean; version?: string }
    ffmpeg: { available: boolean; version?: string }
  }> => ipcRenderer.invoke('check-deps'),

  installPipDeps: (): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke('install-pip-deps'),

  installFfmpeg: (): Promise<{ success: boolean; output: string; manual?: string }> =>
    ipcRenderer.invoke('install-ffmpeg'),

  startServer: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('start-server'),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),
})
