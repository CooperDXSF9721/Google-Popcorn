const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Canvas dimensions
canvas.width = 800;
canvas.height = 600;

// UI controls binding
const arcSlider = document.getElementById('arcSlider');
const arcVal = document.getElementById('arcVal');
const countSlider = document.getElementById('countSlider');
const countVal = document.getElementById('countVal');

arcSlider.addEventListener('input', () => arcVal.textContent = arcSlider.value);
countSlider.addEventListener('input', () => countVal.textContent = countSlider.value);

// Game State
const player = {
    x: canvas.width / 2,
    y: canvas.height / 2,
    angle: 0, // facing direction in radians
    radius: 20
};

let butterBalls = [];
let mouseX = canvas.width / 2;
let mouseY = canvas.height / 2;

// Track mouse position to aim shooter
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    
    // Update facing angle towards cursor
    player.angle = Math.atan2(mouseY - player.y, mouseX - player.x);
});

// Fire a single wave on click
canvas.addEventListener('click', () => {
    fireButterWave();
});

// Fire a single wave on Spacebar press
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) {
        fireButterWave();
    }
});

/**
 * Fires a SINGLE wave burst within a controlled 30° to 45° angle arc
 */
function fireButterWave() {
    const spreadArcDegrees = parseFloat(arcSlider.value); // e.g. 30 to 45
    const ballCount = parseInt(countSlider.value, 10);
    const speed = 7;

    // Convert spread arc to radians and compute half spread
    const spreadArcRadians = spreadArcDegrees * (Math.PI / 180);
    const halfSpread = spreadArcRadians / 2;

    // Base direction angle in radians
    const baseAngle = player.angle;

    // Spawn the set wave of balls
    for (let i = 0; i < ballCount; i++) {
        // Uniform or random spread within [-halfSpread, +halfSpread]
        const offset = (Math.random() * spreadArcRadians) - halfSpread;
        const finalAngle = baseAngle + offset;

        butterBalls.push({
            x: player.x + Math.cos(baseAngle) * player.radius,
            y: player.y + Math.sin(baseAngle) * player.radius,
            vx: Math.cos(finalAngle) * speed,
            vy: Math.sin(finalAngle) * speed,
            radius: 8,
            life: 120 // despawns after frames
        });
    }
}

// Main Game Loop
function update() {
    // Move and age butter balls
    for (let i = butterBalls.length - 1; i >= 0; i--) {
        const ball = butterBalls[i];
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.life--;

        // Remove dead balls or out-of-bounds balls
        if (ball.life <= 0 || 
            ball.x < 0 || ball.x > canvas.width || 
            ball.y < 0 || ball.y > canvas.height) {
            butterBalls.splice(i, 1);
        }
    }
}

function draw() {
    // Clear Canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw Aiming Cone Preview (30°-45°)
    const spreadArcRad = parseFloat(arcSlider.value) * (Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.arc(player.x, player.y, 120, player.angle - spreadArcRad / 2, player.angle + spreadArcRad / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 209, 102, 0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.4)';
    ctx.stroke();

    // 2. Draw Player/Shooter
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    
    // Body
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#4ea8de';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff';
    ctx.stroke();

    // Barrel / Pointer
    ctx.beginPath();
    ctx.rect(0, -5, 25, 10);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
    ctx.restore();

    // 3. Draw Butter Balls
    butterBalls.forEach(ball => {
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd166'; // Butter yellow
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#f77f00';
        ctx.stroke();
    });

    requestAnimationFrame(gameLoop);
}

function gameLoop() {
    update();
    draw();
}

// Start loop
requestAnimationFrame(gameLoop);
