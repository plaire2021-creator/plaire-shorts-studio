# 답글 카드(body.html)를 페이지 틀에 끼우고, 사진을 내장하고, 규칙 위반을 검사한다.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File build_page.ps1 -WorkDir <작업폴더> -Brand 플레르가구 -Source review_20261021_084520.xlsx -Out <저장경로>
#       [-ExtraFacts "7|★4 이하 (모두 칭찬)|hot","2|가족·친구 선물"]  [-Force]
# 입력: <작업폴더>\body.html (카드들), <작업폴더>\img\thumb\rowN.jpg
# 검사에 하나라도 걸리면 저장하지 않는다(-Force 로 강제 저장 가능).
param(
  [Parameter(Mandatory=$true)][string]$WorkDir,
  [Parameter(Mandatory=$true)][ValidateSet('플레르가구','가즈다가구')][string]$Brand,
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Out,
  [string[]]$ExtraFacts = @(),
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$skill = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object Text.UTF8Encoding($false)

$brandInfo = @{
  '플레르가구' = @{ short='플레르'; phone='010-8981-0097'; insta='@_plaire_official'; other='가즈다|3099-0097|gazda' }
  '가즈다가구' = @{ short='가즈다'; phone='010-3099-0097'; insta='@gazda_furniture';  other='플레르|8981-0097|plaire' }
}[$Brand]

$body = [IO.File]::ReadAllText((Join-Path $WorkDir 'body.html'), [Text.Encoding]::UTF8) -replace "`r", ""
if ($body -notmatch '<main id="list">') { $body = "<main id=""list"">`n`n" + $body }

# 날짜: 파일명 review_YYYYMMDD_... 에서 뽑는다
$m = [regex]::Match($Source, 'review_(\d{4})(\d{2})(\d{2})')
$mmdd = if ($m.Success) { $m.Groups[2].Value + $m.Groups[3].Value } else { (Get-Date -Format 'MMdd') }
$label = if ($m.Success) { "$([int]$m.Groups[2].Value)월 $([int]$m.Groups[3].Value)일" } else { (Get-Date -Format 'M월 d일') }

function Count($text, $pat) { ([regex]::Matches($text, $pat)).Count }
$total = Count $body '<article '
$withPhoto = Count $body 'data-photo="1"'
$month = Count $body 'data-month="1"'
$flag = Count $body '<article [^>]*data-flag='

$facts = @("      <div><b>$total</b> 건</div>", "      <div><b>$withPhoto</b> 건 사진 첨부</div>", "      <div><b>$month</b> 건 한달사용</div>")
if ($flag -gt 0) { $facts += "      <div class=""hot""><b>$flag</b> 건 조치 필요</div>" }
foreach ($f in $ExtraFacts) {
  $p = $f.Split('|'); $cls = if ($p.Count -gt 2 -and $p[2] -eq 'hot') { ' class="hot"' } else { '' }
  $facts += "      <div$cls><b>$($p[0])</b> $($p[1])</div>"
}

$head = [IO.File]::ReadAllText((Join-Path $skill 'templates\page_head.html'), [Text.Encoding]::UTF8)
$tail = [IO.File]::ReadAllText((Join-Path $skill 'templates\page_tail.html'), [Text.Encoding]::UTF8)
$titlePrefix = if ($Brand -eq '플레르가구') { '플레르' } else { '가즈다' }
$h1 = if ($Brand -eq '플레르가구') { "$label 접수 리뷰 답글" } else { "$label 가즈다가구 리뷰 답글" }
$head = $head.Replace('{{TITLE}}', "$titlePrefix 리뷰 답글 $mmdd").Replace('{{BRAND}}', $Brand).Replace('{{H1}}', $h1).Replace('{{FACTS}}', ($facts -join "`n"))
$noPhoto = $total - $withPhoto
$footer = "원본 파일 <code>$Source</code> · 사진 $withPhoto 건을 모두 열어 확인한 뒤 작성했습니다."
if ($noPhoto -gt 0) { $footer += " 사진이 없는 $noPhoto 건은 사진 언급 없이 썼습니다." }
$tail = $tail.Replace('{{FOOTER}}', $footer)

$html = $head + $body + "`n" + $tail
foreach ($ph in ([regex]::Matches($html, '__IMG(\d+)__') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)) {
  $f = Join-Path $WorkDir "img\thumb\row$ph.jpg"
  if (Test-Path $f) {
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f))
    $html = $html.Replace("__IMG$($ph)__", "data:image/jpeg;base64,$b64")
  }
}

# ---------- 검사 ----------
$replies = ([regex]::Matches($body, '(?s)<div class="reply">(.*?)</div>') | ForEach-Object { $_.Groups[1].Value })
$all = $replies -join "`n"
$fail = @(); $warn = @()

