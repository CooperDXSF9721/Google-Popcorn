// Setup Canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const ARENA_RADIUS = 350;
canvas.width = ARENA_RADIUS * 2 + 40;
canvas.height = ARENA_RADIUS * 2 + 40;
const CENTER = { x: canvas.width / 2, y: canvas.height / 2 };

// Game State
let gameState = 'MENU';
let peer = null;
let roomConnections = []; // Host list of player connections
let hostConn = null;      // Client connection to Host
let isHost = false;
let myPlayerId = null;
let mySelectedClass = 'heal';

let currentLevel = 1;
let levelTimer = 0;
let levelDuration = 25; // 25 seconds per level

// Entities
let playerStates = {}; 
let hazards = [];
let lingeringFires = [];
let lightningStrikes = [];

// Input Management
const keys = {};
window.addEventListener('keydown', e => {
    // PREVENT SPACEBAR FROM SCROLLING OR TRIGGERING RESTART ACCIDENTALLY
    if (e.code === 'Space') e.preventDefault();
    keys[e.code] = true;
});
window.addEventListener('keyup', e => {
    if (e.code === 'Space') e.preventDefault();
    keys[e.code] = false;
});

// UI Bindings
const uiOverlay = document.getElementById('ui-overlay');
const gameoverOverlay = document.getElementById('gameover-overlay');
const hud = document.getElementById('hud');
const startBtn = document.getElementById('start-btn');
const roomCodeInput = document.getElementById('room-code');
const nameInput = document.getElementById('player-name');
const levelDisplay = document.getElementById('level-display');
const eventBanner = document.getElementById('event-banner');

document.querySelectorAll('.class-card').forEach(card => {
    card.onclick = () => {
        document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        mySelectedClass = card.getAttribute('data-class');
    };
});

// Netcode Setup (PeerJS)
document.getElementById('btn-create-room').onclick = () => {
    const code = 'POP-' + Math.floor(1000 + Math.random() * 9000);
    initPeer(code, true);
};

document.getElementById('btn-join-room').onclick = () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code) return alert("Please enter a valid Room Code");
    initPeer(null, false, code);
};

function initPeer(customId, hostFlag, targetRoomCode) {
    isHost = hostFlag;
    peer = new Peer(customId);

    peer.on('open', (id) => {
        myPlayerId = id;
        document.getElementById('lobby-setup').classList.add('hidden');
        document.getElementById('waiting-room').classList.remove('hidden');
        document.getElementById('display-room-code').innerText = isHost ? id : targetRoomCode;

        if (isHost) {
            registerPlayer(myPlayerId, nameInput.value, mySelectedClass);
            updateLobbyStatus();
        } else {
            hostConn = peer.connect(targetRoomCode);
            setupClientEvents(hostConn);
        }
    });

    peer.on('connection', (conn) => {
        if (isHost) {
            roomConnections.push(conn);
            conn.on('data', (data) => handleHostReceiveData(conn, data));
            conn.on('close', () => {
                delete playerStates[conn.peer];
                updateLobbyStatus();
            });
        }
    });
}

function setupClientEvents(conn) {
    conn.on('open', () => {
        conn.send({ type: 'JOIN', name: nameInput.value, selectedClass: mySelectedClass });
    });
    conn.on('data', (data) => {
        if (data.type === 'LOBBY_UPDATE') {
            playerStates = data.players;
            updateLobbyStatusUI(data.playerCount);
        } else if (data.type === 'START_GAME') {
            startGameClient();
        } else if (data.type === 'GAME_SYNC') {
            playerStates = data.players;
            hazards = data.hazards;
            lingeringFires = data.lingeringFires;
            lightningStrikes = data.lightningStrikes;
            currentLevel = data.currentLevel;
        }
    });
}

