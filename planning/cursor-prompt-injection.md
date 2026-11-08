# Recreating Cursor Prompt Injection

This document explains **only** how Cursor Remote injects prompts into the Cursor desktop app, and how to rebuild that piece in another project.

There is no Cursor CLI API involved. Injection is **desktop automation**:

1. Put the prompt on the system clipboard
2. Focus the correct Cursor window
3. Open the agent/chat input with a hotkey
4. Paste (`Ctrl+V`)
5. Press Enter

That is the entire injection path.

---

## Mental model

```
Your app / script
        │
        ▼
Build final prompt text
        │
        ▼
Copy to clipboard (Base64 → UTF-8 on Windows)
        │
        ▼
Find Cursor process whose window title matches your project
        │
        ▼
Bring that window to the foreground
        │
        ▼
SendKeys: Esc → open-chat hotkey → Ctrl+V → Enter
        │
        ▼
Clear clipboard (optional, avoids "Capture" reading your own prompt)
```

Cursor does not receive a network request. Your PC pretends a human typed into Cursor.

---

## What this project uses

| Piece | Default | Purpose |
|---|---|---|
| `CURSOR_WINDOW_TITLE` | folder name of `PROJECT_ROOT` | Match the right Cursor window when many are open |
| `CURSOR_PROMPT_HOTKEY` | `^i` | Open Cursor's chat/agent input (`^` = Ctrl, so Ctrl+I) |
| Clipboard | Windows `Set-Clipboard` | Carry the full prompt safely |
| `WScript.Shell.SendKeys` | COM object | Fake keyboard input |
| Win32 APIs | `ShowWindowAsync`, `SetForegroundWindow` | Force focus when `AppActivate` fails |

Relevant source in this repo:

- `bridge/src/index.ts` → `sendPromptToCursor(...)`
- Env vars near the top of that file: `CURSOR_PROMPT_HOTKEY`, `CURSOR_WINDOW_TITLE`

---

## Why clipboard + paste (not typing the prompt)

Typing every character with `SendKeys` is fragile for:

- long prompts
- newlines
- quotes / braces / special keys
- Unicode

Clipboard paste is one keystroke and preserves the full text. On Windows, this project encodes the prompt as **Base64** before embedding it in PowerShell so quotes, newlines, and `$` signs cannot break the script.

---

## Windows injection (canonical)

### Step-by-step

1. **Encode prompt as Base64** in Node (or any host language).
2. **Spawn PowerShell** with `-NoProfile -ExecutionPolicy Bypass -Command ...`.
3. Inside PowerShell:
   - Decode Base64 → UTF-8 string
   - `Set-Clipboard -Value $prompt`
   - Find `Get-Process Cursor` with a non-zero main window handle and a title matching `*$targetTitle*`
   - If missing, optionally start `Cursor.exe` with the project path and wait
   - Restore / foreground the window
   - `SendKeys('{ESC}')` — leave menus / clear focus junk
   - `SendKeys('^i')` — open chat (change if your Cursor binding differs)
   - Wait ~500ms for the input box
   - `SendKeys('^v')` — paste
   - `SendKeys('{ENTER}')` — submit
   - `Set-Clipboard -Value ''` — clear clipboard

### Minimal PowerShell you can run by hand

Replace `YOUR_PROMPT_BASE64`, `CrafterDuckGame3.0.0`, and the hotkey if needed.

