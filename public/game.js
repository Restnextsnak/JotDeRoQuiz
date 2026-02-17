const socket = io();

const roomId  = localStorage.getItem('roomId');
const myRole  = localStorage.getItem('role');

if (!roomId || !myRole) window.location.href = '/';

let gameState = {
    myId: null,
    players: [],
    phase: 'waiting',
    round: 1,
    hostId: null,
    playerMakingId: null,
    question: null,       // { question, options, correctAnswer }
    myAnswer: null,
    correctAnswer: null,  // 결과 단계에서 세팅
    isEditingQuestion: false, // 편집기 열린 상태 (updateUI가 덮어쓰지 않도록)
};

// ── DOM ──────────────────────────────────────────────────
const roomCodeEl         = document.getElementById('roomCode');
const roundInfoEl        = document.getElementById('roundInfo');
const phaseInfoEl        = document.getElementById('phaseInfo');
const timerTextEl        = document.getElementById('timerText');
const hostCardEl         = document.getElementById('hostCard');
const playersAreaEl      = document.getElementById('playersArea');

// 섹션들
const waitingArea        = document.getElementById('waitingArea');
const questionEditor     = document.getElementById('questionEditor');
const selectingArea      = document.getElementById('selectingArea');
const hostJudgingArea    = document.getElementById('hostJudgingArea');
const resultArea         = document.getElementById('resultArea');
const finishedArea       = document.getElementById('finishedArea');

// 대기 영역
const hostWaitControls   = document.getElementById('hostWaitControls');
const playerWaitMsg      = document.getElementById('playerWaitMsg');
const waitMsgText        = document.getElementById('waitMsgText');
const preGameArea        = document.getElementById('preGameArea');
const startGameBtn       = document.getElementById('startGameBtn');

// 문제 편집기
const editorLabel        = document.getElementById('editorLabel');
const editorQuestion     = document.getElementById('editorQuestion');
const editorOptionInputs = document.querySelectorAll('.editor-option-input');
const submitQuestionBtn  = document.getElementById('submitQuestionBtn');
const cancelEditorBtn    = document.getElementById('cancelEditorBtn');

// 선택 단계
const questionTextEl     = document.getElementById('questionText');
const optionsAreaEl      = document.getElementById('optionsArea');
const confirmAnswerArea  = document.getElementById('confirmAnswerArea');
const confirmAnswerBtn   = document.getElementById('confirmAnswerBtn');

// 방장 판정
const judgeQuestionText  = document.getElementById('judgeQuestionText');
const judgeOptionsArea   = document.getElementById('judgeOptionsArea');
const confirmJudgeArea   = document.getElementById('confirmJudgeArea');
const confirmJudgeBtn    = document.getElementById('confirmJudgeBtn');

// 결과
const resultQuestionText = document.getElementById('resultQuestionText');
const resultOptionsArea  = document.getElementById('resultOptionsArea');
const eliminatedList     = document.getElementById('eliminatedList');
const hostNextControls   = document.getElementById('hostNextControls');
const nextRoundBtn       = document.getElementById('nextRoundBtn');

// 종료
const winnerDisplay      = document.getElementById('winnerDisplay');
const restartBtn         = document.getElementById('restartBtn');

// 오른쪽 패널
const rightIdle          = document.getElementById('rightIdle');
const finalChatPanel     = document.getElementById('finalChatPanel');
const finalChatMessages  = document.getElementById('finalChatMessages');
const finalChatInput     = document.getElementById('finalChatInput');
const finalChatInputEl   = document.getElementById('finalChatInputEl');
const finalChatSendBtn   = document.getElementById('finalChatSendBtn');
const hostDestroyArea    = document.getElementById('hostDestroyArea');
const destroyRoomBtn     = document.getElementById('destroyRoomBtn');

// 방장 질문 소스 버튼
const btnMakeQuestion    = document.getElementById('btnMakeQuestion');
const btnRandomQuestion  = document.getElementById('btnRandomQuestion');
const btnPlayerQuestion  = document.getElementById('btnPlayerQuestion');

