/* Popcorn! A fan-made recreation of the 2024 Google Popcorn! Doodle.
 *
 * Built from public descriptions of the original: you are an unpopped kernel in
 * a circular arena with up to 60 players, two hearts, three kernel types (Heal,
 * Shield, Catch & Throw) on one ability button, four kitchen bosses (Butter,
 * Salt, Fire, Magnetron), solo and squad modes. Exact attack patterns, numbers,
 * art and audio of the original are not public, so those are my own designs.
 */
(() => {
  'use strict';

  /* ---------- Constants ---------- */
  const TAU = Math.PI * 2;
  const WORLD = 1000;          // world is 1000 x 1000, origin at arena center
  const R = 460;               // arena radius
  const BOSS_R = 54;           // boss body radius
  const KR = 13;               // kernel radius
  const PLAYERS = 60;          // you + 59 others
  const MAX_HP = 2;            // two hearts
  const PLAYER_SPEED = 175;

  const KERNELS = {
    heal:   { name: 'Heal',          color: '#ffd86b', cd: 7 },
    shield: { name: 'Shield',        color: '#7fd4ff', cd: 6, dur: 1.6 },
    catch:  { name: 'Catch & Throw', color: '#ff9f6b', cd: 4, window: 0.9 }
  };
  const TYPE_KEYS = Object.keys(KERNELS);

  const ROUNDS = [
    { id: 'butter',    name: 'Butter',    time: 40,       hp: 60 },
    { id: 'salt',      name: 'Salt',      time: 40,       hp: 60 },
    { id: 'fire',      name: 'Fire',      time: 40,       hp: 60 },
    { id: 'magnetron', name: 'Magnetron', time: Infinity, hp: 80 }
  ];

  /* ---------- Helpers ---------- */
  const $ = id => document.getElementById(id);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const el = {
    menu: $('menu'), hud: $('hud'), stickZone: $('stickZone'), stickBase: $('stickBase'),
    stickKnob: $('stickKnob'), roundLabel: $('roundLabel'), bossFill: $('bossFill'),
    aliveLabel: $('aliveLabel'), banner: $('banner'), hearts: $('hearts'),
    abilityBtn: $('abilityBtn'), abilityName: $('abilityName'), abilityKey: $('abilityKey'),
    muteBtn: $('muteBtn'), result: $('result'), resultTitle: $('resultTitle'),
    resultText: $('resultText'), againBtn: $('againBtn'), watchBtn: $('watchBtn'),
    menuBtn: $('menuBtn'), playBtn: $('playBtn'), modeSolo: $('modeSolo'),
    modeSquad: $('modeSquad'), squadBox: $('squadBox'), squadLink: $('squadLink'),
    copyLink: $('copyLink'), stats: $('stats')
  };
  const isTouch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;

  /* ---------- State ---------- */
  const state = {
    mode: 'solo', type: 'shield', scene: 'menu',
    kernels: [], proj: [], fx: [], boss: null, you: null,
    beam: { phase: 'off', t: 0, ang: 0, spin: 0 },
    round: -1, roundT: 0, interT: 0, cdT: 0, t: 0,
    resultAt: 0, resultShown: false, watching: false, bossDown: false,
    place: 0, squadCode: ''
  };
  const keys = new Set();
  const stick = { id: null, x: 0, y: 0, ox: 0, oy: 0 };

  /* ---------- Audio ---------- */
  let ac = null, muted = false, lastPop = 0;
  function ensureAudio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
  }
  function beep(f, d = 0.1, type = 'square', v = 0.04, f2 = 0, delay = 0) {
    if (!ac || muted) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + d + 0.02);
  }
  const sfx = {
    hit()    { beep(220, 0.25, 'sawtooth', 0.07, 70); },
    pop()    { if (state.t - lastPop < 0.12) return; lastPop = state.t; beep(520, 0.08, 'triangle', 0.025, 180); },
    shield() { beep(620, 0.2, 'sine', 0.06, 900); },
    heal()   { beep(520, 0.12, 'sine', 0.06); beep(780, 0.16, 'sine', 0.06, 0, 0.1); },
    catchOn(){ beep(420, 0.1, 'square', 0.04, 560); },
    caught() { beep(700, 0.1, 'square', 0.05); beep(950, 0.1, 'square', 0.05, 0, 0.08); },
    throw()  { beep(500, 0.18, 'sawtooth', 0.05, 160); },
    boss()   { beep(110, 0.18, 'sawtooth', 0.05, 90); },
    round()  { beep(330, 0.2, 'triangle', 0.07); beep(440, 0.2, 'triangle', 0.07, 0, 0.18); beep(660, 0.3, 'triangle', 0.07, 0, 0.36); },
    win()    { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.25, 'triangle', 0.07, 0, i * 0.15)); },
    lose()   { beep(330, 0.3, 'triangle', 0.07, 200); beep(200, 0.5, 'triangle', 0.07, 90, 0.25); }
  };

  /* ---------- Setup ---------- */
  function makeKernel(i) {
    const teamSize = state.mode === 'squad' ? 4 : 1;
    const a = rnd(0, TAU), r = rnd(150, 380);
    return {
      i, isYou: i === 0, team: Math.floor(i / teamSize),
      type: i === 0 ? state.type : pick(TYPE_KEYS),
      x: Math.cos(a) * r, y: Math.sin(a) * r, fx: 0, fy: -1,
      hp: MAX_HP, alive: true, iframes: 0, flash: 0, popT: 0,
      cd: 0, shield: 0, catchT: 0, catchPending: false, held: false, holdT: 0,
      skill: rnd(0.25, 0.95), wander: rnd(0, TAU), wanderT: 0, blunder: 0, threatD: 999,
      aimBoss: Math.random() < 0.7
    };
  }

  function startGame() {
    ensureAudio();
    state.kernels = Array.from({ length: PLAYERS }, (_, i) => makeKernel(i));
    state.you = state.kernels[0];
    state.proj = []; state.fx = []; state.boss = null;
    state.beam = { phase: 'off', t: 0, ang: 0, spin: 0 };
    state.round = -1; state.cdT = 3.5; state.scene = 'countdown';
    state.resultShown = false; state.watching = false; state.bossDown = false;
    state.place = 0; state.resultAt = 0;
    el.menu.hidden = true; el.result.hidden = true; el.hud.hidden = false;
    el.stickZone.hidden = !isTouch;
    el.hearts.innerHTML = '<span class="heart">\u2665</span><span class="heart">\u2665</span>';
    el.abilityBtn.style.setProperty('--ab', KERNELS[state.type].color);
    el.abilityKey.textContent = isTouch ? 'Tap' : 'Space';
    el.bossFill.style.width = '100%';
    el.roundLabel.textContent = 'Get ready';
    showBanner('Get ready!', 3);
  }

  function startRound(i) {
    state.round = i;
    const r = ROUNDS[i];
    state.boss = { id: r.id, hp: r.hp, max: r.hp, t: 0, tm: {}, shake: 0, hurt: 0, spin: 0, n: 0 };
    state.roundT = r.time;
    state.scene = 'playing';
    el.roundLabel.textContent = 'Round ' + (i + 1) + ': ' + r.name;
    showBanner('Round ' + (i + 1) + ': ' + r.name, 2.2);
    sfx.round();
  }

  function endRound(defeated) {
    state.proj = [];
    state.beam = { phase: 'off', t: 0, ang: 0, spin: 0 };
    if (state.round >= ROUNDS.length - 1) {
      if (defeated) state.bossDown = true;
      return;
    }
    state.scene = 'intermission';
    state.interT = 3;
    state.boss = null;
    showBanner(defeated ? 'Boss popped!' : 'Round cleared', 2.2);
  }

  /* ---------- Banner ---------- */
  let bannerT = 0;
  function showBanner(text, secs) {
    el.banner.textContent = text;
    el.banner.classList.add('show');
    bannerT = secs;
  }

  /* ---------- Abilities ---------- */
  function addRing(x, y, color, max) { state.fx.push({ kind: 'ring', x, y, color, max, t: 0, life: 0.5 }); }
  function addSpark(x, y, color) { state.fx.push({ kind: 'spark', x, y, color, t: 0, life: 0.3 }); }

  function useAbility(k) {
    if (!k.alive) return;
    if (k.type === 'catch' && k.held) { throwHeld(k); return; }
    if (k.cd > 0) return;
    const d = KERNELS[k.type];
    if (k.type === 'heal') {
      k.cd = d.cd;
      for (const o of state.kernels) {
        if (o.alive && o.team === k.team && dist(o, k) <= 110) o.hp = Math.min(MAX_HP, o.hp + 0.5);
      }
      addRing(k.x, k.y, '#8dffb0', 110);
      if (k.isYou) sfx.heal();
    } else if (k.type === 'shield') {
      k.cd = d.cd; k.shield = d.dur;
      if (k.isYou) sfx.shield();
    } else {
      if (k.catchT > 0) return;
      k.catchT = d.window; k.catchPending = true;
      if (k.isYou) sfx.catchOn();
    }
  }

  function throwHeld(k) {
    const cand = [];
    if (state.boss && state.scene === 'playing') cand.push({ x: 0, y: 0, boss: true });
    for (const o of state.kernels) if (o.alive && o.team !== k.team) cand.push(o);
    let ang = Math.atan2(k.fy, k.fx);
    if (k.isYou) {
      let bd = 0.45;
      for (const c of cand) {
        const a = Math.atan2(c.y - k.y, c.x - k.x), da = angDiff(a, ang);
        if (da < bd) { bd = da; ang = a; }
      }
    } else if (cand.length) {
      const boss = cand.find(c => c.boss);
      let tgt = boss && k.aimBoss ? boss : null;
      if (!tgt) { let bd = 1e9; for (const c of cand) { const d = Math.hypot(c.x - k.x, c.y - k.y); if (d < bd) { bd = d; tgt = c; } } }
      ang = Math.atan2(tgt.y - k.y, tgt.x - k.x);
    }
    state.proj.push({
      x: k.x + Math.cos(ang) * (KR + 8), y: k.y + Math.sin(ang) * (KR + 8),
      vx: Math.cos(ang) * 380, vy: Math.sin(ang) * 380, r: 10, col: '#ffb35c',
      team: k.team, thrown: true, life: 2.5
    });
    k.held = false; k.cd = KERNELS.catch.cd;
    if (k.isYou) sfx.throw();
  }

  /* ---------- Damage ---------- */
  function damage(k, amount) {
    if (!k.alive || k.iframes > 0) return;
    k.hp -= amount; k.iframes = 1; k.flash = 0.25;
    if (k.isYou) sfx.hit();
    if (k.hp <= 0.001) {
      k.hp = 0; k.alive = false; k.popT = 0.9; k.held = false;
      sfx.pop();
    }
  }

  function hitBoss(n) {
    const b = state.boss;
    if (!b || state.scene !== 'playing') return;
    b.hp -= n; b.hurt = 0.2;
    sfx.boss();
    if (b.hp <= 0) endRound(true);
  }

  /* ---------- Boss attacks ---------- */
  function spawnP(a, sp, r, col) {
    state.proj.push({
      x: Math.cos(a) * (BOSS_R + 4), y: Math.sin(a) * (BOSS_R + 4),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r, col, team: -1, thrown: false, life: 9
    });
  }
  function aimAt(k) { return Math.atan2(k.y, k.x); }
  function randomTarget() {
    const you = state.you;
    if (you.alive && Math.random() < 0.4) return you;
    const alive = state.kernels.filter(k => k.alive);
    return alive.length ? pick(alive) : null;
  }

  function updateBoss(dt) {
    const b = state.boss;
    b.t += dt;
    b.shake = Math.max(0, b.shake - dt * 3);
    b.hurt = Math.max(0, b.hurt - dt);
    if (b.t < 1.3) return;
    const enr = state.round === 3 ? 1 + Math.min(1.4, b.t / 45) : 1;
    const tick = (key, iv, fn) => {
      b.tm[key] = (b.tm[key] === undefined ? iv * 0.5 : b.tm[key]) - dt;
      if (b.tm[key] <= 0) { b.tm[key] += iv; fn(); }
    };

    if (b.id === 'butter') {
      const ph = Math.floor(b.t / 9) % 2;
      if (ph === 0) {
        // Diamond waves
        tick('dia', 1.5 / enr, () => {
          const n = 24, off = (b.n++ % 2) * (TAU / n / 2);
          for (let i = 0; i < n; i++) {
            const a = i / n * TAU + off;
            spawnP(a, 150 / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a))), 8, '#ffe27a');
          }
          b.shake = 0.6;
        });
      } else if (b.t % 9 < 5.5) {
        // Rotating four-arm spiral
        tick('spi', 0.11 / enr, () => {
          b.spin += 0.33;
          for (let k = 0; k < 4; k++) spawnP(b.spin + k * TAU / 4, 175, 7, '#fff0a8');
        });
      }
    } else if (b.id === 'salt') {
      tick('fan', 1.2 / enr, () => {
        const t = randomTarget(); if (!t) return;
        const a = aimAt(t);
        for (let i = -2; i <= 2; i++) spawnP(a + i * 0.14, 270, 6, '#f4f8ff');
        b.shake = 1;
      });
      tick('scatter', 3.2 / enr, () => {
        const off = rnd(0, TAU);
        for (let i = 0; i < 16; i++) spawnP(off + i / 16 * TAU, 125, 8, '#dfe8f3');
      });
    } else if (b.id === 'fire') {
      tick('ring', 2.4 / enr, () => {
        const n = 36, gap = Math.floor(rnd(0, n)), off = rnd(0, TAU);
        for (let i = 0; i < n; i++) {
          const g = (i - gap + n) % n;
          if (g < 5) continue;
          spawnP(off + i / n * TAU, 135, 9, '#ff7a2a');
        }
        b.shake = 0.7;
      });
      tick('ball', 4.5 / enr, () => {
        for (let i = 0; i < 3; i++) { const t = randomTarget(); if (t) spawnP(aimAt(t), 190, 15, '#ff4b1f'); }
      });
    } else if (b.id === 'magnetron') {
      const bm = state.beam;
      bm.t -= dt;
      if (bm.phase === 'off') {
        if (bm.t <= 0) {
          bm.phase = 'tele'; bm.t = 1.3; bm.ang = rnd(0, TAU);
          bm.spin = (Math.random() < 0.5 ? -1 : 1) * rnd(0.45, 0.8) * Math.min(enr, 1.6);
        }
      } else if (bm.phase === 'tele') {
        if (bm.t <= 0) { bm.phase = 'on'; bm.t = 2.6; }
      } else {
        bm.ang += bm.spin * dt;
        for (const k of state.kernels) {
          if (!k.alive || k.shield > 0) continue;
          if (Math.hypot(k.x, k.y) < BOSS_R) continue;
          const perp = Math.abs(k.x * Math.sin(bm.ang) - k.y * Math.cos(bm.ang));
          if (perp < 9 + KR - 3) damage(k, 1);
        }
        if (bm.t <= 0) { bm.phase = 'off'; bm.t = 2.2 / enr; }
      }
      tick('pulse', 2.2 / enr, () => {
        const off = rnd(0, TAU);
        for (let i = 0; i < 16; i++) spawnP(off + i / 16 * TAU, 150, 8, '#7fe6ff');
      });
    }
  }

  /* ---------- Movement and bots ---------- */
  function moveKernel(k, dx, dy, dt, speed) {
    const m = Math.hypot(dx, dy);
    if (m > 0.1) { k.fx = dx / m; k.fy = dy / m; }
    if (m > 1) { dx /= m; dy /= m; }
    const sp = speed * (k.shield > 0 ? 0.8 : 1);
    k.x += dx * sp * dt; k.y += dy * sp * dt;
    let d = Math.hypot(k.x, k.y);
    const maxD = R - KR - 4, minD = BOSS_R + KR + 6;
    if (d === 0) { k.x = minD; d = minD; }
    if (d > maxD) { k.x *= maxD / d; k.y *= maxD / d; }
    else if (d < minD) { k.x *= minD / d; k.y *= minD / d; }
  }

  function botThink(k, dt) {
    let ax = 0, ay = 0, threat = false;
    k.threatD = 999;
    k.blunder = Math.max(0, k.blunder - dt);
    if (k.blunder <= 0 && Math.random() < (1 - k.skill) * 0.9 * dt) k.blunder = rnd(0.4, 0.9);
    const react = 70 + k.skill * 110;

    if (k.blunder <= 0) {
      for (const p of state.proj) {
        if (p.team === k.team) continue;
        const dx = k.x - p.x, dy = k.y - p.y, d = Math.hypot(dx, dy);
        if (d > react) continue;
        const sp = Math.hypot(p.vx, p.vy) || 1;
        const closing = (dx * p.vx + dy * p.vy) / (d * sp + 0.001);
        if (closing < 0.3) continue;
        const px = -p.vy / sp, py = p.vx / sp;
        const side = (dx * px + dy * py) >= 0 ? 1 : -1;
        const w = 1 - d / react;
        ax += px * side * w * 2.2 + dx / (d + 1) * 0.4 * w;
        ay += py * side * w * 2.2 + dy / (d + 1) * 0.4 * w;
        threat = true;
        if (d < k.threatD) k.threatD = d;
      }
      const bm = state.beam;
      if (bm.phase !== 'off') {
        const s = k.x * Math.sin(bm.ang) - k.y * Math.cos(bm.ang);
        if (Math.abs(s) < 70) {
          const sg = s >= 0 ? 1 : -1;
          ax += Math.sin(bm.ang) * sg * 2; ay += -Math.cos(bm.ang) * sg * 2;
          threat = true;
        }
      }
    }

    if (!threat) {
      k.wanderT -= dt;
      if (k.wanderT <= 0) { k.wander = rnd(0, TAU); k.wanderT = rnd(1, 3); }
      ax += Math.cos(k.wander) * 0.45; ay += Math.sin(k.wander) * 0.45;
    }
    const d = Math.hypot(k.x, k.y);
    if (d < 140) { ax += k.x / (d + 1) * 0.8; ay += k.y / (d + 1) * 0.8; }
    if (d > R - 70) { ax -= k.x / d * 1.2; ay -= k.y / d * 1.2; }
    moveKernel(k, ax, ay, dt, 120 + k.skill * 45);

    // Abilities
    if (k.type === 'heal') {
      if (k.cd <= 0 && k.hp < MAX_HP && Math.random() < 0.8 * dt) useAbility(k);
    } else if (k.type === 'shield') {
      if (k.cd <= 0 && k.threatD < 55 && Math.random() < (0.3 + k.skill * 0.6)) useAbility(k);
    } else {
      if (k.held) { k.holdT += dt; if (k.holdT > 0.6 && state.scene === 'playing') useAbility(k); }
      else if (k.cd <= 0 && k.catchT <= 0 && k.threatD < 90 && Math.random() < 0.25) useAbility(k);
    }
  }

  /* ---------- Update ---------- */
  function readInput() {
    let x = 0, y = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) y -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;
    x += stick.x; y += stick.y;
    return [x, y];
  }

  function updateKernels(dt) {
    for (const k of state.kernels) {
      k.iframes = Math.max(0, k.iframes - dt);
      k.flash = Math.max(0, k.flash - dt);
      k.shield = Math.max(0, k.shield - dt);
      k.cd = Math.max(0, k.cd - dt);
      if (!k.alive) { k.popT = Math.max(0, k.popT - dt); continue; }
      if (k.catchT > 0) {
        k.catchT -= dt;
        if (k.catchT <= 0 && k.catchPending && !k.held) { k.catchPending = false; k.cd = KERNELS.catch.cd; }
      }
      if (k.isYou) { const [x, y] = readInput(); moveKernel(k, x, y, dt, PLAYER_SPEED); }
      else botThink(k, dt);
    }
  }

  function updateProj(dt) {
    const ps = state.proj;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      const d = Math.hypot(p.x, p.y);
      let dead = d > R + 40 || p.life <= 0;
      if (!dead && p.thrown && state.boss && state.scene === 'playing' && d < BOSS_R + p.r) {
        hitBoss(1); dead = true;
      }
      if (!dead) {
        for (const k of state.kernels) {
          if (!k.alive || (p.team >= 0 && k.team === p.team) || p.ignore === k.i) continue;
          const dx = k.x - p.x, dy = k.y - p.y, rr = KR + p.r - 3;
          if (dx * dx + dy * dy > rr * rr) continue;
          if (k.shield > 0) {
            // Deflect away from the shield instead of destroying the shot
            const dd = Math.hypot(dx, dy) || 1, sp = Math.hypot(p.vx, p.vy);
            p.vx = -dx / dd * sp; p.vy = -dy / dd * sp; p.ignore = k.i; p.life = Math.min(p.life, 3);
            addSpark(p.x, p.y, '#bfeaff');
            break;
          }
          if (k.catchT > 0 && !k.held) {
            k.held = true; k.holdT = 0; k.catchT = 0; k.catchPending = false; k.cd = 0;
            addSpark(p.x, p.y, '#ffd0a0');
            if (k.isYou) sfx.caught();
            dead = true; break;
          }
          if (k.iframes > 0) continue;
          damage(k, 1);
          dead = true; break;
        }
      }
      if (dead) ps.splice(i, 1);
    }
  }

  function updateFx(dt) {
    for (let i = state.fx.length - 1; i >= 0; i--) {
      const f = state.fx[i]; f.t += dt;
      if (f.t >= f.life) state.fx.splice(i, 1);
    }
  }

  function checkEnd() {
    if (state.scene === 'menu' || state.scene === 'countdown' || state.scene === 'over') return;
    const teams = new Set();
    for (const k of state.kernels) if (k.alive) teams.add(k.team);
    const youTeamAlive = teams.has(0);
    if (!youTeamAlive && !state.resultShown && !state.resultAt) {
      state.place = teams.size + 1;
      state.resultAt = state.t + 1.3;
    } else if (youTeamAlive && state.you && !state.you.alive && !state.noted) {
      state.noted = true;
      showBanner('Popped! Cheer on your squad', 2.5);
    }
    if (teams.size <= 1 || state.bossDown) {
      state.scene = 'over';
      state.proj = [];
      if (youTeamAlive) { state.resultAt = state.t + 1.2; state.win = true; }
      else { state.win = false; if (!state.resultAt) state.resultAt = state.t + 0.8; }
    }
  }

  function showResult() {
    state.resultShown = true;
    const squad = state.mode === 'squad';
    const total = squad ? PLAYERS / 4 : PLAYERS;
    const over = state.scene === 'over';
    let title, text;
    if (over && state.win) {
      title = squad ? 'Your squad wins!' : 'You win!';
      text = squad ? 'Your squad is the last one unpopped.' : 'Last kernel standing.';
      sfx.win();
    } else if (over && state.watching) {
      title = 'Round over';
      text = 'The match has ended. Your finish: #' + state.place + ' of ' + total + (squad ? ' squads.' : ' kernels.');
    } else {
      title = 'Popped!';
      text = (squad ? 'Your squad finished #' : 'You finished #') + state.place + ' of ' + total + (squad ? ' squads.' : ' kernels.');
      sfx.lose();
    }
    if (!state.recorded) { recordStats(over && state.win, state.place || 1); state.recorded = true; }
    el.resultTitle.textContent = title;
    el.resultText.textContent = text;
    el.watchBtn.hidden = over;
    el.result.hidden = false;
  }

  function update(dt) {
    state.t += dt;
    if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) el.banner.classList.remove('show'); }

    if (state.scene === 'countdown') {
      state.cdT -= dt;
      if (state.cdT <= 0) startRound(0);
    } else if (state.scene === 'intermission') {
      state.interT -= dt;
      if (state.interT <= 0) startRound(state.round + 1);
    } else if (state.scene === 'playing') {
      state.roundT -= dt;
      updateBoss(dt);
      if (state.scene === 'playing' && state.roundT <= 0) endRound(false);
    }

    if (state.scene !== 'menu') {
      updateKernels(dt);
      updateProj(dt);
      updateFx(dt);
      checkEnd();
      if (state.resultAt && !state.resultShown && state.t >= state.resultAt) showResult();
      else if (state.resultAt && state.scene === 'over' && state.watching && state.t >= state.resultAt && el.result.hidden) showResult();
    }
  }

  /* ---------- Rendering ---------- */
  function rr(x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }
  function angryEyes(x, y, s, glow) {
    for (const sx of [-1, 1]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(x + sx * 10 * s, y, 7 * s, 8 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = glow || '#1b1b1b';
      ctx.beginPath(); ctx.arc(x + sx * 10 * s, y + 1 * s, 3.4 * s, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.moveTo(x + sx * 18 * s, y - 13 * s); ctx.lineTo(x + sx * 3 * s, y - 7 * s); ctx.stroke();
    }
  }
  function flame(s, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, -62 * s);
    ctx.bezierCurveTo(30 * s, -30 * s, 44 * s, 0, 26 * s, 30 * s);
    ctx.bezierCurveTo(14 * s, 46 * s, -14 * s, 46 * s, -26 * s, 30 * s);
    ctx.bezierCurveTo(-44 * s, 0, -30 * s, -30 * s, 0, -62 * s);
    ctx.fill();
  }

  function drawBoss(id, b) {
    const t = state.t;
    const sh = b ? b.shake * 4 * Math.sin(t * 70) : 0;
    ctx.save();
    ctx.translate(sh, 0);
    if (b && b.hurt > 0) ctx.globalAlpha = 0.65;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 40, 56, 14, 0, 0, TAU); ctx.fill();
    if (id === 'butter') {
      ctx.rotate(Math.sin(t * 1.2) * 0.06);
      rr(-46, -22, 92, 58, 12, '#e0ac22');
      rr(-46, -34, 92, 50, 12, '#ffe27a');
      angryEyes(0, -12, 1);
      ctx.strokeStyle = '#7a4d00'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 10, 9, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    } else if (id === 'salt') {
      ctx.rotate(Math.sin(t * (b && b.shake > 0.3 ? 28 : 1.4)) * (b && b.shake > 0.3 ? 0.12 : 0.04));
      rr(-30, -14, 60, 58, 12, '#eaf0f7');
      ctx.fillStyle = '#b8c4d2';
      ctx.beginPath(); ctx.arc(0, -14, 30, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#7d8a99';
      for (const dx of [-14, 0, 14]) { ctx.beginPath(); ctx.arc(dx, -26, 3, 0, TAU); ctx.fill(); }
      angryEyes(0, 8, 0.9);
    } else if (id === 'fire') {
      const w = 1 + Math.sin(t * 9) * 0.05;
      ctx.scale(w, 1 + Math.sin(t * 7 + 1) * 0.06);
      flame(1, '#ff4b1f'); flame(0.74, '#ff9d1f'); flame(0.46, '#ffe066');
      angryEyes(0, 6, 0.8);
    } else {
      rr(-52, -36, 104, 74, 10, '#d7dde4');
      const on = state.beam.phase === 'on';
      rr(-44, -28, 64, 58, 6, on ? '#7fe6ff' : '#222c38');
      angryEyes(-12, -2, 0.9, '#ff3b3b');
      ctx.fillStyle = '#9aa5b1';
      ctx.beginPath(); ctx.arc(34, -14, 7, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(34, 8, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff5a4d'; ctx.fillRect(28, 22, 12, 5);
    }
    ctx.restore();
  }

  function drawKernel(k) {
    if (!k.alive) {
      if (k.popT <= 0) return;
      const p = 1 - k.popT / 0.9;
      ctx.save(); ctx.translate(k.x, k.y); ctx.globalAlpha = 1 - p;
      ctx.fillStyle = '#fffaf0';
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * TAU + 0.4;
        ctx.beginPath(); ctx.arc(Math.cos(a) * p * 18, Math.sin(a) * p * 18, 6 + p * 9, 0, TAU); ctx.fill();
      }
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(k.x, k.y);
    if (k.iframes > 0 && Math.floor(k.iframes * 14) % 2) ctx.globalAlpha = 0.45;
    // Marker rings: you and your squadmates
    if (k.isYou || k.team === 0) {
      ctx.strokeStyle = k.isYou ? '#ffffff' : '#7dffa8';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 2, KR + 5, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 14, 11, 4, 0, 0, TAU); ctx.fill();
    // Body
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.bezierCurveTo(11, -15, 13, 2, 10, 9);
    ctx.bezierCurveTo(7, 16, -7, 16, -10, 9);
    ctx.bezierCurveTo(-13, 2, -11, -15, 0, -15);
    ctx.fillStyle = k.flash > 0 ? '#ffffff' : KERNELS[k.type].color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.ellipse(-4, -6, 2.5, 5, 0.3, 0, TAU); ctx.fill();
    // Eyes look where the kernel is heading
    ctx.fillStyle = '#2a1608';
    ctx.beginPath(); ctx.arc(-4 + k.fx * 1.5, -1 + k.fy * 1.5, 1.9, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(4 + k.fx * 1.5, -1 + k.fy * 1.5, 1.9, 0, TAU); ctx.fill();
    // Shield bubble
    if (k.shield > 0) {
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(state.t * 20);
      ctx.fillStyle = 'rgba(127,212,255,0.35)';
      ctx.strokeStyle = '#bfeaff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, KR + 10, 0, TAU); ctx.fill(); ctx.stroke();
    }
    // Catch window and held shot
    if (k.catchT > 0) {
      ctx.strokeStyle = '#ffb35c'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, KR + 12, 0, TAU * (k.catchT / KERNELS.catch.window)); ctx.stroke();
    }
    if (k.held) {
      ctx.fillStyle = '#ffb35c';
      ctx.beginPath(); ctx.arc(0, -24, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
    if (k.isYou) {
      ctx.fillStyle = '#fff'; ctx.font = '700 13px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('YOU', k.x, k.y - 28);
    }
  }

  function drawProj(p) {
    ctx.fillStyle = p.col;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = p.thrown ? '#ffffff' : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = p.thrown ? 3 : 2; ctx.stroke();
    if (p.r >= 14) {
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.5, 0, TAU); ctx.fill();
    }
  }

  function drawBeam() {
    const bm = state.beam;
    if (bm.phase === 'off') return;
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.clip();
    ctx.rotate(bm.ang);
    if (bm.phase === 'tele') {
      ctx.setLineDash([14, 12]);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();
    } else {
      ctx.shadowColor = '#7fe6ff'; ctx.shadowBlur = 24;
      ctx.strokeStyle = '#7fe6ff'; ctx.lineWidth = 20;
      ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(-R, 0); ctx.lineTo(R, 0); ctx.stroke();
    }
    ctx.restore();
  }

  function drawArena() {
    const g = ctx.createRadialGradient(0, 0, 40, 0, 0, R);
    g.addColorStop(0, '#34506b'); g.addColorStop(1, '#22344a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 2;
    for (const r of [150, 250, 350]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); }
    ctx.strokeStyle = '#ffd86b'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(0, 0, R + 5, 0, TAU); ctx.stroke();
  }

  function draw() {
    const w = canvas.width, h = canvas.height, s = Math.min(w, h) / WORLD;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(s, 0, 0, s, w / 2, h / 2);
    drawArena();
    drawBeam();
    const idle = state.scene === 'menu';
    if (state.boss || idle) drawBoss(idle ? 'butter' : state.boss.id, state.boss);
    for (const p of state.proj) drawProj(p);
    for (const k of state.kernels) if (!k.alive) drawKernel(k);
    for (const k of state.kernels) if (k.alive && !k.isYou) drawKernel(k);
    if (state.you && state.you.alive) drawKernel(state.you);
    for (const f of state.fx) {
      const p = f.t / f.life;
      ctx.globalAlpha = 1 - p;
      if (f.kind === 'ring') {
        ctx.strokeStyle = f.color; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(f.x, f.y, 10 + p * f.max, 0, TAU); ctx.stroke();
      } else {
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(f.x, f.y, 6 + p * 10, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ---------- HUD ---------- */
  function updateHud() {
    if (el.hud.hidden || !state.you) return;
    const k = state.you;
    const hs = el.hearts.children;
    for (let i = 0; i < hs.length; i++) hs[i].style.setProperty('--fill', clamp(k.hp - i, 0, 1) * 100 + '%');
    const teams = new Set(); let alive = 0;
    for (const o of state.kernels) if (o.alive) { alive++; teams.add(o.team); }
    el.aliveLabel.textContent = state.mode === 'squad' ? teams.size + ' squads, ' + alive + ' kernels' : alive + ' kernels left';
    if (state.boss) el.bossFill.style.width = clamp(state.boss.hp / state.boss.max, 0, 1) * 100 + '%';
    const d = KERNELS[k.type];
    let name = d.name;
    if (k.type === 'catch') name = k.held ? 'Throw!' : k.catchT > 0 ? 'Catching' : d.name;
    el.abilityName.textContent = name;
    const frac = k.held ? 0 : k.cd / d.cd;
    el.abilityBtn.style.setProperty('--cd', frac * 100 + '%');
    el.abilityBtn.classList.toggle('ready', k.alive && (k.cd <= 0 || k.held));
    el.abilityBtn.disabled = !k.alive;
  }

  /* ---------- Stats ---------- */
  function loadStats() {
    try { return JSON.parse(localStorage.getItem('popcorn.stats')) || { games: 0, wins: 0, best: 0 }; }
    catch (e) { return { games: 0, wins: 0, best: 0 }; }
  }
  function recordStats(win, place) {
    const s = loadStats();
    s.games++; if (win) s.wins++;
    if (!s.best || place < s.best) s.best = place;
    try { localStorage.setItem('popcorn.stats', JSON.stringify(s)); } catch (e) { /* storage blocked */ }
    renderStats();
  }
  function renderStats() {
    const s = loadStats();
    el.stats.textContent = s.games ? 'Games ' + s.games + ', wins ' + s.wins + ', best finish #' + s.best : '';
  }

  /* ---------- Menu wiring ---------- */
  function setRadio(group, active) {
    group.forEach(b => b.setAttribute('aria-checked', b === active ? 'true' : 'false'));
  }
  const kernelBtns = Array.from(document.querySelectorAll('.choice.kernel'));
  kernelBtns.forEach(b => b.addEventListener('click', () => {
    state.type = b.dataset.type; setRadio(kernelBtns, b);
  }));

  function squadUrl() { return location.href.split('?')[0].split('#')[0] + '?squad=' + state.squadCode; }
  function setMode(mode) {
    state.mode = mode;
    setRadio([el.modeSolo, el.modeSquad], mode === 'solo' ? el.modeSolo : el.modeSquad);
    el.squadBox.hidden = mode !== 'squad';
    if (mode === 'squad') {
      if (!state.squadCode) state.squadCode = Math.random().toString(36).slice(2, 7);
      el.squadLink.value = squadUrl();
      try { history.replaceState(null, '', '?squad=' + state.squadCode); } catch (e) { /* file:// */ }
    }
  }
  el.modeSolo.addEventListener('click', () => setMode('solo'));
  el.modeSquad.addEventListener('click', () => setMode('squad'));
  el.copyLink.addEventListener('click', () => {
    const done = () => { el.copyLink.textContent = 'Copied'; setTimeout(() => (el.copyLink.textContent = 'Copy'), 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.squadLink.value).then(done, () => { el.squadLink.select(); });
    else { el.squadLink.select(); document.execCommand('copy'); done(); }
  });

  const begin = () => { state.recorded = false; state.noted = false; startGame(); };
  el.playBtn.addEventListener('click', begin);
  el.againBtn.addEventListener('click', begin);
  el.watchBtn.addEventListener('click', () => { state.watching = true; el.result.hidden = true; });
  el.menuBtn.addEventListener('click', () => {
    state.scene = 'menu'; state.boss = null; state.proj = []; state.kernels = []; state.you = null;
    state.beam = { phase: 'off', t: 0, ang: 0, spin: 0 }; state.recorded = false; state.noted = false;
    el.result.hidden = true; el.hud.hidden = true; el.stickZone.hidden = true; el.menu.hidden = false;
    el.banner.classList.remove('show');
  });
  el.muteBtn.addEventListener('click', () => {
    muted = !muted; el.muteBtn.textContent = muted ? 'Sound off' : 'Sound on';
  });

  /* ---------- Input ---------- */
  window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && !el.hud.hidden) e.preventDefault();
    if (e.code === 'Space') {
      if (!e.repeat && state.you && !el.hud.hidden && el.result.hidden) useAbility(state.you);
      return;
    }
    keys.add(e.code);
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); stick.x = stick.y = 0; });

  el.abilityBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (state.you) useAbility(state.you);
  });

  el.stickZone.addEventListener('pointerdown', e => {
    if (stick.id !== null) return;
    stick.id = e.pointerId;
    el.stickZone.setPointerCapture(e.pointerId);
    const r = el.stickZone.getBoundingClientRect();
    stick.ox = e.clientX; stick.oy = e.clientY;
    el.stickBase.style.display = 'block';
    el.stickBase.style.left = (e.clientX - r.left) + 'px';
    el.stickBase.style.top = (e.clientY - r.top) + 'px';
    el.stickKnob.style.transform = 'translate(0,0)';
  });
  el.stickZone.addEventListener('pointermove', e => {
    if (e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    const m = Math.hypot(dx, dy), max = 50;
    if (m > max) { dx = dx / m * max; dy = dy / m * max; }
    el.stickKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    stick.x = Math.abs(dx) < 6 ? 0 : dx / max;
    stick.y = Math.abs(dy) < 6 ? 0 : dy / max;
  });
  const endStick = e => {
    if (e.pointerId !== stick.id) return;
    stick.id = null; stick.x = stick.y = 0;
    el.stickBase.style.display = 'none';
  };
  el.stickZone.addEventListener('pointerup', endStick);
  el.stickZone.addEventListener('pointercancel', endStick);
  document.addEventListener('contextmenu', e => e.preventDefault());

  /* ---------- Loop ---------- */
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state.scene === 'menu') state.t += dt; else update(dt);
    draw();
    updateHud();
    requestAnimationFrame(frame);
  }

  // Shared squad link opens straight into squad mode
  const params = new URLSearchParams(location.search);
  if (params.get('squad')) { state.squadCode = params.get('squad').slice(0, 12); setMode('squad'); }
  renderStats();
  requestAnimationFrame(frame);
})();
