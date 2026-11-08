import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { docPath, readDocMeta, readDocHtml } from './library.js';
import { expandPromptReferences } from './lineRefs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const PROMPT_FILE = path.join(ROOT, 'data', 'last-cursor-prompt.txt');

/** Substring matched against Cursor window titles (folder name by default). */
const CURSOR_WINDOW_TITLE =
  process.env.CURSOR_WINDOW_TITLE || path.basename(ROOT);

/** SendKeys hotkey that opens Cursor chat/agent input. Default Ctrl+I. */
const CURSOR_PROMPT_HOTKEY = process.env.CURSOR_PROMPT_HOTKEY || '^i';

export function buildCursorPrompt({ documentTitle, documentId, userPrompt, references = [] }) {
  const fileHint = docPath(documentId);
  const html = readDocHtml(documentId) || '';
  const { prompt: expandedPrompt, resolved } = expandPromptReferences(
    userPrompt.trim(),
    references,
    html
  );

  const refLines =
    resolved.length > 0
      ? [
          '',
          'Selection references (mapped to lines in the HTML file):',
          ...resolved.map(
            (r) =>
              `- ${r.label}: "${String(r.text || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120)}"`
          ),
        ]
      : [];

  return [
    `In the document [${documentTitle}] do the following:`,
    expandedPrompt,
    ...refLines,
    '',
    'Context for this edit:',
    `- Document title: ${documentTitle}`,
    `- Document ID: ${documentId}`,
    `- Primary HTML file path (edit this file): ${fileHint}`,
    `- Companion metadata file: ${fileHint.replace(/\.html$/, '.meta.json')}`,
    '',
    'Rules:',
    '- Edit the HTML content of the document file directly.',
    '- When a prompt mentions Line [n] or Line [n-m], those are 1-based line numbers in the HTML file above.',
    '- Preserve existing structure, comments markers, and TipTap-compatible HTML when possible.',
    '- Do not modify unrelated project source code unless required for the requested document change.',
  ].join('\n');
}

function savePromptFile(prompt) {
  fs.mkdirSync(path.dirname(PROMPT_FILE), { recursive: true });
  fs.writeFileSync(PROMPT_FILE, prompt, 'utf8');
  return PROMPT_FILE;
}

/**
 * Inject prompt into the Cursor desktop app via clipboard + SendKeys.
 * No Cursor CLI — same approach as the working Cursor Remote project.
 */
function injectPromptWindows(promptText, { onChunk } = {}) {
  const promptB64 = Buffer.from(promptText, 'utf8').toString('base64');
  const targetTitle = CURSOR_WINDOW_TITLE.replace(/'/g, "''");
  const projectRoot = ROOT.replace(/\\/g, '\\\\').replace(/'/g, "''");
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
# Clear clipboard without Set-Clipboard '' (throws ArgumentNullException on some PS versions)
try {
  [System.Windows.Forms.Clipboard]::Clear()
} catch {
  try { Set-Clipboard -Value ' ' } catch { }
}
Write-Output "Injected into: $($cursor.Id) $($cursor.MainWindowTitle)"
`;

  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { shell: false, windowsHide: true }
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      onChunk?.(text);
    });
    child.stderr?.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      onChunk?.(text);
    });
    child.on('error', (err) => {
      resolve({
        ok: false,
        method: 'desktop-inject',
        error: err.message,
        stdout,
        stderr,
        code: -1,
      });
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0,
        method: 'desktop-inject',
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
        error:
          code === 0
            ? undefined
            : stderr.trim() || stdout.trim() || `PowerShell exited ${code}`,
      });
    });
  });
}

function injectPromptMac(promptText, { onChunk } = {}) {
  const escaped = promptText
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  const script = `
set the clipboard to "${escaped}"
tell application "Cursor" to activate
delay 0.4
tell application "System Events"
  keystroke "i" using control down
  delay 0.55
  keystroke "v" using command down
  delay 0.25
  key code 36
end tell
`;
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-e', script], { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      const t = d.toString();
      stdout += t;
      onChunk?.(t);
    });
    child.stderr?.on('data', (d) => {
      const t = d.toString();
      stderr += t;
      onChunk?.(t);
    });
    child.on('error', (err) =>
      resolve({ ok: false, method: 'desktop-inject-mac', error: err.message, stdout, stderr, code: -1 })
    );
    child.on('close', (code) =>
      resolve({
        ok: code === 0,
        method: 'desktop-inject-mac',
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
        error: code === 0 ? undefined : stderr || `osascript exited ${code}`,
      })
    );
  });
}

export async function runCursorAgent({ prompt, onChunk }) {
  const promptFile = savePromptFile(prompt);

  let result;
  if (process.platform === 'win32') {
    onChunk?.('Injecting into Cursor desktop (clipboard + SendKeys)…\n');
    result = await injectPromptWindows(prompt, { onChunk });
  } else if (process.platform === 'darwin') {
    onChunk?.('Injecting into Cursor desktop (osascript)…\n');
    result = await injectPromptMac(prompt, { onChunk });
  } else {
    result = {
      ok: false,
      method: 'unsupported',
      error:
        'Desktop Cursor injection is implemented for Windows (and basic macOS). Prompt saved to data/last-cursor-prompt.txt — paste it into Cursor Chat manually.',
      stdout: '',
      stderr: '',
    };
  }

  return {
    ...result,
    promptFile,
    prompt,
    windowTitle: CURSOR_WINDOW_TITLE,
    hotkey: CURSOR_PROMPT_HOTKEY,
  };
}

export function validateDocument(documentId) {
  return readDocMeta(documentId);
}
