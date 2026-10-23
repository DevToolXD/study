# 공부방 (study)

OX 퀴즈를 푸는 공부 앱. 홈 화면에 추가해서 쓰는 PWA이고, 빌드 없이 정적 파일만 있다
(`index.html`, `styles.css`, `app.js`, `icons.js`, `sw.js`). GitHub Pages(`master`)로 배포한다.

## 책 사진 → 퀴즈 (Claude CLI 직접 연결)

- 사진으로 문제를 만들어 달라는 요청은 `/quiz` 스킬(`.claude/skills/quiz/SKILL.md`)대로 처리한다.
- 문제 데이터는 `data/library.json` 하나다. 손으로 고치지 말고 `node tools/quiz.mjs ...` 로만 바꾼다.
- 앱은 열릴 때마다 이 파일을 읽어 과목(이름 기준)과 시험에 합친다. 푼 기록은 기기에 따로 저장된다.

## 코드 규칙

- 화면 문구는 한국어 해요체. **이모지를 쓰지 않는다.** 아이콘은 `icons.js` 의 SVG 를 쓴다.
- 글래스는 떠 있는 컨트롤(툴바, 탭바, 시트, 메뉴)에만 쓴다. 콘텐츠는 flat 하게 두고, 글래스 위 글자는 `var(--text)`.
  자세한 규칙은 `liquid-glass-skill` 을 따른다.
- 사용자가 만든 글자는 항상 `textContent` 로 넣는다(`h()` 의 `text` 나 자식 문자열).
- 확대와 길게 눌러 선택하는 걸 막는 것(`user-select: none`, gesture 이벤트)은 의도다. 입력창만 예외다.
- 앱 파일을 바꿔도 `sw.js` 는 건드릴 필요가 없다(네트워크 우선). 앱이 다시 열릴 때 파일 지문이 달라졌으면 자동으로 새로고침한다.
