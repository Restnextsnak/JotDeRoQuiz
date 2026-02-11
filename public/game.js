const socket = io();

const roomId = localStorage.getItem('roomId');
const myRole = localStorage.getItem('role');

if (!roomId || !myRole) {
    window.location.href = '/';
}

let gameState = {
    myId: null,
    players: [],
    phase: 'waiting',
    round: 1,
    currentQuestion: null,
    currentOptions: [],
    myAnswer: null,
    currentChatPlayer: null,
    hostId: null,
    correctAnswer: null   // 방장이 고른 정답 인덱스
};

// 채팅 기록: playerId -> [{senderId, senderName, message}]
const chatHistory = new Map();

// DOM 요소
const roomCodeEl      = document.getElementById('roomCode');
const roundInfoEl     = document.getElementById('roundInfo');
const phaseInfoEl     = document.getElementById('phaseInfo');
const hostCardEl      = document.getElementById('hostCard');
const hostControlsEl  = document.getElementById('hostControls');
const playersAreaEl   = document.getElementById('playersArea');
const questionTextEl  = document.getElementById('questionText');
const optionsAreaEl   = document.getElementById('optionsArea');
const timerTextEl     = document.getElementById('timerText');
const chatMessagesEl  = document.getElementById('chatMessages');
const chatInputAreaEl = document.getElementById('chatInputArea');
const chatInputEl     = document.getElementById('chatInput');
const chatPlayerNameEl= document.getElementById('chatPlayerName');
const excuseAreaEl    = document.getElementById('excuseArea');
const startGameBtn    = document.getElementById('startGameBtn');
const nextRoundBtn    = document.getElementById('nextRoundBtn');
const sendChatBtn     = document.getElementById('sendChatBtn');

roomCodeEl.textContent = `방 코드: ${roomId}`;

// ── 소켓 연결 ──────────────────────────────────────────────

socket.on('connect', () => {
    gameState.myId = socket.id;
    const playerName = localStorage.getItem('playerName');
    socket.emit('rejoin_room', { roomId, name: playerName, role: myRole });
});

// 방 상태 업데이트
socket.on('room_state', (state) => {
    // 서버에서 받은 players에는 rescued 필드가 포함됨 — 그대로 사용
    gameState.players          = state.players;
    gameState.phase            = state.phase;
    gameState.round            = state.round;
    gameState.currentChatPlayer= state.currentChatPlayer;
    gameState.hostId           = state.hostId;
    updateUI();
});

// 라운드 시작
socket.on('round_started', (data) => {
    gameState.round          = data.round;
    gameState.phase          = data.phase;
    gameState.currentOptions = data.options;
    gameState.myAnswer       = null;
    gameState.correctAnswer  = null;

    // 로컬 플레이어 상태 즉시 초기화 (room_state 도착 전 UI가 깨끗하게 보이도록)
    gameState.players.forEach(p => {
        p.answer  = null;
        p.excuse  = '';
        p.likes   = 0;
        p.rescued = false;
    });

    roundInfoEl.textContent  = `라운드: ${data.round}`;
    phaseInfoEl.textContent  = '선택 중';
    questionTextEl.textContent = myRole === 'host' ? '플레이어들이 선택 중...' : '???';

    // 변명 입력창 초기화
    excuseAreaEl.style.display = 'none';
    excuseAreaEl.innerHTML     = '';

    updateUI();
    renderOptions(data.options);
    startTimer(10);
});

// 모두 답변 완료 → 문제 공개
socket.on('all_answered', (data) => {
    gameState.phase          = data.phase;
    gameState.currentQuestion = data.question;

    phaseInfoEl.textContent  = myRole === 'host' ? '정답 선택 (방장)' : '문제 공개';
    questionTextEl.textContent = data.question;
    stopTimer();

    if (myRole === 'host') {
        enableOptionsForHost();
    } else {
        disableOptions();
    }
});

// 정답 공개
socket.on('answer_revealed', (data) => {
    gameState.phase         = data.phase;
    gameState.correctAnswer = data.correctAnswer;
    phaseInfoEl.textContent = '변명 시간';

    highlightCorrectAnswer(data.correctAnswer);
    disableOptions();

    // 1) 방장: nextRoundBtn 표시 (정답 선택 완료 시점)
    if (myRole === 'host') {
        startGameBtn.style.display  = 'none';
        nextRoundBtn.style.display  = 'block';
    }

    // 2) 오답자 플레이어: 변명 입력창 표시
    const me = gameState.players.find(p => p.id === gameState.myId);
    if (me && me.answer !== data.correctAnswer && !me.eliminated && myRole === 'player') {
        showExcuseInput();
    }

    startTimer(10);
});

