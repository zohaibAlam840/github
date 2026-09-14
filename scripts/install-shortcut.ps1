<#
  Puts an "i2i Control System" icon on the Desktop and in the Start menu.

  Run once per PC, after the code is copied into place. It draws the app
  icon (the same valve mark the dashboard tab uses) into a real multi-size
  .ico and points a normal Windows shortcut at "Start i2i.cmd", so the
  operator never sees a folder, a terminal, or a command.
#>

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Root   = Split-Path $PSScriptRoot -Parent
$Target = Join-Path $Root "Start i2i.cmd"
# Beside the launcher, NOT inside .run\ — that folder is documented as
# disposable (logs, PID file), and deleting it must not strip the Desktop
# icon down to a blank page.
$IcoPath = Join-Path $Root "i2i.ico"

if (-not (Test-Path $Target)) { throw "Start i2i.cmd not found next to scripts\. Is the folder complete?" }

# --- Draw the mark ------------------------------------------------------
# Matches app/icon.svg: a rounded brand-blue tile with a white valve mark
# (stem, handle bar, body, outlet), on the SVG's 32-unit grid. Kept in code
# rather than shipped as a binary so it stays in step with the app and
# survives a fresh checkout.
function New-ValveBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  $s = $size / 32.0
  $r = 7 * $s

  $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tile.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
  $tile.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
  $tile.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
  $tile.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
  $tile.CloseFigure()
  $brand = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#3d5fe0"))
  $g.FillPath($brand, $tile)
  $brand.Dispose()
  $tile.Dispose()

  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), (2.1 * $s)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round

  $g.DrawLine($pen, 16 * $s, 11 * $s, 16 * $s, 6 * $s)      # stem
  $g.DrawLine($pen, 12.8 * $s, 6 * $s, 19.2 * $s, 6 * $s)   # handle bar
  $g.DrawEllipse($pen, (16 - 5.6) * $s, (18 - 5.6) * $s, 11.2 * $s, 11.2 * $s)  # body
  $g.DrawLine($pen, 16 * $s, 18 * $s, 21.6 * $s, 18 * $s)   # outlet

  $pen.Dispose()
  $g.Dispose()
  return $bmp
}

# --- Encode one classic (BMP/DIB) icon image ---------------------------
# Explorer handles PNG-payload icons, but plenty of other surfaces still go
# through the legacy GDI path - the taskbar, Alt-Tab, some remote-desktop
# clients, and .NET's own Icon class, which cannot read PNG entries at all.
# Emitting classic DIB entries costs a few KB and removes the question.
function ConvertTo-IconDib([System.Drawing.Bitmap]$bmp) {
  $w = $bmp.Width; $h = $bmp.Height
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)

  # BITMAPINFOHEADER. Height is doubled: an icon DIB stores the colour
  # image and the AND mask stacked in one bitmap.
  $bw.Write([UInt32]40)
  $bw.Write([Int32]$w); $bw.Write([Int32]($h * 2))
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]0)                       # BI_RGB
  $bw.Write([UInt32]($w * $h * 4))
  $bw.Write([Int32]0); $bw.Write([Int32]0)
  $bw.Write([UInt32]0); $bw.Write([UInt32]0)

  # Pixels, BGRA, bottom-up.
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $row = New-Object byte[] ($w * 4)
  for ($y = $h - 1; $y -ge 0; $y--) {
    [System.Runtime.InteropServices.Marshal]::Copy(
      [IntPtr]::Add($data.Scan0, $y * $data.Stride), $row, 0, $row.Length)
    $bw.Write($row)
  }
  $bmp.UnlockBits($data)

  # AND mask: zeroed, because the alpha channel already carries the shape.
  # Rows are padded to a 4-byte boundary.
  $maskRow = [math]::Floor((($w + 31) / 32)) * 4
  $bw.Write((New-Object byte[] ($maskRow * $h)))

  $bw.Flush()
  $bytes = $ms.ToArray()
  $bw.Dispose(); $ms.Dispose()
  # Comma-wrapped on purpose: PowerShell unrolls a returned array into the
  # pipeline, which turns byte[] into Object[]. BinaryWriter.Write then
  # binds to the wrong overload and writes a single byte, producing an
  # icon file with headers and no image.
  return ,$bytes
}

