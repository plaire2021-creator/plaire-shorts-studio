# 구글 시트 접속 (서비스 계정). 키는 각 PC의 %USERPROFILE%\.secrets\google-sheets-key.json
# 시트마다 sheets-editor@plaire-sheets.iam.gserviceaccount.com 을 편집자로 공유해야 열림.
from pathlib import Path

import gspread

KEY_PATH = Path.home() / ".secrets" / "google-sheets-key.json"


def client():
    return gspread.service_account(filename=str(KEY_PATH))


def open_sheet(url):
    return client().open_by_url(url)
