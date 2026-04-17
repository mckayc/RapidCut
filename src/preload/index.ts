import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  /** Get the real filesystem path for a dragged File object */
  getFilePath: (file: File): string => webUtils.getPathForFile(file),

  /** Open a save dialog; returns the chosen path or null if cancelled */
  showSaveDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('show-save-dialog', defaultName),

  /** Write content to an absolute file path */
  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('write-file', filePath, content),

  /** Read a file; returns null if it does not exist */
  readFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('read-file', filePath),

  /** Get the Electron userData directory for persisting app data */
  getUserDataPath: (): Promise<string> =>
    ipcRenderer.invoke('get-user-data-path'),
})