# --- Assemble the .ico -------------------------------------------------
$sizes  = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
  $bmp = New-ValveBitmap $size
  $images += ,@{ Size = $size; Bytes = (ConvertTo-IconDib $bmp) }
  $bmp.Dispose()
}

$ico = New-Object System.IO.MemoryStream
$w   = New-Object System.IO.BinaryWriter($ico)
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$images.Count)  # ICONDIR

$offset = 6 + (16 * $images.Count)
foreach ($img in $images) {
  # 0 in the width/height byte means 256; anything larger will not fit.
  $dim = if ($img.Size -ge 256) { 0 } else { $img.Size }
  $w.Write([Byte]$dim); $w.Write([Byte]$dim)
  $w.Write([Byte]0); $w.Write([Byte]0)            # palette count, reserved
  $w.Write([UInt16]1); $w.Write([UInt16]32)       # colour planes, bits per pixel
  $w.Write([UInt32]$img.Bytes.Length)
  $w.Write([UInt32]$offset)
  $offset += $img.Bytes.Length
}
foreach ($img in $images) { $w.Write([byte[]]$img.Bytes) }

$w.Flush()
[System.IO.File]::WriteAllBytes($IcoPath, $ico.ToArray())
$w.Dispose(); $ico.Dispose()

# Prove the file is a real icon before pointing a shortcut at it.
#
# An earlier version of this script wrote a malformed 159-byte .ico -
# headers with no image data - and cheerfully reported "Shortcut
# installed". The shortcut was then permanently blank, and because Explorer
# caches an icon per path, reinstalling did not fix it. Writing a file is
# not evidence that it is valid, so check.
$written = (Get-Item $IcoPath).Length
if ($written -lt 10KB) {
  throw "The generated icon is only $written bytes, which means it holds no image data. Not installing a shortcut that would show blank."
}
try {
  $probe = New-Object System.Drawing.Icon($IcoPath, 32, 32)
  $probeBmp = $probe.ToBitmap()
  if ($probeBmp.Width -ne 32) { throw "unexpected size $($probeBmp.Width)" }
  $probeBmp.Dispose(); $probe.Dispose()
} catch {
  throw "The generated icon could not be read back as an icon: $($_.Exception.Message)"
}

# --- Create the shortcuts ----------------------------------------------
$shell = New-Object -ComObject WScript.Shell
$made  = @()

foreach ($dir in @([Environment]::GetFolderPath("Desktop"),
                   (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"))) {
  if (-not (Test-Path $dir)) { continue }
  $lnkPath = Join-Path $dir "i2i Control System.lnk"
  # Remove first rather than overwrite. Explorer keys its icon cache on the
  # shortcut, and rewriting one in place is not always enough to make it
  # look again - a shortcut that ever rendered blank tends to stay blank.
  Remove-Item $lnkPath -Force -ErrorAction SilentlyContinue
  $lnk = $shell.CreateShortcut($lnkPath)
  $lnk.TargetPath       = $Target
  $lnk.WorkingDirectory = $Root
  $lnk.IconLocation     = $IcoPath
  $lnk.Description      = "Start the i2i Control Management System (dashboard and SMS worker)"
  $lnk.Save()
  $made += $lnkPath
}

# --- Make Explorer look again -------------------------------------------
# Windows caches shortcut icons per path and will happily keep showing a
# stale or blank one. ie4uinit rebuilds that cache; SHChangeNotify tells the
# shell the Desktop changed so the new icon appears without a sign-out.
try { & "$env:SystemRoot\System32\ie4uinit.exe" -show 2>$null } catch { }
try {
  Add-Type -Namespace Shell32 -Name Notify -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("shell32.dll")]
public static extern void SHChangeNotify(int eventId, uint flags, System.IntPtr item1, System.IntPtr item2);
"@ -ErrorAction Stop
  # SHCNE_ASSOCCHANGED, SHCNF_IDLIST
  [Shell32.Notify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
} catch { }

Write-Host ""
Write-Host "  Shortcut installed:" -ForegroundColor Green
foreach ($m in $made) { Write-Host "    $m" -ForegroundColor Gray }
Write-Host ""
Write-Host "  Double-click it to start the system." -ForegroundColor White
Write-Host ""