function registerPlayer(id, name, cls) {
    playerStates[id] = {
        id: id,
        name: name || 'Kernel',
        class: cls,
        x: CENTER.x + (Math.random() - 0.5) * 200,
        y: CENTER.y + (Math.random() - 0.5) * 200,
        hearts: 2,
        isDead: false,
        cooldown: 0,
        shieldActive: false
    };
}

function handleHostReceiveData(conn, data) {
    if (data.type === 'JOIN') {
        registerPlayer(conn.peer, data.name, data.selectedClass);
        updateLobbyStatus();
    } else if (data.type === 'INPUT') {
        if (playerStates[conn.peer]) {
            playerStates[conn.peer].inputs = data.inputs;
            if (data.useAbility) triggerAbility(playerStates[conn.peer]);
        }
    }
}

function updateLobbyStatus() {
    const count = Object.keys(playerStates).length;
    updateLobbyStatusUI(count);
    
    // Broadcast lobby status
    roomConnections.forEach(c => c.send({
        type: 'LOBBY_UPDATE',
        players: playerStates,
        playerCount: count
    }));

    if (count >= 3) {
        startBtn.disabled = false;
        startBtn.innerText = "START MATCH (" + count + " PLAYERS)";
        startBtn.onclick = () => {
            roomConnections.forEach(c => c.send({ type: 'START_GAME' }));
            startGameHost();
        };
    } else {
        startBtn.disabled = true;
        startBtn.innerText = `WAITING FOR PLAYERS (${count}/3 MIN)`;
    }
}

function updateLobbyStatusUI(count) {
    document.getElementById('player-count-status').innerText = `Connected Players: ${count} (3 Minimum Required)`;
    const list = document.getElementById('player-list-container');
    list.innerHTML = Object.values(playerStates).map(p => `<div style="color:#ffb703;margin:4px;">🍿 ${p.name} (${p.class.toUpperCase()})</div>`).join('');
}

// Ability Logic
function triggerAbility(player) {
    if (player.cooldown > 0 || player.isDead) return;

    if (player.class === 'heal') {
        hazards = hazards.filter(h => {
            let d = Math.hypot(h.x - player.x, h.y - player.y);
            if (d < 100) return false;
            return true;
        });
        player.hearts = Math.min(2, player.hearts + 1);
        player.cooldown = 400;

    } else if (player.class === 'shield') {
        player.shieldActive = true;
        setTimeout(() => player.shieldActive = false, 2500);
        player.cooldown = 350;

    } else if (player.class === 'catch') {
        let caught = hazards.find(h => Math.hypot(h.x - player.x, h.y - player.y) < 80);
        if (caught) {
            hazards.splice(hazards.indexOf(caught), 1);
            let angle = Math.atan2(CENTER.y - player.y, CENTER.x - player.x);
            hazards.push({
                x: player.x, y: player.y,
                vx: Math.cos(angle) * 7, vy: Math.sin(angle) * 7,
                radius: 12, color: '#ff0055', type: 'reflected', life: 180
            });
            player.cooldown = 200;
        }
    }
}

// Game Engines
function startGameHost() {
    gameState = 'PLAYING';
    uiOverlay.classList.add('hidden');
    hud.classList.remove('hidden');
    levelTimer = 0;
    currentLevel = 1;
    requestAnimationFrame(hostLoop);
}

function startGameClient() {
    gameState = 'PLAYING';
    uiOverlay.classList.add('hidden');
    hud.classList.remove('hidden');
    requestAnimationFrame(clientLoop);
}

