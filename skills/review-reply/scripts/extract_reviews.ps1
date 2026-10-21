# 네이버 스마트스토어 리뷰 엑셀(review_YYYYMMDD_HHMMSS.xlsx)을 읽어 답글 작성용 텍스트로 풀어낸다.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File extract_reviews.ps1 -Xlsx <엑셀경로> -WorkDir <작업폴더>
# 결과: <작업폴더>\reviews.txt (행별 B/C/D/E/F/H/I/M/W 열), <작업폴더>\photos.txt (행번호<TAB>사진URL)
param(
  [Parameter(Mandatory=$true)][string]$Xlsx,
  [Parameter(Mandatory=$true)][string]$WorkDir
)
$ErrorActionPreference = 'Stop'
$x = Join-Path $WorkDir 'xlsx'
New-Item -ItemType Directory -Force $x | Out-Null
Copy-Item -LiteralPath $Xlsx (Join-Path $x 'r.zip') -Force
Expand-Archive (Join-Path $x 'r.zip') (Join-Path $x 'unz') -Force

$strs = @()
$ssPath = Join-Path $x 'unz\xl\sharedStrings.xml'
if (Test-Path $ssPath) {
  [xml]$ss = [IO.File]::ReadAllText($ssPath, [Text.Encoding]::UTF8)
  foreach ($si in $ss.sst.si) { $strs += $si.InnerText }
}
[xml]$sh = [IO.File]::ReadAllText((Join-Path $x 'unz\xl\worksheets\sheet1.xml'), [Text.Encoding]::UTF8)

# B 상품명 / C 리뷰구분(일반·한달사용) / D 평점 / E 사진URL / F 리뷰 / H 작성자 / I 등록일 / M 첫 리뷰(한달사용일 때) / W 상품주문번호
$keep = @('B','C','D','E','F','H','I','M','W')
$out = New-Object Text.StringBuilder
$photos = New-Object Text.StringBuilder
$n = 0
foreach ($row in $sh.worksheet.sheetData.row) {
  if ($row.r -eq '1') { continue }
  $n++
  [void]$out.AppendLine("=== ROW $($row.r)")
  foreach ($c in $row.c) {
    $col = $c.r.TrimEnd('0','1','2','3','4','5','6','7','8','9')
    if ($keep -notcontains $col) { continue }
    $v = $c.v
    if ($c.t -eq 's') { $v = $strs[[int]$v] } elseif ($c.t -eq 'inlineStr') { $v = $c.is.InnerText }
    if ($v) {
      [void]$out.AppendLine("$col : $v")
      if ($col -eq 'E') { [void]$photos.AppendLine("$($row.r)`t$v") }
    }
  }
}
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $WorkDir 'reviews.txt'), $out.ToString(), $utf8)
[IO.File]::WriteAllText((Join-Path $WorkDir 'photos.txt'), $photos.ToString(), $utf8)
$pc = ($photos.ToString().Split("`n") | Where-Object { $_.Trim() }).Count
Write-Host "리뷰 $n 건, 사진 $pc 장 -> $WorkDir\reviews.txt"
