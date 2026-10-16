# scripts/gen-quick-icons.ps1
# ---------------------------------------------------------------------------
# Draw the four home-page quick-entry icons in a cute cartoon style
# (thick rounded outlines + bright fills + tiny faces), transparent PNG:
#   quick-study.png     - notebook with bookmark  (blue)
#   quick-orders.png    - calendar with a check   (green)
#   quick-messages.png  - envelope                (orange)
#   quick-profile.png   - person                  (coral)
#
# Usage (from the project root):
#   pwsh -File scripts/gen-quick-icons.ps1
#   pwsh -File scripts/gen-quick-icons.ps1 -Size 240      # export bigger
#
# Everything is drawn on a 120x120 logical grid and scaled to -Size (default 120).
# KEEP THIS FILE ASCII-ONLY (Windows PowerShell reads .ps1 as ANSI -> mojibake).
# ---------------------------------------------------------------------------
param(
  [int]$Size = 120,
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $OutDir = [System.IO.Path]::GetFullPath((Join-Path $here "..\images"))
}
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

function New-Icon {
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.ScaleTransform([single]($Size / 120.0), [single]($Size / 120.0))
  return @{ bmp = $bmp; g = $g }
}

function C([string]$hex) { return [System.Drawing.ColorTranslator]::FromHtml($hex) }
function B([string]$hex) { return New-Object System.Drawing.SolidBrush((C $hex)) }
function P([string]$hex, [single]$w) {
  $pen = New-Object System.Drawing.Pen((C $hex), $w)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  return $pen
}
function RoundPath($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}
function Poly($g, $brush, $pairs) {
  $pts = New-Object 'System.Drawing.PointF[]' ($pairs.Count / 2)
  for ($i = 0; $i -lt $pairs.Count; $i += 2) {
    $pts[$i / 2] = New-Object System.Drawing.PointF([single]$pairs[$i], [single]$pairs[$i + 1])
  }
  $g.FillPolygon($brush, $pts)
  return $pts
}
# two eyes only (used where a mouth would fight with the shape's own detail)
function Eyes($g, [string]$ink, [double]$cx, [double]$cy, [double]$gap, [double]$eyeH) {
  $brush = B $ink
  $ew = $eyeH * 0.82
  $g.FillEllipse($brush, [single]($cx - $gap / 2 - $ew / 2), [single]($cy - $eyeH / 2), [single]$ew, [single]$eyeH)
  $g.FillEllipse($brush, [single]($cx + $gap / 2 - $ew / 2), [single]($cy - $eyeH / 2), [single]$ew, [single]$eyeH)
  $brush.Dispose()
}
# cute face: two eyes + a smile, on top of whatever was drawn before
function Face($g, [string]$ink, [double]$cx, [double]$cy, [double]$gap, [double]$eyeH) {
  Eyes $g $ink $cx $cy $gap $eyeH
  $pen = P $ink 4
  $r = New-Object System.Drawing.Rectangle([int]($cx - $gap * 0.75), [int]($cy + $eyeH), [int]($gap * 1.5), [int]($eyeH * 1.3))
  $g.DrawArc($pen, $r, 20, 140)
  $pen.Dispose()
}
function Save-Icon($ctx, [string]$name) {
  $ctx.g.Dispose()
  $path = Join-Path $OutDir $name
  $ctx.bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $ctx.bmp.Dispose()
  $len = (Get-Item -LiteralPath $path).Length
  # Write-Host (not Write-Output) so this line does not pollute the return value
  Write-Host ("  OK  " + $name.PadRight(22) + ([math]::Round($len / 1024, 1)).ToString().PadLeft(6) + " KB")
  return $len
}

$ink = 6.0      # outline width on the 120 grid
$total = 0

# ---------------- 1. notebook with bookmark (blue) ----------------
$ctx = New-Icon; $g = $ctx.g
$outline = P "#1B3AA6" $ink
$bBody = B "#4C7DFF"; $bBand = B "#A8C3FF"; $bRib = B "#FFD166"
$pBody = RoundPath 26 18 68 90 18
$g.FillPath($bBody, $pBody)
$bBand2 = B "#A8C3FF"
$g.FillPath($bBand2, (RoundPath 26 18 16 90 16))
$g.FillRectangle($bBand2, 34, 18, 8, 90)
$hl = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 255, 255, 255))
$g.FillEllipse($hl, 50, 26, 26, 14)
$g.DrawPath($outline, $pBody)
$penRib = P "#C98A00" 4
$ribPts = Poly $g $bRib @(72, 18, 86, 18, 86, 60, 79, 48, 72, 60)
$g.DrawPolygon($penRib, $ribPts)
Face $g "#1B3AA6" 60 62 16 9
$hl.Dispose(); $bBody.Dispose(); $bBand.Dispose(); $bBand2.Dispose(); $bRib.Dispose()
$outline.Dispose(); $penRib.Dispose()
$total += Save-Icon $ctx "quick-study.png"

