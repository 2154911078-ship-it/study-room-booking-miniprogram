# scripts/gen-brand-images.ps1
# ---------------------------------------------------------------------------
# Redraw the three brand images in the same cute cartoon style as the new icons:
#   logo.png    300x300  app badge: blue rounded tile + white arch + open book + sparkles
#   avatar.png  240x240  default avatar: blue circle + white person + blush + smile
#   empty.png   240x240  empty-state art: dashed ring + blank card with a tiny face
# (sizes are 1.5-2x the on-screen rpx so they stay crisp on 3x phones)
#
# Usage (from the project root):
#   pwsh -File scripts/gen-brand-images.ps1
#   pwsh -File scripts/gen-brand-images.ps1 -Scale 2      # export 2x for inspection
#
# Everything is drawn on a 120x120 logical grid. KEEP THIS FILE ASCII-ONLY.
# ---------------------------------------------------------------------------
param(
  [double]$Scale = 1,
  [string]$OutDir = "",
  # badge = blue rounded tile (best on the light login page)
  # bare  = no tile, white mark only (best on the blue hero header of the home page)
  [ValidateSet("badge", "bare", "both")]
  [string]$Variant = "both"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $OutDir = [System.IO.Path]::GetFullPath((Join-Path $here "..\images"))
}
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

function C([string]$hex) { return [System.Drawing.ColorTranslator]::FromHtml($hex) }
function B([string]$hex) { return New-Object System.Drawing.SolidBrush((C $hex)) }
function BA([string]$hex, [int]$alpha) {
  $c = C $hex
  return New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B))
}
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
function Star($g, $brush, $cx, $cy, $r) {
  $k = $r * 0.30
  $pts = New-Object 'System.Drawing.PointF[]' 8
  $pts[0] = New-Object System.Drawing.PointF([single]$cx, [single]($cy - $r))
  $pts[1] = New-Object System.Drawing.PointF([single]($cx + $k), [single]($cy - $k))
  $pts[2] = New-Object System.Drawing.PointF([single]($cx + $r), [single]$cy)
  $pts[3] = New-Object System.Drawing.PointF([single]($cx + $k), [single]($cy + $k))
  $pts[4] = New-Object System.Drawing.PointF([single]$cx, [single]($cy + $r))
  $pts[5] = New-Object System.Drawing.PointF([single]($cx - $k), [single]($cy + $k))
  $pts[6] = New-Object System.Drawing.PointF([single]($cx - $r), [single]$cy)
  $pts[7] = New-Object System.Drawing.PointF([single]($cx - $k), [single]($cy - $k))
  $g.FillPolygon($brush, $pts)
}
function New-Icon([int]$px) {
  $bmp = New-Object System.Drawing.Bitmap($px, $px, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.ScaleTransform([single]($px / 120.0), [single]($px / 120.0))
  return @{ bmp = $bmp; g = $g }
}
function Save-Icon($ctx, [string]$name) {
  $ctx.g.Dispose()
  $path = Join-Path $OutDir $name
  $ctx.bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $ctx.bmp.Dispose()
  $len = (Get-Item -LiteralPath $path).Length
  Write-Host ("  OK  " + $name.PadRight(16) + ([math]::Round($len / 1024, 1)).ToString().PadLeft(6) + " KB")
  return $len
}

$total = 0

# white brand mark (arch + open book + bookmark + sparkles) drawn on the 120 grid
function Draw-Mark($g) {
  # white arch (library dome)
  $penArch = New-Object System.Drawing.Pen((C "#FFFFFF"), 9)
  $penArch.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $penArch.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawArc($penArch, (New-Object System.Drawing.Rectangle(26, 28, 68, 68)), 180, 180)
  # open book: two curved pages
  $bPage = B "#FFFFFF"
  $left = New-Object System.Drawing.Drawing2D.GraphicsPath
  $left.AddBezier(58, 72, 42, 78, 30, 82, 20, 88)
  $left.AddLine(20, 88, 20, 98)
  $left.AddBezier(20, 98, 30, 103, 42, 106, 58, 108)
  $left.CloseFigure()
  $right = New-Object System.Drawing.Drawing2D.GraphicsPath
  $right.AddBezier(62, 72, 78, 78, 90, 82, 100, 88)
  $right.AddLine(100, 88, 100, 98)
  $right.AddBezier(100, 98, 90, 103, 78, 106, 62, 108)
  $right.CloseFigure()
  $g.FillPath($bPage, $left)
  $g.FillPath($bPage, $right)
  # bookmark ribbon
  $bMark = B "#FFC94D"
  $rib = New-Object 'System.Drawing.PointF[]' 5
  $rib[0] = New-Object System.Drawing.PointF([single]67, [single]72)
  $rib[1] = New-Object System.Drawing.PointF([single]78, [single]72)
  $rib[2] = New-Object System.Drawing.PointF([single]78, [single]96)
  $rib[3] = New-Object System.Drawing.PointF([single]72.5, [single]87)
  $rib[4] = New-Object System.Drawing.PointF([single]67, [single]96)
  $g.FillPolygon($bMark, $rib)
  # sparkles
  $bSparkW = BA "#FFFFFF" 225
  $bSparkY = B "#FFD166"
  Star $g $bSparkW 25 30 7
  Star $g $bSparkY 96 33 6.5
  Star $g $bSparkW 100 73 4.5
  $bPage.Dispose(); $bMark.Dispose(); $bSparkW.Dispose(); $bSparkY.Dispose()
  $penArch.Dispose(); $left.Dispose(); $right.Dispose()
}

# ---------------- logo.png (badge) : blue tile + mark -> login page ----------------
if ($Variant -eq "badge" -or $Variant -eq "both") {
  $ctx = New-Icon ([int](300 * $Scale)); $g = $ctx.g
  $tile = RoundPath 4 4 112 112 30
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)), (New-Object System.Drawing.Point(120, 120)), (C "#5C86FF"), (C "#1E43D8"))
  $g.FillPath($grad, $tile)
  $ring = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 255, 255, 255), 2.5)
  $g.DrawPath($ring, $tile)
  Draw-Mark $g
  $grad.Dispose(); $ring.Dispose(); $tile.Dispose()
  $total += Save-Icon $ctx "logo.png"
}

