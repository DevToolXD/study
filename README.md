# 공부방

OX 퀴즈를 푸는 공부 앱. Safari에서 **홈 화면에 추가**해서 쓰는 PWA이고, 책 사진으로 문제를 만드는 일은 **Claude CLI가 앱에 직접** 한다.

```
책 사진 ── Claude CLI(/quiz) ──▶ data/library.json ──push──▶ GitHub Pages ──▶ 앱이 열릴 때 자동으로 가져옴
```

복사나 붙여넣기는 없다. 문제는 저장소의 `data/library.json` 한 파일로만 오간다.

## 1. 앱 쓰기

1. 이 저장소의 GitHub Pages 주소를 Safari로 연다. (Settings → Pages → Branch `master`, `/ (root)`)
2. 공유 버튼 → **홈 화면에 추가**.
3. 과목은 앱에서 직접 만든다. 시험·단원 안에 문제를 직접 써도 되고, 아래처럼 CLI로 넣어도 된다.

앱은 켤 때마다(그리고 홈 화면 앱으로 돌아올 때마다) 새 버전과 새 문제를 확인한다. 바뀐 게 있으면 알아서 새로고침하고,
퀴즈를 푸는 중이면 끝난 뒤에 적용한다.

## 2. 사진으로 문제 만들기 (Claude CLI)

저장소를 내려받아 그 폴더에서 Claude CLI를 연다. Node.js(18 이상)와 git push 권한이 필요하다.

```bash
git clone https://github.com/DevToolXD/study && cd study
claude
```

```
/quiz 수학 3단원 ~/Desktop/교과서52.jpg ~/Desktop/교과서53.jpg
```

- 사진 경로 대신 `inbox/` 폴더에 사진을 넣어 두고 `/quiz 수학 3단원` 만 써도 된다.
- Claude가 사진을 읽고 OX 문제를 만들어 `node tools/quiz.mjs` 로 `data/library.json` 에 넣고, commit과 push까지 한다.
- 1~2분 뒤(Pages 반영) 앱을 열면 문제가 들어와 있다. 과목은 **이름이 같으면** 앱에서 만든 과목에 합쳐진다.
- `/quiz` 없이 "이 사진으로 퀴즈 만들어줘"라고 해도 된다. `CLAUDE.md` 와 `.claude/skills/quiz` 가 방법을 알려 준다.

스크립트를 직접 쓸 수도 있다.

```bash
node tools/quiz.mjs add --subject "수학" --exam "3단원" < questions.json
node tools/quiz.mjs list
node tools/quiz.mjs remove --subject "수학" --exam "3단원" --question "정비례"
node tools/quiz.mjs validate
```

지금 앱은 **OX만** 푼다. 객관식과 주관식은 앱에 들어오면 스크립트도 함께 열린다.

## 3. 화면

- 좁은 화면(세로 폰)은 아래 탭바, 640px 이상(가로 폰, 태블릿)은 옆으로 옮겨진 세로 바(iPhone Duo처럼), 1000px 이상은 사이드바와 힌지 선이 있는 두 영역 레이아웃이다.
- 글래스는 떠 있는 컨트롤(툴바, 탭바, 시트, 메뉴)에만 쓰고, 내용은 평평하게 둔다. 규칙은 [liquid-glass-skill](https://github.com/heyparsadev/liquid-glass-skill)을 따른다.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html`, `styles.css`, `app.js`, `icons.js` | 앱 전부. 빌드 없음 |
| `sw.js`, `manifest.webmanifest`, `icons/` | 홈 화면 앱, 오프라인, 자동 업데이트 |
| `data/library.json` | CLI가 쓰고 앱이 읽는 문제 파일 |
| `tools/quiz.mjs` | 문제 검증, 중복 제거, 병합 |
| `.claude/skills/quiz`, `CLAUDE.md` | Claude CLI가 따르는 절차 |
