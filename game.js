// Game Engine & Logic
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Canvas dimensions
const ARENA_RADIUS = 360;
canvas.width = ARENA_RADIUS * 2 + 40;
canvas.height = ARENA_RADIUS * 2 + 40;
const CENTER = { x: canvas.width / 2, y: canvas.height / 2 };

// State Management
let gameState = 'MENU'; // MENU, PLAYING, GAMEOVER
let gameMode = 'solo'; // solo, squad
let selectedClass = 'heal';
let gameTime = 0;
let lastTimestamp = 0;
let eventTimer = 0;
let activeEventText = '';

// Input Tracking
const keys = {};
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

// UI Elements
const uiOverlay = document.getElementById('ui-overlay');
const gameoverOverlay = document.getElementById('gameover-overlay');
const hud = document.getElementById('hud');
const heartsContainer = document.getElementById('player-hearts');
const timerDisplay = document.getElementById('timer');
const cooldownFill = document.getElementById('cooldown-fill');
const abilityNameHud = document.getElementById('ability-name');
const eventBanner = document.getElementById('event-banner');
const squadHud = document.getElementById('squad-hud');

// Mode & Class Selector Event Listeners
document.getElementById('mode-solo').onclick = (e) => {
    gameMode = 'solo';
    document.querySelectorAll('.btn-group .btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
};
document.getElementById('mode-squad').onclick = (e) => {
    gameMode = 'squad';
    document.querySelectorAll('.btn-group .btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
};

document.querySelectorAll('.class-card').forEach(card => {
    card.onclick = () => {
        document.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedClass = card.getAttribute('data-class');
    };
});

document.getElementById('start-btn').onclick = startGame;
document.getElementById('restart-btn').onclick = startGame;

// Entities
let players = [];
let hazards = [];
let particles = [];
let enemies = [];

// Player Class Definition
class Kernel {
    constructor(id, x, y, isAI = false, kernelClass = 'heal', name = 'Player') {
        this.id = id;
        this.x = x;
        this.y = y;
        this.radius = 16;
        this.speed = 4;
        this.isAI = isAI;
        this.kernelClass = kernelClass;
        this.name = name;
        
        this.hearts = 2;
        this.maxHearts = 2;
        this.isDowned = false;
        this.downedTimer = 0;
        this.reviveProgress = 0;
        this.isDead = false;

        this.shieldActive = false;
        this.shieldTimer = 0;
        this.heldProjectile = null;

        this.abilityCooldown = 0;
        this.maxCooldown = kernelClass === 'heal' ? 300 : (kernelClass === 'shield' ? 400 : 200);

        this.invulnerableTimer = 0;
        this.color = isAI ? '#ffbc42' : '#f7fff7';
    }

    update() {
        if (this.isDead) return;

        // Downed Logic (Squad Mode)
        if (this.isDowned) {
            this.downedTimer -= 1;
            if (this.downedTimer <= 0) {
                this.isDead = true;
                createExplosion(this.x, this.y, '#ffffff', 25);
            }
            return;
        }

        // Cooldowns & Timers
        if (this.abilityCooldown > 0) this.abilityCooldown--;
        if (this.invulnerableTimer > 0) this.invulnerableTimer--;
        if (this.shieldTimer > 0) {
            this.shieldTimer--;
            if (this.shieldTimer <= 0) this.shieldActive = false;
        }

        // Movement
        let dx = 0;
        let dy = 0;

        if (!this.isAI) {
            if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
            if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
            if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
            if (keys['KeyD'] || keys['ArrowRight']) dx += 1;

            if (keys['Space']) this.useAbility();
        } else {
            // Simple AI Logic
            const avoidDist = 80;
            hazards.forEach(h => {
                let dist = Math.hypot(h.x - this.x, h.y - this.y);
                if (dist < avoidDist) {
                    dx += (this.x - h.x) / dist;
                    dy += (this.y - h.y) / dist;
                }
            });

            // Keep AI inside arena bounds
            let distFromCenter = Math.hypot(this.x - CENTER.x, this.y - CENTER.y);
            if (distFromCenter > ARENA_RADIUS - 50) {
                dx += (CENTER.x - this.x) / distFromCenter;
                dy += (CENTER.y - this.y) / distFromCenter;
            }

            // AI occasionally uses ability
            if (Math.random() < 0.005) this.useAbility();
        }

        // Normalize movement
        if (dx !== 0 || dy !== 0) {
            let len = Math.hypot(dx, dy);
            dx /= len;
            dy /= len;
            this.x += dx * this.speed;
            this.y += dy * this.speed;
        }

        // Arena boundary collision
        let distFromCenter = Math.hypot(this.x - CENTER.x, this.y - CENTER.y);
        if (distFromCenter + this.radius > ARENA_RADIUS) {
            let angle = Math.atan2(this.y - CENTER.y, this.x - CENTER.x);
            this.x = CENTER.x + Math.cos(angle) * (ARENA_RADIUS - this.radius);
            this.y = CENTER.y + Math.sin(angle) * (ARENA_RADIUS - this.radius);
        }

        // Held Projectile Tracking
        if (this.heldProjectile) {
            this.heldProjectile.x = this.x;
            this.heldProjectile.y = this.y - 25;
        }
    }

    useAbility() {
        if (this.abilityCooldown > 0 || this.isDowned || this.isDead) return;

        if (this.kernelClass === 'heal') {
            // Absorb nearby projectiles
            let absorbed = false;
            hazards = hazards.filter(h => {
                if (h.type === 'projectile' || h.type === 'salt') {
                    let d = Math.hypot(h.x - this.x, h.y - this.y);
                    if (d < 120) {
                        absorbed = true;
                        createParticles(h.x, h.y, '#00f5d4', 8);
                        return false;
                    }
                }
                return true;
            });
            if (absorbed && this.hearts < this.maxHearts) {
                this.hearts++;
                createParticles(this.x, this.y, '#2a9d8f', 15);
            }
            this.abilityCooldown = this.maxCooldown;

        } else if (this.kernelClass === 'shield') {
            this.shieldActive = true;
            this.shieldTimer = 180; // 3 seconds
            this.abilityCooldown = this.maxCooldown;

        } else if (this.kernelClass === 'catch') {
            if (!this.heldProjectile) {
                // Catch nearest projectile
                let catchTarget = hazards.find(h => (h.type === 'projectile' || h.type === 'salt') && Math.hypot(h.x - this.x, h.y - this.y) < 70);
                if (catchTarget) {
                    this.heldProjectile = catchTarget;
                    hazards.splice(hazards.indexOf(catchTarget), 1);
                }
            } else {
                // Throw caught projectile
                let targetAngle = Math.random() * Math.PI * 2;
                if (this.isAI) {
                    targetAngle = Math.atan2(CENTER.y - this.y, CENTER.x - this.x);
                } else {
                    targetAngle = Math.atan2(CENTER.y - this.y, CENTER.x - this.x); // Toss toward center
                }
                
                hazards.push({
                    x: this.x,
                    y: this.y,
                    vx: Math.cos(targetAngle) * 9,
                    vy: Math.sin(targetAngle) * 9,
                    radius: 8,
                    type: 'reflected',
                    color: '#ff0055',
                    life: 180
                });
                this.heldProjectile = null;
                this.abilityCooldown = this.maxCooldown;
            }
        }
    }

    takeHit() {
        if (this.invulnerableTimer > 0 || this.shieldActive || this.isDowned || this.isDead) return;

        this.hearts--;
        this.invulnerableTimer = 60; // 1 second invulnerability
        createParticles(this.x, this.y, '#e63946', 12);

        if (this.hearts <= 0) {
            if (gameMode === 'squad') {
                this.isDowned = true;
                this.downedTimer = 600; // 10 seconds to revive
                this.reviveProgress = 0;
            } else {
                this.isDead = true;
                createExplosion(this.x, this.y, '#fff', 30);
            }
        }
    }

    draw() {
        if (this.isDead) return;

        ctx.save();
        ctx.translate(this.x, this.y);

        // Flash during invulnerability
        if (this.invulnerableTimer % 6 > 3) {
            ctx.restore();
            return;
        }

        // Shield Effect
        if (this.shieldActive) {
            ctx.beginPath();
            ctx.arc(0, 0, this.radius + 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(42, 157, 143, 0.4)';
            ctx.strokeStyle = '#2a9d8f';
            ctx.lineWidth = 3;
            ctx.fill();
            ctx.stroke();
        }

        // Downed Ring
        if (this.isDowned) {
            ctx.beginPath();
            ctx.arc(0, 0, this.radius + 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#e63946';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Revive progress bar
            if (this.reviveProgress > 0) {
                ctx.fillStyle = '#2a9d8f';
                ctx.fillRect(-15, -this.radius - 12, (this.reviveProgress / 100) * 30, 4);
            }
        }

        // Kernel Body (Corn Kernel Kernel shape)
        ctx.beginPath();
        ctx.moveTo(0, -this.radius);
        ctx.quadraticCurveTo(this.radius, -this.radius / 2, this.radius, this.radius / 2);
        ctx.quadraticCurveTo(0, this.radius + 4, -this.radius, this.radius / 2);
        ctx.quadraticCurveTo(-this.radius, -this.radius / 2, 0, -this.radius);
        ctx.fillStyle = this.isDowned ? '#777' : (this.kernelClass === 'heal' ? '#8ac926' : (this.kernelClass === 'shield' ? '#1982c4' : '#ffca3a'));
        ctx.fill();
        ctx.strokeStyle = '#d4a373';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Eyes
        ctx.fillStyle = '#111';
        if (this.isDowned) {
            // Dead/Downed X eyes
            ctx.font = '10px sans-serif';
            ctx.fillText('x x', -6, 2);
        } else {
            ctx.beginPath();
            ctx.arc(-4, -2, 2.5, 0, Math.PI * 2);
            ctx.arc(4, -2, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Name tag
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, 0, this.radius + 14);

        ctx.restore();
    }
}

// Spawner Logic & Enemy Hazards
function spawnHazards() {
    eventTimer++;

    // Base Fire Attack (Butter Spray / Flame)
    if (eventTimer % 90 === 0) {
        let angle = Math.random() * Math.PI * 2;
        hazards.push({
            type: 'butter',
            x: CENTER.x + Math.cos(angle) * (ARENA_RADIUS - 10),
            y: CENTER.y + Math.sin(angle) * (ARENA_RADIUS - 10),
            vx: -Math.cos(angle) * 3,
            vy: -Math.sin(angle) * 3,
            radius: 18,
            color: '#ffb703',
            life: 240
        });
    }

    // Salt Barrage
    if (eventTimer % 140 === 0) {
        showEventNotice("SALT BARRAGE!");
        for (let i = 0; i < 8; i++) {
            let angle = (Math.PI * 2 / 8) * i;
            hazards.push({
                type: 'salt',
                x: CENTER.x,
                y: CENTER.y,
                vx: Math.cos(angle) * 4,
                vy: Math.sin(angle) * 4,
                radius: 6,
                color: '#ffffff',
                life: 180
            });
        }
    }

    // Electrical Zap Area
    if (eventTimer % 300 === 0) {
        showEventNotice("ELECTRICAL SURGE!");
        hazards.push({
            type: 'zap',
            x: CENTER.x + (Math.random() - 0.5) * ARENA_RADIUS * 1.2,
            y: CENTER.y + (Math.random() - 0.5) * ARENA_RADIUS * 1.2,
            radius: 65,
            color: 'rgba(72, 202, 228, 0.4)',
            warmup: 60, // 1 sec warning before active
            life: 120
        });
    }
}

function showEventNotice(msg) {
    eventBanner.innerText = msg;
    eventBanner.classList.add('visible');
    setTimeout(() => eventBanner.classList.remove('visible'), 2000);
}

// Particle Helper
function createParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            radius: Math.random() * 4 + 2,
            color: color,
            life: 30
        });
    }
}

function createExplosion(x, y, color, count) {
    createParticles(x, y, color, count);
}

// Initialize Match
function startGame() {
    players = [];
    hazards = [];
    particles = [];
    gameTime = 0;
    eventTimer = 0;

    // Local Player
    let mainPlayer = new Kernel(1, CENTER.x, CENTER.y + 100, false, selectedClass, 'You');
    players.push(mainPlayer);

    // AI Players / Squad Teammates
    if (gameMode === 'solo') {
        players.push(new Kernel(2, CENTER.x - 100, CENTER.y, true, 'shield', 'Kernel Bob'));
        players.push(new Kernel(3, CENTER.x + 100, CENTER.y, true, 'catch', 'Kernel Pip'));
        players.push(new Kernel(4, CENTER.x, CENTER.y - 100, true, 'heal', 'Kernel Pop'));
    } else { // Squad Mode
        players.push(new Kernel(2, CENTER.x - 50, CENTER.y + 100, true, 'shield', 'Teammate 1'));
        players.push(new Kernel(3, CENTER.x + 50, CENTER.y + 100, true, 'heal', 'Teammate 2'));
    }

    // UI Updates
    uiOverlay.classList.add('hidden');
    gameoverOverlay.classList.add('hidden');
    hud.classList.remove('hidden');

    if (gameMode === 'squad') {
        squadHud.classList.remove('hidden');
    } else {
        squadHud.classList.add('hidden');
    }

    abilityNameHud.innerText = selectedClass.toUpperCase();
    gameState = 'PLAYING';
    lastTimestamp = performance.now();
    requestAnimationFrame(gameLoop);
}

// Game Loop
function gameLoop(timestamp) {
    if (gameState !== 'PLAYING') return;

    let dt = (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;
    gameTime += dt;

    // Update Timer Display
    let mins = Math.floor(gameTime / 60).toString().padStart(2, '0');
    let secs = Math.floor(gameTime % 60).toString().padStart(2, '0');
    timerDisplay.innerText = `${mins}:${secs}`;

    // Clear Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Circular Arena Background
    ctx.beginPath();
    ctx.arc(CENTER.x, CENTER.y, ARENA_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#181a24';
    ctx.fill();
    ctx.strokeStyle = '#fb8500';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Spawn hazards
    spawnHazards();

    // Revive Logic (Squad Mode)
    if (gameMode === 'squad') {
        let p1 = players[0];
        players.forEach(p => {
            if (p !== p1 && p.isDowned && !p1.isDowned && !p1.isDead) {
                let dist = Math.hypot(p1.x - p.x, p1.y - p.y);
                if (dist < 40) {
                    p.reviveProgress += 2;
                    if (p.reviveProgress >= 100) {
                        p.isDowned = false;
                        p.hearts = 1;
                        p.reviveProgress = 0;
                        createParticles(p.x, p.y, '#8ac926', 20);
                    }
                } else {
                    p.reviveProgress = Math.max(0, p.reviveProgress - 0.5);
                }
            }
        });
    }

    // Update & Draw Players
    players.forEach(p => {
        p.update();
        p.draw();
    });

    // Update & Draw Hazards
    hazards = hazards.filter(h => {
        h.x += (h.vx || 0);
        h.y += (h.vy || 0);
        if (h.life) h.life--;

        // Draw Hazards
        if (h.type === 'zap') {
            ctx.beginPath();
            ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
            if (h.warmup > 0) {
                h.warmup--;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.strokeStyle = '#48cae4';
                ctx.lineWidth = 1;
                ctx.stroke();
            } else {
                ctx.fillStyle = h.color;
                ctx.fill();
            }
        } else {
            ctx.beginPath();
            ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
            ctx.fillStyle = h.color;
            ctx.fill();
        }

        // Hazard Collision against Players
        players.forEach(p => {
            if (p.isDead || p.isDowned) return;

            let dist = Math.hypot(p.x - h.x, p.y - h.y);

            if (h.type === 'zap' && h.warmup <= 0) {
                if (dist < h.radius + p.radius) p.takeHit();
            } else if (h.type !== 'zap') {
                if (dist < h.radius + p.radius) {
                    if (h.type === 'reflected') {
                        p.takeHit();
                    } else {
                        if (p.shieldActive) {
                            // Deflect back
                            h.vx = -h.vx * 1.5;
                            h.vy = -h.vy * 1.5;
                            h.type = 'reflected';
                        } else {
                            p.takeHit();
                            h.life = 0; // Destroy projectile on hit
                        }
                    }
                }
            }
        });

        // Keep inside arena check
        let distCenter = Math.hypot(h.x - CENTER.x, h.y - CENTER.y);
        if (distCenter > ARENA_RADIUS && h.type !== 'zap') return false;

        return h.life === undefined || h.life > 0;
    });

    // Update & Draw Particles
    particles = particles.filter(pt => {
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life--;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
        ctx.fillStyle = pt.color;
        ctx.fill();
        return pt.life > 0;
    });

    // Update HUD
    let mainPlayer = players[0];
    let heartHTML = '';
    for (let i = 0; i < mainPlayer.maxHearts; i++) {
        heartHTML += i < mainPlayer.hearts ? '❤️ ' : '🖤 ';
    }
    heartsContainer.innerHTML = heartHTML;

    // Cooldown bar update
    let cooldownRatio = 1 - (mainPlayer.abilityCooldown / mainPlayer.maxCooldown);
    cooldownFill.style.width = `${Math.max(0, cooldownRatio * 100)}%`;

    // Check Win/Loss Conditions
    if (gameMode === 'solo') {
        if (mainPlayer.isDead) {
            endGame(false, "You popped!");
            return;
        }
        let aliveEnemies = players.slice(1).filter(p => !p.isDead);
        if (aliveEnemies.length === 0) {
            endGame(true, "VICTORY! You are the Last Unpopped Kernel!");
            return;
        }
    } else {
        let squadAlive = players.filter(p => !p.isDead).length;
        if (squadAlive === 0) {
            endGame(false, "Your squad was completely popped!");
            return;
        }
    }

    requestAnimationFrame(gameLoop);
}

function endGame(isWin, message) {
    gameState = 'GAMEOVER';
    hud.classList.add('hidden');
    gameoverOverlay.classList.remove('hidden');

    document.getElementById('end-title').innerText = isWin ? "VICTORY! 🍿" : "POPPED! 💥";
    document.getElementById('end-title').style.color = isWin ? "#8ac926" : "#e63946";
    let mins = Math.floor(gameTime / 60).toString().padStart(2, '0');
    let secs = Math.floor(gameTime % 60).toString().padStart(2, '0');
    document.getElementById('end-stats').innerText = `${message} (Survival Time: ${mins}:${secs})`;
}
