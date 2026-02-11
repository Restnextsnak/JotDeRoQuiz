const socket = io();

// 로컬 스토리지에서 정보 가져오기
const roomId = localStorage.getItem('roomId');
const myRole = localStorage.getItem('role');

if (!roomId || !myRole) {
    window.location.href = '/';
}

// 게임 상태
let gameState = {
    myId: null,
    players: [],
    phase: 'waiting',
    round: 1,
    currentQuestion: null,
    currentOptions: [],
    myAnswer: null,
    currentChatPlayer: null,
    hostId: null
};

// DOM 요소
const roomCodeEl = document.getElementById('roomCode');
const roundInfoEl = document.getElementById('roundInfo');
const phaseInfoEl = document.getElementById('phaseInfo');
const hostCardEl = document.getElementById('hostCard');
const hostControlsEl = document.getElementById('hostControls');
const playersAreaEl = document.getElementById('playersArea');
const questionTextEl = document.getElementById('questionText');
const optionsAreaEl = document.getElementById('optionsArea');
const timerTextEl = document.getElementById('timerText');
const chatMessagesEl = document.getElementById('chatMessages');
const chatInputAreaEl = document.getElementById('chatInputArea');
const chatInputEl = document.getElementById('chatInput');
const chatPlayerNameEl = document.getElementById('chatPlayerName');

// 버튼
const startGameBtn = document.getElementById('startGameBtn');
const nextRoundBtn = document.getElementById('nextRoundBtn');
const sendChatBtn = document.getElementById('sendChatBtn');

// 초기화
roomCodeEl.textContent = `방 코드: ${roomId}`;
gameState.myId = socket.id;

// 서버 연결 확인
socket.on('connect', () => {
    gameState.myId = socket.id;
    // 방 재참가 (리프레시 대응)
    socket.emit('get_room_state', { roomId });
});

// 방 상태 업데이트
socket.on('room_state', (state) => {
    gameState.players = state.players;
    gameState.phase = state.phase;
    gameState.round = state.round;
    gameState.currentChatPlayer = state.currentChatPlayer;
    gameState.hostId = state.hostId;
    
    updateUI();
});

// 라운드 시작
socket.on('round_started', (data) => {
    gameState.round = data.round;
    gameState.phase = data.phase;
    gameState.currentOptions = data.options;
    gameState.myAnswer = null;
    
    roundInfoEl.textContent = `라운드: ${data.round}`;
    phaseInfoEl.textContent = '선택 중';
    questionTextEl.textContent = '???';
    
    renderOptions(data.options);
    startTimer(20);
});

// 모두 답변 완료
socket.on('all_answered', (data) => {
    gameState.phase = data.phase;
    gameState.currentQuestion = data.question;
    
    phaseInfoEl.textContent = '문제 공개';
    questionTextEl.textContent = data.question;
    
    // 방장이 아닌 경우 선택지 비활성화
    if (myRole !== 'host') {
        disableOptions();
    }
});

// 정답 공개
socket.on('answer_revealed', (data) => {
    gameState.phase = data.phase;
    phaseInfoEl.textContent = '변명 시간';
    
    highlightCorrectAnswer(data.correctAnswer);
    
    // 오답자인 경우 변명 입력창 표시
    const me = gameState.players.find(p => p.id === gameState.myId);
    if (me && me.answer !== data.correctAnswer && !me.eliminated && myRole !== 'spectator') {
        showExcuseInput();
    }
    
    startTimer(10);
});

// 채팅 시작
socket.on('chat_started', (data) => {
    gameState.currentChatPlayer = data.playerId;
    chatPlayerNameEl.textContent = `${data.playerName}님과 대화 중`;
    
    // 방장이거나 채팅 대상 플레이어인 경우 입력창 활성화
    if (myRole === 'host' || gameState.myId === data.playerId) {
        chatInputAreaEl.style.display = 'flex';
        chatMessagesEl.innerHTML = ''; // 채팅 초기화
        
        // 방장인 경우 판결 버튼 추가
        if (myRole === 'host') {
            addJudgementButtons(data.playerId);
        }
    }
});

// 판결 버튼 추가 (방장 전용)
function addJudgementButtons(playerId) {
    // 기존 버튼 제거
    const existing = document.querySelector('.judgement-buttons');
    if (existing) existing.remove();
    
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'judgement-buttons';
    buttonsDiv.style.cssText = 'display: flex; gap: 10px; padding: 10px; background: rgba(255,255,255,0.05);';
    
    const rescueBtn = document.createElement('button');
    rescueBtn.textContent = '✅ 구제';
    rescueBtn.style.cssText = 'flex: 1; background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);';
    rescueBtn.onclick = () => {
        socket.emit('judge_player', { roomId, playerId, rescue: true });
        buttonsDiv.remove();
    };
    
    const eliminateBtn = document.createElement('button');
    eliminateBtn.textContent = '❌ 탈락';
    eliminateBtn.style.cssText = 'flex: 1; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);';
    eliminateBtn.onclick = () => {
        socket.emit('judge_player', { roomId, playerId, rescue: false });
        buttonsDiv.remove();
    };
    
    buttonsDiv.appendChild(rescueBtn);
    buttonsDiv.appendChild(eliminateBtn);
    
    const leftPanel = document.querySelector('.left-panel');
    leftPanel.insertBefore(buttonsDiv, chatInputAreaEl);
}