if ((Count $html '__IMG\d+__') -gt 0) { $fail += "사진 자리표시자가 남음(썸네일 없음): $(([regex]::Matches($html,'__IMG\d+__')|%{$_.Value}|Select-Object -Unique) -join ', ')" }
if ($replies.Count -ne $total) { $fail += "카드 $total 개인데 답글 $($replies.Count) 개" }
$closing = "저희 $Brand" + '를 믿고 구매해주셔서 감사합니다!'
$block = "[$Brand]`n고객센터 : $($brandInfo.phone)`n인스타 : $($brandInfo.insta)"
$i = 0
foreach ($r in $replies) {
  $i++
  $t = $r.TrimEnd()
  if (-not $t.EndsWith($block)) { $fail += "답글 $i : 하단 브랜드 블록이 정확하지 않음" }
  if ($t -notmatch [regex]::Escape($closing) + "`n`n" + [regex]::Escape("[$Brand]")) { $fail += "답글 $i : 마지막 감사 인사 뒤에 빈 줄 하나 + 브랜드 블록 형식이 아님" }
  $lines = ($t.Split("`n") | Where-Object { $_.Trim() }).Count - 3
  if ($lines -lt 3 -or $lines -gt 9) { $warn += "답글 $i : 본문 $lines 줄 (권장 4~7줄)" }
}
if ((Count $all $brandInfo.other) -gt 0) { $fail += "다른 브랜드 정보가 섞임" }

$banned = [ordered]@{
  '큰따옴표'                        = '"|“|”'
  '감정 짐작(~셨겠어요/~셨을 텐데)'   = '셨겠|셨을 ?텐데|아쉬우셨|좋으셨겠|속상하셨겠|당황하셨겠|불편하셨겠'
  'CS 이관 문구'                    = 'CS팀|연락 ?드리겠습니다|편하신 시간대'
  '문어체'                          = '마음이 무겁|면목이|그냥 두기 어렵|감사한 마음으로 읽|넘길 얘기|생각합니다\.'
  '고객 평가 표현'                   = '안목|센스|잘 고르셨|탁월한 선택|현명한 선택|효도|효자|효녀|구매 잘 하셨|결정 잘 하셨'
}
foreach ($k in $banned.Keys) { $c = Count $all $banned[$k]; if ($c -gt 0) { $fail += "$k $c 회" } }

# 이모지: 사람 표정·손만 허용
$badEmoji = @{}; $usedEmoji = @{}
for ($j = 0; $j -lt $all.Length; $j++) {
  $ch = $all[$j]; $cp = [int]$ch; $len = 1
  if ([char]::IsHighSurrogate($ch) -and $j + 1 -lt $all.Length) { $cp = [char]::ConvertToUtf32($ch, $all[$j+1]); $len = 2 }
  $isEmoji = ($cp -ge 0x1F000) -or ($cp -ge 0x2600 -and $cp -le 0x27BF) -or ($cp -ge 0x2B00 -and $cp -le 0x2BFF)
  if ($isEmoji -and -not ($cp -ge 0x1F3FB -and $cp -le 0x1F3FF)) {
    $s = $all.Substring($j, $len)
    $ok = ($cp -ge 0x1F600 -and $cp -le 0x1F64F) -or ($cp -ge 0x1F910 -and $cp -le 0x1F92F) -or ($cp -ge 0x1F970 -and $cp -le 0x1F97A) -or
          ($cp -ge 0x1F44A -and $cp -le 0x1F450) -or ($cp -ge 0x1F918 -and $cp -le 0x1F91F) -or $cp -eq 0x263A -or $cp -eq 0x270C -or $cp -eq 0x261D
    if ($ok) { $usedEmoji[$s] = 1 + [int]$usedEmoji[$s] } else { $badEmoji[$s] = 1 + [int]$badEmoji[$s] }
  }
  $j += $len - 1
}
if ($badEmoji.Count -gt 0) { $fail += "사람 표정·손이 아닌 이모지: $(($badEmoji.Keys | ForEach-Object { "$_ x$($badEmoji[$_])" }) -join ' ')" }

# 변주 점검(경고)
$rep = [ordered]@{ '오래 편하게 써주세요' = 1; '저희가 다 ' = 2; '사진 보니' = [Math]::Max(3, [int]($total / 4)); '~😊' = [Math]::Max(2, [int]($total / 5)) }
foreach ($k in $rep.Keys) { $c = Count $all ([regex]::Escape($k)); if ($c -gt $rep[$k]) { $warn += "'$k' $c 회 (최대 $($rep[$k])회 권장)" } }
$firsts = $replies | ForEach-Object { ($_.Trim().Split("`n")[0] -replace '[^가-힣]', '').Substring(0, [Math]::Min(4, ($_.Trim().Split("`n")[0] -replace '[^가-힣]', '').Length)) }
$firsts | Group-Object | Where-Object { $_.Count -ge 3 -and $_.Name } | ForEach-Object { $warn += "첫 줄이 '$($_.Name)…'로 시작하는 답글 $($_.Count) 개" }
$noEmoji = ($replies | Where-Object { $_ -notmatch '[\uD83C-\uDBFF]|☺' }).Count

Write-Host "카드 $total / 사진 $withPhoto / 한달사용 $month / 조치 필요 $flag / 이모지 없는 답글 $noEmoji"
Write-Host "사용한 이모지: $(($usedEmoji.Keys | ForEach-Object { "$_ x$($usedEmoji[$_])" }) -join ' ')"
foreach ($w in $warn) { Write-Host "[경고] $w" }
foreach ($f in $fail) { Write-Host "[실패] $f" }

if ($fail.Count -gt 0 -and -not $Force) { Write-Host "검사 실패 - 저장하지 않았습니다."; exit 1 }
[IO.File]::WriteAllText($Out, $html, $utf8)
Write-Host "저장: $Out ($([int]((Get-Item $Out).Length / 1024)) KB)"
