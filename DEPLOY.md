# 웹 배포 + 구글 로그인 + 회원 권한 (Supabase)

이 문서대로 하면 **인터넷에 올려 여러 사람이 각자 구글 계정으로 로그인해 함께 편집**할 수 있습니다.
권한은 브라우저가 아니라 **서버(Postgres RLS)** 에서 강제되므로, 개발자도구로 코드를 고쳐도 뚫리지 않습니다.

> claude.ai Artifact 링크에서는 외부 도메인 접속이 차단되어 로그인이 동작하지 않습니다.
> Artifact 링크는 "샘플·프리뷰"로 두고, 실제 운영은 아래 배포본으로 하세요.

## 권한 표

| 역할 | 열람 | 편집·삭제 | CSV·JSON 다운로드 | 저장 | 회원 권한 지정 |
| --- | --- | --- | --- | --- | --- |
| **서버관리자** | O | O | O | O | O (양도 포함) |
| **운영자** | O | O | O | O | X |
| **일반회원** | O | X | X | X | X |

- 최초 서버관리자: **dynn1178@gmail.com** (스키마에 박혀 있음. 이 계정으로 로그인하면 자동 지정되고, 스키마 실행 전에 이미 가입했더라도 실행 시점에 승격됩니다)
- 그 외에는 로그인하면 자동으로 **일반회원**이 되고, 서버관리자가 운영자로 올려 줍니다.
- 양도: 상대를 **서버관리자**로 올린 뒤 본인을 **운영자**로 내립니다. 마지막 서버관리자는 DB 트리거가 강등을 막습니다.

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에서 무료 프로젝트 생성 (리전은 아시아 권장)
2. 좌측 **SQL Editor** → `supabase/schema.sql` 내용을 통째로 붙여넣고 **Run**
   - `jta_members`(회원·역할), `jta_docs`(보드 JSON), `jta-images` 스토리지 버킷, RLS 정책, 트리거가 생성됩니다.
   - 만드는 것 전부 `jta_` 접두사라 프로젝트에 이미 있는 `profiles`·`docs` 같은 것과 겹치지 않습니다.
   - 스토리지 정책 생성에서 권한 오류가 나면(드묾) Storage → `jta-images` → Policies 에서 같은 조건을 UI로 넣으면 됩니다.

## 2. 구글 로그인 켜기

1. Google Cloud Console → **API 및 서비스 → 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션)**
2. **승인된 리디렉션 URI** 에 아래를 추가
   ```
   https://<프로젝트ID>.supabase.co/auth/v1/callback
   ```
3. 발급된 **클라이언트 ID / 시크릿** 을 Supabase → **Authentication → Providers → Google** 에 입력하고 Enable
4. Supabase → **Authentication → URL Configuration**
   - **Site URL**: 배포할 주소 (예: `https://journey.mycompany.com`)
   - **Redirect URLs**: 같은 주소 추가 (로컬 테스트용 `http://localhost:5173` 등도 함께)

## 3. 앱에 연결 정보 넣기

방문자가 매번 설정하지 않도록 **파일에 박아서 배포**하는 방식을 권장합니다.

`parts/13-auth.js` 상단을 수정하고 다시 빌드하세요.

```js
const SUPA_DEFAULT = {
  url:  "https://<프로젝트ID>.supabase.co",
  anon: "<anon public key>",
  bucket: "jta-images",
  docId: "main"
};
```

`anon key`는 공개되어도 되는 값입니다(권한은 RLS가 판단). **service_role 키는 절대 넣지 마세요.**

빌드:

```sh
./build.sh          # Windows: sh build.sh  또는 Git Bash
```

두 파일이 만들어집니다.

| 파일 | 용도 |
| --- | --- |
| `index.html` | **웹 배포용** — `<!doctype>` · `<meta charset="utf-8">` 까지 포함된 온전한 문서 |
| `journey-atlas.html` | claude.ai Artifact 배포용 (플랫폼이 doctype/head/body를 감쌈) |

`index.html`을 **반드시 커밋**하세요. 이 파일이 없으면 배포 후 `/` 에서 404가 납니다.

임시로 시험만 해 볼 때는 앱 우상단 **폴더 아이콘 → 서버(Supabase)** 에서 URL·anon key를 넣어도 됩니다(그 브라우저에만 저장됨).

## 4. 정적 호스팅에 올리기

