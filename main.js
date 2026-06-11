/* ============================================================
   透明の器 — Music Interactive Web
   --------------------------------
   画面は一枚の窓ガラス。あなたは雨の朝、誰もいない街の内側にいる。
   ・ガラスは朝もやで曇る。なぞると拭ける。放っておくとまた曇る
   ・あまつぶは結露し、くっつき、とりこみ、落ちて、水たまりに消える
   ・しずくに触れると「数えられる」— あまつぶ数えて暇つぶす
   ・雨の強さ/波紋/落下は楽曲のエネルギーに連動する
   ============================================================ */

'use strict';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------
   歌詞タイムライン（秒）
   実曲とのズレは t を直す。再生中に L キーで現在時刻が
   コンソールに出るので、それを写すだけでよい。
   event: crows  … カラスの群れが空を埋める
          gather … 小さいあまつぶが寄り集まる
          absorb … 大きいあまつぶがとりこむ
          fall   … 大きいしずくが一斉に落ちる
          pool   … 水たまりに波紋がひろがる
   ------------------------------------------------------------ */
const TIMELINE = [
  // faster-whisper の単語タイムスタンプから実測（発声の約0.4秒手前で立ち上げる）
  { t:  13.9, text: '老人が犬を連れて朝もやに消えてった' },
  { t:  20.9, text: 'カラスがいっせいに飛び立って空を埋めた', event: 'crows' },
  { t:  26.4, text: 'みんなどこへ行くの' },

  { t:  32.0, text: '誰もいないこの街で、ただきこえるのは' },
  { t:  38.9, text: '自分の吐く息と雨の音だけ', event: 'breath' },

  { t:  44.6, text: 'あまつぶ数えて暇つぶす' },
  { t:  53.3, text: 'あまつぶ数えて暇つぶす' },
  { t:  60.3, text: '小さいあまつぶくっついて', event: 'gather' },
  { t:  64.0, text: '大きいあまつぶとりこんで', event: 'absorb' },
  { t:  68.5, text: '落ちてゆく', event: 'fall' },
  { t:  71.3, text: '落ちてゆく', event: 'fall' },
  { t:  75.0, text: '水たまりの中消えてった', event: 'pool' },

  { t:  93.1, text: 'あまつぶ数えて暇つぶす' },
  { t: 100.4, text: 'あまつぶ数えて暇つぶす' },
  { t: 107.2, text: '小さいあまつぶくっついて', event: 'gather' },
  { t: 110.9, text: '大きいあまつぶとりこんで', event: 'absorb' },
  { t: 115.4, text: '落ちてゆく', event: 'fall' },
  { t: 118.1, text: '落ちてゆく', event: 'fall' },
  { t: 121.9, text: '水たまりの中消えてった', event: 'pool' },

  { t: 154.8, text: '誰もいないこの街で、ただきこえるのは' },
  { t: 161.4, text: '自分の吐く息と雨の音だけ', event: 'breath' },

  { t: 169.2, text: 'あまつぶ数えて暇つぶす' },
  { t: 175.2, text: 'あまつぶ数えて暇つぶす' },
];

/* ---------------- 基本要素 ---------------- */

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const audio = document.getElementById('audio');

let W = 0, H = 0, dpr = 1;
let puddleY = 0;                 // 水たまりの水面

// オフスクリーン: 外の街（鮮明） / 曇り元 / 生きている曇り層
let bg, bgX;
let fogSrc;
let fog, fogX;
let noiseTile;

const state = {
  started: false,
  ended: false,
  time: 0,            // 再生位置
  energy: 0,          // 0..1 全体エネルギー（平滑化）
  bass: 0,            // 0..1 低域
  bassAvg: 0.01,
  beat: 0,            // 直近ビートの減衰パルス
  counted: 0,         // 数えたあまつぶ
  pointer: { x: -999, y: -999, px: -999, py: -999, down: false, lastMove: 0 },
  breathTimer: 0,
  silentFrames: 0,    // アナライザが沈黙なら擬似エネルギーへ
  syntheticAudio: false,
};

/* ---------------- 外の街を描く ----------------
   ぼんやりした朝。街灯のボケ、電柱、濡れた路面。
   正規化座標で一度だけ風景を決め、リサイズ時に再描画する。 */

const town = {
  bokeh: [], poles: [], windows: [],
  init() {
    this.bokeh = [];
    for (let i = 0; i < 34; i++) {
      this.bokeh.push({
        x: Math.random(), y: rand(0.18, 0.72), r: rand(0.014, 0.06),
        warm: Math.random() < 0.5, a: rand(0.22, 0.52),
      });
    }
    this.poles = [];
    let px = rand(0.06, 0.16);
    while (px < 1) { this.poles.push({ x: px, w: rand(0.004, 0.008), lean: rand(-0.01, 0.01) }); px += rand(0.16, 0.3); }
    this.windows = [];
    for (let i = 0; i < 9; i++) {
      this.windows.push({ x: Math.random(), y: rand(0.3, 0.62), w: rand(0.01, 0.025), h: rand(0.015, 0.035), a: rand(0.05, 0.16) });
    }
  },
};