// 채팅 시작
socket.on('chat_started', (data) => {
    gameState.currentChatPlayer = data.playerId;
    showChatPanel(data.playerId, data.playerName);
});

// 채팅 메시지 수신
socket.on('chat_message', (data) => {
    // 기록 저장
    const pid = gameState.currentChatPlayer;
    if (!chatHistory.has(pid)) chatHistory.set(pid, []);
    chatHistory.get(pid).push(data);

    appendChatMessage(data);
});

// 플레이어 구제 (room_state가 먼저 도착해 gameState.players가 이미 갱신된 상태)
socket.on('player_rescued', (data) => {
    showNotification(`${data.playerName}님이 구제되었습니다!`, 'success');
    closeChatPanel();
    // room_state로 이미 rescued:true 가 반영됐으므로 updateUI만 호출
    updateUI();
});

// 플레이어 탈락
socket.on('player_eliminated', (data) => {
    showNotification(`${data.playerName}님이 탈락했습니다!`, 'error');
    closeChatPanel();
    // room_state로 이미 eliminated:true 가 반영됐으므로 updateUI만 호출
    updateUI();
});

// 게임 종료
socket.on('game_finished', (data) => {
    stopTimer();
    gameState.phase         = 'finished';
    gameState.correctAnswer = null;
    phaseInfoEl.textContent = '게임 종료';

    // 변명 입력창 숨기기
    excuseAreaEl.style.display = 'none';
    excuseAreaEl.innerHTML     = '';

    if (data.winner) {
        questionTextEl.textContent = `🎉 우승: ${data.winner.name} 🎉`;
        showNotification(`🎉 ${data.winner.name}님이 우승했습니다! 🎉`, 'success');
    } else {
        questionTextEl.textContent = '게임 종료';
        showNotification('게임이 종료되었습니다', 'info');
    }

    if (myRole === 'host') {
        startGameBtn.style.display = 'block';
        nextRoundBtn.style.display = 'none';
    }

    updateUI();
});

socket.on('host_left', () => {
    alert('방장이 나갔습니다. 로비로 돌아갑니다.');
    window.location.href = '/';
});

// ── UI 업데이트 ────────────────────────────────────────────

function updateUI() {
    // 방장 카드
    const host = gameState.players.find(p => p.id === gameState.hostId);
    if (host) {
        let html = `<div class="player-name">👑 ${host.name} (방장)</div>`;
        if (host.excuse) {
            const canLike = myRole !== 'spectator' &&
                (gameState.phase === 'excuse' || gameState.phase === 'chat');
            html += buildExcuseHtml(host, canLike);
        }
        hostCardEl.innerHTML = html;
    }

    // 방장 컨트롤
    if (myRole === 'host') {
        hostControlsEl.style.display = 'flex';
        if (gameState.phase === 'waiting' || gameState.phase === 'finished') {
            startGameBtn.style.display = 'block';
            nextRoundBtn.style.display = 'none';
        } else if (gameState.phase === 'excuse' || gameState.phase === 'chat') {
            // answer_revealed 이후에만 nextRound 보임 (correctAnswer가 세팅된 경우)
            startGameBtn.style.display = 'none';
            nextRoundBtn.style.display = gameState.correctAnswer !== null ? 'block' : 'none';
        } else {
            startGameBtn.style.display = 'none';
            nextRoundBtn.style.display = 'none';
        }
    }

    // 플레이어 목록
    playersAreaEl.innerHTML = '';
    gameState.players
        .filter(p => p.id !== gameState.hostId)
        .forEach(player => playersAreaEl.appendChild(createPlayerCard(player)));
}

function buildExcuseHtml(player, canLike) {
    const likeBtn = canLike
        ? `<button class="like-button" onclick="likeExcuse('${player.id}')">❤️ <span>${player.likes || 0}</span></button>`
        : `<span class="like-count-display">❤️ ${player.likes || 0}</span>`;
    return `<div class="excuse-text"><span class="excuse-body">${player.excuse}</span>${likeBtn}</div>`;
}

