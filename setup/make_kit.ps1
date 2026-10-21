# 설치 키트 만들기 (지금 잘 쓰고 있는 PC에서 실행)
# 바탕화면에 '플레르MS팀_설치키트' 폴더와 zip을 만든다. 새 PC에서 압축을 풀고 '설치하기.cmd'를 더블클릭하면 끝.
# ⚠ 키트에는 회사 비밀 파일(구글 키·연결 정보·오늘의집 비밀번호)이 들어 있다. USB·사내 공유로만 옮기고 메일·메신저·인터넷에 올리지 말 것.
param([string]$Out = [Environment]::GetFolderPath("Desktop"), [switch]$NoPause)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$kit = Join-Path $Out "플레르MS팀_설치키트"
if (Test-Path $kit) { Remove-Item $kit -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $kit "secrets") | Out-Null

Copy-Item (Join-Path $PSScriptRoot "install.ps1") (Join-Path $kit "install.ps1")
$cmd = "@echo off`r`ntitle 플레르 MS팀 업무 도구 설치`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0install.ps1`"`r`n"
[System.IO.File]::WriteAllText((Join-Path $kit "설치하기.cmd"), $cmd, [System.Text.Encoding]::Default)

$sec = Join-Path $env:USERPROFILE ".secrets"
$home2 = Join-Path $env:USERPROFILE "plaire-shorts"
$found = @()
foreach ($f in @((Join-Path $sec "google-sheets-key.json"), (Join-Path $sec "ohouse_pw.txt"), (Join-Path $home2 "config.json"), (Join-Path $home2 "tokens.json"))) {
  if (Test-Path $f) { Copy-Item $f (Join-Path $kit "secrets"); $found += (Split-Path $f -Leaf) }
}
$readme = @"
플레르 MS팀 업무 도구 설치 키트 ($(Get-Date -Format 'yyyy-MM-dd') 만듦)

1. 이 폴더를 새 PC로 옮기고(USB·사내 공유) 압축을 풀어요.
2. '설치하기.cmd' 를 더블클릭해요. (파란 창에서 '추가 정보 → 실행'이 나오면 실행, '이 앱이 변경하도록 허용'은 [예])
3. 10분쯤 뒤 브라우저에 업무 도구가 열리면 왼쪽 위 Claude [로그인]을 눌러 회사 Claude 계정으로 로그인해요. 끝!

들어 있는 회사 설정: $($found -join ', ')
⚠ 비밀 파일이 들어 있어요. 메일·메신저·인터넷에 올리지 말고, 설치가 끝나면 새 PC에서 이 폴더를 지워 주세요.
"@
[System.IO.File]::WriteAllText((Join-Path $kit "읽어주세요.txt"), $readme, [System.Text.Encoding]::UTF8)

$zip = "$kit.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$kit\*" -DestinationPath $zip
Write-Host "설치 키트를 만들었어요: $kit (+ zip)"
Write-Host "들어 있는 회사 설정: $($found -join ', ')"
if (-not $NoPause) { Read-Host "엔터를 누르면 닫혀요" }
