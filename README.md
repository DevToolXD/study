# 공부방

책 사진으로 만든 문제를 푸는 공부 앱. Safari에서 **홈 화면에 추가**해서 쓰는 PWA이고,
문제는 **Claude CLI가 앱에 직접** 넣는다. 앱에서 문제를 하나하나 쓸 일은 없다.

```
책 사진 ── Claude CLI(/quiz) ──> data/library.json ──push──> GitHub Pages ──> 앱이 열릴 때 자동으로 가져옴
```

복사나 붙여넣기는 없다. 문제는 저장소의 `data/library.json` 한 파일로만 오간다.
CLI는 Claude Pro로 로그인한 Claude Code라서 **API 키도 API 비용도 없다.** 앱도 AI를 부르지 않는다.

## 1. 앱 쓰기

1. 이 저장소의 GitHub Pages 주소를 Safari로 연다. (Settings → Pages → Branch `master`, `/ (root)`)
2. 공유 버튼 → **홈 화면에 추가**.
3. 앱에서는 **과목과 시험·단원 이름만** 만든다. 문제는 아래처럼 사진으로 채운다.

앱은 켤 때마다(그리고 홈 화면 앱으로 돌아올 때마다) 새 버전과 새 문제를 확인한다. 바뀐 게 있으면 알아서 새로고침하고,
퀴즈를 푸는 중이면 끝난 뒤에 적용한다. 바로 확인하고 싶을 때만 설정의 **동기화** 버튼을 쓴다.

## 2. 사진으로 문제 만들기

저장소를 내려받아 그 폴더에서 Claude CLI를 연다. Node.js(18 이상)와 git push 권한이 필요하다.

```bash
git clone https://github.com/DevToolXD/study && cd study
claude
```

```
/quiz 수학 3단원 ~/Desktop/교과서52.jpg ~/Desktop/교과서53.jpg
```

사진 경로 대신 `inbox/` 폴더에 사진을 넣어 두고 `/quiz 수학 3단원` 만 써도 된다.
Claude가 사진을 읽고 **기본 150개**를 만들어 `data/library.json` 에 넣고 commit과 push까지 한다.
1~2분 뒤(Pages 반영) 앱을 열면 들어와 있다. 과목과 시험은 **이름이 같으면** 앱에서 만든 것에 합쳐진다.

과목 성격에 맞춰 만든다.

| 과목 | 만드는 것 | 앱에서 푸는 방식 |
|---|---|---|
| 영어·일본어 등 단어 | 사진에 있는 단어 전부 | 뜻 고르기, 단어 고르기, 직접 쓰기를 순서대로 |
| 수학 | 같거나 비슷한 유형의 문제를 숫자와 상황을 바꿔 | 직접 쓰기(주관식)와 객관식 |
| 사회·역사·과학 등 | OX, 객관식, 주관식 퀴즈 | OX 버튼, 보기 고르기, 직접 쓰기 |

모든 문제에는 **유형(topic)** 이 붙는다.

## 3. 앱이 문제를 내는 방식

- **많이 틀린 유형은 더 자주**, 잘 맞히는 유형은 덜 나온다. 시험 화면의 **유형** 탭에서 유형별 정답률과 다음 연습의 출제 비중을 볼 수 있다.
- 한 문제를 **6번** 풀고 마지막에 맞히면 **정복**으로 빠진다. 단어는 2번씩 방식을 바꿔 가며 6번이다.
- 남은 문제가 적어지면 시험 화면이 새 문제를 받을 때라고 알려 준다. 그때 `/quiz 리프레시 수학 3단원` 으로 새 150개를 받는다.
  기존 문제는 지우지 않고, 기기에서 정복한 것은 앱이 알아서 뺀다.
- 한 번에 푸는 문제 수(10·20·30·50)는 설정에서 바꾼다.

스크립트를 직접 쓸 수도 있다.

```bash
node tools/quiz.mjs add --subject "수학" --exam "3단원" --kind math --target 150 < questions.json
node tools/quiz.mjs list --topics
node tools/quiz.mjs remove --subject "수학" --exam "3단원" --question "기울기"
node tools/quiz.mjs validate
```

## 4. 화면

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
