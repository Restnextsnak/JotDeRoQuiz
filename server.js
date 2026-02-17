const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const presetQuestions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf-8'));

const rooms = new Map();

function getUniqueName(room, desiredName, excludeId = null) {
  const usedNames = new Set();
  room.players.forEach((p, id) => {
    if (id !== excludeId) usedNames.add(p.name);
  });
  if (!usedNames.has(desiredName)) return desiredName;
  let i = 2;
  while (usedNames.has(`${desiredName}${i}`)) i++;
  return `${desiredName}${i}`;
}

function createRoom(roomId, hostId, hostName) {
  rooms.set(roomId, {
    id: roomId,
    host: hostId,
    players: new Map(),
    currentQuestion: null,   // { question, options, correctAnswer }
    currentRound: 1,
    phase: 'waiting',        // waiting | player_making | selecting | host_judging | result | finished
    answers: new Map(),
    usedPresetIds: new Set(),
    phaseTimer: null,
    playerMakingId: null,    // 질문 만드는 플레이어 소켓 ID
    finalWinner: null,
  });
}

function setPhaseTimer(roomId, ms, callback) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.phaseTimer) clearTimeout(room.phaseTimer);
  room.phaseTimer = setTimeout(() => {
    room.phaseTimer = null;
    callback();
  }, ms);
}

function clearPhaseTimer(roomId) {
  const room = rooms.get(roomId);
  if (room && room.phaseTimer) {
    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;
  }
}

function getRandomPreset(room) {
  const available = presetQuestions.filter(q => !room.usedPresetIds.has(q.id));
  if (available.length === 0) {
    room.usedPresetIds.clear();
    return presetQuestions[Math.floor(Math.random() * presetQuestions.length)];
  }
  return available[Math.floor(Math.random() * available.length)];
}

function getAlivePlayers(room) {
  return Array.from(room.players.values()).filter(p =>
    !p.eliminated && p.role === 'player'
  );
}

function checkAllPlayersAnswered(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.phase !== 'selecting') return;

  const alive = getAlivePlayers(room);
  const answered = alive.filter(p => p.answer !== null).length;

  if (alive.length > 0 && answered === alive.length) {
    clearPhaseTimer(roomId);
    room.phase = 'host_judging';

    // 보기별 선택 수 집계
    const optionCount = room.currentQuestion.options.length;
    const tally = Array(optionCount).fill(0);
    alive.forEach(p => { if (p.answer !== null) tally[p.answer]++; });

    broadcastRoomState(roomId);
    io.to(roomId).emit('all_answered', {
      phase: 'host_judging',
      question: room.currentQuestion.question,
      options: room.currentQuestion.options,
      tally,
    });
    console.log(`All answered in ${roomId}`);
  }
}

function forceAnswerTimeout(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.phase !== 'selecting') return;

  const optionCount = room.currentQuestion.options.length;
  room.players.forEach((player, id) => {
    if (!player.eliminated && player.role === 'player' && player.answer === null) {
      const random = Math.floor(Math.random() * optionCount);
      player.answer = random;
      room.answers.set(id, random);
    }
  });

  room.phase = 'host_judging';

  // 보기별 선택 수 집계
  const optionCountF = room.currentQuestion.options.length;
  const tallyF = Array(optionCountF).fill(0);
  getAlivePlayers(room).forEach(p => { if (p.answer !== null) tallyF[p.answer]++; });

  broadcastRoomState(roomId);
  io.to(roomId).emit('all_answered', {
    phase: 'host_judging',
    question: room.currentQuestion.question,
    options: room.currentQuestion.options,
    tally: tallyF,
  });
  console.log(`Answer timeout forced in ${roomId}`);
}

