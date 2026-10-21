# 플레르 MS팀 업무 도구 (플레르 숏츠 스튜디오)

플레르 MS팀의 업무 도구 모음 사이트예요. 메뉴: **플레르 숏츠**(사용 중), **주간 매출 통계 · 월간 매출 통계 · 제품 리뷰수 종합**(준비 중).

## 플레르 숏츠

제품 사진 + 상세페이지 이미지 zip과 제품명을 넣으면 15초 홍보 숏츠(9:16), 제목(25자), 설명글(150자)을 만들고 버튼 한 번으로 유튜브·인스타그램·틱톡에 올리는 **로컬 사이트**입니다. Claude 플러그인으로 배포돼서, 같은 Claude 계정을 쓰는 모든 PC에 똑같이 설치할 수 있어요.

- 영상 생성: 각 PC의 Claude Code(같은 Claude 계정)가 `plaire-product-shorts` 스킬로 만듭니다. 추가 API 비용 없음
- 업로드(공식 API, 혼합 방식)
  - 인스타그램 릴스: 바로 전체공개
  - 유튜브 쇼츠: 전체공개로 요청하지만 **구글 심사 전에는 비공개로 올라감** → 스튜디오에서 공개로 전환
  - 틱톡: **앱 심사 전에는 틱톡 앱 받은편지함(초안)** 으로 전송 → 앱 알림에서 캡션 붙여 게시
- 네이버 클립 / 쇼핑 숏클립: 자동 업로드 불가. 스튜디오의 체크리스트와 복사 버튼으로 직접 등록

---

## 1. PC에 설치 (PC마다 한 번, 버튼 한 번)

**설치 키트 만들기** — 이미 잘 쓰고 있는 PC에서 한 번:
```
powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\plugins\cache\plaire-tools\plaire-shorts-studio\<버전>\setup\make_kit.ps1"
```
바탕화면에 `플레르MS팀_설치키트` 폴더(+zip)가 생겨요. 회사 비밀 파일(구글 시트 키·오늘의집 파일 비밀번호·유튜브/인스타/틱톡 앱 설정과 연결)이 들어 있으니 **USB·사내 공유로만** 옮기세요(메일·메신저·인터넷 금지).

**새 PC에서** — 키트 압축을 풀고 `설치하기.cmd` 더블클릭. Python·Node.js·Git·Claude Code 설치 → 업무 도구 플러그인 설치 → 회사 설정 복사 → 구성요소 설치·자동 시작 → 브라우저로 열기까지 알아서 해요(10분쯤). 중간에 '이 앱이 변경하도록 허용' 창이 뜨면 [예]. 다 되면 업무 도구 왼쪽 위 **Claude [로그인]**만 한 번 하면 끝이에요.

설치가 끝나면 업무 도구가 **화면 없이 백그라운드로** 켜지고, 앞으로 **PC에 로그인할 때마다 자동으로** 켜져요(시작프로그램 `플레르 MS팀 업무 도구.vbs`). 바탕화면의 **플레르 숏츠 스튜디오** 아이콘을 더블클릭하면 브라우저에 `http://localhost:4173` 이 열려요. 브라우저나 창을 닫아도 도구는 계속 켜져 있어요.

