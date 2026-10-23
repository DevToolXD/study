---
name: quiz
description: 책·교재 사진으로 OX 퀴즈를 만들어 공부 앱의 data/library.json 에 직접 넣고 push 한다. 사용자가 사진 경로와 함께 "퀴즈 만들어줘", "문제 만들어줘", "OX 만들어줘", "/quiz 수학 3단원 사진..." 처럼 요청하면 사용한다.
argument-hint: <과목> <시험·단원 이름> <사진 경로 또는 폴더...>
---

# 책 사진 → OX 퀴즈 → 앱 (직접 연결)

앱(`index.html`)은 열릴 때마다 `data/library.json` 을 읽어 문제를 자동으로 가져온다.
그래서 **프롬프트를 복사하거나 JSON을 붙여넣을 일이 없다.** 이 파일을 바꾸고 push 하면 끝이다.

요청: `$ARGUMENTS`

## 입력

- 형식: `<과목> <시험·단원 이름> <사진 경로...>`. 경로는 파일이거나 폴더다.
- 경로가 없으면 `inbox/` 폴더의 이미지(jpg, jpeg, png, webp, heic)를 쓴다.
- 과목이나 시험·단원 이름이 빠졌을 때만 짧게 한 번 묻는다. 이미 있으면 묻지 않는다.
- 문제 수: 사진 한 장에 6~8개, 전체 최대 40개. 사용자가 개수나 난이도를 말하면 그대로 따른다.

## 절차

1. 사진을 하나씩 Read 도구로 연다. 이미지를 직접 읽을 수 있다.
   - HEIC 는 `sips -s format jpeg 입력.heic --out /tmp/p.jpg`(macOS)로 바꿔서 읽는다.
   - 너무 커서 안 열리면 `sips -Z 1800 입력.jpg --out /tmp/p.jpg` 로 줄인다.
   - 흐리거나 잘려서 못 읽는 부분은 건너뛰고, 그 사실을 마지막에 알린다.
2. 사진에 **실제로 적힌 내용만** 근거로 쓴다. 추측하거나 책에 없는 지식을 넣지 않는다.
3. 아래 "문제 작성 규칙"대로 OX 문제를 만든다.
4. 저장소 루트에서 stdin 으로 넘긴다. (루트가 아니면 `cd` 한다.)

   ```bash
   node tools/quiz.mjs add --subject "수학" --exam "3단원 함수" --source "교과서 p.52-58" <<'JSON'
   [
     {"type":"ox","question":"y = 2x는 정비례 관계이다.","answer":true,"explanation":"x가 2배가 되면 y도 2배가 돼요.","page":52}
   ]
   JSON
   ```

   스크립트가 중복(같은 문장)을 걸러내고, 형식이 틀린 문제는 이유와 함께 건너뛴다. 다시 실행해도 안전하다.
5. `node tools/quiz.mjs validate` 가 "정상"인지 확인한다.
6. 저장하고 올린다. 현재 브랜치가 앱이 배포되는 브랜치(`master`)인지 `git branch --show-current` 로 확인한다.

   ```bash
   git add data/library.json
   git commit -m "quiz: 수학 3단원 함수 +8"
   git pull --rebase && git push
   ```

   push 가 거절되면 `git pull --rebase` 후 다시 시도한다. `library.json` 이 충돌하면 상대 파일을 받은 뒤 같은 `add` 명령을 다시 실행한다.
7. 한 줄로 알린다: 추가 N · 중복 M · 건너뜀 K, 이 시험의 전체 문제 수, 못 읽은 부분이 있으면 그 내용.
   마지막에 "GitHub Pages 반영까지 1~2분, 그 뒤 앱을 열면 자동으로 들어와요"라고 덧붙인다.
8. `inbox/` 에서 가져온 사진은 `inbox/done/` 으로 옮긴다. (`inbox/` 는 git 에 올라가지 않는다.)

## 문제 JSON

```json
{ "type": "ox", "question": "문장", "answer": true, "explanation": "해설 한 문장", "page": 52 }
```

- `type`: 지금은 `ox` 만 된다. 앱이 객관식·주관식을 지원하기 전에는 만들지 않는다(스크립트가 거부한다).
- `answer`: `true`(O) 또는 `false`(X).
- `question`: 4~400자. `explanation`: 300자 이하. `page` 는 있을 때만.

## 문제 작성 규칙

- 한 문장에 사실 하나. 앞뒤 문맥 없이도 읽히게 쓴다.
- O 와 X 가 비슷한 비율(40~60%)이 되게 한다.
- X 문장은 책의 문장에서 숫자, 주체, 인과, 정의 중 하나를 살짝 바꿔 그럴듯하게 만든다.
  "항상", "절대", "모든" 같은 말만 붙여서 틀리게 만들지 않는다.
- 해설은 한 문장으로, 근거가 되는 책 내용을 적는다. 쪽수를 알면 `page` 에 넣는다.
- 표나 그림은 문장으로 풀어서 묻는다. 사진 속 글자를 그대로 베끼지 않는다.
- 같은 내용을 표현만 바꿔 반복하지 않는다.
- 한국어로 쓴다. 영어 교재면 영어 문장에 한국어 해설을 붙여도 된다.

## 이름과 모양

- 과목 이름은 앱에서 만든 과목과 **공백·대소문자를 무시하고 같은 이름이면 같은 과목**으로 합쳐진다. 앱에 있는 이름 그대로 쓴다.
- 새 과목이면 이름으로 아이콘을 고르고 색은 자동이다. 바꾸려면 `--icon`(book type calc flask atom leaf globe columns hourglass code music palette pencil bulb ball chart star compass), `--color`(blue green orange pink purple teal).

## 다른 명령

```bash
node tools/quiz.mjs list                                  # 과목·시험·문제 수
node tools/quiz.mjs remove --subject 수학 --exam "3단원"   # 시험 삭제
node tools/quiz.mjs remove --subject 수학 --exam "3단원" --question "정비례"   # 문제 하나 삭제
```
