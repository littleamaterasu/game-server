const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    }
});

const PORT = 3000;

// Bản đồ 1000x1000
const MAP_SIZE = 100;
const map = Array.from({ length: MAP_SIZE }, () =>
    Array.from({ length: MAP_SIZE }, () => (Math.random() > 0.8 ? 1 : 0))
);
let items = [];

function isObstacle(x, y) {
    return y < 0 || y >= MAP_SIZE || x < 0 || x >= MAP_SIZE || map[y][x] === 1;
}

// Dữ liệu người chơi
let players = {};

// Khi client kết nối
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Khởi tạo người chơi
    players[socket.id] = {
        x: Math.floor(MAP_SIZE / 2),
        y: Math.floor(MAP_SIZE / 2),
        hp: 100,
        score: 0,
    };

    // Gửi thông tin ban đầu
    socket.emit('currentPlayers', players);
    socket.emit('map', { size: MAP_SIZE, map: map });

    // Phát thông tin người chơi mới cho các client khác
    socket.broadcast.emit('newPlayer', { id: socket.id, position: players[socket.id] });

    setInterval(() => {
        if (items.length < 1000) {
            const newItem = {
                id: Date.now(),
                x: Math.floor(Math.random() * MAP_SIZE),
                y: Math.floor(Math.random() * MAP_SIZE),
                type: Math.random() > 0.5 ? 'heal' : 'damage',
            };
            items.push(newItem);
            io.emit('mapItems', items);
        }
    }, 1000);

    // Nhận sự kiện di chuyển
    socket.on('move', (data) => {
        let player = players[socket.id];
        if (!player) return;

        let newX = player.x + data.dx;
        let newY = player.y + data.dy;

        if (!isObstacle(newX, player.y)) player.x = newX;
        if (!isObstacle(player.x, newY)) player.y = newY;

        io.emit('updatePosition', { id: socket.id, position: player });
    });

    // Nhận sự kiện bắn tia
    socket.on('shoot', (data) => {
        const player = players[socket.id];
        if (!player) return;

        let x = player.x;
        let y = player.y;

        // Tìm điểm kết thúc của tia
        while (!isObstacle(x + data.dx, y + data.dy)) {
            x += data.dx;
            y += data.dy;

            // Kiểm tra va chạm với người chơi
            for (let id in players) {
                if (id !== socket.id && players[id].x === x && players[id].y === y) {
                    players[id].hp -= Math.floor(Math.random() * 10) + 1;

                    if (players[id].hp <= 0) {
                        players[socket.id].score += 1;
                        players[id] = {
                            x: Math.floor(Math.random() * (MAP_SIZE - 20)) + 10,
                            y: Math.floor(Math.random() * (MAP_SIZE - 20)) + 10,
                            hp: 100,
                            score: players[id].score,
                        };
                        io.emit('playerRespawned', { id, position: players[id] });
                    }

                    io.emit('updateHealth', { id, hp: players[id].hp });
                    break;
                }
            }
        }

        // Phát thông tin về tia
        io.emit('newBeam', {
            startX: player.x,
            startY: player.y,
            endX: x,
            endY: y,
            owner: socket.id,
        });

        io.on('pickupItem', (position) => {
            const player = players[socket.id];
            if (!player) return;

            // Kiểm tra người chơi có ở gần item không
            const itemIndex = items.findIndex(
                (item) =>
                    Math.abs(item.x - position.x) <= 1 &&
                    Math.abs(item.y - position.y) <= 1
            );

            if (itemIndex !== -1) {
                const pickedItem = items[itemIndex];

                // Áp dụng hiệu ứng của item
                if (pickedItem.type === 'heal') {
                    player.hp = Math.min(100, player.hp + 10); // Tăng máu tối đa là 100
                } else if (pickedItem.type === 'damage') {
                    player.hp = Math.max(0, player.hp - 10); // Giảm máu tối thiểu là 0
                }

                // Xóa item khỏi danh sách
                items.splice(itemIndex, 1);

                // Gửi danh sách item đã cập nhật và trạng thái người chơi
                io.emit('mapItems', items);
                io.emit('updatePosition', { id: socket.id, position: player });
            }
        });
    });

    // Khi người chơi ngắt kết nối
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});