function paintTown(c, w, h) {
  // 朝もやの空
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.0, '#c3ced5');
  sky.addColorStop(0.45, '#a6b3bb');
  sky.addColorStop(0.78, '#7f8c95');
  sky.addColorStop(1.0, '#5d6a73');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);

  // 遠景の建物のかたまり（もやに沈む）
  c.save();
  for (let i = 0; i < 7; i++) {
    const bx = (i / 7) * w + rand(-w * 0.04, w * 0.04);
    const bw = rand(w * 0.08, w * 0.2);
    const bh = rand(h * 0.12, h * 0.3);
    const g = c.createLinearGradient(0, h * 0.78 - bh, 0, h * 0.78);
    g.addColorStop(0, 'rgba(100,114,124,0.0)');
    g.addColorStop(1, 'rgba(78, 92,103,0.72)');
    c.fillStyle = g;
    c.fillRect(bx, h * 0.78 - bh, bw, bh);
  }
  c.restore();

  // 窓あかり
  for (const wd of town.windows) {
    c.fillStyle = `rgba(236, 216, 176, ${Math.min(0.4, wd.a * 2)})`;
    c.fillRect(wd.x * w, wd.y * h, wd.w * w, wd.h * h);
  }

  // 電柱と電線
  c.strokeStyle = 'rgba(70, 82, 90, 0.4)';
  for (const p of town.poles) {
    const x0 = p.x * w, x1 = x0 + p.lean * w;
    c.lineWidth = p.w * w;
    c.beginPath();
    c.moveTo(x0, h * 0.78);
    c.lineTo(x1, h * 0.22);
    c.stroke();
  }
  c.lineWidth = Math.max(1, w * 0.0012);
  c.strokeStyle = 'rgba(70, 82, 90, 0.3)';
  for (let i = 0; i < town.poles.length - 1; i++) {
    const a = town.poles[i], b = town.poles[i + 1];
    const ax = a.x * w + a.lean * w * 0.85, bx2 = b.x * w + b.lean * w * 0.85;
    const ay = h * 0.27, by = h * 0.27;
    c.beginPath();
    c.moveTo(ax, ay);
    c.quadraticCurveTo((ax + bx2) / 2, ay + h * 0.05, bx2, by);
    c.stroke();
  }

  // 街灯のボケ
  for (const b of town.bokeh) {
    const r = b.r * Math.min(w, h) * 2.2;
    const g = c.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, r);
    const col = b.warm ? '226, 200, 160' : '198, 214, 224';
    g.addColorStop(0, `rgba(${col}, ${b.a})`);
    g.addColorStop(0.6, `rgba(${col}, ${b.a * 0.5})`);
    g.addColorStop(1, `rgba(${col}, 0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(b.x * w, b.y * h, r, 0, TAU);
    c.fill();
  }

  // 濡れた路面と水たまり（光の縦すじが反射する）
  const roadTop = h * 0.78;
  const road = c.createLinearGradient(0, roadTop, 0, h);
  road.addColorStop(0, '#5b676f');
  road.addColorStop(0.5, '#4a565e');
  road.addColorStop(1, '#39444c');
  c.fillStyle = road;
  c.fillRect(0, roadTop, w, h - roadTop);

  for (const b of town.bokeh) {
    if (b.y > 0.66) continue;
    const col = b.warm ? '226, 200, 160' : '198, 214, 224';
    const rx = b.x * w;
    const g = c.createLinearGradient(0, roadTop, 0, h);
    g.addColorStop(0, `rgba(${col}, ${b.a * 0.55})`);
    g.addColorStop(1, `rgba(${col}, 0)`);
    c.fillStyle = g;
    const sw = b.r * Math.min(w, h) * rand(0.8, 1.4);
    c.fillRect(rx - sw / 2, roadTop, sw, (h - roadTop) * rand(0.5, 1));
  }

  // 路面のかすかな水平のゆらぎ
  c.strokeStyle = 'rgba(220, 230, 236, 0.05)';
  c.lineWidth = 1;
  for (let y = roadTop + 6; y < h; y += rand(7, 16)) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y + rand(-2, 2));
    c.stroke();
  }
}

/* ぼかし: 縮小→拡大の二段。filter非対応環境でも動く */
function blurred(src, factor) {
  const a = document.createElement('canvas');
  a.width = Math.max(2, Math.round(src.width / factor));
  a.height = Math.max(2, Math.round(src.height / factor));
  const ac = a.getContext('2d');
  ac.imageSmoothingEnabled = true;
  ac.drawImage(src, 0, 0, a.width, a.height);
  const b = document.createElement('canvas');
  b.width = Math.max(2, Math.round(a.width / 2));
  b.height = Math.max(2, Math.round(a.height / 2));
  const bc = b.getContext('2d');
  bc.imageSmoothingEnabled = true;
  bc.drawImage(a, 0, 0, b.width, b.height);
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const oc = out.getContext('2d');
  oc.imageSmoothingEnabled = true;
  oc.drawImage(b, 0, 0, out.width, out.height);
  return out;
}

function makeNoise() {
  const n = document.createElement('canvas');
  n.width = n.height = 128;
  const nc = n.getContext('2d');
  const img = nc.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 14;
  }
  nc.putImageData(img, 0, 0);
  return n;
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  puddleY = H * 0.84;

  bg = document.createElement('canvas');
  bg.width = canvas.width;
  bg.height = canvas.height;
  bgX = bg.getContext('2d');
  bgX.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintTown(bgX, W, H);

  // 曇り元 = ぼかした街 + 乳白のもや
  const soft = blurred(bg, 9);
  fogSrc = document.createElement('canvas');
  fogSrc.width = canvas.width;
  fogSrc.height = canvas.height;
  const fc = fogSrc.getContext('2d');
  fc.drawImage(soft, 0, 0);
  fc.fillStyle = 'rgba(228, 235, 240, 0.42)';
  fc.fillRect(0, 0, fogSrc.width, fogSrc.height);

  fog = document.createElement('canvas');
  fog.width = canvas.width;
  fog.height = canvas.height;
  fogX = fog.getContext('2d');
  fogX.drawImage(fogSrc, 0, 0);

  noiseTile = makeNoise();
}

/* ---------------- 音 ---------------- */

let actx = null, analyser = null, freqData = null;

function initAudio() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  actx = new AC();
  const src = actx.createMediaElementSource(audio);
  analyser = actx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;
  src.connect(analyser);
  analyser.connect(actx.destination);
  freqData = new Uint8Array(analyser.frequencyBinCount);
}

function readAudio() {
  if (!analyser) return;
  analyser.getByteFrequencyData(freqData);
  let sum = 0, bassSum = 0;
  const n = freqData.length;
  for (let i = 0; i < n; i++) sum += freqData[i];
  for (let i = 1; i < 11; i++) bassSum += freqData[i];
  const energyNow = sum / (n * 255);
  const bassNow = bassSum / (10 * 255);

  // file:// 等でアナライザが無音を返す場合は擬似エネルギーで補う
  if (!audio.paused && energyNow < 0.001) {
    state.silentFrames++;
    if (state.silentFrames > 150) state.syntheticAudio = true;
  } else {
    state.silentFrames = 0;
    state.syntheticAudio = false;
  }

  let e = energyNow, b = bassNow;
  if (state.syntheticAudio) {
    const t = state.time;
    e = 0.25 + 0.15 * Math.sin(t * 0.5) + 0.08 * Math.sin(t * 2.3);
    b = 0.3 + 0.25 * Math.max(0, Math.sin(t * Math.PI * 2 * 1.4));
  }

  state.energy += (e - state.energy) * 0.06;
  state.bass += (b - state.bass) * 0.25;
  state.bassAvg += (state.bass - state.bassAvg) * 0.012;

  if (state.bass > state.bassAvg * 1.5 && state.bass > 0.12 && state.beat < 0.25) {
    state.beat = 1;
  }
  state.beat *= 0.92;
}

/* ---------------- あまつぶ ---------------- */

const drops = [];        // 静止滴と滑落滴
const ripples = [];      // 水たまりの波紋
const floaters = [];     // 数えた数字の浮遊
const crows = [];        // カラス
const rain = [];         // ガラスの向こうを降る雨
let mergeSurge = 0;      // gather/absorb イベントの余韻
let slideTimer = 0;      // 次の滴が滑り出すまでの間
let fogDebt = 0;         // 曇り戻しの蓄積量

function initRain() {
  rain.length = 0;
  for (let i = 0; i < 70; i++) {
    rain.push({
      x: Math.random(), y: Math.random(),
      len: rand(0.02, 0.05), speed: rand(0.55, 1.0),
      depth: rand(0.3, 1), // 遠いほど薄く遅い
    });
  }
}

function drawRain(dt) {
  ctx.save();
  ctx.lineCap = 'round';
  const fall = (0.6 + state.energy * 1.6);
  for (const r of rain) {
    r.y += r.speed * r.depth * fall * dt;
    if (r.y > 1.05) { r.y = -0.06; r.x = Math.random(); }
    const x = r.x * W, y = r.y * H, len = r.len * H * r.depth;
    ctx.strokeStyle = `rgba(222, 232, 238, ${0.10 + r.depth * 0.14})`;
    ctx.lineWidth = r.depth * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len * 0.06, y + len);
    ctx.stroke();
  }
  ctx.restore();
}

function spawnDrop(x, y, r) {
  if (drops.length > 420) {
    // いちばん小さい静止滴を蒸発させて場所をあける
    let mi = -1, mr = Infinity;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d.sliding && !d.counted && d.r < mr) { mr = d.r; mi = i; }
    }
    if (mi >= 0) drops.splice(mi, 1); else return null;
  }
  const d = {
    x: x !== undefined ? x : rand(0, W),
    y: y !== undefined ? y : rand(0, puddleY - 30),
    r: r !== undefined ? r : rand(0.8, 4.0),
    vy: 0,
    sliding: false,
    wob: rand(0, TAU),
    counted: false,
    shimmer: 0,
  };
  drops.push(d);
  return d;
}

function mergeInto(big, small) {
  big.r = Math.min(Math.sqrt(big.r * big.r + small.r * small.r), 16);
  big.x = (big.x * big.r + small.x * small.r) / (big.r + small.r);
  big.shimmer = Math.max(big.shimmer, 0.4);
  small.dead = true;
}

function updateDrops(dt) {
  // 結露: 曲のエネルギーで雨が強くなる
  if (state.started && !state.ended) {
    const rate = 0.1 + state.energy * 2.4 + state.beat * 0.8;
    if (Math.random() < rate * dt * 14) spawnDrop();
  }

  // 静止滴どうしの合体（間引いて負荷を抑える）
  const surge = mergeSurge > 0;
  if (surge) mergeSurge -= dt;
  if ((frameCount % 12 === 0) || surge) {
    for (let i = 0; i < drops.length; i++) {
      const a = drops[i];
      if (a.dead || a.sliding || a.r < 1.2) continue;
      for (let j = i + 1; j < drops.length; j++) {
        const b = drops[j];
        if (b.dead || b.sliding) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        const reach = (a.r + b.r) * (surge ? 1.7 : 0.85);
        if (dx * dx + dy * dy < reach * reach) {
          if (surge && dx * dx + dy * dy > (a.r + b.r) * (a.r + b.r) * 0.7) {
            // 引き寄せ合う
            b.x += dx * 0.08; b.y += dy * 0.08;
          } else {
            a.r >= b.r ? mergeInto(a, b) : mergeInto(b, a);
          }
        }
      }
    }
  }

  // 結露は静かに育つ。大きい滴ほど水を集める
  const grow = (0.012 + state.energy * 0.05) * dt;
  let slidingCount = 0;
  for (const d of drops) {
    if (d.sliding && !d.dead) slidingCount++;
    if (d.dead || d.sliding || d.r >= 7.5) continue;
    d.r += grow * (0.5 + d.r * 0.18);
  }

  // 重い滴は滑り出す。ただし筋は一本ずつ、間をおいて
  slideTimer -= dt;
  if (slideTimer <= 0 && slidingCount < 3) {
    const heavies = drops.filter(d => !d.dead && !d.sliding && d.r > 5.4);
    if (heavies.length) {
      const d = heavies[(Math.random() * heavies.length) | 0];
      d.sliding = true;
      d.vy = rand(0.2, 0.6);
      slideTimer = rand(2.5, 6.0) - state.energy * 2.5 - state.beat * 0.6;
    }
  }

  // 滑落
  for (const d of drops) {
    if (d.dead || !d.sliding) continue;
    d.wob += dt * 7;
    d.vy += (0.5 + d.r * 0.10 + state.bass * 0.5) * dt * 60 * 0.04;
    d.vy = Math.min(d.vy, 6.5 + d.r * 0.2);
    d.y += d.vy * dt * 60;
    d.x += Math.sin(d.wob) * 0.28 + rand(-0.1, 0.1);

    // 通り道の滴をとりこむ
    for (const o of drops) {
      if (o === d || o.dead || o.sliding) continue;
      const dx = d.x - o.x, dy = d.y - o.y;
      const reach = d.r + o.r + 1;
      if (dx * dx + dy * dy < reach * reach) mergeInto(d, o);
    }

    // 曇りをぬぐった軌跡
    eraseFog(d.x, d.y, d.r * 1.05, 0.35);

    // ときどき小滴を置いていく
    if (Math.random() < 0.08) {
      const t = spawnDrop(d.x + rand(-d.r * 0.5, d.r * 0.5), d.y - d.r - rand(0, 4), rand(0.5, 1.6));
      if (t) d.r = Math.max(2.5, d.r - 0.03);
    }

    // 水たまりへ
    if (d.y >= puddleY) {
      d.dead = true;
      splash(d.x, puddleY + rand(4, Math.max(5, H - puddleY - 12)), d.r);
    }
  }

  // 死んだ滴を回収
  for (let i = drops.length - 1; i >= 0; i--) {
    if (drops[i].dead) drops.splice(i, 1);
  }
}

function splash(x, y, r) {
  const n = r > 9 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    ripples.push({ x, y, r: 1 + i * 4, max: r * rand(5, 8), a: 0.5, delay: i * 0.12 });
  }
}

function updateRipples(dt) {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const rp = ripples[i];
    if (rp.delay > 0) { rp.delay -= dt; continue; }
    rp.r += (28 + state.bass * 50) * dt;
    rp.a -= dt * 0.4;
    if (rp.a <= 0 || rp.r > rp.max) ripples.splice(i, 1);
  }
}

/* ---------------- カラス ---------------- */

function flushCrows() {
  const n = 13;
  for (let i = 0; i < n; i++) {
    crows.push({
      x: rand(-W * 0.2, W * 0.5),
      y: rand(H * 0.45, H * 0.75),
      vx: rand(2.4, 4.2),
      vy: rand(-1.8, -0.9),
      s: rand(6, 14),
      flap: rand(0, TAU),
      flapSpeed: rand(9, 14),
    });
  }
}

function updateCrows(dt) {
  for (let i = crows.length - 1; i >= 0; i--) {
    const c = crows[i];
    c.x += c.vx * dt * 60;
    c.y += c.vy * dt * 60;
    c.vy *= 0.998;
    c.flap += c.flapSpeed * dt;
    if (c.x > W + 60 || c.y < -60) crows.splice(i, 1);
  }
}

function drawCrows() {
  ctx.save();
  ctx.strokeStyle = 'rgba(38, 46, 52, 0.4)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (const c of crows) {
    const f = Math.sin(c.flap) * 0.8;
    ctx.beginPath();
    ctx.moveTo(c.x - c.s, c.y);
    ctx.quadraticCurveTo(c.x - c.s / 2, c.y - c.s * f, c.x, c.y);
    ctx.quadraticCurveTo(c.x + c.s / 2, c.y - c.s * f, c.x + c.s, c.y);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------- 曇りの操作 ---------------- */

function eraseFog(x, y, r, strength) {
  fogX.save();
  fogX.setTransform(dpr, 0, 0, dpr, 0, 0);
  fogX.globalCompositeOperation = 'destination-out';
  const g = fogX.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(0,0,0,${strength})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  fogX.fillStyle = g;
  fogX.beginPath();
  fogX.arc(x, y, r, 0, TAU);
  fogX.fill();
  fogX.restore();
}

function breathFog(x, y, r, a) {
  fogX.save();
  fogX.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = fogX.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(225, 233, 238, ${a})`);
  g.addColorStop(1, 'rgba(225, 233, 238, 0)');
  fogX.fillStyle = g;
  fogX.beginPath();
  fogX.arc(x, y, r, 0, TAU);
  fogX.fill();
  fogX.restore();
}