# ---------------- logo-hero.png (bare) : mark only -> blue home header ----------------
if ($Variant -eq "bare" -or $Variant -eq "both") {
  $ctx = New-Icon ([int](300 * $Scale)); $g = $ctx.g
  Draw-Mark $g
  $total += Save-Icon $ctx "logo-hero.png"
}


# ---------------- avatar.png : blue circle + cute person ----------------
$ctx = New-Icon ([int](240 * $Scale)); $g = $ctx.g
$head = New-Object System.Drawing.Rectangle(6, 6, 108, 108)
$grad2 = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(0, 0)), (New-Object System.Drawing.Point(120, 120)), (C "#8FB0FF"), (C "#3D6BFF"))
$g.FillEllipse($grad2, $head)
$bWhite = B "#FFFFFF"
$g.FillEllipse($bWhite, 44, 30, 32, 32)
$pie = New-Object System.Drawing.Rectangle(27, 68, 66, 66)
$g.FillPie($bWhite, $pie, 180, 180)
# face details on the white head
$bBlush = BA "#FF8A9B" 210
$g.FillEllipse($bBlush, 45, 48, 8, 5.5)
$g.FillEllipse($bBlush, 67, 48, 8, 5.5)
$penSmile = P "#3D6BFF" 3
$g.DrawArc($penSmile, (New-Object System.Drawing.Rectangle(52, 51, 16, 12)), 20, 140)
$bWhite.Dispose(); $bBlush.Dispose(); $penSmile.Dispose(); $grad2.Dispose()
$total += Save-Icon $ctx "avatar.png"

# ---------------- empty.png : dashed ring + blank card with a tiny face ----------------
$ctx = New-Icon ([int](240 * $Scale)); $g = $ctx.g
$penRing = New-Object System.Drawing.Pen((C "#C8D6F5"), 4.5)
$penRing.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
$penRing.DashPattern = [single[]]@(3.2, 2.4)
$g.DrawEllipse($penRing, (New-Object System.Drawing.Rectangle(13, 13, 94, 94)))
$card = RoundPath 35 38 50 44 12
$bCard = B "#EEF3FF"
$g.FillPath($bCard, $card)
$penCard = P "#C8D6F5" 3
$g.DrawPath($penCard, $card)
$bEye = B "#9FB3D9"
$g.FillEllipse($bEye, 47, 53, 7, 8)
$g.FillEllipse($bEye, 66, 53, 7, 8)
$penMouth = P "#9FB3D9" 3.4
$g.DrawLine($penMouth, 54, 69, 66, 69)
$bCard.Dispose(); $bEye.Dispose(); $penCard.Dispose(); $penMouth.Dispose(); $penRing.Dispose(); $card.Dispose()
$total += Save-Icon $ctx "empty.png"

Write-Output ""
Write-Output ("total " + [math]::Round($total / 1024, 1) + " KB -> " + $OutDir)
Write-Output "NOTE: WeChat DevTools caches images by path; clear its file cache and recompile."
