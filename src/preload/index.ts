import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getFilePath: (file: File): string => webUtils.getPathForFile(file),

  showSaveDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('show-save-dialog', defaultName),
  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('write-file', filePath, content),
  readFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('read-file', filePath),
  getUserDataPath: (): Promise<string> =>
    ipcRenderer.invoke('get-user-data-path'),

  checkDeps: (): Promise<{
    python: { available: boolean; version?: string }
    ffmpeg: { available: boolean; version?: string }
    silero_vad: { available: boolean }
  }> => ipcRenderer.invoke('check-deps'),

  installPipDeps: (): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke('install-pip-deps'),
  installFfmpeg: (): Promise<{ success: boolean; output: string; manual?: string }> =>
    ipcRenderer.invoke('install-ffmpeg'),
  startServer: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('start-server'),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  getDepsVerified: (): Promise<boolean> =>
    ipcRenderer.invoke('get-deps-verified'),
  setDepsVerified: (): Promise<void> =>
    ipcRenderer.invoke('set-deps-verified'),
  clearDepsVerified: (): Promise<void> =>
    ipcRenderer.invoke('clear-deps-verified'),

  on: (channel: string, callback: (...args: any[]) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
})