// Host Main Processing Loop
let rotAngle = 0;
function hostLoop() {
    if (gameState !== 'PLAYING') return;

    levelTimer += 1 / 60;
    rotAngle += 0.02;

    // Check Level Progression
    if (levelTimer > levelDuration && currentLevel < 4) {
        currentLevel++;
        levelTimer = 0;
        showBanner(`LEVEL ${currentLevel} ENTERED!`);
    }

    // Process Player Movement Inputs
    Object.values(playerStates).forEach(p => {
        if (p.isDead) return;
        
        let inp = (p.id === myPlayerId) ? readLocalInputs() : p.inputs;
        if (inp) {
            let spd = 2.5; // Slower, precision-focused movement speed
            if (inp.up) p.y -= spd;
            if (inp.down) p.y += spd;
            if (inp.left) p.x -= spd;
            if (inp.right) p.x += spd;

            // Boundaries
            let dist = Math.hypot(p.x - CENTER.x, p.y - CENTER.y);
            if (dist > ARENA_RADIUS - 16) {
                let a = Math.atan2(p.y - CENTER.y, p.x - CENTER.x);
                p.x = CENTER.x + Math.cos(a) * (ARENA_RADIUS - 16);
                p.y = CENTER.y + Math.sin(a) * (ARENA_RADIUS - 16);
            }
        }
        if (p.cooldown > 0) p.cooldown--;
    });

    // Check local Space ability activation
    if (keys['Space']) {
        triggerAbility(playerStates[myPlayerId]);
        keys['Space'] = false; // Prevent hold reset
    }

    // LEVEL ATTACK PATTERNS
    spawnLevelAttacks();

    // Hazard Collisions
    hazards = hazards.filter(h => {
        h.x += h.vx || 0;
        h.y += h.vy || 0;
        if (h.life !== undefined) h.life--;

        // Check player hits
        Object.values(playerStates).forEach(p => {
            if (p.isDead) return;
            if (Math.hypot(p.x - h.x, p.y - h.y) < h.radius + 14) {
                if (!p.shieldActive) {
                    p.hearts--;
                    if (p.hearts <= 0) p.isDead = true;
                }
            }
        });

        return h.life === undefined || h.life > 0;
    });

    // Lingering Fire Collisions
    lingeringFires = lingeringFires.filter(f => {
        f.life--;
        Object.values(playerStates).forEach(p => {
            if (!p.isDead && Math.hypot(p.x - f.x, p.y - f.y) < f.radius + 12) {
                if (!p.shieldActive) {
                    p.hearts--;
                    if (p.hearts <= 0) p.isDead = true;
                }
            }
        });
        return f.life > 0;
    });

    // Broadcast Game State to Clients
    roomConnections.forEach(c => c.send({
        type: 'GAME_SYNC',
        players: playerStates,
        hazards: hazards,
        lingeringFires: lingeringFires,
        lightningStrikes: lightningStrikes,
        currentLevel: currentLevel
    }));

    renderCanvas();
    requestAnimationFrame(hostLoop);
}

// Client Loop
function clientLoop() {
    if (gameState !== 'PLAYING') return;

    // Send local key state to Host
    if (hostConn) {
        hostConn.send({
            type: 'INPUT',
            inputs: readLocalInputs(),
            useAbility: keys['Space']
        });
        if (keys['Space']) keys['Space'] = false;
    }

    renderCanvas();
    requestAnimationFrame(clientLoop);
}

function readLocalInputs() {
    return {
        up: keys['KeyW'] || keys['ArrowUp'],
        down: keys['KeyS'] || keys['ArrowDown'],
        left: keys['KeyA'] || keys['ArrowLeft'],
        right: keys['KeyD'] || keys['ArrowRight']
    };
}