# ---------------- 2. calendar with a check (green) ----------------
$ctx = New-Icon; $g = $ctx.g
$outline = P "#0B7A4B" $ink
$bBody = B "#F4FBF7"; $bHead = B "#22C55E"
$pBody = RoundPath 16 28 88 76 20
$g.FillPath($bBody, $pBody)
$g.SetClip($pBody)
$g.FillRectangle($bHead, 16, 28, 88, 26)
$hl = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(60, 255, 255, 255))
$g.FillEllipse($hl, 26, 32, 30, 10)
$g.ResetClip()
$pRing1 = RoundPath 34 12 11 24 5.5
$pRing2 = RoundPath 75 12 11 24 5.5
$g.FillPath($bHead, $pRing1); $g.FillPath($bHead, $pRing2)
$g.DrawPath($outline, $pRing1); $g.DrawPath($outline, $pRing2)
$g.DrawPath($outline, $pBody)
$penCheck = P "#16A34A" 9
$ck = New-Object 'System.Drawing.PointF[]' 3
$ck[0] = New-Object System.Drawing.PointF([single]44, [single]70)
$ck[1] = New-Object System.Drawing.PointF([single]57, [single]84)
$ck[2] = New-Object System.Drawing.PointF([single]80, [single]56)
$g.DrawLines($penCheck, $ck)
# eyes on the green header band
$bEye = B "#FFFFFF"
$g.FillEllipse($bEye, 42, 36, 8, 9)
$g.FillEllipse($bEye, 66, 36, 8, 9)
$bEye.Dispose()
$hl.Dispose(); $bBody.Dispose(); $bHead.Dispose(); $outline.Dispose(); $penCheck.Dispose()
$total += Save-Icon $ctx "quick-orders.png"

# ---------------- 3. envelope (orange) ----------------
$ctx = New-Icon; $g = $ctx.g
$outline = P "#B45309" $ink
$bBody = B "#FFD08A"; $bFlap = B "#F59E0B"
$pBody = RoundPath 14 26 92 70 14
$g.FillPath($bBody, $pBody)
$hl = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 255, 255, 255))
$g.FillEllipse($hl, 24, 32, 28, 12)
$g.DrawPath($outline, $pBody)
$penFlap = P "#F59E0B" 7
$flap = New-Object 'System.Drawing.PointF[]' 3
$flap[0] = New-Object System.Drawing.PointF([single]22, [single]33)
$flap[1] = New-Object System.Drawing.PointF([single]60, [single]58)
$flap[2] = New-Object System.Drawing.PointF([single]98, [single]33)
$g.DrawLines($penFlap, $flap)
Eyes $g "#B45309" 60 70 16 9
$hl.Dispose(); $bBody.Dispose(); $bFlap.Dispose(); $outline.Dispose(); $penFlap.Dispose()
$total += Save-Icon $ctx "quick-messages.png"

# ---------------- 4. person (coral) ----------------
$ctx = New-Icon; $g = $ctx.g
$outline = P "#C93A52" $ink
$bHead = B "#FF8A9B"; $bBody = B "#FFC2CC"
$pieRect = New-Object System.Drawing.Rectangle(18, 62, 84, 84)
$g.FillPie($bBody, $pieRect, 180, 180)
$g.DrawPie($outline, $pieRect, 180, 180)
$g.FillEllipse($bHead, 36, 14, 48, 48)
$hl = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(80, 255, 255, 255))
$g.FillEllipse($hl, 46, 22, 16, 10)
$g.DrawEllipse($outline, 36, 14, 48, 48)
Face $g "#C93A52" 60 34 18 10
$hl.Dispose(); $bHead.Dispose(); $bBody.Dispose(); $outline.Dispose()
$total += Save-Icon $ctx "quick-profile.png"

Write-Output ""
Write-Output ("total " + [math]::Round($total / 1024, 1) + " KB -> " + $OutDir)
Write-Output "NOTE: WeChat DevTools caches images by path; clear its file cache and recompile."
