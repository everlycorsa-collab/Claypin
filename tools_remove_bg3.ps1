param(
  [Parameter(Mandatory=$true)][string]$InPath,
  [Parameter(Mandatory=$true)][string]$OutPath,
  [double]$T1 = 22,
  [double]$T2 = 45,
  [double]$ProtectBelowFrac = 1.0,
  [int]$MaskScale = 2  # считаем маску в 1/MaskScale разрешении для скорости, потом апскейлим
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::new($InPath)
$w = $src.Width
$h = $src.Height

$full = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gFull = [System.Drawing.Graphics]::FromImage($full)
$gFull.DrawImage($src, 0, 0, $w, $h)
$gFull.Dispose()

# маленькая копия для быстрого расчёта маски
$sw = [int]([math]::Ceiling($w / $MaskScale))
$sh = [int]([math]::Ceiling($h / $MaskScale))
$small = New-Object System.Drawing.Bitmap $sw, $sh, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gSmall = [System.Drawing.Graphics]::FromImage($small)
$gSmall.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear
$gSmall.DrawImage($src, 0, 0, $sw, $sh)
$gSmall.Dispose()
$src.Dispose()

$rectS = New-Object System.Drawing.Rectangle 0, 0, $sw, $sh
$dataS = $small.LockBits($rectS, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$strideS = $dataS.Stride
$bytesS = New-Object byte[] ($strideS * $sh)
[System.Runtime.InteropServices.Marshal]::Copy($dataS.Scan0, $bytesS, 0, $bytesS.Length)
$bpp = 4

# Образцы фона: верхняя кромка + левая/правая полосы (без нижней — там пол, похож по цвету на ноги)
$refs = New-Object System.Collections.Generic.List[int[]]
$margin = [int](10 / $MaskScale) + 1
for ($px = 0; $px -lt $sw; $px += 2) {
  for ($py = 0; $py -lt $margin; $py += 2) {
    $idx = $py * $strideS + $px * $bpp
    $refs.Add(@([int]$bytesS[$idx+2], [int]$bytesS[$idx+1], [int]$bytesS[$idx]))
  }
}
$sideLimit = [int]($sh * 0.68)
for ($py = 0; $py -lt $sideLimit; $py += 2) {
  for ($px = 0; $px -lt $margin; $px += 2) {
    $idx = $py * $strideS + $px * $bpp
    $refs.Add(@([int]$bytesS[$idx+2], [int]$bytesS[$idx+1], [int]$bytesS[$idx]))
    $idx2 = $py * $strideS + ($sw - 1 - $px) * $bpp
    $refs.Add(@([int]$bytesS[$idx2+2], [int]$bytesS[$idx2+1], [int]$bytesS[$idx2]))
  }
}

$refR = $refs | ForEach-Object { $_[0] }
$refG = $refs | ForEach-Object { $_[1] }
$refB = $refs | ForEach-Object { $_[2] }
$refCount = $refs.Count

$protectYS = [int]($sh * $ProtectBelowFrac)
$featherPxS = [math]::Max(2, [int](22 / $MaskScale))
$t1sq = $T1 * $T1
$t2sq = $T2 * $T2

# альфа-маска в маленьком разрешении
$alphaSmall = New-Object byte[] ($sw * $sh)
for ($y = 0; $y -lt $sh; $y++) {
  for ($x = 0; $x -lt $sw; $x++) {
    $idx = $y * $strideS + $x * $bpp
    if ($y -ge $protectYS) {
      $alphaSmall[$y * $sw + $x] = 255
      continue
    }
    $r = [int]$bytesS[$idx+2]; $gg = [int]$bytesS[$idx+1]; $b = [int]$bytesS[$idx]

    $bestsq = [double]::MaxValue
    for ($ri = 0; $ri -lt $refCount; $ri++) {
      $dr = $r - $refR[$ri]; $dg = $gg - $refG[$ri]; $db = $b - $refB[$ri]
      $dsq = $dr*$dr + $dg*$dg + $db*$db
      if ($dsq -lt $bestsq) { $bestsq = $dsq }
      if ($bestsq -le $t1sq) { break }
    }

    $alpha = 255
    if ($bestsq -le $t1sq) { $alpha = 0 }
    elseif ($bestsq -lt $t2sq) {
      $best = [math]::Sqrt($bestsq)
      $alpha = [byte](255.0 * ($best - $T1) / ($T2 - $T1))
    }

    if ($y -ge ($protectYS - $featherPxS)) {
      $featherT = ($y - ($protectYS - $featherPxS)) / [double]$featherPxS
      $minAlpha = [byte](255.0 * $featherT)
      if ($alpha -lt $minAlpha) { $alpha = $minAlpha }
    }

    $alphaSmall[$y * $sw + $x] = $alpha
  }
}
$small.UnlockBits($dataS)
$small.Dispose()

# апскейл маски (билинейно вручную) и применение к полноразмерному изображению
$rectF = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$dataF = $full.LockBits($rectF, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$strideF = $dataF.Stride
$bytesF = New-Object byte[] ($strideF * $h)
[System.Runtime.InteropServices.Marshal]::Copy($dataF.Scan0, $bytesF, 0, $bytesF.Length)

for ($y = 0; $y -lt $h; $y++) {
  $sy = [math]::Min($sh - 1, [int]($y / $MaskScale))
  for ($x = 0; $x -lt $w; $x++) {
    $sx = [math]::Min($sw - 1, [int]($x / $MaskScale))
    $a = $alphaSmall[$sy * $sw + $sx]
    $idx = $y * $strideF + $x * $bpp
    $bytesF[$idx+3] = $a
  }
}

[System.Runtime.InteropServices.Marshal]::Copy($bytesF, 0, $dataF.Scan0, $bytesF.Length)
$full.UnlockBits($dataF)
$full.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$full.Dispose()
"saved $OutPath"