function refog(alpha) {
  fogX.save();
  fogX.setTransform(1, 0, 0, 1, 0, 0);
  fogX.globalAlpha = alpha;
  fogX.drawImage(fogSrc, 0, 0);
  fogX.restore();
}

/* ---------------- 描画 ---------------- */

let frameCount = 0;

function drawDrop(d) {
  const { x, y, r } = d;
  if (r < 2.2) {
    ctx.fillStyle = 'rgba(214, 226, 233, 0.5)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    return;
  }

  // しずくのレンズ: 外の景色が上下反転して縮んで映る
  ctx.save();
  ctx.beginPath();
  const squashX = d.sliding ? 0.92 : 1;
  const squashY = d.sliding ? 1.12 : 1;
  ctx.ellipse(x, y, r * squashX, r * squashY, 0, 0, TAU);
  ctx.clip();

  const m = 2.4;
  const sx = (x - r * m) * dpr;
  const sy = (y - r * m) * dpr;
  const sw = r * 2 * m * dpr;
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.drawImage(bg, sx, sy, sw, sw, -r * squashX, -r * squashY, r * 2 * squashX, r * 2 * squashY);
  ctx.restore();

  // 縁の影と光
  ctx.save();
  const rim = ctx.createRadialGradient(x, y, r * 0.4, x, y, r);
  rim.addColorStop(0, 'rgba(255,255,255,0)');
  rim.addColorStop(0.85, 'rgba(40, 55, 65, 0.08)');
  rim.addColorStop(1, 'rgba(30, 45, 55, 0.4)');
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.ellipse(x, y, r * squashX, r * squashY, 0, 0, TAU);
  ctx.fill();

  const hl = d.shimmer > 0 ? 0.9 : 0.65;
  ctx.fillStyle = `rgba(255,255,255,${hl})`;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.18, r * 0.1, -0.6, 0, TAU);
  ctx.fill();
  ctx.restore();

  if (d.shimmer > 0) d.shimmer -= 0.02;
}