roomCodeEl.textContent = `방 코드: ${roomId}`;

// ── 소켓 연결 ────────────────────────────────────────────

socket.on('connect', () => {
    gameState.myId = socket.id;
    const playerName = localStorage.getItem('playerName');
    socket.emit('rejoin_room', { roomId, name: playerName, role: myRole });
});

// ── 방 상태 ─────────────────────────────────────────────

socket.on('room_state', (state) => {
    gameState.players        = state.players;
    gameState.phase          = state.phase;
    gameState.round          = state.round;
    gameState.hostId         = state.hostId;
    gameState.playerMakingId = state.playerMakingId;
    if (state.question) gameState.question = state.question;

    roundInfoEl.textContent = `라운드 ${state.round}`;
    updateUI();
});

// ── 게임 시작 ────────────────────────────────────────────

socket.on('game_started', () => {
    gameState.phase         = 'waiting';
    gameState.myAnswer      = null;
    gameState.correctAnswer = null;
    gameState.pendingAnswer = null;
    gameState.pendingJudge  = null;
    gameState.question      = null;
    showSection('waiting');
    phaseInfoEl.textContent = '문제 준비 중';
    if (myRole === 'host') {
        showHostWaitControls();
    } else {
        showPlayerWaitMsg('방장이 문제를 준비 중입니다...');
    }
});

// ── 라운드 대기 (다음 라운드) ────────────────────────────

socket.on('round_waiting', (data) => {
    gameState.phase    = 'waiting';
    gameState.round    = data.round;
    gameState.myAnswer = null;
    gameState.correctAnswer = null;
    gameState.question = null;
    roundInfoEl.textContent = `라운드 ${data.round}`;
    phaseInfoEl.textContent = '문제 준비 중';
    showSection('waiting');
    if (myRole === 'host') {
        showHostWaitControls();
    } else {
        showPlayerWaitMsg('방장이 문제를 준비 중입니다...');
    }
});

// ── 플레이어 질문 만드는 중 ──────────────────────────────

socket.on('player_making_question', (data) => {
    gameState.phase = 'player_making';
    gameState.playerMakingId = data.playerId;

    if (myRole === 'host') {
        // 방장: 취소 버튼 포함한 대기 메시지
        showSection('waiting');
        hostWaitControls.style.display = 'none';
        playerWaitMsg.style.display    = 'block';
        waitMsgText.textContent = `${data.playerName}님이 질문을 만드는 중...`;
        let cancelBtn = document.getElementById('cancelPlayerQuestionBtn');
        if (!cancelBtn) {
            cancelBtn = document.createElement('button');
            cancelBtn.id = 'cancelPlayerQuestionBtn';
            cancelBtn.className = 'cancel-btn';
            cancelBtn.textContent = '❌ 질문 취소';
            cancelBtn.onclick = () => socket.emit('cancel_player_question', { roomId });
            playerWaitMsg.appendChild(cancelBtn);
        }
    } else if (socket.id === data.playerId) {
        // 선택된 플레이어: open_question_editor가 이미 왔거나 곧 오므로 편집기 표시
        gameState.isEditingQuestion = true;
        showSection('editor');
        editorLabel.textContent = '질문과 보기를 자유롭게 입력하세요!';
        cancelEditorBtn.style.display = 'none';
        editorQuestion.focus();
    } else {
        // 다른 플레이어: 대기 메시지
        showSection('waiting');
        showPlayerWaitMsg(`${data.playerName}님이 질문을 만드는 중...`);
    }
});

// ── 문제 편집기 열기 ─────────────────────────────────────