- 서버가 오류로 꺼지면 지킴이(`watchdog.ps1`)가 몇 초 뒤 다시 켜요. 기록은 `%USERPROFILE%\plaire-shorts\logs\` (30일 보관).
- 비밀 파일 위치: `%USERPROFILE%\.secrets\google-sheets-key.json`, `%USERPROFILE%\.secrets\ohouse_pw.txt`, `%USERPROFILE%\plaire-shorts\config.json`, `tokens.json` — 저장소에는 없어요.

### 업데이트
```
claude plugin marketplace update plaire-tools
claude plugin update plaire-shorts-studio@plaire-tools
```
업데이트가 설치되면 켜져 있는 도구가 **하던 일(영상 생성·업로드·집계·답글 작성)이 끝난 뒤** 새 버전 구성요소를 미리 깔고 스스로 갈아타요(1분 안에, 끊김 1초 정도). 따로 다시 켤 필요 없어요.

### 여러 PC에서 같은 설정 쓰기
연결 설정(앱 ID·시크릿)은 `%USERPROFILE%\plaire-shorts\config.json` 에 저장돼요. 이 파일을 다른 PC의 같은 위치에 복사하면 ID 입력을 건너뛸 수 있어요. 로그인 토큰(`tokens.json`)은 보안상 PC마다 "연결" 버튼으로 한 번씩 연결하는 걸 권장해요.

---

## 2. 관리자 설정 (담당자가 처음 한 번)
아래에서 받은 값들을 `studio/app-config.json` 에 넣고 저장소에 올리면, 모든 PC의 스튜디오에 **연결하기** 버튼이 켜져요. (값이 비어 있으면 그 칸은 "준비 중"으로 보여요) 스튜디오 **설정 → 관리자 설정**에 넣으면 그 PC에서만 바로 쓸 수 있어요.

### 유튜브
1. [Google Cloud 콘솔](https://console.cloud.google.com)에서 프로젝트 만들기 → **YouTube Data API v3** 사용 설정
2. OAuth 동의 화면: 외부, 앱 이름 "플레르 숏츠 스튜디오", 테스트 사용자에 채널 관리 구글 계정 추가
3. 사용자 인증 정보 → OAuth 클라이언트 ID → 유형 **데스크톱 앱** → 클라이언트 ID·보안 비밀번호를 `youtube` 에 입력
4. 전체공개 업로드를 풀려면 Google의 [YouTube API Services 감사 신청](https://support.google.com/youtube/contact/yt_api_form)을 제출 (승인 전엔 비공개로 올라감)

### 인스타그램 (Instagram 로그인 방식 — 페이스북 페이지·인스타 쇼핑 설정을 건드리지 않음)
1. Meta 앱(플레르 숏츠 스튜디오, 앱 ID 1991082041562355)에 **Instagram** 제품이 추가돼 있음 → Instagram 앱 ID `1843390043497509` 는 `app-config.json` 에 들어 있음
2. Meta 앱 → Instagram → **Instagram 로그인이 포함된 API 설정 → 1. 액세스 토큰 생성 → 계정 추가** → @_plaire_official 로 로그인 → 표시되는 토큰 복사
3. 스튜디오 왼쪽 연결에서 인스타그램 **연결하기** → 토큰 붙여넣기 → **토큰으로 연결** (60일 토큰. 스튜디오가 켜질 때와 켜져 있는 동안 12시간마다 자동 연장 → 60일 안에 한 번이라도 스튜디오를 켜면 계속 유지. 2주 미만 남으면 연결 칸에 경고)
4. 업로드할 때만 영상 파일 하나를 Cloudflare 임시 주소(cloudflared, setup.ps1이 설치)로 몇 분간 열어 인스타가 가져가게 하고, 끝나면 바로 닫아요. 스튜디오 화면·다른 파일은 열리지 않아요.
   (Meta가 Instagram 로그인 방식에서 localhost 리디렉션을 허용하지 않아 버튼 로그인 대신 토큰 붙여넣기를 써요)

### 틱톡
1. [TikTok for Developers](https://developers.tiktok.com)에서 앱 만들기 → **Login Kit** + **Content Posting API** 추가, 권한 `user.info.basic`, `video.upload`
2. 플랫폼 **Desktop** 으로 등록하고 리디렉트 URL에 `http://localhost:4173/auth/tiktok/callback` 등록 → Client key·secret을 `tiktok` 에 입력
   (Desktop 등록이 안 되면 https 회사 주소를 등록하고 그 주소를 `tiktok.redirect_uri` 에 넣으세요. 이 경우 연결할 때 이동된 주소창 URL을 붙여넣는 창이 떠요)
3. 심사 전에는 **Sandbox** 에서 본인 틱톡 계정을 테스트 사용자로 추가
4. 심사(App review) 통과 후에는 바로 공개 게시로 바꿀 수 있어요

---

## 3. 쓰는 법
1. **새 영상** → zip 끌어다 놓기 → 제품명 → **영상 만들기** (3~5분)
   - zip 안: `사진자료\`(촬영 원본, 전 컬러가 한 줄로 선 라인업 사진이 있으면 좋음), `분할_JPG\`(상세페이지 이미지), 있으면 `상품명_키워드_선정근거.xlsx`
2. 영상 확인 → 제목·설명글 수정(글자 수 표시) → 필요하면 요청을 적고 **다시 만들기**
3. 올릴 곳 체크 → **선택한 곳에 업로드** → 결과 링크 확인
4. 네이버 클립·쇼핑 숏클립은 **영상 받기 / 제목·설명 복사**로 직접 등록하고 체크

작업물은 `%USERPROFILE%\plaire-shorts\jobs\<날짜-시간>\` 에 남아요.

## 구성
```
.claude-plugin/   플러그인·마켓플레이스 정보
skills/           plaire-product-shorts 스킬 (제작 규칙·스튜디오 모드)
commands/         /shorts-studio
engine/           Remotion 영상 엔진
scripts/          shorts.py (사진 시트·크롭·BGM·검수·렌더·zip 풀기), make_bgm.py
studio/           로컬 사이트 (server.js, lib/, public/)
setup/            install.ps1(새 PC 원클릭 설치), make_kit.ps1(설치 키트 만들기), setup.ps1(구성요소·자동 시작), start.ps1(브라우저로 열기), watchdog.ps1(백그라운드 지킴이)
```
