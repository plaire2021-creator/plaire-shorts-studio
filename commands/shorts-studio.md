---
description: 플레르 숏츠 스튜디오(로컬 사이트)를 설치하거나 실행합니다
---

플레르 숏츠 스튜디오를 실행해 주세요. 이 플러그인의 루트는 `${CLAUDE_PLUGIN_ROOT}` 입니다.

1. `${CLAUDE_PLUGIN_ROOT}\studio\node_modules` 또는 `${CLAUDE_PLUGIN_ROOT}\engine\node_modules` 가 없으면 이 PC에 처음 설치하는 것이다. `${CLAUDE_PLUGIN_ROOT}\setup\setup.ps1` 을 PowerShell로 실행하라고 안내하고(사용자가 직접 실행하는 편이 낫다: 설치 중 확인 메시지가 나옴), 끝나면 바탕화면 아이콘으로 열면 된다고 알려준다.
2. 설치돼 있으면 `node "${CLAUDE_PLUGIN_ROOT}\studio\server.js" --open` 을 백그라운드로 실행해 브라우저에서 http://127.0.0.1:4173 이 열리게 한다. 이미 켜져 있으면(포트 사용 중) 주소만 알려준다.
3. 영상 생성은 이 PC의 Claude Code 로그인을 쓴다. 스튜디오의 "연결 설정 → 로그인 확인"이 실패하면 터미널에서 `claude` 실행 후 `/login` 하라고 안내한다.
