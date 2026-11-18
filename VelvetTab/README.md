# Velvet Tab

Chrome 새 탭을 대체하는 개인용 커스터마이징 새 탭 (Manifest V3, Vanilla JS, 외부 통신 없음).
배경화면 · 시계 · 날짜 · 자체 즐겨찾기 · 새 탭 내부 북마크바를 글래스 스타일로 자유롭게 배치합니다.

## 설치

1. Chrome 주소창에 `chrome://extensions` 입력
2. 오른쪽 위 **개발자 모드** 켜기
3. **압축해제된 확장 프로그램을 로드합니다** → 이 `VelvetTab` 폴더 선택
4. `Ctrl+T` 로 새 탭 열기 → "변경사항을 유지하시겠습니까?" 안내가 나오면 **유지**
5. (선택) 새 탭에서는 Chrome 기본 북마크바가 나오지 않으므로, Chrome 설정 → 모양 → 북마크바는
   **새 탭 페이지에만 표시**(기본값) 또는 **항상 숨기기**를 권장 — 새 탭에는 Velvet Tab 북마크바가 대신 표시됩니다.

> `tests/` 폴더는 확장 동작과 무관합니다(로드해도 무해). 배포용으로 묶을 때는 제외해도 됩니다.

## 사용법

- **설정**: 오른쪽 아래 톱니바퀴 (마우스를 움직이면 나타남). `Esc` 또는 패널 바깥 클릭으로 닫기
- **요소** 탭: 시계/날짜/즐겨찾기/북마크바 표시·크기·형식, 일반 설정
- **배치** 탭: 요소별 9개 위치 선택, **편집 모드**(마우스로 끌어 이동, `Esc`/완료로 종료), 기본 배치 복원
- **디자인** 탭: 전역 / 요소별 글래스 설정 (● = 전역보다 우선하는 개별 설정, ↺ = 전역 값으로)
- **배경** 탭: 이미지 선택(클릭·끌어놓기) → 화면에서 미리보기 → 적용 / 취소 / 교체 / 초기화, 표시 방식
- **즐겨찾기** 탭: 추가·편집·삭제·숨김·끌어서 순서 변경·아이콘(자동/글자/이모지/이미지)
- **프리셋** 탭: 저장·적용·덮어쓰기·이름 변경·복제·삭제·기본 지정·JSON 내보내기/가져오기

## 권한

| 권한 | 용도 |
|---|---|
| `storage` | 설정·프리셋·즐겨찾기 저장 (chrome.storage.local) |
| `bookmarks` | 새 탭 북마크바에 Chrome 북마크를 **읽기 전용**으로 표시 (생성·수정·삭제·이동 호출 없음) |
| `favicon` | Chrome 이 이미 가지고 있는 사이트 아이콘 캐시 표시 (네트워크 요청 없음) |

호스트 권한·백그라운드 서비스 워커·원격 스크립트 없음. CSP 로 `connect-src 'none'` — 외부 통신이 불가능합니다.

## 파일 구조

```
VelvetTab/
├── manifest.json
├── newtab.html
├── css/
│   ├── base.css          토큰·리셋·배경 레이어
│   ├── glass.css         글래스모피즘 변수 시스템
│   ├── components.css    시계·날짜·즐겨찾기·북마크바·메뉴·편집 모드
│   ├── settings.css      설정 패널 (처음 열 때만 로드)
│   └── responsive.css
├── js/
│   ├── app.js                진입점 (병렬 로딩, 요소별 갱신, 편집 모드)
│   ├── defaults.js           기본값·스키마·기본 제공 프리셋
│   ├── storage-manager.js    저장소·검증·마이그레이션·탭 간 동기화
│   ├── style-manager.js      전역/개별 스타일 병합 → CSS 변수
│   ├── layout-manager.js     정규화 좌표 배치 계산 (순수 함수)
│   ├── drag-manager.js       편집 모드 드래그
│   ├── clock.js / date.js    시계·날짜
│   ├── background-manager.js 배경 이미지 IndexedDB·검증·표시
│   ├── favorites-manager.js  자체 즐겨찾기 (지시서의 bookmark-manager.js 역할)
│   ├── bookmark-bar.js       Chrome 북마크 읽기 전용 북마크바
│   ├── preset-manager.js     프리셋
│   └── settings-panel.js     설정 패널 (동적 import)
├── assets/icons/
└── tests/
    ├── unit.test.js      node --test (순수 로직 14개)
    └── e2e/              실제 Chrome E2E (79개 항목)
```