```powershell
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

$prompt = [System.Text.Encoding]::UTF8.GetString(
  [System.Convert]::FromBase64String('YOUR_PROMPT_BASE64')
)
Set-Clipboard -Value $prompt

$wshell = New-Object -ComObject wscript.shell
$targetTitle = 'CrafterDuckGame3.0.0'
$projectRoot = 'C:\Users\you\path\to\project'

$cursor = Get-Process Cursor -ErrorAction SilentlyContinue |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and
    $_.MainWindowTitle -and
    $_.MainWindowTitle -like "*$targetTitle*"
  } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1

if (-not $cursor) {
  $cursorExe = "$env:LOCALAPPDATA\Programs\cursor\Cursor.exe"
  if (Test-Path $cursorExe) {
    Start-Process -FilePath $cursorExe -ArgumentList @($projectRoot)
    Start-Sleep -Seconds 4
  }
  $cursor = Get-Process Cursor -ErrorAction SilentlyContinue |
    Where-Object {
      $_.MainWindowHandle -ne 0 -and
      $_.MainWindowTitle -and
      $_.MainWindowTitle -like "*$targetTitle*"
    } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
}

if (-not $cursor) {
  throw "No Cursor window matched title '*$targetTitle*'"
}

# 9 = SW_RESTORE
[void][Win32]::ShowWindowAsync($cursor.MainWindowHandle, 9)
Start-Sleep -Milliseconds 150

$activated = $wshell.AppActivate($cursor.Id)
if (-not $activated) {
  [void][Win32]::SetForegroundWindow($cursor.MainWindowHandle)
}

Start-Sleep -Milliseconds 350
$wshell.SendKeys('{ESC}')
Start-Sleep -Milliseconds 100
$wshell.SendKeys('^i')          # Ctrl+I — change to your Cursor chat hotkey
Start-Sleep -Milliseconds 550
$wshell.SendKeys('^v')          # Ctrl+V paste
Start-Sleep -Milliseconds 250
$wshell.SendKeys('{ENTER}')
Start-Sleep -Milliseconds 200
Set-Clipboard -Value ''

Write-Output "Injected into: $($cursor.Id) $($cursor.MainWindowTitle)"
```

### Minimal Node wrapper

```js
import { spawn } from "child_process";

const CURSOR_WINDOW_TITLE = process.env.CURSOR_WINDOW_TITLE || "MyProject";
const CURSOR_PROMPT_HOTKEY = process.env.CURSOR_PROMPT_HOTKEY || "^i";
const PROJECT_ROOT = process.env.PROJECT_ROOT || "C:\\path\\to\\project";

function injectPrompt(promptText) {
  const promptB64 = Buffer.from(promptText, "utf8").toString("base64");
  const targetTitle = CURSOR_WINDOW_TITLE.replace(/'/g, "''");
  const projectRoot = PROJECT_ROOT.replace(/\\/g, "\\\\").replace(/'/g, "''");
  const hotkey = CURSOR_PROMPT_HOTKEY.replace(/'/g, "''");

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
$prompt = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${promptB64}'))
Set-Clipboard -Value $prompt
$wshell = New-Object -ComObject wscript.shell
$targetTitle = '${targetTitle}'
$projectRoot = '${projectRoot}'
$cursor = Get-Process Cursor -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle -like "*$targetTitle*" } |
  Sort-Object StartTime -Descending |
  Select-Object -First 1
if (-not $cursor) {
  $cursorExe = "$env:LOCALAPPDATA\\Programs\\cursor\\Cursor.exe"
  if (Test-Path $cursorExe) {
    Start-Process -FilePath $cursorExe -ArgumentList @($projectRoot)
    Start-Sleep -Seconds 4
  }
  $cursor = Get-Process Cursor -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle -like "*$targetTitle*" } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
}
if (-not $cursor) { throw "No Cursor window for '$targetTitle'" }
[void][Win32]::ShowWindowAsync($cursor.MainWindowHandle, 9)
Start-Sleep -Milliseconds 150
if (-not $wshell.AppActivate($cursor.Id)) {
  [void][Win32]::SetForegroundWindow($cursor.MainWindowHandle)
}
Start-Sleep -Milliseconds 350
$wshell.SendKeys('{ESC}')
Start-Sleep -Milliseconds 100
$wshell.SendKeys('${hotkey}')
Start-Sleep -Milliseconds 550
$wshell.SendKeys('^v')
Start-Sleep -Milliseconds 250
$wshell.SendKeys('{ENTER}')
Start-Sleep -Milliseconds 200
Set-Clipboard -Value ''
Write-Output "Cursor target: $($cursor.Id) $($cursor.MainWindowTitle)"
`;

  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { shell: false },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || stdout || `powershell exited ${code}`));
    });
  });
}

