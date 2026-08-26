param(
  [Parameter(Mandatory=$true)][string]$InPath,
  [Parameter(Mandatory=$true)][string]$OutPath,
  [int]$LowDiff = 12,   # G-max(R,B) ниже этого — точно НЕ фон
  [int]$HighDiff = 35   # G-max(R,B) выше этого — точно фон
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
$stride = $data.Stride
$bytes = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bpp = 4

for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $idx = $y * $stride + $x * $bpp
    $b = [int]$bytes[$idx]; $gg = [int]$bytes[$idx+1]; $r = [int]$bytes[$idx+2]

    $mx = [Math]::Max($r, $b)
    $diff = $gg - $mx

    if ($diff -ge $HighDiff) {
      $bytes[$idx+3] = 0
    } elseif ($diff -le $LowDiff) {
      # оставляем как есть (непрозрачно) — но также слегка приглушаем зелёный краевой рефлекс на кромке персонажа
      $bytes[$idx+3] = 255
    } else {
      $t = ($diff - $LowDiff) / [double]($HighDiff - $LowDiff)
      $bytes[$idx+3] = [byte](255.0 * (1 - $t))
      # спилл-подавление: на полупрозрачной кромке убираем зелёный оттенок, подмешивая R/B
      $bytes[$idx+1] = [byte][Math]::Min(255, $mx)
    }
  }
}

[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$bmp.UnlockBits($data)
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"saved $OutPath"
