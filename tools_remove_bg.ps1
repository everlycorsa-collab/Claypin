param(
  [Parameter(Mandatory=$true)][string]$InPath,
  [Parameter(Mandatory=$true)][string]$OutPath,
  [double]$Threshold = 30
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Bitmap]::new($InPath)
$w = $src.Width
$h = $src.Height

# Перегоняем в 32bppArgb, чтобы можно было писать альфу
$bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($src, 0, 0, $w, $h)
$g.Dispose()
$src.Dispose()

$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Scan0
$bytes = New-Object byte[] ($data.Stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bpp = 4
$rowStride = $data.Stride

function GetPx($x, $y) {
  $idx = $y * $rowStride + $x * $bpp
  return @($bytes[$idx+2], $bytes[$idx+1], $bytes[$idx], $bytes[$idx+3]) # R,G,B,A (BGRA in memory)
}
function SetAlpha($x, $y, $a) {
  $idx = $y * $rowStride + $x * $bpp
  $bytes[$idx+3] = $a
}

$visited = New-Object bool[] ($w * $h)
$queue = New-Object System.Collections.Generic.Queue[int]

function Enqueue($x, $y) {
  $i = $y * $w + $x
  if (-not $visited[$i]) {
    $visited[$i] = $true
    $queue.Enqueue($i)
  }
}

for ($x = 0; $x -lt $w; $x++) { Enqueue $x 0; Enqueue $x ($h - 1) }
for ($y = 0; $y -lt $h; $y++) { Enqueue 0 $y; Enqueue ($w - 1) $y }

function TryGrow([int]$cx, [int]$cy, [int]$nx, [int]$ny, $p) {
  if ($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h) { return }
  $ni = $ny * $w + $nx
  if ($visited[$ni]) { return }
  $np = GetPx $nx $ny
  $dr = [double]$p[0] - [double]$np[0]
  $dg = [double]$p[1] - [double]$np[1]
  $db = [double]$p[2] - [double]$np[2]
  $dist2 = $dr*$dr + $dg*$dg + $db*$db
  if ($dist2 -le $script:thr2) {
    $script:visited[$ni] = $true
    $script:queue.Enqueue($ni)
  }
}

$thr2 = $Threshold * $Threshold
while ($queue.Count -gt 0) {
  $i = $queue.Dequeue()
  $cx = [int]($i % $w)
  $cy = [int][math]::Floor($i / $w)
  $p = GetPx $cx $cy
  SetAlpha $cx $cy 0

  TryGrow $cx $cy ($cx - 1) $cy $p
  TryGrow $cx $cy ($cx + 1) $cy $p
  TryGrow $cx $cy $cx ($cy - 1) $p
  TryGrow $cx $cy $cx ($cy + 1) $p
}

[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$bmp.UnlockBits($data)
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"saved $OutPath"
