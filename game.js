// Setup Canvas and Fullscreen Resolution
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Map & Camera Dimensions
const MAP_RADIUS = 900; // Wider than the screen
const CENTER = { x: 0, y: 0 };
let camera = { x: 0, y: 0 };

// Game State
let gameState = 'MENU';
let peer = null;
let roomConnections = [];
let hostConn = null;
let isHost = false;
let myPlayerId = null;
let mySelectedClass = 'heal';

let currentLevel = 1;
let levelTimer = 0;
let levelDuration = 30; // 30 seconds per level

// Interval Attack Timers
let attackCycleTimer = 0;
let isAttackingPhase = false;

// Entities
let playerStates = {}; 
let hazards = [];
let lingeringFires = [];
let lightningStrikes = [];

// Input Management (Prevents spacebar from scrolling or resetting)
const keys = {};
window.addEventListener('keydown', e => {
    if (e.code === 'Space') e.preventDefault();
    keys[e.code] = true;
});
window.addEventListener('keyup', e => {
    if (e.code === 'Space') e.preventDefault();
    keys[e.code] = false;
});

// UI Elements
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

// P2P Networking
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
        x: CENTER.x + (Math.random() - 0.5) * 300,
        y: CENTER.y + (Math.random() - 0.5) * 300,
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
            if (d < 120) return false;
            return true;
        });
        player.hearts = Math.min(2, player.hearts + 1);
        player.cooldown = 400;

    } else if (player.class === 'shield') {
        player.shieldActive = true;
        setTimeout(() => player.shieldActive = false, 2500);
        player.cooldown = 350;

    } else if (player.class === 'catch') {
        let caught = hazards.find(h => Math.hypot(h.x - player.x, h.y - player.y) < 90);
        if (caught) {
            hazards.splice(hazards.indexOf(caught), 1);
            let angle = Math.atan2(CENTER.y - player.y, CENTER.x - player.x);
            hazards.push({
                x: player.x, y: player.y,
                vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8,
                radius: 10, color: '#ff0055', type: 'reflected', life: 180
            });
            player.cooldown = 200;
        }
    }
}

// Game Loop Setup
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