function drawRipples() {
  ctx.save();
  for (const rp of ripples) {
    if (rp.delay > 0) continue;
    ctx.strokeStyle = `rgba(228, 238, 244, ${rp.a})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.22, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFloaters(dt) {
  ctx.save();
  ctx.font = `300 ${Math.round(clamp(W * 0.018, 15, 24))}px "Hiragino Mincho ProN", "Yu Mincho", serif`;
  ctx.textAlign = 'center';
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.y -= 14 * dt;
    f.a -= dt * 0.36;
    if (f.a <= 0) { floaters.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(42, 54, 62, ${f.a})`;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
}

function render(dt) {
  // 1. 外の街（視差つき）
  const par = 7;
  const ox = state.pointer.x > 0 ? ((state.pointer.x / W) - 0.5) * -par : 0;
  const oy = state.pointer.y > 0 ? ((state.pointer.y / H) - 0.5) * -par * 0.6 : 0;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(bg, ox - par, oy - par, W + par * 2, H + par * 2);
  ctx.restore();

  // 2. ガラスの向こうの雨とカラス
  drawRain(dt);
  drawCrows();

  // 3. 曇り層
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(fog, 0, 0);
  ctx.restore();

  // 4. 水たまりの波紋（曇りごしでも見えるように上へ）
  drawRipples();

  // 5. あまつぶ
  for (const d of drops) drawDrop(d);

  // 6. 数えた数字
  drawFloaters(dt);

  // 7. 粒子（フィルムグレイン）
  if (noiseTile) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    const nx = (Math.random() * 128) | 0, ny = (Math.random() * 128) | 0;
    ctx.translate(-nx, -ny);
    ctx.fillStyle = grainPattern();
    ctx.fillRect(nx, ny, W + 128, H + 128);
    ctx.restore();
  }

  // 8. ビネット
  ctx.save();
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.74);
  v.addColorStop(0, 'rgba(20, 30, 38, 0)');
  v.addColorStop(1, 'rgba(20, 30, 38, 0.22)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

let _grainPattern = null;
function grainPattern() {
  if (!_grainPattern) _grainPattern = ctx.createPattern(noiseTile, 'repeat');
  return _grainPattern;
}

/* ---------------- 歌詞 ---------------- */

const lyricsBox = document.getElementById('lyrics');
let timelineIdx = 0;
let lyricSide = 0;

function showLyric(text) {
  const el = document.createElement('div');
  el.className = 'lyric';
  el.textContent = text;
  // 左右の余白に交互に置く。中央は雨にゆずる
  lyricSide = 1 - lyricSide;
  const xRatio = lyricSide === 1 ? rand(0.66, 0.82) : rand(0.12, 0.26);
  el.style.left = `${(xRatio * 100).toFixed(1)}%`;
  el.style.top = `${rand(8, 22).toFixed(1)}%`;
  lyricsBox.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  setTimeout(() => {
    el.classList.remove('on');
    el.classList.add('off');
    setTimeout(() => el.remove(), 3600);
  }, 6800);
}

function fireEvent(name) {
  switch (name) {
    case 'crows':
      flushCrows();
      break;
    case 'gather':
      for (let i = 0; i < 50; i++) spawnDrop(undefined, rand(0, puddleY * 0.9), rand(0.7, 2.6));
      mergeSurge = 5;
      break;
    case 'absorb':
      mergeSurge = 6;
      break;
    case 'fall': {
      const sorted = drops.filter(d => !d.sliding && !d.dead).sort((a, b) => b.r - a.r);
      for (let i = 0; i < Math.min(4, sorted.length); i++) {
        sorted[i].r = Math.max(sorted[i].r, 6);
        sorted[i].sliding = true;
        sorted[i].vy = rand(0.5, 1.2);
      }
      break;
    }
    case 'pool':
      for (let i = 0; i < 6; i++) {
        setTimeout(() => {
          ripples.push({ x: rand(W * 0.1, W * 0.9), y: rand(puddleY + 6, H - 8), r: 2, max: rand(40, 90), a: 0.45, delay: 0 });
        }, i * 420);
      }
      break;
    case 'breath':
      breathFog(rand(W * 0.3, W * 0.7), rand(H * 0.5, H * 0.75), rand(90, 140), 0.5);
      break;
  }
}

function tickTimeline() {
  state.time = audio.currentTime;
  while (timelineIdx < TIMELINE.length && TIMELINE[timelineIdx].t <= state.time) {
    const entry = TIMELINE[timelineIdx];
    if (entry.text) showLyric(entry.text);
    if (entry.event) fireEvent(entry.event);
    timelineIdx++;
  }
}

/* ---------------- 入力 ---------------- */

const counterEl = document.getElementById('counter');
const countEl = document.getElementById('count');

function onPointerMove(e) {
  const p = state.pointer;
  p.px = p.x; p.py = p.y;
  p.x = e.clientX; p.y = e.clientY;
  p.lastMove = performance.now();
  if (!state.started || state.ended) return;
  // ガラスをぬぐう
  const dx = p.x - p.px, dy = p.y - p.py;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 10));
  for (let i = 0; i <= steps; i++) {
    eraseFog(p.px + dx * (i / steps), p.py + dy * (i / steps), 30, 0.5);
  }
}

