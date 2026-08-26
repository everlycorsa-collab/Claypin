param(
  [Parameter(Mandatory=$true)][string]$InPath,
  [Parameter(Mandatory=$true)][string]$OutPath,
  [double]$T1 = 22,
  [double]$T2 = 45,
  [double]$ProtectBelowFrac = 1.0  # доля высоты (0..1), НИЖЕ которой пиксели всегда остаются непрозрачными (ноги)
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::new($InPath)
$w = $src.Width
$h = $src.Height

$bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($src, 0, 0, $w, $h)
$g.Dispose()
$src.Dispose()

$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($data.Stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bpp = 4
$rowStride = $data.Stride

# Образцы фона: верхняя кромка + левая/правая полосы (БЕЗ нижней — там пол, он слишком похож
# по цвету на ноги персонажа, и нижняя кромка их "смывала").
$refs = New-Object System.Collections.Generic.List[double[]]
$margin = 10
for ($px = 0; $px -lt $w; $px += 3) {
  for ($py = 0; $py -lt $margin; $py += 3) {
    $idx = $py * $rowStride + $px * $bpp
    $refs.Add(@([double]$bytes[$idx+2], [double]$bytes[$idx+1], [double]$bytes[$idx]))
  }
}
for ($py = 0; $py -lt ([int]($h * 0.68)); $py += 3) {
  for ($px = 0; $px -lt $margin; $px += 3) {
    $idx = $py * $rowStride + $px * $bpp
    $refs.Add(@([double]$bytes[$idx+2], [double]$bytes[$idx+1], [double]$bytes[$idx]))
    $idx2 = $py * $rowStride + ($w - 1 - $px) * $bpp
    $refs.Add(@([double]$bytes[$idx2+2], [double]$bytes[$idx2+1], [double]$bytes[$idx2]))
  }
}

$protectY = [int]($h * $ProtectBelowFrac)
$featherPx = 22
for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $idx = $y * $rowStride + $x * $bpp

    if ($y -ge $protectY) {
      $bytes[$idx+3] = 255
      continue
    }

    $r = [double]$bytes[$idx+2]; $gg = [double]$bytes[$idx+1]; $b = [double]$bytes[$idx]

    $best = [double]::MaxValue
    foreach ($ref in $refs) {
      $dr = $r - $ref[0]; $dg = $gg - $ref[1]; $db = $b - $ref[2]
      $d = [math]::Sqrt($dr*$dr + $dg*$dg + $db*$db)
      if ($d -lt $best) { $best = $d }
      if ($best -lt $T1) { break }
    }

    $alpha = 255
    if ($best -le $T1) { $alpha = 0 }
    elseif ($best -lt $T2) { $alpha = [byte](255.0 * ($best - $T1) / ($T2 - $T1)) }

    if ($y -ge ($protectY - $featherPx)) {
      # мягкий переход к защищённой зоне ног — не даём alpha упасть ниже нарастающего "пола"
      $featherT = ($y - ($protectY - $featherPx)) / [double]$featherPx
      $minAlpha = [byte](255.0 * $featherT)
      if ($alpha -lt $minAlpha) { $alpha = $minAlpha }
    }

    $bytes[$idx+3] = $alpha
  }
}

[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$bmp.UnlockBits($data)
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"saved $OutPath"