// Example:
// await injectPrompt("[Agent Mode]\\nFix the login bug.\\n\\nOnce done, bump globalconfig version +1.");
```

---

## SendKeys cheat sheet

`WScript.Shell.SendKeys` uses its own syntax (not raw Win32 key codes):

| Meaning | SendKeys |
|---|---|
| Ctrl | `^` |
| Alt | `%` |
| Shift | `+` |
| Enter | `{ENTER}` |
| Escape | `{ESC}` |
| Ctrl+I | `^i` |
| Ctrl+V | `^v` |
| Ctrl+L | `^l` |
| Literal `+` `^` `%` `{` `}` | wrap in braces, e.g. `{+}` |

Set `CURSOR_PROMPT_HOTKEY` to whatever opens chat in **your** Cursor keybindings. Common defaults people try: `^i`, `^l`, `^k`.

---

## Finding the right Cursor window

Cursor can have many windows. Titles usually contain the project / folder name.

This project filters:

```powershell
Get-Process Cursor |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and
    $_.MainWindowTitle -and
    $_.MainWindowTitle -like "*$targetTitle*"
  }
```

Tips:

- Set `CURSOR_WINDOW_TITLE` to a unique substring from the title bar (e.g. `CrafterDuckGame3.0.0`).
- If injection hits the wrong workspace, your title filter is too broad or wrong.
- Inspect titles with:

```powershell
Get-Process Cursor |
  Where-Object { $_.MainWindowTitle } |
  Select-Object Id, MainWindowTitle
```

---

## macOS / Linux variants (also in this repo)

These are thinner fallbacks; Windows is the primary path.

### macOS (`osascript`)

```bash
osascript \
  -e 'set the clipboard to "YOUR PROMPT TEXT"' \
  -e 'tell application "Cursor" to activate' \
  -e 'tell application "System Events" to keystroke "v" using command down' \
  -e 'tell application "System Events" to key code 36'
```

Note: this sample pastes and presses Return, but does **not** open chat with a hotkey first. You may need an extra `keystroke "i" using control down` (or your binding) after activate.

### Linux (`xclip` + `xdotool`)

```bash
printf %s "YOUR PROMPT TEXT" | xclip -selection clipboard
xdotool search --name Cursor windowactivate --sync key ctrl+v Return
```

Same caveat: you may need an extra hotkey before paste.

---

## Timing that matters

These sleeps are empirical, not scientific. If paste fails, increase them.

| Delay | Why |
|---|---|
| 150ms after restore | window animation / focus settle |
| 350ms after activate | Cursor must actually be foreground |
| 100ms after Esc | leave previous UI |
| 550ms after open-chat hotkey | chat composer must mount |
| 250ms after paste | clipboard paste finish |
| 200ms after Enter | submit settle |

Too short → Esc/hotkey/paste lands in the wrong place. Too long → just slower.

---

## Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `No Cursor window was found` | Title filter wrong / Cursor not open | Open project; set `CURSOR_WINDOW_TITLE` from real title |
| Prompt goes into wrong project | Multiple Cursor windows | Tighten title match |
| Nothing pasted | Chat input never opened | Wrong hotkey; change `CURSOR_PROMPT_HOTKEY` |
| Partial / corrupted paste | Old here-string clipboard embedding | Use Base64 clipboard decode |
| Focus refused | Windows focus stealing protection | Use both `AppActivate` and `SetForegroundWindow`; click Cursor once manually then retry |
| Capture returns your own prompt | Clipboard not cleared | Clear clipboard after inject |
| PowerShell exits 1 | Script error / quoting break | Prefer Base64; check stderr |

---

## Security / safety notes

- This is **local UI automation**, not an official Cursor SDK.
- It can type into whatever window ends up focused if focus fails — keep the title filter strict.
- Clearing the clipboard after send is recommended.
- Do not expose a remote endpoint that accepts arbitrary prompts and injects them without auth; this project's bridge uses a token for that reason.
- Windows may require the injecting process to run in an interactive desktop session (not a headless service).

---

## Smallest “another project” checklist

1. Decide the prompt string.
2. Decide the Cursor window title substring.
3. Decide the open-chat hotkey (`^i` unless remapped).
4. Implement clipboard set (Base64 on Windows).
5. Implement focus + SendKeys sequence.
6. Test with a short prompt while watching the Cursor window.
7. Only then wire it to HTTP / WebSocket / phone / etc.

You do **not** need the Android app, file browser, preview, or notifications to recreate injection. Those are separate features around this core.

---

## Reference: SendKeys sequence used here

```
Esc
Ctrl+I   (or CURSOR_PROMPT_HOTKEY)
Ctrl+V
Enter
```

That is the injection. Everything else in Cursor Remote is transport, UI, and completion tracking around that sequence.
