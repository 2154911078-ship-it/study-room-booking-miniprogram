# scripts/compose-covers.ps1
# ---------------------------------------------------------------------------
# Turn square room pictures into the banner covers used by the project.
#
#   background : the picture shrunk to 64px wide and blown back up (heavy blur), darkened
#   foreground : the same picture drawn sharp, centred, filling the middle square
#   cropTop    : fraction cut off the top before composing (removes the "AI-generated" badge
#                that sits in the top-left corner of the source pictures)
#
# Two sizes are produced per room (both defined in scripts/covers-map.json):
#   out      -> canvas.width  x canvas.height   (room detail page, 750x340rpx  = 2.21:1)
#   outCard  -> canvas.cardWidth x cardHeight   (home "hot rooms" card, 460x240rpx = 1.92:1)
# Drop "outCard" from an item if you only want the big one.
#
# Per room the script uses:
#   srcCard   (1.92:1 crop)  -> card output, straight scale-to-fill
#   srcDetail (2.21:1 crop)  -> detail output, full-bleed; when this file is absent it
#                               falls back to composing the square 'src' with a blurred fill
#   src       (1:1 square)   -> fallback source for the detail output (and the plate)
#
# Home banners (wide posters) are handled by the "banners" block in the JSON.
#
# Usage (run from the project root):
#   pwsh -File scripts/compose-covers.ps1
#   pwsh -File scripts/compose-covers.ps1 -SrcDir "D:\some\other\folder" -CropTop 0
#
# The mapping table lives in scripts/covers-map.json (UTF-8).
# KEEP THIS FILE ASCII-ONLY: Windows PowerShell reads .ps1 as ANSI, so any
# non-ASCII text written here turns into mojibake. Chinese paths belong in the JSON.
# ---------------------------------------------------------------------------
param(
  [string]$Map = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "covers-map.json"),
  [string]$SrcDir = "",
  [double]$CropTop = -1,
  [double]$CropCardTop = -1,
  [int]$Quality = -1
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = [System.IO.Path]::GetFullPath((Join-Path $here ".."))
$outDir = Join-Path $root "images"

$cfg = Get-Content -Raw -Encoding UTF8 $Map | ConvertFrom-Json
$W = [int]$cfg.canvas.width
$H = [int]$cfg.canvas.height
$CW = [int]$cfg.canvas.cardWidth
$CH = [int]$cfg.canvas.cardHeight
if ($Quality -lt 0) { $Quality = [int]$cfg.canvas.quality }
if ($CropTop -lt 0) { $CropTop = [double]$cfg.canvas.cropTop }
if ($CropCardTop -lt 0) {
  if ($null -ne $cfg.canvas.cropCardTop) { $CropCardTop = [double]$cfg.canvas.cropCardTop } else { $CropCardTop = $CropTop }
}
if ([string]::IsNullOrWhiteSpace($SrcDir)) { $SrcDir = [string]$cfg.srcDir }

Write-Output ("source : " + $SrcDir)
Write-Output ("big    : " + $W + "x" + $H + "   card : " + $CW + "x" + $CH +
  "   quality " + $Quality + "   cropTop " + ([math]::Round($CropTop * 100)) + "%" +
  "   cropCardTop " + ([math]::Round($CropCardTop * 100)) + "%")
Write-Output ("output : " + $outDir)
Write-Output ""

$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

# Scale-to-fill + centre crop, then save as JPG. Used for pictures that are already
# cropped to the target ratio (no blur letterbox needed).
function AspectFill($img, $outW, $outH, $outPath) {
  $scale = [math]::Max($outW / $img.Width, $outH / $img.Height)
  $sw = $outW / $scale
  $sh = $outH / $scale
  $sx = ($img.Width - $sw) / 2
  $sy = ($img.Height - $sh) / 2
  $canvas = New-Object System.Drawing.Bitmap($outW, $outH)
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $srcRect = New-Object System.Drawing.RectangleF([single]$sx, [single]$sy, [single]$sw, [single]$sh)
  $dstRect = New-Object System.Drawing.RectangleF([single]0, [single]0, [single]$outW, [single]$outH)
  $g.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $canvas.Save($outPath, $jpeg, $encParams)
  $canvas.Dispose()
  return (Get-Item -LiteralPath $outPath).Length
}

# Compose one banner: blurred darkened plate + sharp centred square of full canvas height.
function Compose($work, $outW, $outH, $outPath) {  $bw = 64
  $bh = [int][math]::Round(64.0 * $outH / $outW)
  $plate = New-Object System.Drawing.Bitmap($bw, $bh)
  $gp = [System.Drawing.Graphics]::FromImage($plate)
  $gp.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
  $gp.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gp.DrawImage($work, (New-Object System.Drawing.Rectangle(0, 0, $bw, $bh)))
  $gp.Dispose()

  $canvas = New-Object System.Drawing.Bitmap($outW, $outH)
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($plate, (New-Object System.Drawing.Rectangle(0, 0, $outW, $outH)))
  $veil = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(72, 12, 18, 32))
  $g.FillRectangle($veil, 0, 0, $outW, $outH)
  $veil.Dispose()

  $side = $outH
  $x = [int](($outW - $side) / 2)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($work, (New-Object System.Drawing.Rectangle($x, 0, $side, $side)))
  $g.Dispose()
  $plate.Dispose()
  $canvas.Save($outPath, $jpeg, $encParams)
  $canvas.Dispose()
  return (Get-Item -LiteralPath $outPath).Length
}