function onPointerDown(e) {
  if (!state.started || state.ended) return;
  const x = e.clientX, y = e.clientY;

  // しずくに触れたら、数える
  let hit = null, hitD = Infinity;
  for (const d of drops) {
    if (d.dead || d.counted || d.r < 1.6) continue;
    const dd = Math.hypot(d.x - x, d.y - y);
    if (dd < Math.max(d.r + 18, 24) && dd < hitD) { hit = d; hitD = dd; }
  }
  if (hit) {
    hit.counted = true;
    hit.shimmer = 1;
    state.counted++;
    countEl.textContent = state.counted;
    counterEl.classList.remove('hidden');
    floaters.push({ x: hit.x, y: hit.y - hit.r - 6, a: 0.9, text: String(state.counted) });
  } else {
    // 何もない場所: 吐く息がガラスを曇らせ、結露が生まれる
    breathFog(x, y, rand(46, 70), 0.45);
    for (let i = 0; i < 5; i++) {
      spawnDrop(x + rand(-30, 30), y + rand(-30, 30), rand(0.8, 2.8));
    }
  }
}

window.addEventListener('pointermove', onPointerMove, { passive: true });
window.addEventListener('pointerdown', onPointerDown);

// 歌詞タイミング調整用: L で現在時刻をコンソールへ
window.addEventListener('keydown', (e) => {
  if (e.key === 'l' || e.key === 'L') {
    console.log(`[透明の器] t = ${audio.currentTime.toFixed(1)}`);
  }
});

