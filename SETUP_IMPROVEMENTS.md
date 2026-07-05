# RapidCut Setup Auto-Install Improvements

## Problem
When users first launch RapidCut after installing the MSI, only 1 of 4 dependencies auto-install successfully:
- ❌ Python - shows "Manual" button
- ❌ Python packages (pydub, fastapi, uvicorn, silero-vad) - shows "Install" button  
- ❌ Silero VAD - shows "Install" button
- ✅ ffmpeg - auto-installs successfully

## Root Cause
The initialization flow checks for dependencies but **never attempts to auto-install missing ones** (except for user-triggered installations via buttons).

### Current Flow (Broken)
```
1. Check dependencies
2. All available? → Start server
3. Missing? → Show UI with manual install buttons
4. User must manually click each "Install" button
```

### Required Flow (Fixed)
```
1. Check dependencies
2. All available? → Start server  
3. Python available + other deps missing? → Auto-install ffmpeg + pip packages
4. Re-check dependencies
5. All available? → Start server
6. Still missing? → Show UI with manual buttons for remaining deps
```

## Changes Made

### ✅ Change 1: SetupScreen.tsx - Add Auto-Install Logic
**File**: `src/renderer/src/components/SetupScreen.tsx`

Added a new `autoInstallDeps()` function that:
1. Automatically installs ffmpeg if missing
2. Automatically installs Python packages if Python is available but packages are missing
3. Re-checks dependencies after installations
4. Starts the server if all dependencies are now available

Modified `checkDeps()` to call `autoInstallDeps()` when:
- `autoLaunch=true` (initial setup)
- Python is available
- But ffmpeg or packages are still missing

**Result**: ffmpeg and pip packages now auto-install during initial setup

## Remaining Issues & Limitations

### 1. ⚠️ Python Auto-Installation (Not Implemented)
**Why**: Python cannot be easily auto-installed programmatically on Windows. Options include:
- Downloading and running the official installer (requires user interaction)
- Using Microsoft Store/winget to install Python
- Detecting Python from system PATH

**Current**: Python detection only checks if Python is available in PATH or registry.

**Recommendation**: 
- For better UX, consider adding the Python MSI to your app distribution
- Or add a fallback auto-install via winget on Windows 11+
- Or package Python with the Tauri app itself

### 2. 📝 Suggested Future Enhancement
Add a command to attempt Python installation via winget on Windows:

```rust
// In lib.rs
#[tauri::command]
async fn install_python(app: AppHandle) -> Result<InstallResult, String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("winget");
        cmd.args([
            "install", "--id", "Python.Python.3.11", "-e",
            "--silent", "--accept-package-agreements", "--accept-source-agreements",
        ]);
        let r = run_streaming(&app, cmd);
        if r.success {
            // Clear cache so check_deps re-checks
            *state.deps_cache.lock().unwrap() = None;
        }
        return Ok(r);
    }
}
```

Then call this auto-install function when Python is missing in the auto-install flow.

## Testing the Fix

1. **Clean Test**: Uninstall Python packages and ffmpeg from your system
2. **Run MSI**: Fresh install of RapidCut
3. **Verify**: 
   - ffmpeg should auto-install ✓
   - pip packages should auto-install ✓  
   - Silero VAD should be installed via pip ✓
   - Should proceed to launching without manual button clicks ✓

## Files Modified
- `src/renderer/src/components/SetupScreen.tsx` - Added auto-install logic during initial setup

## Files That Could Be Enhanced
- `src-tauri/src/lib.rs` - Add Python auto-install via winget (optional)