function startRound(roomId, question, options) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.currentQuestion = { question, options, correctAnswer: null };
  room.phase = 'selecting';
  room.playerMakingId = null;
  room.pendingQuestion = null;
  room.answers.clear();
  room.players.forEach(p => { p.answer = null; });

  broadcastRoomState(roomId);
  io.to(roomId).emit('round_started', {
    round: room.currentRound,
    question: room.currentQuestion.question,
    options: room.currentQuestion.options,
    phase: 'selecting',
  });

  setPhaseTimer(roomId, 10000, () => forceAnswerTimeout(roomId));
  console.log(`Round started in ${roomId}: ${question}`);
}

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const state = {
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      answer: p.answer,
      eliminated: p.eliminated,
      score: p.score,
    })),
    phase: room.phase,
    round: room.currentRound,
    hostId: room.host,
    playerMakingId: room.playerMakingId,
    question: room.currentQuestion ? {
      question: room.currentQuestion.question,
      options: room.currentQuestion.options,
      correctAnswer: room.currentQuestion.correctAnswer,
    } : null,
  };

  io.to(roomId).emit('room_state', state);
}

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // 방 생성
  socket.on('create_room', (data) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    createRoom(roomId, socket.id, data.name);

    const room = rooms.get(roomId);
    room.players.set(socket.id, {
      id: socket.id, name: data.name, role: 'host',
      answer: null, eliminated: false, score: 0,
    });

    socket.join(roomId);
    socket.emit('room_created', { roomId, role: 'host' });
    console.log(`Room created: ${roomId} by ${data.name}`);
  });

  // 방 참가
  socket.on('join_room', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) { socket.emit('error', { message: '방을 찾을 수 없습니다.' }); return; }
    if (room.players.size >= 30) { socket.emit('error', { message: '방이 가득 찼습니다. (최대 30명)' }); return; }

    const role = data.role || 'player';
    const uniqueName = getUniqueName(room, data.name);

    room.players.set(socket.id, {
      id: socket.id, name: uniqueName, role,
      answer: null, eliminated: false, score: 0,
    });

    socket.join(data.roomId);
    socket.emit('joined_room', { roomId: data.roomId, role, name: uniqueName });
    broadcastRoomState(data.roomId);
    console.log(`${uniqueName} joined ${data.roomId} as ${role}`);
  });

  // ── 방장: 문제 만들기 시작 (직접 입력) ──────────────────
  socket.on('host_make_question', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;
    if (room.phase !== 'waiting') return;

    room.phase = 'waiting'; // 방장이 만드는 중은 waiting 유지 (UI는 클라이언트에서)
    // 방장에게만 문제 편집 UI 열림 신호
    socket.emit('open_question_editor', { mode: 'host' });
  });

  // ── 방장: 랜덤 질문 ───────────────────────────────────
  socket.on('host_random_question', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;
    if (room.phase !== 'waiting') return;

    const q = getRandomPreset(room);
    room.usedPresetIds.add(q.id);
    // 방장에게만 질문 편집 UI 열림 (미리 채워진 상태)
    socket.emit('open_question_editor', {
      mode: 'host',
      prefill: { question: q.question, options: q.options }
    });
  });

  // ── 방장: 플레이어 질문 뽑기 ─────────────────────────
  socket.on('host_player_question', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;
    if (room.phase !== 'waiting') return;

    const alive = getAlivePlayers(room);
    if (alive.length === 0) return;

    const chosen = alive[Math.floor(Math.random() * alive.length)];
    room.playerMakingId = chosen.id;
    room.phase = 'player_making';

    broadcastRoomState(data.roomId);
    // 선택된 플레이어에게만 편집 UI 열림
    io.to(chosen.id).emit('open_question_editor', { mode: 'player' });
    io.to(data.roomId).emit('player_making_question', {
      playerId: chosen.id,
      playerName: chosen.name,
    });
  });

  // ── 플레이어 질문 삭제 요청 (마음에 안 들 때) ────────
  socket.on('cancel_player_question', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;
    if (room.phase !== 'player_making' && room.phase !== 'host_review') return;

    // 플레이어가 아직 편집 중이면 창 닫기
    if (room.playerMakingId) {
      io.to(room.playerMakingId).emit('close_question_editor');
    }
    room.playerMakingId = null;
    room.pendingQuestion = null;
    room.phase = 'waiting';
    broadcastRoomState(data.roomId);
  });

  // ── 문제 제출 (방장 직접 → 바로 시작 / 플레이어 → 방장 검토) ──
  socket.on('submit_question', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) return;

    const isHost = room.host === socket.id;
    const isPlayerMaking = room.phase === 'player_making' && socket.id === room.playerMakingId;

    if (!isHost && !isPlayerMaking) return;

    const { question, options } = data;
    if (!question || !options || options.length !== 4) return;
    if (options.some(o => !o || !o.trim())) return;

    if (isPlayerMaking) {
      // 플레이어 제출 → 방장에게 검토/수정 에디터 열기
      room.phase = 'host_review';
      room.pendingQuestion = { question: question.trim(), options: options.map(o => o.trim()) };
      room.playerMakingId = null;
      broadcastRoomState(data.roomId);

      // 플레이어들에게 대기 메시지
      io.to(data.roomId).emit('player_submitted_question', {
        playerName: room.players.get(socket.id)?.name || '플레이어',
      });
      // 방장에게만 수정 가능한 에디터 열기
      io.to(room.host).emit('open_question_editor', {
        mode: 'host_review',
        prefill: { question: question.trim(), options: options.map(o => o.trim()) },
      });
      console.log(`Player question submitted for review in ${data.roomId}`);
    } else {
      // 방장 직접 제출 → 바로 게임 시작
      startRound(data.roomId, question.trim(), options.map(o => o.trim()));
    }
  });

  // ── 방장: 플레이어 질문 검토 후 확정 ─────────────────
  socket.on('confirm_player_question', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;
    if (room.phase !== 'host_review') return;

    const { question, options } = data;
    if (!question || !options || options.length !== 4) return;
    if (options.some(o => !o || !o.trim())) return;

    startRound(data.roomId, question.trim(), options.map(o => o.trim()));
  });

  // ── 플레이어 선택지 제출 ──────────────────────────────
  socket.on('submit_answer', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.phase !== 'selecting') return;

    const player = room.players.get(socket.id);
    if (!player || player.eliminated || player.role !== 'player') return;
    if (player.answer !== null) return;

    room.answers.set(socket.id, data.answerIndex);
    player.answer = data.answerIndex;

    broadcastRoomState(data.roomId);
    checkAllPlayersAnswered(data.roomId);
  });

  // ── 방장: 정답 선택 ───────────────────────────────────
  socket.on('select_correct_answer', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id || room.phase !== 'host_judging') return;

    room.currentQuestion.correctAnswer = data.answerIndex;
    room.phase = 'result';

    // 오답자 탈락 처리
    const eliminated = [];
    room.players.forEach((player) => {
      if (player.eliminated || player.role !== 'player') return;
      if (player.answer !== data.answerIndex) {
        player.eliminated = true;
        eliminated.push({ id: player.id, name: player.name });
      }
    });

    broadcastRoomState(data.roomId);

    const survivors = getAlivePlayers(room);
    io.to(data.roomId).emit('result_revealed', {
      correctAnswer: data.answerIndex,
      eliminated,
      survivorCount: survivors.length,
      phase: 'result',
    });

    console.log(`Result in ${data.roomId}: correct=${data.answerIndex}, eliminated=${eliminated.length}, survivors=${survivors.length}`);
  });

  // ── 방장: 다음 라운드 ─────────────────────────────────
  socket.on('next_round', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;
    if (room.phase !== 'result') return;

    const survivors = getAlivePlayers(room);

    if (survivors.length <= 1) {
      room.phase = 'finished';
      room.finalWinner = survivors[0] || null;
      broadcastRoomState(data.roomId);
      io.to(data.roomId).emit('game_finished', {
        winner: room.finalWinner,
      });
      return;
    }

    room.currentRound++;
    room.phase = 'waiting';
    room.currentQuestion = null;
    room.playerMakingId = null;
    room.answers.clear();
    room.players.forEach(p => { p.answer = null; });

    broadcastRoomState(data.roomId);
    io.to(data.roomId).emit('round_waiting', { round: room.currentRound });
    console.log(`Round ${room.currentRound} waiting in ${data.roomId}`);
  });

  // ── 게임 시작 (첫 라운드 또는 재시작) ───────────────────
  socket.on('start_game', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;
    // waiting(게임 전) 또는 finished(재시작) 상태에서만 허용
    if (room.phase !== 'waiting' && room.phase !== 'finished') return;

    clearPhaseTimer(data.roomId);
    room.currentRound = 1;
    room.phase = 'waiting';
    room.currentQuestion = null;
    room.playerMakingId = null;
    room.finalWinner = null;
    room.answers.clear();
    room.usedPresetIds.clear();
    room.players.forEach(p => {
      p.answer = null;
      p.eliminated = false;
      p.score = 0;
    });

    broadcastRoomState(data.roomId);
    io.to(data.roomId).emit('game_started', { round: 1 });
    console.log(`Game started in ${data.roomId}`);
  });

  // ── 독대 채팅 (finished 단계) ──────────────────────────
  socket.on('final_chat', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.phase !== 'finished') return;

    const sender = room.players.get(socket.id);
    if (!sender) return;

    const isHost = socket.id === room.host;
    const isWinner = room.finalWinner && socket.id === room.finalWinner.id;
    if (!isHost && !isWinner) return;

    const winnerId = room.finalWinner?.id;
    if (!winnerId) return;

    io.to(room.host).to(winnerId).emit('final_chat_message', {
      senderId: socket.id,
      senderName: sender.name,
      message: data.message,
    });
  });

  // ── 방장: 방 폭파 ─────────────────────────────────────
  socket.on('destroy_room', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;

    clearPhaseTimer(data.roomId);
    io.to(data.roomId).emit('room_destroyed');
    rooms.delete(data.roomId);
    console.log(`Room ${data.roomId} destroyed by host`);
  });

  // ── 재접속 ────────────────────────────────────────────
  socket.on('rejoin_room', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) { socket.emit('error', { message: '방을 찾을 수 없습니다.' }); return; }

    if (room.players.has(socket.id)) {
      socket.join(data.roomId);
      broadcastRoomState(data.roomId);
      return;
    }

    // 같은 이름+역할 찾아서 소켓 ID만 교체
    let existing = null, oldId = null;
    room.players.forEach((p, id) => {
      if (p.name === data.name && p.role === data.role) { existing = p; oldId = id; }
    });

    if (existing && oldId !== socket.id) {
      room.players.delete(oldId);
      existing.id = socket.id;
      room.players.set(socket.id, existing);
      if (room.answers.has(oldId)) {
        room.answers.set(socket.id, room.answers.get(oldId));
        room.answers.delete(oldId);
      }
      if (room.playerMakingId === oldId) room.playerMakingId = socket.id;
    } else if (!existing) {
      room.players.set(socket.id, {
        id: socket.id, name: data.name, role: data.role,
        answer: null, eliminated: false, score: 0,
      });
    }

    if (data.role === 'host') room.host = socket.id;

    socket.join(data.roomId);
    broadcastRoomState(data.roomId);
  });

  // ── 연결 해제 ─────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);

    rooms.forEach((room, roomId) => {
      if (!room.players.has(socket.id)) return;

      const wasHost = room.host === socket.id;
      const disconnectedId = socket.id;

      setTimeout(() => {
        if (!room.players.has(disconnectedId)) return;

        room.players.delete(disconnectedId);

        if (wasHost && room.host === disconnectedId) {
          clearPhaseTimer(roomId);
          io.to(roomId).emit('room_destroyed');
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (host disconnected)`);
        } else {
          broadcastRoomState(roomId);
        }
      }, 5000);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access at: http://localhost:${PORT}`);
});
