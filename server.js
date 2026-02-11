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

const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf-8'));

const rooms = new Map();

// 방 내 닉네임 중복 확인 후 고유 이름 반환
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
    currentQuestion: null,
    currentRound: 1,
    phase: 'waiting',
    answers: new Map(),
    excuses: new Map(),
    currentChatPlayer: null,
    usedQuestions: new Set(),
    rescuedPlayers: new Set()
  });
}

function getRandomQuestion(room) {
  const available = questions.filter(q => !room.usedQuestions.has(q.id));
  if (available.length === 0) {
    room.usedQuestions.clear();
    return questions[Math.floor(Math.random() * questions.length)];
  }
  return available[Math.floor(Math.random() * available.length)];
}

// 플레이어(방장 제외) 중 살아있고 아직 답 안 한 사람 수 체크 후 자동 진행
function checkAllPlayersAnswered(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.phase !== 'selecting') return;

  const alivePlayers = Array.from(room.players.values()).filter(p =>
    !p.eliminated && p.role === 'player'
  );
  const answeredCount = alivePlayers.filter(p => p.answer !== null).length;

  if (alivePlayers.length > 0 && answeredCount === alivePlayers.length) {
    room.phase = 'question_reveal';
    io.to(roomId).emit('all_answered', {
      question: room.currentQuestion.question,
      phase: 'question_reveal'
    });
    console.log(`All players answered in room ${roomId}, revealing question`);
  }
}

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // 방 생성
  socket.on('create_room', (data) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    createRoom(roomId, socket.id, data.name);

    const room = rooms.get(roomId);
    room.players.set(socket.id, {
      id: socket.id,
      name: data.name,
      role: 'host',
      answer: null,
      excuse: '',
      likes: 0,
      eliminated: false
    });

    socket.join(roomId);
    socket.emit('room_created', { roomId, role: 'host' });
    console.log(`Room created: ${roomId} by ${data.name}`);
  });

  // 방 참가
  socket.on('join_room', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) {
      socket.emit('error', { message: '방을 찾을 수 없습니다.' });
      return;
    }

    const role = data.role || 'player';
    const uniqueName = getUniqueName(room, data.name);

    room.players.set(socket.id, {
      id: socket.id,
      name: uniqueName,
      role: role,
      answer: null,
      excuse: '',
      likes: 0,
      eliminated: false
    });

    socket.join(data.roomId);
    socket.emit('joined_room', { roomId: data.roomId, role: role, name: uniqueName });

    broadcastRoomState(data.roomId);
    console.log(`${uniqueName} joined room ${data.roomId} as ${role}`);
  });

  // 게임 시작
  socket.on('start_game', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;

    const question = getRandomQuestion(room);
    room.currentQuestion = question;
    room.usedQuestions.add(question.id);
    room.phase = 'selecting';
    room.answers.clear();
    room.excuses.clear();
    room.rescuedPlayers.clear();

    // 플레이어 답변/변명 초기화
    room.players.forEach(player => {
      player.answer = null;
      player.excuse = '';
      player.likes = 0;
    });

    io.to(data.roomId).emit('round_started', {
      round: room.currentRound,
      options: question.options,
      phase: 'selecting'
    });

    console.log(`Game started in room ${data.roomId}, Round ${room.currentRound}`);
  });

  // 플레이어 답변 제출 (방장은 제출 불가)
  socket.on('submit_answer', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.phase !== 'selecting') return;

    const player = room.players.get(socket.id);
    if (!player || player.eliminated || player.role !== 'player') return;
    if (player.answer !== null) return; // 이미 답변함

    room.answers.set(socket.id, data.answerIndex);
    player.answer = data.answerIndex;

    broadcastRoomState(data.roomId);
    checkAllPlayersAnswered(data.roomId);
  });

  // 방장이 정답 선택
  socket.on('select_correct_answer', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id || room.phase !== 'question_reveal') return;

    room.currentQuestion.correctAnswer = data.answerIndex;
    room.phase = 'excuse';

    const wrongPlayers = [];
    room.players.forEach((player, id) => {
      if (player.eliminated || player.role !== 'player') return;
      if (player.answer !== data.answerIndex) {
        wrongPlayers.push({ id, name: player.name });
      }
    });

    io.to(data.roomId).emit('answer_revealed', {
      correctAnswer: data.answerIndex,
      wrongPlayers: wrongPlayers,
      phase: 'excuse'
    });

    console.log(`Correct answer set: ${data.answerIndex} in room ${data.roomId}`);
  });

  // 변명 제출
  socket.on('submit_excuse', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.phase !== 'excuse') return;

    const player = room.players.get(socket.id);
    if (!player || player.eliminated || player.role !== 'player') return;
    if (player.answer === room.currentQuestion.correctAnswer) return;
    if (player.excuse) return; // 이미 제출함

    player.excuse = data.excuse.substring(0, 20);
    room.excuses.set(socket.id, player.excuse);

    broadcastRoomState(data.roomId);
  });

  // 좋아요 (관전자 제외)
  socket.on('like_excuse', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) return;

    const liker = room.players.get(socket.id);
    if (!liker || liker.role === 'spectator') return;

    const target = room.players.get(data.playerId);
    if (target && target.excuse) {
      target.likes = (target.likes || 0) + 1;
      broadcastRoomState(data.roomId);
    }
  });

  // 1:1 채팅 시작
  socket.on('start_chat', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;

    room.currentChatPlayer = data.playerId;
    room.phase = 'chat';

    io.to(data.roomId).emit('chat_started', {
      playerId: data.playerId,
      playerName: room.players.get(data.playerId)?.name
    });
  });

  // 1:1 채팅 메시지 (관전자 불가, 방장+대상 플레이어만)
  socket.on('chat_message', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.phase !== 'chat') return;

    const player = room.players.get(socket.id);
    if (!player || player.role === 'spectator') return;

    if (socket.id === room.host || socket.id === room.currentChatPlayer) {
      io.to(room.host).to(room.currentChatPlayer).emit('chat_message', {
        senderId: socket.id,
        senderName: player.name,
        message: data.message
      });
    }
  });

  // 플레이어 구제/탈락
  socket.on('judge_player', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;

    const player = room.players.get(data.playerId);
    if (!player) return;

    if (data.rescue) {
      room.rescuedPlayers.add(data.playerId);
      io.to(data.roomId).emit('player_rescued', {
        playerId: data.playerId,
        playerName: player.name
      });
    } else {
      player.eliminated = true;
      io.to(data.roomId).emit('player_eliminated', {
        playerId: data.playerId,
        playerName: player.name
      });
    }

    room.currentChatPlayer = null;
    room.phase = 'excuse';
    broadcastRoomState(data.roomId);
  });

  // 다음 라운드
  socket.on('next_round', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;

    // 구제받지 못한 오답자 강제 탈락
    room.players.forEach((player, id) => {
      if (
        player.role === 'player' &&
        !player.eliminated &&
        player.answer !== room.currentQuestion.correctAnswer &&
        !room.rescuedPlayers.has(id)
      ) {
        player.eliminated = true;
      }
    });

    const survivors = Array.from(room.players.values()).filter(p =>
      !p.eliminated && p.role !== 'spectator'
    );

    if (survivors.length <= 1) {
      room.phase = 'finished';
      io.to(data.roomId).emit('game_finished', {
        winner: survivors[0] || null
      });
      return;
    }

    room.currentRound++;
    const question = getRandomQuestion(room);
    room.currentQuestion = question;
    room.usedQuestions.add(question.id);
    room.phase = 'selecting';
    room.answers.clear();
    room.excuses.clear();
    room.rescuedPlayers.clear();

    room.players.forEach(player => {
      player.answer = null;
      player.excuse = '';
      player.likes = 0;
    });

    io.to(data.roomId).emit('round_started', {
      round: room.currentRound,
      options: question.options,
      phase: 'selecting'
    });

    console.log(`Next round ${room.currentRound} in room ${data.roomId}`);
  });

  // 페이지 이동 후 재참가
  socket.on('rejoin_room', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) {
      socket.emit('error', { message: '방을 찾을 수 없습니다.' });
      return;
    }

    if (room.players.has(socket.id)) {
      socket.join(data.roomId);
      broadcastRoomState(data.roomId);
      return;
    }

    // 같은 이름+역할의 기존 항목 제거 (이전 소켓 ID 정리)
    room.players.forEach((p, oldId) => {
      if (p.name === data.name && p.role === data.role) {
        room.players.delete(oldId);
      }
    });

    room.players.set(socket.id, {
      id: socket.id,
      name: data.name,
      role: data.role,
      answer: null,
      excuse: '',
      likes: 0,
      eliminated: false
    });

    if (data.role === 'host') {
      room.host = socket.id;
    }

    socket.join(data.roomId);
    broadcastRoomState(data.roomId);
  });

  // 방 상태 전송 요청
  socket.on('get_room_state', (data) => {
    broadcastRoomState(data.roomId);
  });

  // 연결 해제 (5초 대기 후 진짜 나간 것으로 처리)
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);

    rooms.forEach((room, roomId) => {
      if (!room.players.has(socket.id)) return;

      const wasHost = room.host === socket.id;
      const disconnectedSocketId = socket.id;

      setTimeout(() => {
        if (!room.players.has(disconnectedSocketId)) return;

        room.players.delete(disconnectedSocketId);

        if (wasHost && room.host === disconnectedSocketId) {
          io.to(roomId).emit('host_left');
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (host left)`);
        } else {
          broadcastRoomState(roomId);
        }
      }, 5000);
    });
  });
});

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const state = {
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      answer: p.answer,
      excuse: p.excuse,
      likes: p.likes,
      eliminated: p.eliminated
    })),
    phase: room.phase,
    round: room.currentRound,
    currentChatPlayer: room.currentChatPlayer,
    hostId: room.host
  };

  io.to(roomId).emit('room_state', state);
}

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access at: http://localhost:${PORT}`);
});