## 데이터 저장 구조

**chrome.storage.local** (키별 분리 → 한 영역 손상이 다른 영역에 영향 없음)

| 키 | 내용 |
|---|---|
| `vt.meta` | `{ schemaVersion, migratedFrom, at }` |
| `vt.settings` | `elements.{clock,date,favorites,bookmarkBar}.{visible, position{mode,preset,x,y}, style(개별 설정만), options}`, `globalStyle`, `background{fit,posX,posY,dim}`, `general` |
| `vt.presets` | `{ items:[{id,name,builtin,data:{elements,globalStyle},createdAt,updatedAt}], defaultId, activeId }` |
| `vt.favorites` | `{ items:[{id,title,url,hidden,icon:{type,value,color}}] }` |
| `vt.backup` | 손상되어 기본값으로 대체된 원본 값 (복구용) |

**IndexedDB** `VelvetTab` v1 — `images['background']` = 이미지 Blob, `meta['background']` = `{name,type,size,width,height,updatedAt}`.
이미지와 메타는 한 트랜잭션으로 갱신되고 항상 같은 키에 덮어쓰므로 중복이 생기지 않습니다.

**안정성**
- 위치는 화면 비율(0~1)로 저장 → 해상도가 바뀌어도 배치 유지
- 모든 값은 로드 시 타입·범위 검증 (손상 값 → 기본값 + `vt.backup` 에 원본 보관)
- `SCHEMA_VERSION` + `MIGRATIONS[n]` 으로 단계별 변환. 더 새로운 버전의 데이터는 덮어쓰지 않음(읽기 전용)
- 저장은 250ms 디바운스(드래그 중에는 저장하지 않고 놓을 때 1회), 탭이 숨겨지거나 닫힐 때 즉시 flush
- 다른 새 탭에서 바꾼 설정은 열린 탭에 바로 반영. 자기 저장의 지연 이벤트는 무시해 빠른 연속 편집이 되돌아가지 않음

## 테스트

```bash
node --test tests/unit.test.js
```

E2E (실제 Google Chrome, 임시 프로필 — 사용자 프로필은 사용하지 않음. `playwright-core` 필요):

```bash
PW_CORE=<playwright-core 경로> node tests/e2e/e2e.cjs <결과 폴더>
```

E2E 는 Windows 에서 실제 `Ctrl+T` 키 입력과 창 캡처를 위해 `tests/e2e/win.ps1` 을 사용합니다.
Chrome 137+ 정식 빌드는 `--load-extension` 을 지원하지 않아 CDP `Extensions.loadUnpacked` 로 확장을 로드합니다.

## 알려진 제약

- **Chrome 기본 북마크바는 확장 새 탭에서 표시되지 않습니다** (Chrome 157 실측, `../docs/BOOKMARK_BAR_TEST.md`).
  그래서 새 탭 안에 자체 북마크바를 구현했습니다. 이것은 확장 프로그램 페이지 안의 UI 이며
  Chrome 실제 툴바와 동일하게 동작하지 않습니다: 끌어서 정리, 우클릭 메뉴(수정·삭제), 북마크릿 실행, 탭 그룹 표시는 지원하지 않습니다.
- Chrome 157 은 확장 새 탭 하단에 "Velvet Tab / Chrome 맞춤설정" 푸터를 자동으로 붙입니다. 확장에서 제거할 수 없습니다.
- 새 탭을 열면 Chrome 이 주소창에 포커스를 줍니다(브라우저 동작).
- 파비콘은 Chrome 이 한 번이라도 방문해 캐시한 사이트만 실제 아이콘이 나오고, 나머지는 기본 지구본 아이콘입니다.
- 설정 버튼 자체는 숨길 수 없습니다(설정 진입 수단). 대신 자동 숨김(기본 켜짐)을 제공합니다.