socket.on('open_question_editor', (data) => {
    gameState.isEditingQuestion = true;
    showSection('editor');
    editorQuestion.value = '';
    editorOptionInputs.forEach(inp => inp.value = '');

    if (data.prefill) {
        editorQuestion.value = data.prefill.question || '';
        data.prefill.options.forEach((opt, i) => {
            if (editorOptionInputs[i]) editorOptionInputs[i].value = opt;
        });
    }

    if (data.mode === 'host') {
        editorLabel.textContent = '질문과 보기를 입력하세요 (수정 가능)';
        cancelEditorBtn.style.display = 'inline-block';
    } else {
        editorLabel.textContent = '질문과 보기를 자유롭게 입력하세요!';
        cancelEditorBtn.style.display = 'none';
    }
    editorQuestion.focus();
});

// ── 문제 편집기 닫기 ─────────────────────────────────────

socket.on('close_question_editor', () => {
    gameState.isEditingQuestion = false;
    showSection('waiting');
    showPlayerWaitMsg('방장이 질문을 취소했습니다. 잠시 기다려주세요...');
});

// ── 라운드 시작 (선택 단계) ──────────────────────────────

socket.on('round_started', (data) => {
    gameState.phase   = 'selecting';
    gameState.myAnswer = null;
    gameState.correctAnswer = null;
    gameState.pendingAnswer = null; // 확정 전 임시 선택
    gameState.question = { question: data.question, options: data.options };

    phaseInfoEl.textContent = '선택 중';
    showSection('selecting');
    questionTextEl.textContent = myRole === 'host' ? '플레이어들이 선택 중...' : data.question;
    confirmAnswerArea.style.display = 'none';
    renderOptions(data.options, optionsAreaEl, myRole !== 'player');
    startTimer(10);
    updatePlayerList();
});

// ── 모두 답변 완료 → 방장 판정 ──────────────────────────

socket.on('all_answered', (data) => {
    gameState.phase = 'host_judging';
    gameState.question = { question: data.question, options: data.options };
    gameState.pendingJudge = null; // 확정 전 임시 정답 선택
    stopTimer();
    phaseInfoEl.textContent = myRole === 'host' ? '정답을 선택하세요' : '방장이 정답 선택 중...';

    if (myRole === 'host') {
        showSection('host_judging');
        judgeQuestionText.textContent = data.question || '';
        confirmJudgeArea.style.display = 'none';
        renderOptions(data.options || [], judgeOptionsArea, false, true);
    } else {
        showSection('selecting');
        questionTextEl.textContent = data.question || '';
        confirmAnswerArea.style.display = 'none';
        disableOptions(optionsAreaEl);
    }
    updatePlayerList();
});

// ── 결과 공개 ────────────────────────────────────────────

socket.on('result_revealed', (data) => {
    gameState.phase         = 'result';
    gameState.correctAnswer = data.correctAnswer;
    stopTimer();
    phaseInfoEl.textContent = '결과 발표';
    showSection('result');

    resultQuestionText.textContent = gameState.question?.question || '';
    renderResultOptions(gameState.question?.options || [], data.correctAnswer);

    eliminatedList.innerHTML = '';
    if (data.eliminated.length > 0) {
        const title = document.createElement('p');
        title.className = 'eliminated-title';
        title.textContent = `💀 탈락: ${data.eliminated.map(p => p.name).join(', ')}`;
        eliminatedList.appendChild(title);
    } else {
        const title = document.createElement('p');
        title.className = 'eliminated-title success';
        title.textContent = '🎉 모두 정답!';
        eliminatedList.appendChild(title);
    }

    if (myRole === 'host') hostNextControls.style.display = 'block';
    updatePlayerList();
});

// ── 게임 종료 ────────────────────────────────────────────

socket.on('game_finished', (data) => {
    gameState.phase = 'finished';
    stopTimer();
    phaseInfoEl.textContent = '게임 종료';
    showSection('finished');

    if (data.winner) {
        winnerDisplay.innerHTML = `<div class="winner-title">🏆 우승자</div><div class="winner-name">${data.winner.name}</div>`;
        showNotification(`🏆 ${data.winner.name}님 우승!`, 'success');
    } else {
        winnerDisplay.innerHTML = `<div class="winner-title">게임 종료</div><div class="winner-name">모두 탈락</div>`;
    }

    // 독대 채팅 패널
    rightIdle.style.display = 'none';
    finalChatPanel.style.display = 'flex';

    const isHost   = myRole === 'host';
    const isWinner = data.winner && gameState.myId === data.winner.id;
    if (isHost || isWinner) {
        finalChatInput.style.display = 'flex';
    }

    if (myRole === 'host') {
        restartBtn.style.display = 'block';
    }

    updatePlayerList();
});