/* ---------------- ループ ---------------- */

let lastT = performance.now();

function loop(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  frameCount++;

  if (state.started && !state.ended) {
    readAudio();
    tickTimeline();
    updateDrops(dt);
    updateCrows(dt);
    updateRipples(dt);

    // 曇りはゆっくり戻る。8bitアルファの丸め切り捨てを避けるため、
    // 細かく重ねず、ある程度たまってから一度に描く
    fogDebt += (0.5 + state.energy * 0.25) * dt;
    if (fogDebt >= 0.045) {
      refog(Math.min(fogDebt, 0.12));
      fogDebt = 0;
    }

    // 自分の吐く息: しばらく触れずにいると、画面の下のほうが静かに曇る
    state.breathTimer += dt;
    const idle = performance.now() - state.pointer.lastMove > 2600;
    if (state.breathTimer > 4.6) {
      state.breathTimer = 0;
      if (idle) breathFog(W / 2 + rand(-W * 0.15, W * 0.15), H * 0.8, rand(80, 130), 0.28);
    }
  } else if (state.ended) {
    updateDrops(dt);
    updateRipples(dt);
    // 終景: 曇りが晴れて、街がはっきり見えてくる
    eraseFog(W / 2 + rand(-W * 0.4, W * 0.4), rand(0, H), rand(60, 160), 0.06);
  }

  render(dt);
  requestAnimationFrame(loop);
}

