# JotDeRo Quiz 설치 가이드

## Windows에 설치하기

### 1. Node.js 설치 (아직 설치 안 했다면)

1. https://nodejs.org 접속
2. LTS 버전 다운로드 및 설치

### 2. 프로젝트 파일 준비

이 폴더를 `C:\JotDeRoQuiz`에 복사하세요.

### 3. 의존성 설치

명령 프롬프트(CMD) 또는 PowerShell을 열고:

```cmd
cd C:\JotDeRoQuiz
npm install
```

### 4. 서버 실행

```cmd
npm start
```

서버가 실행되면 브라우저에서 `http://localhost:3000` 접속!

## 인터넷에서 접속 가능하게 만들기 (Render 배포)

### 방법 1: Render (무료, 추천)

1. GitHub 계정 만들기 (https://github.com)
2. 새 저장소 생성
3. 이 폴더의 모든 파일을 GitHub에 업로드:
   ```cmd
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/your-username/jotderoquiz.git
   git push -u origin main
   ```
4. Render 계정 만들기 (https://render.com)
5. New > Web Service 선택
6. GitHub 저장소 연결
7. 설정:
   - Build Command: `npm install`
   - Start Command: `npm start`
8. Create Web Service 클릭!

배포 완료 후 `https://your-app.onrender.com` 같은 주소로 접속 가능!

### 방법 2: Glitch (가장 쉬움)

1. https://glitch.com 접속
2. New Project > Import from GitHub
3. 저장소 URL 입력
4. 자동으로 배포됨!

### 방법 3: Railway (무료 + 빠름)

1. https://railway.app 접속
2. New Project > Deploy from GitHub repo
3. 저장소 선택
4. 자동 배포!

## 로컬 네트워크에서 접속 가능하게 하기

같은 Wi-Fi 네트워크의 다른 기기에서 접속하려면:

1. 내 IP 주소 확인:
   ```cmd
   ipconfig
   ```
   - IPv4 주소 찾기 (예: 192.168.0.10)

2. 서버 실행 후 다른 기기에서:
   ```
   http://192.168.0.10:3000
   ```

## 포트 변경하기

기본 포트 3000 대신 다른 포트 사용하려면:

Windows:
```cmd
set PORT=8080
npm start
```

Linux/Mac:
```bash
PORT=8080 npm start
```

## 문제 해결

### "npm을 찾을 수 없습니다" 오류
→ Node.js를 설치했는지 확인. CMD 재시작 필요할 수 있음

### 포트 3000이 이미 사용 중
→ 다른 프로그램이 포트를 사용 중. 위 "포트 변경하기" 참고

### Socket.IO 연결 실패
→ 방화벽 설정 확인. 포트 허용 필요할 수 있음

## 질문 추가/변경하기

`questions.json` 파일을 텍스트 에디터로 열어서 수정:

```json
{
  "id": 16,
  "question": "방송인이 가장 좋아하는 게임은?",
  "options": ["리그오브레전드", "오버워치", "발로란트", "배틀그라운드"]
}
```

- 질문은 방송인의 주관적 의견을 묻는 것이 재미있음
- 정답이 정해져 있지 않은 질문이 좋음
- 당황스러운 질문일수록 재미있음!

## 방송 활용 팁

1. **OBS 설정**: 브라우저 소스로 게임 화면 추가
2. **시청자 참여**: 채팅에 방 코드 공유
3. **디스코드/카톡**: 음성 채팅 병행하면 더 재미있음
4. **테마 정하기**: "오늘은 음식 주제!", "MBTI 특집" 등

즐거운 방송 되세요! 🎮🎉