// Host Engine Loop
let rotAngle = 0;
function hostLoop() {
    if (gameState !== 'PLAYING') return;

    levelTimer += 1 / 60;
    attackCycleTimer += 1 / 60;
    rotAngle += 0.015;

    // Progression
    if (levelTimer > levelDuration && currentLevel < 4) {
        currentLevel++;
        levelTimer = 0;
        showBanner(`LEVEL ${currentLevel} ENTERED!`);
    }

    // Interval Control (4 seconds Attack Burst, 2.5 seconds Rest/Cooldown)
    if (attackCycleTimer % 6.5 < 4.0) {
        isAttackingPhase = true;
    } else {
        isAttackingPhase = false;
    }

    // Process Movement Inputs
    Object.values(playerStates).forEach(p => {
        if (p.isDead) return;
        
        let inp = (p.id === myPlayerId) ? readLocalInputs() : p.inputs;
        if (inp) {
            let spd = 3.2; // Smooth movement speed
            if (inp.up) p.y -= spd;
            if (inp.down) p.y += spd;
            if (inp.left) p.x -= spd;
            if (inp.right) p.x += spd;

            // Map Boundary Constraints
            let dist = Math.hypot(p.x - CENTER.x, p.y - CENTER.y);
            if (dist > MAP_RADIUS - 18) {
                let a = Math.atan2(p.y - CENTER.y, p.x - CENTER.x);
                p.x = CENTER.x + Math.cos(a) * (MAP_RADIUS - 18);
                p.y = CENTER.y + Math.sin(a) * (MAP_RADIUS - 18);
            }
        }
        if (p.cooldown > 0) p.cooldown--;
    });

    if (keys['Space']) {
        triggerAbility(playerStates[myPlayerId]);
        keys['Space'] = false;
    }

    // Attack Patterns
    if (isAttackingPhase) {
        spawnLevelAttacks();
    }

    // Update Hazards
    hazards = hazards.filter(h => {
        h.x += h.vx || 0;
        h.y += h.vy || 0;
        if (h.life !== undefined) h.life--;

        // Collision detection
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

    // Update Lingering Fires
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

    // Update Lightning Strikes
    lightningStrikes = lightningStrikes.filter(l => {
        l.warmup--;
        if (l.warmup <= 0 && l.warmup > -15) { // Active strike window
            Object.values(playerStates).forEach(p => {
                if (!p.isDead && Math.abs(p.x - l.x) < 25) {
                    if (!p.shieldActive) {
                        p.hearts--;
                        if (p.hearts <= 0) p.isDead = true;
                    }
                }
            });
        }
        return l.warmup > -20;
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

    updateCamera();
    renderCanvas();
    requestAnimationFrame(hostLoop);
}

// Client Loop
function clientLoop() {
    if (gameState !== 'PLAYING') return;

    if (hostConn) {
        hostConn.send({
            type: 'INPUT',
            inputs: readLocalInputs(),
            useAbility: keys['Space']
        });
        if (keys['Space']) keys['Space'] = false;
    }

    updateCamera();
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

// Interval Attack Spawner
function spawnLevelAttacks() {
    // Level 1: Butter Stick Boss Center Attack
    if (currentLevel === 1 && Math.random() < 0.1) {
        let a = Math.random() * Math.PI * 2;
        hazards.push({
            x: CENTER.x, y: CENTER.y,
            vx: Math.cos(a) * 3.5, vy: Math.sin(a) * 3.5,
            radius: 5, color: '#ffb703', life: 280 // Smaller butter balls
        });
    }

    // Level 2: Salt Shaker Boss Center
    if (currentLevel === 2) {
        if (Math.random() < 0.08) {
            let a = Math.random() * Math.PI * 2;
            hazards.push({
                x: CENTER.x, y: CENTER.y,
                vx: Math.cos(a) * 4, vy: Math.sin(a) * 4,
                radius: 6, color: '#ffffff', life: 220
            });
        }
        if (Math.random() < 0.03) { // Raining Salt
            hazards.push({
                x: CENTER.x + (Math.random() - 0.5) * MAP_RADIUS * 1.6,
                y: CENTER.y + (Math.random() - 0.5) * MAP_RADIUS * 1.6,
                vx: 0, vy: 0, radius: 10, color: 'rgba(255,255,255,0.8)', life: 80
            });
        }
    }

    // Level 3: Fire Center Boss
    if (currentLevel === 3) {
        if (Math.random() < 0.05) {
            let a = Math.random() * Math.PI * 2;
            let fx = CENTER.x + Math.cos(a) * (Math.random() * MAP_RADIUS * 0.8);
            let fy = CENTER.y + Math.sin(a) * (Math.random() * MAP_RADIUS * 0.8);
            lingeringFires.push({ x: fx, y: fy, radius: 22, life: 200 });
        }
    }

    // Level 4: Microwave Final Boss
    if (currentLevel === 4) {
        if (Math.random() < 0.04) { // Rotating Ring Attack
            for (let i = 0; i < 8; i++) {
                let a = rotAngle + (Math.PI * 2 / 8) * i;
                hazards.push({
                    x: CENTER.x, y: CENTER.y,
                    vx: Math.cos(a) * 4, vy: Math.sin(a) * 4,
                    radius: 6, color: '#48cae4', life: 200
                });
            }
        }
        if (Math.random() < 0.02) { // Screen Lightning Strikes
            lightningStrikes.push({
                x: CENTER.x + (Math.random() - 0.5) * MAP_RADIUS * 1.5,
                warmup: 45
            });
        }
    }
}

// Camera Tracking Logic
function updateCamera() {
    if (playerStates[myPlayerId]) {
        let p = playerStates[myPlayerId];
        camera.x = p.x - canvas.width / 2;
        camera.y = p.y - canvas.height / 2;
    }
}

function showBanner(txt) {
    eventBanner.innerText = txt;
    eventBanner.classList.add('visible');
    setTimeout(() => eventBanner.classList.remove('visible'), 2500);
}

// World Rendering & Camera Transformations
function renderCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Arena Floor
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, MAP_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#12131c';
    ctx.fill();
    ctx.strokeStyle = currentLevel === 4 ? '#e63946' : '#ffb703';
    ctx.lineWidth = 8;
    ctx.stroke();

    // Render Boss in Center
    drawCenterBoss();

    // Level 3 & 4 Rotating Beams
    if (currentLevel >= 3) {
        ctx.save();
        ctx.strokeStyle = 'rgba(230, 57, 70, 0.4)';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(CENTER.x + Math.cos(rotAngle) * MAP_RADIUS, CENTER.y + Math.sin(rotAngle) * MAP_RADIUS);
        ctx.lineTo(CENTER.x - Math.cos(rotAngle) * MAP_RADIUS, CENTER.y - Math.sin(rotAngle) * MAP_RADIUS);
        ctx.stroke();
        ctx.restore();
    }

    // Lightning Strikes
    lightningStrikes.forEach(l => {
        if (l.warmup > 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fillRect(l.x - 15, CENTER.y - MAP_RADIUS, 30, MAP_RADIUS * 2);
        } else {
            ctx.fillStyle = '#48cae4';
            ctx.fillRect(l.x - 20, CENTER.y - MAP_RADIUS, 40, MAP_RADIUS * 2);
        }
    });

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

        // Name Tag
        ctx.fillStyle = '#fff';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, 0, 26);

        ctx.restore();
    });

    ctx.restore();

    // Render Static HUD
    const levelNames = ["1: BUTTER STICK", "2: SALT SHAKER", "3: FIRE ENGINE", "4: MICROWAVE BOSS"];
    levelDisplay.innerText = "LEVEL " + levelNames[currentLevel - 1];

    if (playerStates[myPlayerId]) {
        let p = playerStates[myPlayerId];
        document.getElementById('player-hearts').innerText = p.hearts === 2 ? "❤️ ❤️" : (p.hearts === 1 ? "❤️ 🖤" : "🖤 🖤");
    }
}

// Center Boss Render Models
function drawCenterBoss() {
    ctx.save();
    ctx.translate(CENTER.x, CENTER.y);

    if (currentLevel === 1) {
        // Stick of Butter
        ctx.fillStyle = '#ffee93';
        ctx.fillRect(-25, -45, 50, 90);
        ctx.strokeStyle = '#ffb703';
        ctx.lineWidth = 3;
        ctx.strokeRect(-25, -45, 50, 90);
    } else if (currentLevel === 2) {
        // Salt Shaker
        ctx.fillStyle = '#e0e0e0';
        ctx.beginPath();
        ctx.arc(0, 0, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.fillText("SALT", -12, 4);
    } else if (currentLevel === 3) {
        // Fire Boss
        ctx.fillStyle = '#d62828';
        ctx.beginPath();
        ctx.arc(0, 0, 45, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fcbf49';
        ctx.beginPath();
        ctx.arc(0, 0, 25, 0, Math.PI * 2);
        ctx.fill();
    } else if (currentLevel === 4) {
        // Microwave Boss
        ctx.fillStyle = '#2b2d42';
        ctx.fillRect(-50, -35, 100, 70);
        ctx.fillStyle = '#8d99ae';
        ctx.fillRect(-40, -25, 55, 50);
        ctx.fillStyle = '#48cae4';
        ctx.fillRect(20, -25, 20, 50);
    }

    ctx.restore();
}