// ── 방 폭파 / 방장 나감 ──────────────────────────────────

socket.on('room_destroyed', () => {
    alert('방이 종료되었습니다.');
    window.location.href = '/';
});

// ── updateUI ─────────────────────────────────────────────

function updateUI() {
    roundInfoEl.textContent = `라운드 ${gameState.round}`;
    updatePlayerList();

    // 편집기 열린 중이면 섹션 전환 스킵
    if (gameState.isEditingQuestion) return;

    // phase별 섹션 표시
    switch (gameState.phase) {
        case 'waiting':
            showSection('waiting');
            phaseInfoEl.textContent = '문제 준비 중';
            if (myRole === 'host') {
                showHostWaitControls();
            } else {
                showPlayerWaitMsg('방장이 문제를 준비 중입니다...');
            }
            // 게임 전이면 시작 버튼
            if (gameState.round === 1) {
                preGameArea.style.display = myRole === 'host' ? 'block' : 'none';
                if (myRole === 'host') hostWaitControls.style.display = 'none';
            }
            break;
        case 'player_making':
            // player_making_question 이벤트에서 처리
            break;
        case 'selecting':
            // 섹션 전환만 — 내용은 round_started 이벤트에서 렌더링
            showSection('selecting');
            phaseInfoEl.textContent = '선택 중';
            break;
        case 'host_judging':
            // 섹션 전환만 — 내용은 all_answered 이벤트에서 렌더링
            phaseInfoEl.textContent = myRole === 'host' ? '정답을 선택하세요' : '방장이 정답 선택 중...';
            if (myRole === 'host') {
                showSection('host_judging');
            } else {
                showSection('selecting');
            }
            break;
        case 'result':
            phaseInfoEl.textContent = '결과 발표';
            break;
        case 'finished':
            phaseInfoEl.textContent = '게임 종료';
            break;
    }

    // 방장 전용 UI
    if (myRole === 'host') {
        hostDestroyArea.style.display = 'block';
    }
}

function showSection(name) {
    waitingArea.style.display     = name === 'waiting' ? 'flex' : 'none';
    questionEditor.style.display  = name === 'editor'  ? 'flex' : 'none';
    selectingArea.style.display   = name === 'selecting' ? 'flex' : 'none';
    hostJudgingArea.style.display = name === 'host_judging' ? 'flex' : 'none';
    resultArea.style.display      = name === 'result'  ? 'flex' : 'none';
    finishedArea.style.display    = name === 'finished' ? 'flex' : 'none';
}

function showHostWaitControls() {
    preGameArea.style.display      = 'none';
    playerWaitMsg.style.display    = 'none';
    hostWaitControls.style.display = 'flex';
    // 취소 버튼 제거
    const cancelBtn = document.getElementById('cancelPlayerQuestionBtn');
    if (cancelBtn) cancelBtn.remove();
}

function showPlayerWaitMsg(msg) {
    preGameArea.style.display      = 'none';
    hostWaitControls.style.display = 'none';
    playerWaitMsg.style.display    = 'block';
    waitMsgText.textContent        = msg;
}

// ── 플레이어 목록 ─────────────────────────────────────────

