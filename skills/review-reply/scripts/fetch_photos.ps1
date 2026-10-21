# photos.txt 의 리뷰 사진을 내려받아 확인용(small, 460px)과 페이지 삽입용(thumb, 340px)으로 줄인다.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File fetch_photos.ps1 -WorkDir <작업폴더>
# 결과: <작업폴더>\img\small\rowN.jpg  (Read 로 한 장씩 열어 볼 것)
#       <작업폴더>\img\thumb\rowN.jpg  (build_page.ps1 이 페이지에 내장)
param([Parameter(Mandatory=$true)][string]$WorkDir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$d = Join-Path $WorkDir 'img'
New-Item -ItemType Directory -Force "$d\orig","$d\small","$d\thumb" | Out-Null

$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
function Save-Resized($src, $dst, $max, $q) {
  $img = [Drawing.Image]::FromFile($src)
  try {
    foreach ($p in $img.PropertyItems) {
      if ($p.Id -eq 0x0112) {
        switch ([int]$p.Value[0]) { 3 { $img.RotateFlip('Rotate180FlipNone') } 6 { $img.RotateFlip('Rotate90FlipNone') } 8 { $img.RotateFlip('Rotate270FlipNone') } }
      }
    }
    $s = [Math]::Min(1.0, $max / [Math]::Max($img.Width, $img.Height))
    $w = [int]($img.Width * $s); $h = [int]($img.Height * $s)
    $bmp = New-Object Drawing.Bitmap $w, $h
    $g = [Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h)
    $ep = New-Object Drawing.Imaging.EncoderParameters 1
    $ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]$q)
    $bmp.Save($dst, $codec, $ep); $g.Dispose(); $bmp.Dispose()
  } finally { $img.Dispose() }
}

$lines = [IO.File]::ReadAllLines((Join-Path $WorkDir 'photos.txt'), [Text.Encoding]::UTF8) | Where-Object { $_.Trim() }
$sizes = @{}
foreach ($l in $lines) {
  $parts = $l.Split("`t"); $r = $parts[0]; $u = $parts[1].Trim()
  $o = "$d\orig\row$r.img"
  try {
    Invoke-WebRequest -Uri $u -OutFile $o -UseBasicParsing
    Save-Resized $o "$d\small\row$r.jpg" 460 80
    Save-Resized $o "$d\thumb\row$r.jpg" 340 68
    $len = (Get-Item $o).Length
    $dup = ''
    if ($sizes.ContainsKey($len)) { $dup = "  <- 행$($sizes[$len]) 과 같은 사진" } else { $sizes[$len] = $r }
    Write-Host "행$r 완료$dup"
  } catch {
    Write-Host "행$r 실패: $($_.Exception.Message)"
  }
}
Write-Host "사진 $($lines.Count) 장 처리 -> $d\small"
