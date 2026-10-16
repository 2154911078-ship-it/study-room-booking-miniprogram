# scripts/gen-tab-icons.ps1
# ---------------------------------------------------------------------------
# Draw the four tabBar icons (normal + active) in a chunky rounded cartoon style.
# Output is 81x81 transparent PNG, i.e. exactly what app.json expects:
#   images/tab-home.png / -active.png        house
#   images/tab-rooms.png / -active.png       list (study-room list)
#   images/tab-orders.png / -active.png      ticket (reservations)
#   images/tab-profile.png / -active.png     person
#
# Colours match app.json:  color #8A93A6 ,  selectedColor #2F5BFF
# No faces here on purpose: the tabBar renders icons at ~27px, so faces would turn to mush.
#
# Usage (from the project root):
#   pwsh -File scripts/gen-tab-icons.ps1
#   pwsh -File scripts/gen-tab-icons.ps1 -Size 162      # 2x preview
#
# Drawn on an 81x81 grid and scaled to -Size. KEEP THIS FILE ASCII-ONLY.
# ---------------------------------------------------------------------------
param(
  [int]$Size = 81,
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $OutDir = [System.IO.Path]::GetFullPath((Join-Path $here "..\images"))
}
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

$COLOR_NORMAL = "#8A93A6"
$COLOR_ACTIVE = "#2F5BFF"

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
function New-Icon {
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.ScaleTransform([single]($Size / 81.0), [single]($Size / 81.0))
  return @{ bmp = $bmp; g = $g }
}
# punch a real transparent hole (not a white patch) so it works on any background
function Cut-Round($g, $path) {
  $old = $g.CompositingMode
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $tb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Transparent)
  $g.FillPath($tb, $path)
  $tb.Dispose()
  $g.CompositingMode = $old
}
function Cut-Circle($g, $rect) {
  $old = $g.CompositingMode
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $tb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Transparent)
  $g.FillEllipse($tb, $rect)
  $tb.Dispose()
  $g.CompositingMode = $old
}

function Draw-Home($g, [string]$color) {
  $brush = B $color
  $pen = P $color 9
  # chunky rounded roof
  $roof = New-Object System.Drawing.Drawing2D.GraphicsPath
  $roof.AddLine(40.5, 15, 71, 40)
  $roof.AddLine(71, 40, 10, 40)
  $roof.CloseFigure()
  $g.FillPath($brush, $roof)
  $g.DrawPath($pen, $roof)
  # body
  $body = RoundPath 17 36 47 33 9
  $g.FillPath($brush, $body)
  # door punched out
  Cut-Round $g (RoundPath 33 49 15 20 6)
  $brush.Dispose(); $pen.Dispose(); $roof.Dispose(); $body.Dispose()
}

function Draw-Rooms($g, [string]$color) {
  $brush = B $color
  $b1 = RoundPath 15 20 51 12 6
  $b2 = RoundPath 15 35 51 12 6
  $b3 = RoundPath 15 50 30 12 6
  $g.FillPath($brush, $b1)
  $g.FillPath($brush, $b2)
  $g.FillPath($brush, $b3)
  $brush.Dispose(); $b1.Dispose(); $b2.Dispose(); $b3.Dispose()
}

function Draw-Orders($g, [string]$color) {
  $brush = B $color
  $body = RoundPath 15 17 51 47 12
  $g.FillPath($brush, $body)
  # notches on both sides + two slots, all punched through
  Cut-Circle $g (New-Object System.Drawing.Rectangle(7, 32, 16, 16))
  Cut-Circle $g (New-Object System.Drawing.Rectangle(58, 32, 16, 16))
  Cut-Round $g (RoundPath 25 28 31 8 4)
  Cut-Round $g (RoundPath 25 44 31 8 4)
  $brush.Dispose(); $body.Dispose()
}

function Draw-Profile($g, [string]$color) {
  $brush = B $color
  $g.FillEllipse($brush, 27, 15, 27, 27)
  $pieRect = New-Object System.Drawing.Rectangle(13, 42, 55, 55)
  $g.FillPie($brush, $pieRect, 180, 180)
  $brush.Dispose()
}

function Save-Icon($ctx, [string]$name) {
  $ctx.g.Dispose()
  $path = Join-Path $OutDir $name
  $ctx.bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $ctx.bmp.Dispose()
  $len = (Get-Item -LiteralPath $path).Length
  Write-Host ("  OK  " + $name.PadRight(26) + ([math]::Round($len / 1024, 1)).ToString().PadLeft(6) + " KB")
  return $len
}

$total = 0
foreach ($tab in @("home", "rooms", "orders", "profile")) {
  foreach ($state in @("", "-active")) {
    $ctx = New-Icon
    $color = $COLOR_NORMAL
    if ($state -eq "-active") { $color = $COLOR_ACTIVE }
    switch ($tab) {
      "home" { Draw-Home $ctx.g $color }
      "rooms" { Draw-Rooms $ctx.g $color }
      "orders" { Draw-Orders $ctx.g $color }
      "profile" { Draw-Profile $ctx.g $color }
    }
    $total += Save-Icon $ctx ("tab-" + $tab + $state + ".png")
  }
}
Write-Output ""
Write-Output ("total " + [math]::Round($total / 1024, 1) + " KB -> " + $OutDir)
Write-Output "NOTE: app.json already points at these file names; just clear the DevTools cache and recompile."