function updatePlayerList() {
    const host = gameState.players.find(p => p.id === gameState.hostId);
    if (host) {
        hostCardEl.innerHTML = `<span class="host-crown">👑</span><span class="player-name">${host.name}</span>`;
    }

    playersAreaEl.innerHTML = '';
    gameState.players
        .filter(p => p.id !== gameState.hostId)
        .forEach(player => {
            const card = document.createElement('div');
            card.className = `player-card ${player.eliminated ? 'eliminated' : ''}`;

            let statusIcon = '';
            if (player.eliminated) {
                statusIcon = '<span class="status-icon elim">💀</span>';
            } else if (gameState.phase === 'selecting' && player.answer !== null) {
                statusIcon = '<span class="status-icon done">✅</span>';
            } else if (gameState.phase === 'result' || gameState.phase === 'finished') {
                if (gameState.correctAnswer !== null) {
                    statusIcon = player.answer === gameState.correctAnswer
                        ? '<span class="status-icon correct">⭕</span>'
                        : '<span class="status-icon wrong">❌</span>';
                }
            }

            card.innerHTML = `<span class="player-name">${player.name}</span>${statusIcon}`;
            playersAreaEl.appendChild(card);
        });
}

// ── 선택지 렌더링 ─────────────────────────────────────────

function renderOptions(options, container, disabled = false, isJudge = false) {
    container.innerHTML = '';
    options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className   = 'option-button';
        btn.textContent = `${['①','②','③','④'][i]} ${opt}`;
        btn.disabled    = disabled;

        if (!disabled) {
            if (isJudge) {
                // 방장: 클릭하면 임시 선택 표시, 확정 버튼으로 제출
                if (gameState.pendingJudge === i) btn.classList.add('selected');
                btn.addEventListener('click', () => {
                    gameState.pendingJudge = i;
                    Array.from(container.children).forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                    confirmJudgeArea.style.display = 'block';
                });
            } else {
                // 플레이어: 클릭하면 임시 선택 표시, 확정 버튼으로 제출
                if (gameState.myAnswer !== null) {
                    btn.disabled = true;
                    if (gameState.myAnswer === i) btn.classList.add('selected');
                } else {
                    if (gameState.pendingAnswer === i) btn.classList.add('pending');
                    btn.addEventListener('click', () => selectPending(i));
                }
            }
        }
        container.appendChild(btn);
    });
}

function renderResultOptions(options, correctIndex) {
    resultOptionsArea.innerHTML = '';
    options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className   = 'option-button';
        btn.textContent = `${['①','②','③','④'][i]} ${opt}`;
        btn.disabled    = true;
        if (i === correctIndex) btn.classList.add('correct');
        else if (gameState.myAnswer === i) btn.classList.add('wrong-pick');
        resultOptionsArea.appendChild(btn);
    });
}

function disableOptions(container) {
    container.querySelectorAll('.option-button').forEach(b => b.disabled = true);
}

function selectPending(index) {
    if (myRole !== 'player' || gameState.myAnswer !== null || gameState.phase !== 'selecting') return;
    gameState.pendingAnswer = index;
    // 버튼 시각적 표시 갱신
    optionsAreaEl.querySelectorAll('.option-button').forEach((btn, i) => {
        btn.classList.remove('pending', 'selected');
        if (i === index) btn.classList.add('pending');
    });
    confirmAnswerArea.style.display = 'block';
}

function confirmAnswer() {
    if (myRole !== 'player' || gameState.myAnswer !== null || gameState.phase !== 'selecting') return;
    if (gameState.pendingAnswer === null) return;
    const index = gameState.pendingAnswer;
    gameState.myAnswer = index;
    socket.emit('submit_answer', { roomId, answerIndex: index });

    optionsAreaEl.querySelectorAll('.option-button').forEach((btn, i) => {
        btn.classList.remove('pending');
        btn.disabled = true;
        if (i === index) btn.classList.add('selected');
    });
    confirmAnswerArea.style.display = 'none';
}

// ── 타이머 ───────────────────────────────────────────────

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
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    timerTextEl.textContent = '';
}

// ── 알림 ─────────────────────────────────────────────────

function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.className   = `notification ${type}`;
    n.textContent = message;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 3000);
}

// ── 버튼 이벤트 ──────────────────────────────────────────