/* ---------------- 開始と終了 ---------------- */

const startEl = document.getElementById('start');
const finEl = document.getElementById('fin');
const titleEl = document.getElementById('title');
const hintEl = document.getElementById('hint');

function begin() {
  if (state.started) return;
  state.started = true;
  initAudio();
  if (actx.state === 'suspended') actx.resume();
  audio.play().catch(() => {});
  startEl.classList.add('gone');
  titleEl.classList.add('on');
  hintEl.classList.remove('hidden');
  setTimeout(() => hintEl.classList.add('hidden'), 9000);
  transportEl.classList.remove('hidden');
  wakeTransport();
  // 開幕: ガラスにはすでに結露がある
  for (let i = 0; i < 70; i++) spawnDrop();
}

startEl.addEventListener('click', begin);

/* ---------------- トランスポート（再生・シーク・音量） ---------------- */

const transportEl = document.getElementById('transport');
const playBtn = document.getElementById('playpause');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const seekTrack = document.getElementById('seek-track');
const seekFill = document.getElementById('seek-fill');
const timeEl = document.getElementById('time');
const muteBtn = document.getElementById('mute');
const iconVol = document.getElementById('icon-vol');
const iconMute = document.getElementById('icon-mute');
const volTrack = document.getElementById('vol-track');
const volFill = document.getElementById('vol-fill');