function createPlayerCard(player) {
    const card = document.createElement('div');
    card.className = `player-card ${player.eliminated ? 'eliminated' : ''}`;
    card.id = `player-${player.id}`;

    let html = `<div class="player-name">${player.name}</div>`;
    html += `<div class="player-info"><div class="player-status">`;

    if (player.role === 'spectator') {
        html += `<span class="status-badge">관전</span>`;
    } else if (player.eliminated) {
        html += `<span class="status-badge">탈락</span>`;
    } else if (player.answer !== null && gameState.phase === 'selecting') {
        html += `<span class="status-badge answered">답변 완료</span>`;
    }
    html += `</div></div>`;

    if (player.excuse) {
        const canLike = myRole !== 'spectator' &&
            (gameState.phase === 'excuse' || gameState.phase === 'chat') &&
            !player.eliminated;
        html += buildExcuseHtml(player, canLike);
    }

    // 방장 전용 액션 버튼: 변명/채팅 단계, 미탈락, 미구제 오답자만
    if (myRole === 'host' &&
        (gameState.phase === 'excuse' || gameState.phase === 'chat') &&
        !player.eliminated &&
        !player.rescued &&
        player.role === 'player' &&
        player.answer !== null) {
        // 정답자에게는 버튼 표시 안 함 (정답자는 rescue 불필요)
        // correctAnswer가 아직 null이면 (변명 단계 시작 직후) 오답자 모두 표시
        const isCorrect = gameState.correctAnswer !== null && player.answer === gameState.correctAnswer;
        if (!isCorrect) {
            html += `
                <div class="player-actions" id="actions-${player.id}">
                    <button class="btn-chat" onclick="startChat('${player.id}')">대화하기</button>
                    <button class="btn-eliminate" onclick="eliminatePlayer('${player.id}')">즉시 탈락</button>
                </div>`;
        }
    }

    card.innerHTML = html;
    return card;
}

// ── 선택지 렌더링 ──────────────────────────────────────────

function renderOptions(options) {
    optionsAreaEl.innerHTML = '';
    options.forEach((option, index) => {
        const btn = document.createElement('button');
        btn.className    = 'option-button';
        btn.textContent  = `${index + 1}. ${option}`;
        btn.dataset.index = index;

        if (myRole === 'host' || myRole === 'spectator') btn.disabled = true;
        if (gameState.myAnswer !== null) {
            btn.disabled = true;
            if (gameState.myAnswer === index) btn.classList.add('selected');
        }

        btn.addEventListener('click', () => selectOption(index));
        optionsAreaEl.appendChild(btn);
    });
}

function enableOptionsForHost() {
    optionsAreaEl.querySelectorAll('.option-button').forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('selected');
    });
}

function selectOption(index) {
    if (myRole !== 'player' || gameState.myAnswer !== null || gameState.phase !== 'selecting') return;

    gameState.myAnswer = index;
    socket.emit('submit_answer', { roomId, answerIndex: index });

    optionsAreaEl.querySelectorAll('.option-button').forEach((btn, i) => {
        btn.disabled = true;
        if (i === index) btn.classList.add('selected');
    });
}

function disableOptions() {
    optionsAreaEl.querySelectorAll('.option-button').forEach(btn => btn.disabled = true);
}

function highlightCorrectAnswer(correctIndex) {
    const btns = optionsAreaEl.querySelectorAll('.option-button');
    if (btns[correctIndex]) btns[correctIndex].classList.add('correct');
}

// ── 방장 정답 선택 클릭 처리 ──────────────────────────────

optionsAreaEl.addEventListener('click', (e) => {
    if (myRole !== 'host' || gameState.phase !== 'question_reveal') return;
    if (!e.target.classList.contains('option-button')) return;

    const buttons = Array.from(optionsAreaEl.querySelectorAll('.option-button'));
    const index   = buttons.indexOf(e.target);
    if (index !== -1) socket.emit('select_correct_answer', { roomId, answerIndex: index });
});

// ── 변명 입력창 ────────────────────────────────────────────

function showExcuseInput() {
    excuseAreaEl.innerHTML = '';
    excuseAreaEl.style.display = 'flex';

    const input    = document.createElement('input');
    input.type     = 'text';
    input.className= 'excuse-input';
    input.placeholder = '변명을 입력하세요 (20자 이내)';
    input.maxLength   = 20;

    const btn     = document.createElement('button');
    btn.textContent   = '제출';
    btn.className     = 'excuse-submit-btn';

    const doSubmit = () => {
        const val = input.value.trim();
        if (!val) return;
        socket.emit('submit_excuse', { roomId, excuse: val });
        excuseAreaEl.innerHTML     = `<div class="excuse-submitted">변명 제출: "${val}"</div>`;
        excuseAreaEl.style.display = 'block';
    };

    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') doSubmit(); });
    btn.addEventListener('click', doSubmit);

    excuseAreaEl.appendChild(input);
    excuseAreaEl.appendChild(btn);
    input.focus();
}

