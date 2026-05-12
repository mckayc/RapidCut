# RapidCut

AI-powered silence remover for video and audio. Drop a file, get a Final Cut Pro XML timeline back — with every silence, dead air, and filler gap already cut out.

---

## What it does

RapidCut analyzes your video or audio file and produces a `.fcpxml` file that you import directly into Final Cut Pro (or any editor that accepts FCPXML). It does not re-encode your media — it only generates the edit decision list, so your original footage stays untouched and import is instant.

**Two detection modes, usable together:**

- **Speech Detection** — uses Silero VAD (a neural voice activity detector) to find non-speech gaps. Accurate even over background noise.
- **Audio Level Detection** — cuts regions below a dB threshold. Fast and works on any audio.

**Settings (saved per preset):**

| Setting | What it does |
|---|---|
| Minimum Gap Duration | Shortest silence that gets cut (ms) |
| Speech Threshold | VAD confidence cutoff — raise to cut breaths, lower if real speech is being cut |
| Silence Threshold | Audio level below which is considered silence (dB) |
| Clip Start / End Padding | Extra milliseconds kept at each clip edge so words don't feel clipped |

You can create multiple named presets (e.g. "Podcast", "B-roll", "Interview") and switch between them.

---

## First-time setup

On first launch RapidCut checks for its dependencies and walks you through installing anything missing:

1. **Python** — must be installed on your system. Download from [python.org](https://www.python.org/downloads/).
2. **FFmpeg** — RapidCut can install it automatically via winget, or you can point it to an existing installation.
3. **Silero VAD** — installed automatically into an isolated Python virtual environment inside `%APPDATA%\com.rapidcut.app`. Nothing is installed system-wide.

Setup only runs once. After that the app goes straight to the main screen.

---

## How to use

1. Open RapidCut.
2. Drop one or more video/audio files onto the drop zone, or click it to browse.
   - Supported formats: `.mp4` `.mov` `.mkv` `.avi` `.webm` `.m4v` `.mp3` `.wav` `.aac` `.m4a`
3. RapidCut analyzes the file and saves a `.fcpxml` file next to your original, named `yourfile_rapidcut.fcpxml`.
4. Import the `.fcpxml` into your editor.

If you drop multiple files they are processed one after another. A queue counter shows how many remain.

The gear icon in the top-right corner reopens the setup/dependency screen.

---

## Installing on Windows

The build output is a single `.exe` installer (NSIS) located in:

```
src-tauri\target\release\bundle\nsis\RapidCut_0.1.5_x64-setup.exe
```

Run the installer. It installs RapidCut to your user profile by default (no admin rights required).

### Make RapidCut appear in Windows Search

After installation, Windows Search indexes apps that live in the Start Menu. The installer creates a Start Menu shortcut automatically — just press the Windows key and type **RapidCut**.

If the shortcut is missing, or you want to pin it somewhere, do this manually:

1. Find the installed `RapidCut.exe`. It will be in one of these locations depending on how you installed it:
   - `C:\Users\<you>\AppData\Local\Programs\RapidCut\RapidCut.exe`
   - `C:\Program Files\RapidCut\RapidCut.exe`

2. Right-click `RapidCut.exe` → **Create shortcut**.

3. Move the shortcut to the Start Menu folder so Windows indexes it:
   ```
   C:\Users\<you>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\
   ```
   Paste the shortcut there. Windows Search will pick it up within a few seconds.

4. Press Win and type **RapidCut** to confirm it appears.

To also pin it to the taskbar: right-click the shortcut (or the running app in the taskbar) → **Pin to taskbar**.

---

## Building from source

**Requirements:** Node.js 18+, Rust (via [rustup.rs](https://rustup.rs)), Python 3.10+.

```bash
# Install Node dependencies
npm install

# Development (hot-reload)
npm run dev

# Production build (installer output in src-tauri/target/release/bundle/)
npm run build
```

The first `npm run build` compiles the Rust backend which takes a few minutes. Subsequent builds are faster.

---

## Tech stack

- **Frontend** — React, Zustand, Tailwind CSS
- **Desktop shell** — Tauri v2 (Rust)
- **Audio analysis** — Python (FastAPI server, Silero VAD, FFmpeg)
- **Output format** — Final Cut Pro XML (FCPXML)