// Hazard Spawners
function spawnLevelAttacks() {
    // Level 1: Butter Cannon
    if (currentLevel >= 1 && Math.random() < 0.05) {
        let a = Math.random() * Math.PI * 2;
        hazards.push({
            x: CENTER.x + Math.cos(a) * ARENA_RADIUS,
            y: CENTER.y + Math.sin(a) * ARENA_RADIUS,
            vx: -Math.cos(a) * 2.5, vy: -Math.sin(a) * 2.5,
            radius: 12, color: '#ffb703', life: 300
        });
    }

    // Level 2: Salt Shaker (Cubes + Salt Rain)
    if (currentLevel >= 2) {
        if (Math.random() < 0.03) {
            let a = Math.random() * Math.PI * 2;
            hazards.push({
                x: CENTER.x, y: CENTER.y,
                vx: Math.cos(a) * 3, vy: Math.sin(a) * 3,
                radius: 8, color: '#ffffff', life: 200
            });
        }
        if (Math.random() < 0.02) { // Salt Rain
            hazards.push({
                x: CENTER.x + (Math.random() - 0.5) * ARENA_RADIUS * 1.6,
                y: CENTER.y + (Math.random() - 0.5) * ARENA_RADIUS * 1.6,
                vx: 0, vy: 0, radius: 14, color: 'rgba(255,255,255,0.8)', life: 60
            });
        }
    }

    // Level 3: Fire Lines & Lingering Fireballs
    if (currentLevel >= 3) {
        if (Math.random() < 0.04) {
            let a = Math.random() * Math.PI * 2;
            let fx = CENTER.x + Math.cos(a) * (Math.random() * ARENA_RADIUS);
            let fy = CENTER.y + Math.sin(a) * (Math.random() * ARENA_RADIUS);
            lingeringFires.push({ x: fx, y: fy, radius: 18, life: 240 });
        }
    }

    // Level 4: Microwave Boss Attacks
    if (currentLevel >= 4) {
        if (Math.random() < 0.02) { // Ring waves
            for (let i = 0; i < 12; i++) {
                let a = rotAngle + (Math.PI * 2 / 12) * i;
                hazards.push({
                    x: CENTER.x, y: CENTER.y,
                    vx: Math.cos(a) * 3.5, vy: Math.sin(a) * 3.5,
                    radius: 7, color: '#48cae4', life: 180
                });
            }
        }
    }
}

function showBanner(txt) {
    eventBanner.innerText = txt;
    eventBanner.classList.add('visible');
    setTimeout(() => eventBanner.classList.remove('visible'), 2500);
}

// Rendering Logic
function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Arena Background
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#12131c';
    ctx.fill();
    ctx.strokeStyle = currentLevel === 4 ? '#e63946' : '#ffb703';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Rotating Fire Lines for Level 3 & 4 Boss
    if (currentLevel >= 3) {
        ctx.save();
        ctx.strokeStyle = 'rgba(230, 57, 70, 0.4)';
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(CENTER.x + Math.cos(rotAngle) * ARENA_RADIUS, CENTER.y + Math.sin(rotAngle) * ARENA_RADIUS);
        ctx.lineTo(CENTER.x - Math.cos(rotAngle) * ARENA_RADIUS, CENTER.y - Math.sin(rotAngle) * ARENA_RADIUS);
        ctx.stroke();
        ctx.restore();
    }

    // Lingering Fires
    lingeringFires.forEach(f => {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(247, 127, 0, 0.6)';
        ctx.fill();
    });

    // Hazards
    hazards.forEach(h => {
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
        ctx.fillStyle = h.color;
        ctx.fill();
    });

    // Players
    Object.values(playerStates).forEach(p => {
        if (p.isDead) return;

        ctx.save();
        ctx.translate(p.x, p.y);

        if (p.shieldActive) {
            ctx.beginPath();
            ctx.arc(0, 0, 22, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(42, 157, 143, 0.4)';
            ctx.fill();
        }

        // Draw Kernel
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fillStyle = p.id === myPlayerId ? '#ffffff' : '#ffc83b';
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.stroke();

        // Name
        ctx.fillStyle = '#fff';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, 0, 26);

        ctx.restore();
    });

    // Update Level Hud text
    const levelNames = ["1: BUTTER SPRAY", "2: SALT SHAKER", "3: FIRE LINES", "4: MICROWAVE BOSS"];
    levelDisplay.innerText = "LEVEL " + levelNames[currentLevel - 1];

    if (playerStates[myPlayerId]) {
        let p = playerStates[myPlayerId];
        document.getElementById('player-hearts').innerText = p.hearts === 2 ? "❤️ ❤️" : (p.hearts === 1 ? "❤️ 🖤" : "🖤 🖤");
    }
}
