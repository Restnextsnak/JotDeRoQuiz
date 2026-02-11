const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

// 정적 파일 제공
app.use(express.static('public'));

// 문제 데이터 로드
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf-8'));

// 게임 상태 관리
const rooms = new Map();

// 방 생성
function createRoom(roomId, hostId, hostName) {
  rooms.set(roomId, {
    id: roomId,
    host: hostId,
    hostName: hostName,
    players: new Map(), // playerId -> { id, name, role, answer, excuse, likes, eliminated }
    currentQuestion: null,
    currentRound: 1,
    phase: 'waiting', // waiting, selecting, question_reveal, excuse, chat, results
    answers: new Map(), // playerId -> answerIndex
    excuses: new Map(), // playerId -> excuse text
    currentChatPlayer: null, // 현재 1:1 채팅 중인 플레이어 ID
    usedQuestions: new Set(),
    rescuedPlayers: new Set() // 이번 라운드에 구제된 플레이어들
  });
}

// 랜덤 문제 선택 (사용하지 않은 문제 중)
function getRandomQuestion(room) {
  const availableQuestions = questions.filter(q => !room.usedQuestions.has(q.id));
  if (availableQuestions.length === 0) {
    // 모든 문제 사용했으면 리셋
    room.usedQuestions.clear();
    return questions[Math.floor(Math.random() * questions.length)];
  }
  return availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
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

    const role = data.role || 'player'; // host, player, spectator
    
    room.players.set(socket.id, {
      id: socket.id,
      name: data.name,
      role: role,
      answer: null,
      excuse: '',
      likes: 0,
      eliminated: false
    });

    socket.join(data.roomId);
    socket.emit('joined_room', { roomId: data.roomId, role: role });
    
    // 방 전체에 플레이어 목록 업데이트
    broadcastRoomState(data.roomId);
    console.log(`${data.name} joined room ${data.roomId} as ${role}`);
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

    // 플레이어들에게는 선택지만 보냄 (문제 숨김)
    io.to(data.roomId).emit('round_started', {
      round: room.currentRound,
      options: question.options,
      phase: 'selecting'
    });

    console.log(`Game started in room ${data.roomId}, Round ${room.currentRound}`);
  });

  // 플레이어 답변 제출
  socket.on('submit_answer', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.phase !== 'selecting') return;

    const player = room.players.get(socket.id);
    if (!player || player.eliminated || player.role === 'spectator') return;

    room.answers.set(socket.id, data.answerIndex);
    player.answer = data.answerIndex;

    // 모든 살아있는 플레이어가 답했는지 확인
    const alivePlayers = Array.from(room.players.values()).filter(p => 
      !p.eliminated && p.role !== 'spectator'
    );
    const answeredCount = Array.from(room.answers.keys()).filter(id => {
      const p = room.players.get(id);
      return p && !p.eliminated && p.role !== 'spectator';
    }).length;

    broadcastRoomState(data.roomId);

    if (answeredCount === alivePlayers.length) {
      // 모두 답변 완료 - 문제 공개 단계로
      room.phase = 'question_reveal';
      io.to(data.roomId).emit('all_answered', {
        question: room.currentQuestion.question,
        phase: 'question_reveal'
      });
    }
  });

  // 방장이 정답 선택
  socket.on('select_correct_answer', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id || room.phase !== 'question_reveal') return;

    room.currentQuestion.correctAnswer = data.answerIndex;
    room.phase = 'excuse';

    // 오답자 찾기
    const wrongPlayers = [];
    room.players.forEach((player, id) => {
      if (player.eliminated || player.role === 'spectator') return;
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
    if (!player || player.eliminated || player.role === 'spectator') return;
    if (player.answer === room.currentQuestion.correctAnswer) return;

    player.excuse = data.excuse.substring(0, 20); // 20자 제한
    room.excuses.set(socket.id, player.excuse);

    broadcastRoomState(data.roomId);
  });

  // 좋아요
  socket.on('like_excuse', (data) => {
    const room = rooms.get(data.roomId);
    if (!room) return;

    const player = room.players.get(data.playerId);
    if (player && player.excuse) {
      player.likes = (player.likes || 0) + 1;
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

  // 1:1 채팅 메시지
  socket.on('chat_message', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.phase !== 'chat') return;

    const player = room.players.get(socket.id);
    if (!player) return;

    // 방장과 현재 채팅 중인 플레이어만 메시지 전송 가능
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

    // 채팅 종료
    room.currentChatPlayer = null;
    room.phase = 'excuse'; // 변명 단계로 복귀
    broadcastRoomState(data.roomId);
  });

  // 다음 라운드
  socket.on('next_round', (data) => {
    const room = rooms.get(data.roomId);
    if (!room || room.host !== socket.id) return;

    // 구제받지 못한 오답자들 모두 탈락
    room.players.forEach((player, id) => {
      if (player.answer !== room.currentQuestion.correctAnswer && 
          !room.rescuedPlayers.has(id) &&
          !player.eliminated &&
          player.role !== 'spectator') {
        player.eliminated = true;
      }
    });

    // 생존자 확인
    const survivors = Array.from(room.players.values()).filter(p => 
      !p.eliminated && p.role !== 'spectator'
    );

    if (survivors.length <= 1) {
      // 게임 종료
      room.phase = 'finished';
      io.to(data.roomId).emit('game_finished', {
        winner: survivors[0] || null
      });
      return;
    }

    // 다음 라운드 시작
    room.currentRound++;
    const question = getRandomQuestion(room);
    room.currentQuestion = question;
    room.usedQuestions.add(question.id);
    room.phase = 'selecting';
    room.answers.clear();
    room.excuses.clear();
    room.rescuedPlayers.clear();

    // likes 초기화
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

  // 방 상태 전송 요청
  socket.on('get_room_state', (data) => {
    broadcastRoomState(data.roomId);
  });

  // 연결 해제
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    
    // 방에서 플레이어 제거
    rooms.forEach((room, roomId) => {
      if (room.players.has(socket.id)) {
        room.players.delete(socket.id);
        broadcastRoomState(roomId);
        
        // 방장이 나가면 방 삭제
        if (room.host === socket.id) {
          io.to(roomId).emit('host_left');
          rooms.delete(roomId);
          console.log(`Room ${roomId} deleted (host left)`);
        }
      }
    });
  });
});

// 방 전체 상태 브로드캐스트
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