let transportSleep = null;
function wakeTransport() {
  transportEl.classList.add('awake');
  clearTimeout(transportSleep);
  transportSleep = setTimeout(() => transportEl.classList.remove('awake'), 2800);
}

function fmt(s) {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss < 10 ? '0' : ''}${ss}`;
}

function refreshPlayIcon() {
  const playing = !audio.paused;
  iconPlay.classList.toggle('hidden', playing);
  iconPause.classList.toggle('hidden', !playing);
}

playBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!state.started) { begin(); return; }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
  refreshPlayIcon();
  wakeTransport();
});

audio.addEventListener('play', refreshPlayIcon);
audio.addEventListener('pause', refreshPlayIcon);

function updateTransportDisplay() {
  const d = audio.duration || 1;
  seekFill.style.width = `${(audio.currentTime / d) * 100}%`;
  timeEl.textContent = fmt(audio.currentTime);
}
audio.addEventListener('timeupdate', updateTransportDisplay);
audio.addEventListener('seeked', updateTransportDisplay);

// シーク。後方へ飛んだら歌詞インデックスを巻き戻す
function seekToRatio(ratio) {
  if (!audio.duration) return;
  const target = clamp(ratio, 0, 1) * audio.duration;
  audio.currentTime = target;
  timelineIdx = 0;
  while (timelineIdx < TIMELINE.length && TIMELINE[timelineIdx].t <= target) timelineIdx++;
  // 飛び先より後の歌詞は消す
  for (const el of lyricsBox.querySelectorAll('.lyric')) el.remove();
  if (state.ended && target < audio.duration - 0.3) {
    state.ended = false;
    finEl.classList.add('hidden');
    titleEl.classList.add('on');
  }
}

function dragBar(track, onRatio) {
  const handle = (e) => {
    const rect = track.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX);
    onRatio((cx - rect.left) / rect.width);
    wakeTransport();
  };
  track.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    handle(e);
    try { track.setPointerCapture(e.pointerId); } catch (_) {}
    const move = (ev) => handle(ev);
    const up = () => {
      try { track.releasePointerCapture(e.pointerId); } catch (_) {}
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
  });
}

dragBar(seekTrack, seekToRatio);

// 音量
let savedVol = 1;
function setVol(v) {
  v = clamp(v, 0, 1);
  audio.volume = v;
  audio.muted = v === 0;
  volFill.style.width = `${v * 100}%`;
  iconVol.classList.toggle('hidden', audio.muted);
  iconMute.classList.toggle('hidden', !audio.muted);
  if (v > 0) savedVol = v;
}
dragBar(volTrack, setVol);

muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setVol(audio.muted || audio.volume === 0 ? (savedVol || 0.8) : 0);
  wakeTransport();
});

setVol(1);
refreshPlayIcon();

// マウスが下のほうに来たら、または操作したら起こす
window.addEventListener('pointermove', (e) => {
  if (state.started && e.clientY > H - 120) wakeTransport();
}, { passive: true });

// スペースで再生/一時停止
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state.started) {
    e.preventDefault();
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    refreshPlayIcon();
    wakeTransport();
  }
});

audio.addEventListener('ended', () => {
  state.ended = true;
  titleEl.classList.remove('on');
  document.querySelector('#fin-count span').textContent = state.counted;
  setTimeout(() => finEl.classList.remove('hidden'), 4200);
});

document.getElementById('replay').addEventListener('click', (e) => {
  e.stopPropagation();
  // 仕切り直し
  drops.length = 0;
  ripples.length = 0;
  crows.length = 0;
  floaters.length = 0;
  timelineIdx = 0;
  state.counted = 0;
  state.ended = false;
  countEl.textContent = '0';
  counterEl.classList.add('hidden');
  fogX.setTransform(1, 0, 0, 1, 0, 0);
  fogX.globalAlpha = 1;
  fogX.drawImage(fogSrc, 0, 0);
  finEl.classList.add('hidden');
  titleEl.classList.add('on');
  audio.currentTime = 0;
  audio.play().catch(() => {});
  for (let i = 0; i < 70; i++) spawnDrop();
});

window.addEventListener('resize', resize);

town.init();
initRain();
resize();
requestAnimationFrame(loop);