`journey-atlas.html` 파일 하나만 올리면 됩니다. 빌드 도구·서버 코드가 필요 없습니다.

`index.html` 하나만 있으면 됩니다. 빌드 도구·서버 코드가 필요 없습니다.

| 방법 | 설정 |
| --- | --- |
| **Vercel** | 저장소 연결 → **Framework Preset `Other`**, **Build Command 비움**, **Output Directory 비움**(루트 그대로) → Deploy |
| **Netlify** | 폴더 드래그&드롭, 또는 저장소 연결 후 Build command 비움 · Publish directory `.` |
| **GitHub Pages** | Settings → Pages → 브랜치 `main` / 폴더 `/ (root)` |
| **사내 웹서버** | `index.html` 복사 (`Content-Type: text/html; charset=utf-8` 권장) |

배포 주소를 2-4의 **Site URL / Redirect URLs** 에 반드시 넣어야 로그인 후 되돌아옵니다.

### 배포했는데 `404: NOT_FOUND` 가 뜬다면

거의 항상 **루트에 `index.html` 이 없어서** 입니다.

1. `./build.sh` 를 실행해 `index.html` 이 만들어졌는지 확인
2. `git add index.html && git commit && git push` — 커밋에 포함됐는지 확인
3. Vercel 프로젝트 설정에서 **Build Command 가 비어 있고 Output Directory 가 비어 있는지** 확인
   (프레임워크 프리셋이 잡혀 있으면 빌드 산출물 폴더를 찾다가 아무것도 못 찾습니다)
4. Vercel → Deployments → 해당 배포 → **Source** 탭에서 `index.html` 이 실제로 올라갔는지 확인
5. 그래도 404면 `vercel.json` 이 저장소에 있는지 확인(이 저장소에 포함돼 있습니다)

저장소에는 배포에 불필요한 파일을 빼는 `.vercelignore`(`parts/`, `supabase/`, `*.md`)와
캐시 설정용 `vercel.json` 이 함께 들어 있습니다.

### 로그인했는데 다시 로그인 화면으로 돌아온다면

Supabase → Authentication → **URL Configuration** 의 Site URL / Redirect URLs 에
배포 주소가 **정확히**(끝 슬래시 포함 여부까지) 들어 있는지 확인하세요.
앱은 `https://도메인/경로` 형태로 되돌아옵니다.

## 5. 첫 사용

1. 배포 주소 접속 → 우상단 **구글로 로그인**
2. `dynn1178@gmail.com` 으로 로그인 → 자동으로 **서버관리자**
3. 팀원에게 주소를 알려 주고 각자 로그인 → **회원 · 권한 관리** 에서 필요한 사람을 **운영자** 로 변경
4. 편집 후 **서버 저장**(Ctrl+S). 다른 사람은 새로고침하면 최신본이 보입니다.
   동시에 저장하면 나중 저장이 거절되고 안내가 뜹니다(먼저 새로고침 후 다시 저장).

## 데이터가 어디에 저장되나

| 대상 | 위치 |
| --- | --- |
| 보드·태그·캠페인 | `public.jta_docs` 테이블의 `data` (JSONB) |
| 화면 이미지 | `jta-images` 스토리지 버킷(비공개). 열람 시 7일짜리 서명 URL로 내려받음 |
| 회원·역할 | `public.jta_members` |
| 편집 중 임시본 | 각자 브라우저 IndexedDB (저장 전 새로고침해도 남음) |

## 알아둘 한계

- **일반회원의 다운로드 차단은 화면 수준**입니다. 열람이 허용된 이상 데이터는 그 사람 브라우저까지 내려가므로, 개발자도구를 쓰면 내용 자체는 복사할 수 있습니다. 진짜로 못 보게 하려면 애초에 열람 권한을 주지 않아야 합니다(로그인 안 한 사람은 RLS가 `jta_docs` 조회를 막습니다).
- 저장은 문서 전체를 덮어쓰는 방식이라, 같은 순간에 두 사람이 저장하면 **나중 저장이 거절**됩니다(먼저 새로고침 필요). 실시간 동시 편집은 아닙니다.
- 이미지가 많아지면 Supabase 무료 티어 용량(1GB)을 확인하세요. 업로드 시 1200px·WebP로 줄여 저장하므로 보통 화면 한 장에 50~150KB입니다.