// ── 채팅 패널 ──────────────────────────────────────────────

function showChatPanel(playerId, playerName) {
    // 선택지 정보 가져오기
    const player     = gameState.players.find(p => p.id === playerId);
    const answerIdx  = player ? player.answer : null;
    const optionText = (answerIdx !== null && gameState.currentOptions[answerIdx])
        ? `${answerIdx + 1}. ${gameState.currentOptions[answerIdx]}`
        : '(없음)';

    chatPlayerNameEl.innerHTML =
        `<strong>${playerName}</strong>님과 대화 중<br>
         <span class="chat-player-choice">🎯 선택: ${optionText}</span>`;

    // 채팅 기록 복원
    chatMessagesEl.innerHTML = '';
    const history = chatHistory.get(playerId) || [];
    history.forEach(msg => appendChatMessage(msg));

    if (myRole === 'host' || gameState.myId === playerId) {
        chatInputAreaEl.style.display = 'flex';
        if (myRole === 'host') addJudgementButtons(playerId);
    }
}

function closeChatPanel() {
    chatInputAreaEl.style.display = 'none';
    chatPlayerNameEl.innerHTML    = '';
    const existing = document.querySelector('.judgement-buttons');
    if (existing) existing.remove();
}

function appendChatMessage(data) {
    const msgEl    = document.createElement('div');
    msgEl.className= `chat-message ${data.senderId === gameState.myId ? 'mine' : 'other'}`;

    const senderEl = document.createElement('div');
    senderEl.className  = 'chat-message-sender';
    senderEl.textContent= data.senderName;

    const textEl   = document.createElement('div');
    textEl.textContent  = data.message;

    msgEl.appendChild(senderEl);
    msgEl.appendChild(textEl);
    chatMessagesEl.appendChild(msgEl);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function addJudgementButtons(playerId) {
    const existing = document.querySelector('.judgement-buttons');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.className = 'judgement-buttons';

    const rescueBtn = document.createElement('button');
    rescueBtn.textContent = '✅ 구제';
    rescueBtn.className   = 'btn-rescue';
    rescueBtn.onclick = () => {
        socket.emit('judge_player', { roomId, playerId, rescue: true });
        div.remove();
    };

    const elimBtn  = document.createElement('button');
    elimBtn.textContent = '❌ 탈락';
    elimBtn.className   = 'btn-eliminate';
    elimBtn.onclick = () => {
        socket.emit('judge_player', { roomId, playerId, rescue: false });
        div.remove();
    };

    div.appendChild(rescueBtn);
    div.appendChild(elimBtn);
    document.querySelector('.left-panel').insertBefore(div, chatInputAreaEl);
}

// ── 기타 액션 ─────────────────────────────────────────────

function likeExcuse(playerId) {
    if (myRole === 'spectator') return;
    socket.emit('like_excuse', { roomId, playerId });
}

function startChat(playerId) {
    socket.emit('start_chat', { roomId, playerId });
}

function eliminatePlayer(playerId) {
    if (confirm('정말 탈락시키시겠습니까?')) {
        socket.emit('judge_player', { roomId, playerId, rescue: false });
    }
}

// ── 타이머 ────────────────────────────────────────────────

let timerInterval = null;

function startTimer(seconds) {
    stopTimer();
    let remaining = seconds;
    timerTextEl.textContent = `⏰ ${remaining}초`;
    timerInterval = setInterval(() => {
        remaining--;
        timerTextEl.textContent = `⏰ ${remaining}초`;
        if (remaining <= 0) stopTimer();
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    timerTextEl.textContent = '';
}

// ── 알림 ──────────────────────────────────────────────────

function showNotification(message, type = 'info') {
    const n    = document.createElement('div');
    n.className= `notification ${type}`;
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
}

// ── 버튼 이벤트 ───────────────────────────────────────────

startGameBtn.addEventListener('click', () => {
    socket.emit('start_game', { roomId });
});

nextRoundBtn.addEventListener('click', () => {
    socket.emit('next_round', { roomId });
});

sendChatBtn.addEventListener('click', () => {
    if (myRole === 'spectator') return;
    const message = chatInputEl.value.trim();
    if (message) {
        socket.emit('chat_message', { roomId, message });
        chatInputEl.value = '';
    }
});

chatInputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatBtn.click();
});