// 채팅 메시지 수신
socket.on('chat_message', (data) => {
    const messageEl = document.createElement('div');
    messageEl.className = `chat-message ${data.senderId === gameState.myId ? 'mine' : 'other'}`;
    
    const senderEl = document.createElement('div');
    senderEl.className = 'chat-message-sender';
    senderEl.textContent = data.senderName;
    
    const textEl = document.createElement('div');
    textEl.textContent = data.message;
    
    messageEl.appendChild(senderEl);
    messageEl.appendChild(textEl);
    chatMessagesEl.appendChild(messageEl);
    
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
});

// 플레이어 구제
socket.on('player_rescued', (data) => {
    showNotification(`${data.playerName}님이 구제되었습니다!`, 'success');
    chatInputAreaEl.style.display = 'none';
    chatPlayerNameEl.textContent = '';
});

// 플레이어 탈락
socket.on('player_eliminated', (data) => {
    showNotification(`${data.playerName}님이 탈락했습니다!`, 'error');
    chatInputAreaEl.style.display = 'none';
    chatPlayerNameEl.textContent = '';
});

// 게임 종료
socket.on('game_finished', (data) => {
    if (data.winner) {
        showNotification(`🎉 ${data.winner.name}님이 우승했습니다! 🎉`, 'success');
        phaseInfoEl.textContent = '게임 종료';
    } else {
        showNotification('게임이 종료되었습니다', 'info');
    }
    
    if (myRole === 'host') {
        startGameBtn.style.display = 'block';
        nextRoundBtn.style.display = 'none';
    }
});

// 방장 나감
socket.on('host_left', () => {
    alert('방장이 나갔습니다. 로비로 돌아갑니다.');
    window.location.href = '/';
});

// UI 업데이트
function updateUI() {
    // 방장 카드 업데이트
    const host = gameState.players.find(p => p.id === gameState.hostId);
    if (host) {
        hostCardEl.innerHTML = `
            <div class="player-name">👑 ${host.name} (방장)</div>
            ${host.excuse ? `
                <div class="excuse-text">
                    ${host.excuse}
                    ${myRole !== 'spectator' && gameState.phase === 'excuse' ? `
                        <button class="like-button" onclick="likeExcuse('${host.id}')">
                            ❤️<span class="like-count">${host.likes || 0}</span>
                        </button>
                    ` : ''}
                </div>
            ` : ''}
        `;
        
        if (host.likes > 0) {
            hostCardEl.setAttribute('data-likes', Math.min(host.likes, 10));
        }
    }
    
    // 호스트 컨트롤 표시 여부
    if (myRole === 'host') {
        hostControlsEl.style.display = 'flex';
        
        if (gameState.phase === 'waiting') {
            startGameBtn.style.display = 'block';
            nextRoundBtn.style.display = 'none';
        } else if (gameState.phase === 'excuse' || gameState.phase === 'chat') {
            startGameBtn.style.display = 'none';
            nextRoundBtn.style.display = 'block';
        } else {
            startGameBtn.style.display = 'none';
            nextRoundBtn.style.display = 'none';
        }
    }
    
    // 플레이어 목록 업데이트
    playersAreaEl.innerHTML = '';
    
    gameState.players
        .filter(p => p.id !== gameState.hostId)
        .forEach(player => {
            const card = createPlayerCard(player);
            playersAreaEl.appendChild(card);
        });
}

// 플레이어 카드 생성
function createPlayerCard(player) {
    const card = document.createElement('div');
    card.className = `player-card ${player.eliminated ? 'eliminated' : ''}`;
    card.id = `player-${player.id}`;
    
    if (player.likes > 0) {
        card.setAttribute('data-likes', Math.min(player.likes, 10));
    }
    
    let html = `<div class="player-name">${player.name}</div>`;
    
    // 상태 표시
    html += `<div class="player-info">`;
    html += `<div class="player-status">`;
    
    if (player.role === 'spectator') {
        html += `<span class="status-badge">관전</span>`;
    } else if (player.eliminated) {
        html += `<span class="status-badge">탈락</span>`;
    } else if (player.answer !== null && gameState.phase === 'selecting') {
        html += `<span class="status-badge answered">답변 완료</span>`;
    }
    
    html += `</div>`;
    html += `</div>`;
    
    // 변명 텍스트
    if (player.excuse) {
        html += `
            <div class="excuse-text">
                ${player.excuse}
                ${myRole !== 'spectator' && gameState.phase === 'excuse' && !player.eliminated ? `
                    <button class="like-button" onclick="likeExcuse('${player.id}')">
                        ❤️<span class="like-count">${player.likes || 0}</span>
                    </button>
                ` : `
                    <span class="like-count" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%);">
                        ❤️ ${player.likes || 0}
                    </span>
                `}
            </div>
        `;
    }
    
    // 방장 전용 액션 버튼
    if (myRole === 'host' && gameState.phase === 'excuse' && player.excuse && !player.eliminated) {
        html += `
            <div class="player-actions">
                <button class="btn-chat" onclick="startChat('${player.id}')">대화하기</button>
                <button class="btn-eliminate" onclick="eliminatePlayer('${player.id}')">즉시 탈락</button>
            </div>
        `;
    }
    
    card.innerHTML = html;
    return card;
}