$total = 0
$done = 0
foreach ($it in $cfg.items) {
  $srcPath = Join-Path $SrcDir $it.src
  if (-not (Test-Path -LiteralPath $srcPath)) { Write-Output ("  MISSING  " + $it.src); continue }

  $img = [System.Drawing.Image]::FromFile($srcPath)
  $cut = [int][math]::Round($img.Height * $CropTop)
  $workH = $img.Height - $cut
  $work = New-Object System.Drawing.Bitmap($img.Width, $workH)
  $gw = [System.Drawing.Graphics]::FromImage($work)
  $gw.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gw.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $img.Width, $workH)),
    (New-Object System.Drawing.Rectangle(0, $cut, $img.Width, $workH)), [System.Drawing.GraphicsUnit]::Pixel)
  $gw.Dispose()
  $img.Dispose()

  # 详情页大图：优先用专门准备的 2.21:1 源图（srcDetail，满幅不虚化）；
  # 还没准备时回退为方图（src）虚化补边合成，保证随时可跑不报错。
  $detailSrc = ""
  if ($it.srcDetail) {
    $dp = Join-Path $SrcDir $it.srcDetail
    if (Test-Path -LiteralPath $dp) { $detailSrc = $dp }
  }
  if ($detailSrc) {
    $dimg = [System.Drawing.Image]::FromFile($detailSrc)
    $len = AspectFill $dimg $W $H (Join-Path $outDir $it.out)
    $dimg.Dispose()
    $how = "full-bleed  <- " + $it.srcDetail
  } else {
    $len = Compose $work $W $H (Join-Path $outDir $it.out)
    $how = "blur-fill  <- " + $it.src
  }
  $total += $len
  $done++
  Write-Output ("  OK  " + $it.id.PadRight(4) + $it.out.PadRight(14) +
    ([math]::Round($len / 1024, 1)).ToString().PadLeft(6) + " KB   " + $how)

  if ($it.outCard -and $CW -gt 0 -and $CH -gt 0) {
    if ($it.srcCard) {
      # already cropped to the card ratio: scale to fill + centre crop, straight to JPG
      $cardSrc = Join-Path $SrcDir $it.srcCard
      if (Test-Path -LiteralPath $cardSrc) {
        $ci = [System.Drawing.Image]::FromFile($cardSrc)
        # cut the same watermark strip off the card source too, then fill the card box
        $cutC = [int][math]::Round($ci.Height * $CropCardTop)
        if ($cutC -gt 0 -and $cutC -lt $ci.Height) {
          # NOTE: PowerShell variable names are case-insensitive, so never use $cw/$ch here
          # (they would clobber $CW/$CH, the configured card size).
          $cropW = $ci.Width
          $cropH = $ci.Height - $cutC
          $tmp = New-Object System.Drawing.Bitmap($cropW, $cropH)
          $gt = [System.Drawing.Graphics]::FromImage($tmp)
          $gt.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $gt.DrawImage($ci, (New-Object System.Drawing.Rectangle(0, 0, $cropW, $cropH)),
            (New-Object System.Drawing.Rectangle(0, $cutC, $cropW, $cropH)), [System.Drawing.GraphicsUnit]::Pixel)
          $gt.Dispose()
          $ci.Dispose()
          $ci = $tmp
        }
        $len2 = AspectFill $ci $CW $CH (Join-Path $outDir $it.outCard)
        $ci.Dispose()
      } else {
        Write-Output ("  MISSING (card)  " + $it.srcCard + " -> fallback to composed card")
        $len2 = Compose $work $CW $CH (Join-Path $outDir $it.outCard)
      }
    } else {
      $len2 = Compose $work $CW $CH (Join-Path $outDir $it.outCard)
    }
    $total += $len2
    Write-Output ("      " + "     " + $it.outCard.PadRight(20) +
      ([math]::Round($len2 / 1024, 1)).ToString().PadLeft(6) + " KB   (card " + $CW + "x" + $CH + ")")
  }
  $work.Dispose()
}
Write-Output ""
Write-Output ("done: " + $done + "/" + $cfg.items.Count + " rooms, " + ($done + $(if ($CW -gt 0) { $done } else { 0 })) +
  " files, " + [math]::Round($total / 1024) + " KB (" + [math]::Round($total / 1048576, 2) + " MB)")

# ---------------- home banner posters ----------------
# Source files are already wide artwork/posters: scale to fill + centre crop, straight to JPG.
if ($cfg.banners -and $cfg.banners.items) {
  $bannerW = [int]$cfg.banners.width
  $bannerH = [int]$cfg.banners.height
  Write-Output ""
  Write-Output ("banners: " + $bannerW + "x" + $bannerH)
  foreach ($bn in $cfg.banners.items) {
    $bnPath = Join-Path $SrcDir $bn.src
    if (-not (Test-Path -LiteralPath $bnPath)) { Write-Output ("  MISSING  " + $bn.src); continue }
    $bimg = [System.Drawing.Image]::FromFile($bnPath)
    $blen = AspectFill $bimg $bannerW $bannerH (Join-Path $outDir $bn.out)
    $bimg.Dispose()
    $total += $blen
    Write-Output ("  OK  banner  " + $bn.out.PadRight(34) +
      ([math]::Round($blen / 1024, 1)).ToString().PadLeft(7) + " KB   <- " + $bn.src)
  }
}
Write-Output ""
Write-Output ("grand total " + [math]::Round($total / 1024) + " KB")
Write-Output "NOTE: WeChat DevTools caches images by path; clear its file cache and recompile to see new covers."