// 게임 시작 전 대기 → 시작
startGameBtn.addEventListener('click', () => {
    socket.emit('start_game', { roomId });
});

// 문제 소스 버튼들
btnMakeQuestion.addEventListener('click', () => {
    socket.emit('host_make_question', { roomId });
});
btnRandomQuestion.addEventListener('click', () => {
    socket.emit('host_random_question', { roomId });
});
btnPlayerQuestion.addEventListener('click', () => {
    socket.emit('host_player_question', { roomId });
});

// 문제 제출
submitQuestionBtn.addEventListener('click', () => {
    const question = editorQuestion.value.trim();
    const options  = Array.from(editorOptionInputs).map(inp => inp.value.trim());

    if (!question) { showNotification('질문을 입력하세요', 'error'); return; }
    if (options.some(o => !o)) { showNotification('보기 4개를 모두 입력하세요', 'error'); return; }

    gameState.isEditingQuestion = false;
    socket.emit('submit_question', { roomId, question, options });
    showSection('waiting');
    showPlayerWaitMsg('문제가 제출되었습니다. 잠시 기다려주세요...');
});

// 편집기 취소 (방장만)
cancelEditorBtn.addEventListener('click', () => {
    gameState.isEditingQuestion = false;
    showSection('waiting');
    showHostWaitControls();
});

// 플레이어 선택 확정
confirmAnswerBtn.addEventListener('click', () => {
    confirmAnswer();
});

// 방장 정답 확정
confirmJudgeBtn.addEventListener('click', () => {
    if (gameState.pendingJudge === null) return;
    socket.emit('select_correct_answer', { roomId, answerIndex: gameState.pendingJudge });
    confirmJudgeArea.style.display = 'none';
    // 버튼 모두 비활성화
    judgeOptionsArea.querySelectorAll('.option-button').forEach(b => b.disabled = true);
    gameState.pendingJudge = null;
});

// 다음 라운드
nextRoundBtn.addEventListener('click', () => {
    socket.emit('next_round', { roomId });
    hostNextControls.style.display = 'none';
});

// 재시작
restartBtn.addEventListener('click', () => {
    // 먼저 UI 초기화 후 서버에 요청
    finalChatPanel.style.display = 'none';
    finalChatMessages.innerHTML  = '';
    finalChatInput.style.display = 'none';
    rightIdle.style.display      = 'block';
    restartBtn.style.display     = 'none';
    winnerDisplay.innerHTML      = '';
    gameState.myAnswer           = null;
    gameState.correctAnswer      = null;
    gameState.pendingAnswer      = null;
    gameState.pendingJudge       = null;
    socket.emit('start_game', { roomId });
});

// 방 폭파
destroyRoomBtn.addEventListener('click', () => {
    if (confirm('정말 방을 폭파하시겠습니까? 모든 플레이어가 강제 퇴장됩니다.')) {
        socket.emit('destroy_room', { roomId });
    }
});

// 독대 채팅 전송
finalChatSendBtn.addEventListener('click', sendFinalChat);
finalChatInputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendFinalChat();
});

function sendFinalChat() {
    const msg = finalChatInputEl.value.trim();
    if (!msg) return;
    socket.emit('final_chat', { roomId, message: msg });
    finalChatInputEl.value = '';
}

socket.on('final_chat_message', (data) => {
    const div = document.createElement('div');
    div.className   = `chat-message ${data.senderId === gameState.myId ? 'mine' : 'other'}`;
    div.innerHTML   = `<div class="chat-message-sender">${data.senderName}</div><div>${data.message}</div>`;
    finalChatMessages.appendChild(div);
    finalChatMessages.scrollTop = finalChatMessages.scrollHeight;
});

// ── 초기 UI 상태 ─────────────────────────────────────────

// 방에 처음 들어왔을 때 (게임 전 대기)
if (myRole === 'host') {
    hostDestroyArea.style.display = 'block';
    preGameArea.style.display     = 'block';
    hostWaitControls.style.display = 'none';
}
showSection('waiting');