// 선택지 렌더링
function renderOptions(options) {
    optionsAreaEl.innerHTML = '';
    
    options.forEach((option, index) => {
        const btn = document.createElement('button');
        btn.className = 'option-button';
        btn.textContent = `${index + 1}. ${option}`;
        btn.onclick = () => selectOption(index);
        
        // 관전자는 선택 불가
        if (myRole === 'spectator') {
            btn.disabled = true;
        }
        
        // 이미 답변했으면 비활성화
        if (gameState.myAnswer !== null) {
            btn.disabled = true;
            if (gameState.myAnswer === index) {
                btn.classList.add('selected');
            }
        }
        
        optionsAreaEl.appendChild(btn);
    });
}

// 선택지 선택
function selectOption(index) {
    if (gameState.myAnswer !== null || myRole === 'spectator') return;
    
    gameState.myAnswer = index;
    socket.emit('submit_answer', { roomId, answerIndex: index });
    
    // UI 업데이트
    const buttons = optionsAreaEl.querySelectorAll('.option-button');
    buttons.forEach((btn, i) => {
        btn.disabled = true;
        if (i === index) {
            btn.classList.add('selected');
        }
    });
}

// 선택지 비활성화
function disableOptions() {
    const buttons = optionsAreaEl.querySelectorAll('.option-button');
    buttons.forEach(btn => btn.disabled = true);
}

// 정답 하이라이트
function highlightCorrectAnswer(correctIndex) {
    const buttons = optionsAreaEl.querySelectorAll('.option-button');
    buttons[correctIndex].classList.add('correct');
}

// 변명 입력창 표시
function showExcuseInput() {
    const me = gameState.players.find(p => p.id === gameState.myId);
    if (!me || me.excuse) return; // 이미 제출했으면 무시
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'excuse-input';
    input.placeholder = '변명을 입력하세요 (20자 이내)';
    input.maxLength = 20;
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            submitExcuse(input.value);
            input.remove();
        }
    });
    
    optionsAreaEl.appendChild(input);
    input.focus();
}

// 변명 제출
function submitExcuse(excuse) {
    if (!excuse.trim()) return;
    socket.emit('submit_excuse', { roomId, excuse: excuse.trim() });
}

// 좋아요
function likeExcuse(playerId) {
    if (myRole === 'spectator') return;
    socket.emit('like_excuse', { roomId, playerId });
}

// 대화 시작
function startChat(playerId) {
    socket.emit('start_chat', { roomId, playerId });
}

// 플레이어 탈락
function eliminatePlayer(playerId) {
    if (confirm('정말 탈락시키시겠습니까?')) {
        socket.emit('judge_player', { roomId, playerId, rescue: false });
    }
}

// 타이머
let timerInterval = null;
function startTimer(seconds) {
    if (timerInterval) clearInterval(timerInterval);
    
    let remaining = seconds;
    timerTextEl.textContent = `⏰ ${remaining}초`;
    
    timerInterval = setInterval(() => {
        remaining--;
        timerTextEl.textContent = `⏰ ${remaining}초`;
        
        if (remaining <= 0) {
            clearInterval(timerInterval);
            timerTextEl.textContent = '';
        }
    }, 1000);
}

// 알림 표시
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// 버튼 이벤트
startGameBtn.addEventListener('click', () => {
    socket.emit('start_game', { roomId });
});

nextRoundBtn.addEventListener('click', () => {
    socket.emit('next_round', { roomId });
});

sendChatBtn.addEventListener('click', () => {
    const message = chatInputEl.value.trim();
    if (message) {
        socket.emit('chat_message', { roomId, message });
        chatInputEl.value = '';
    }
});

chatInputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChatBtn.click();
    }
});

// 방장이 정답 선택 (문제 공개 후)
optionsAreaEl.addEventListener('click', (e) => {
    if (myRole === 'host' && gameState.phase === 'question_reveal' && e.target.classList.contains('option-button')) {
        const buttons = Array.from(optionsAreaEl.querySelectorAll('.option-button'));
        const index = buttons.indexOf(e.target);
        
        if (index !== -1) {
            socket.emit('select_correct_answer', { roomId, answerIndex: index });
        }
    }
});
