/**
 * ============================================
 * MAYYUR AIR DRAW - Futuristic Air Drawing
 * draw.mayyur.com
 * ============================================
 * Premium AI-powered gesture-controlled canvas
 * Using MediaPipe Hands for real-time tracking
 * ============================================
 */

"use strict";

/* ============================================
   CONFIGURATION
   ============================================ */
const CONFIG = {
  // Drawing
  brushColor: "#00f5ff",
  brushSize: 4,
  glowIntensity: 0.8,
  rainbowMode: false,
  performanceMode: false,
  soundEnabled: false,

  // Smoothing
  smoothingFactor: 0.35,
  predictionFactor: 0.2,
  velocitySmoothingFactor: 0.4,

  // Gesture detection
  gestureConfidenceThreshold: 0.7,
  gestureDebounceMs: 300,
  gestureHysteresisFrames: 5,

  // Particles
  maxParticles: 60,
  particleLifespan: 40,

  // Performance
  targetFPS: 60,
  adaptiveQuality: true,
  maxTrailLength: 200,
};

/* ============================================
   STATE MANAGEMENT
   ============================================ */
const STATE = {
  isDrawing: false,
  isPaused: false,
  currentGesture: "NONE",
  gestureFrameCount: 0,
  lastGesture: "NONE",
  handDetected: false,

  // Position tracking
  currentPos: { x: 0, y: 0 },
  smoothedPos: { x: 0, y: 0 },
  prevSmoothedPos: { x: 0, y: 0 },
  velocity: { x: 0, y: 0 },
  smoothedVelocity: { x: 0, y: 0 },

  // Drawing state
  trails: [],
  currentTrail: [],
  particles: [],
  undoStack: [],
  redoStack: [],

  // Performance
  fps: 60,
  frameCount: 0,
  lastFpsTime: performance.now(),
  lastFrameTime: 0,
  qualityScale: 1,

  // Rainbow
  rainbowHue: 0,

  // Intro
  introComplete: false,
  introProgress: 0,
};

/* ============================================
   DOM REFERENCES
   ============================================ */
const DOM = {};

function cacheDOMElements() {
  DOM.introOverlay = document.getElementById("intro-overlay");
  DOM.introStatus = document.getElementById("intro-status");
  DOM.introLoaderBar = document.querySelector(".intro-loader-bar");
  DOM.webcam = document.getElementById("webcam");
  DOM.trackingCanvas = document.getElementById("tracking-canvas");
  DOM.drawingCanvas = document.getElementById("drawing-canvas");
  DOM.effectsCanvas = document.getElementById("effects-canvas");
  DOM.cursorCanvas = document.getElementById("cursor-canvas");
  DOM.bgParticles = document.getElementById("bg-particles");
  DOM.gestureHud = document.getElementById("gesture-hud");
  DOM.hudLabel = document.getElementById("hud-label");
  DOM.hudSublabel = document.getElementById("hud-sublabel");
  DOM.fpsValue = document.getElementById("fps-value");
  DOM.toolbar = document.getElementById("toolbar");
  DOM.toolbarHeader = document.getElementById("toolbar-header");
  DOM.toolbarBody = document.getElementById("toolbar-body");
  DOM.toolbarCollapseBtn = document.getElementById("toolbar-collapse-btn");
  DOM.brushSizeSlider = document.getElementById("brush-size");
  DOM.glowSlider = document.getElementById("glow-intensity");
  DOM.sizeValue = document.getElementById("size-value");
  DOM.glowValue = document.getElementById("glow-value");
  DOM.customColor = document.getElementById("custom-color");
  DOM.screenshotFlash = document.getElementById("screenshot-flash");

  // Buttons
  DOM.rainbowBtn = document.getElementById("rainbow-btn");
  DOM.clearBtn = document.getElementById("clear-btn");
  DOM.undoBtn = document.getElementById("undo-btn");
  DOM.redoBtn = document.getElementById("redo-btn");
  DOM.saveBtn = document.getElementById("save-btn");
  DOM.fullscreenBtn = document.getElementById("fullscreen-btn");
  DOM.perfBtn = document.getElementById("perf-btn");
  DOM.soundBtn = document.getElementById("sound-btn");
}

/* ============================================
   CANVAS CONTEXTS
   ============================================ */
let trackingCtx, drawingCtx, effectsCtx, cursorCtx, bgCtx;

function initCanvases() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  [DOM.trackingCanvas, DOM.drawingCanvas, DOM.effectsCanvas, DOM.cursorCanvas].forEach((canvas) => {
    canvas.width = w;
    canvas.height = h;
  });

  DOM.bgParticles.width = w;
  DOM.bgParticles.height = h;

  trackingCtx = DOM.trackingCanvas.getContext("2d", { alpha: true });
  drawingCtx = DOM.drawingCanvas.getContext("2d", { alpha: true, desynchronized: true });
  effectsCtx = DOM.effectsCanvas.getContext("2d", { alpha: true });
  cursorCtx = DOM.cursorCanvas.getContext("2d", { alpha: true });
  bgCtx = DOM.bgParticles.getContext("2d", { alpha: true });
}

/* ============================================
   UTILITY FUNCTIONS
   ============================================ */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

/* ============================================
   EXPONENTIAL SMOOTHING / KALMAN-LIKE FILTER
   ============================================ */
class PositionSmoother {
  constructor(smoothing = 0.35, prediction = 0.2) {
    this.smoothing = smoothing;
    this.prediction = prediction;
    this.pos = null;
    this.velocity = { x: 0, y: 0 };
    this.lastPos = null;
    this.lastTime = 0;
  }

  update(rawPos) {
    const now = performance.now();
    const dt = this.lastTime ? (now - this.lastTime) / 16.67 : 1;
    this.lastTime = now;

    if (!this.pos) {
      this.pos = { ...rawPos };
      this.lastPos = { ...rawPos };
      return this.pos;
    }

    // Calculate velocity
    const vx = (rawPos.x - this.lastPos.x) / dt;
    const vy = (rawPos.y - this.lastPos.y) / dt;

    // Smooth velocity
    this.velocity.x = lerp(this.velocity.x, vx, CONFIG.velocitySmoothingFactor);
    this.velocity.y = lerp(this.velocity.y, vy, CONFIG.velocitySmoothingFactor);

    // Predict position
    const predictedX = rawPos.x + this.velocity.x * this.prediction;
    const predictedY = rawPos.y + this.velocity.y * this.prediction;

    // Exponential smoothing
    this.pos.x = lerp(this.pos.x, predictedX, this.smoothing);
    this.pos.y = lerp(this.pos.y, predictedY, this.smoothing);

    this.lastPos = { ...rawPos };

    return { ...this.pos };
  }

  reset() {
    this.pos = null;
    this.lastPos = null;
    this.velocity = { x: 0, y: 0 };
  }
}

const positionSmoother = new PositionSmoother(CONFIG.smoothingFactor, CONFIG.predictionFactor);

/* ============================================
   GESTURE RECOGNITION
   ============================================ */
function isFingerExtended(landmarks, fingerTip, fingerPip) {
  return landmarks[fingerTip].y < landmarks[fingerPip].y;
}

function isThumbExtended(landmarks) {
  return landmarks[4].x < landmarks[3].x; // For mirrored view
}

function detectGesture(landmarks) {
  if (!landmarks || landmarks.length < 21) return "NONE";

  const indexExtended = isFingerExtended(landmarks, 8, 6);
  const middleExtended = isFingerExtended(landmarks, 12, 10);
  const ringExtended = isFingerExtended(landmarks, 16, 14);
  const pinkyExtended = isFingerExtended(landmarks, 20, 18);
  const thumbExtended = isThumbExtended(landmarks);

  // Thumbs up: only thumb extended
  if (thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return "THUMBS_UP";
  }

  // Open palm: all fingers extended
  if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
    return "OPEN_PALM";
  }

  // Two fingers up: index + middle extended, others closed
  if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
    return "TWO_FINGERS";
  }

  // One index finger up: only index extended
  if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return "INDEX_UP";
  }

  // Closed fist: no fingers extended
  if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended && !thumbExtended) {
    return "CLOSED_FIST";
  }

  return "NONE";
}

function processGesture(rawGesture) {
  // Hysteresis: require consistent detection over multiple frames
  if (rawGesture === STATE.lastGesture) {
    STATE.gestureFrameCount++;
  } else {
    STATE.gestureFrameCount = 0;
    STATE.lastGesture = rawGesture;
  }

  // Only change gesture after hysteresis threshold
  if (STATE.gestureFrameCount >= CONFIG.gestureHysteresisFrames) {
    if (rawGesture !== STATE.currentGesture) {
      handleGestureChange(rawGesture);
      STATE.currentGesture = rawGesture;
    }
  }
}

function handleGestureChange(newGesture) {
  const prevGesture = STATE.currentGesture;

  switch (newGesture) {
    case "INDEX_UP":
      STATE.isDrawing = true;
      STATE.isPaused = false;
      updateHUD("DRAW MODE", "Drawing with index finger");
      break;

    case "OPEN_PALM":
      STATE.isDrawing = false;
      STATE.isPaused = false;
      if (STATE.currentTrail.length > 0) {
        finalizeTrail();
      }
      updateHUD("ERASE MODE", "Open palm to erase");
      eraseAtPosition();
      break;

    case "CLOSED_FIST":
      STATE.isDrawing = false;
      STATE.isPaused = true;
      if (STATE.currentTrail.length > 0) {
        finalizeTrail();
      }
      updateHUD("PAUSED", "Closed fist detected");
      break;

    case "TWO_FINGERS":
      STATE.isDrawing = false;
      CONFIG.rainbowMode = !CONFIG.rainbowMode;
      DOM.rainbowBtn.classList.toggle("active", CONFIG.rainbowMode);
      updateHUD("RAINBOW " + (CONFIG.rainbowMode ? "ON" : "OFF"), "Two fingers toggle");
      break;

    case "THUMBS_UP":
      STATE.isDrawing = false;
      clearCanvas();
      updateHUD("CLEARED", "Thumbs up - canvas cleared");
      break;

    default:
      STATE.isDrawing = false;
      if (STATE.currentTrail.length > 0) {
        finalizeTrail();
      }
      updateHUD("READY", "Show your hand");
      break;
  }
}

function updateHUD(label, sublabel) {
  DOM.hudLabel.textContent = label;
  DOM.hudSublabel.textContent = sublabel;
  DOM.gestureHud.classList.add("active");

  // Color based on mode
  const colors = {
    "DRAW MODE": "#00f5ff",
    "ERASE MODE": "#ff006e",
    PAUSED: "#ffbe0b",
    "RAINBOW ON": "#a855f7",
    "RAINBOW OFF": "#8888aa",
    CLEARED: "#39ff14",
    READY: "#8888aa",
  };

  const color = colors[label] || "#00f5ff";
  DOM.hudLabel.style.color = color;
  document.querySelector(".hud-ring").style.borderColor = color;
}

/* ============================================
   DRAWING ENGINE
   ============================================ */
function finalizeTrail() {
  if (STATE.currentTrail.length > 1) {
    STATE.undoStack.push([...STATE.trails]);
    STATE.redoStack = [];
    STATE.trails.push({
      points: [...STATE.currentTrail],
      color: STATE.currentTrail[0].color,
      size: CONFIG.brushSize,
      glow: CONFIG.glowIntensity,
    });

    // Limit undo stack
    if (STATE.undoStack.length > 30) {
      STATE.undoStack.shift();
    }
  }
  STATE.currentTrail = [];
}

function addTrailPoint(pos) {
  const speed = Math.hypot(STATE.smoothedVelocity.x, STATE.smoothedVelocity.y);
  const pressure = clamp(1 - speed * 0.3, 0.3, 1.2);

  let color = CONFIG.brushColor;
  if (CONFIG.rainbowMode) {
    STATE.rainbowHue = (STATE.rainbowHue + 2) % 360;
    color = hslToHex(STATE.rainbowHue, 1, 0.55);
  }

  STATE.currentTrail.push({
    x: pos.x,
    y: pos.y,
    pressure,
    color,
    time: performance.now(),
  });

  // Limit trail length for performance
  if (STATE.currentTrail.length > CONFIG.maxTrailLength) {
    STATE.currentTrail.shift();
  }

  // Spawn particles
  if (Math.random() < 0.4 && STATE.particles.length < CONFIG.maxParticles) {
    spawnParticle(pos, color, speed);
  }
}

function spawnParticle(pos, color, speed) {
  const angle = Math.random() * Math.PI * 2;
  const vel = (0.5 + Math.random() * 2) * (1 + speed * 0.5);
  STATE.particles.push({
    x: pos.x + (Math.random() - 0.5) * 10,
    y: pos.y + (Math.random() - 0.5) * 10,
    vx: Math.cos(angle) * vel,
    vy: Math.sin(angle) * vel,
    life: CONFIG.particleLifespan,
    maxLife: CONFIG.particleLifespan,
    color,
    size: 1 + Math.random() * 2,
  });
}

function eraseAtPosition() {
  const eraseRadius = 40;
  const pos = STATE.smoothedPos;

  STATE.trails = STATE.trails.filter((trail) => {
    return !trail.points.some((p) => dist(p, pos) < eraseRadius);
  });

  redrawAllTrails();
}

function clearCanvas() {
  if (STATE.trails.length > 0) {
    STATE.undoStack.push([...STATE.trails]);
    STATE.redoStack = [];
  }
  STATE.trails = [];
  STATE.currentTrail = [];
  STATE.particles = [];
  drawingCtx.clearRect(0, 0, DOM.drawingCanvas.width, DOM.drawingCanvas.height);
  effectsCtx.clearRect(0, 0, DOM.effectsCanvas.width, DOM.effectsCanvas.height);
}

function undo() {
  if (STATE.undoStack.length === 0) return;
  STATE.redoStack.push([...STATE.trails]);
  STATE.trails = STATE.undoStack.pop();
  STATE.currentTrail = [];
  redrawAllTrails();
}

function redo() {
  if (STATE.redoStack.length === 0) return;
  STATE.undoStack.push([...STATE.trails]);
  STATE.trails = STATE.redoStack.pop();
  STATE.currentTrail = [];
  redrawAllTrails();
}

function redrawAllTrails() {
  drawingCtx.clearRect(0, 0, DOM.drawingCanvas.width, DOM.drawingCanvas.height);
  STATE.trails.forEach((trail) => {
    renderTrail(drawingCtx, trail.points, trail.glow);
  });
}

/* ============================================
   NEON RENDERING ENGINE
   ============================================ */
function renderTrail(ctx, points, glowIntensity) {
  if (points.length < 2) return;

  const glow = glowIntensity || CONFIG.glowIntensity;

  // Draw glow layer
  if (glow > 0 && !CONFIG.performanceMode) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Outer glow
    ctx.shadowColor = points[0].color;
    ctx.shadowBlur = 15 * glow;
    ctx.lineWidth = (points[0].pressure || 1) * CONFIG.brushSize * 2.5;
    ctx.globalAlpha = 0.3 * glow;

    drawSmoothPath(ctx, points);
    ctx.stroke();

    // Inner glow
    ctx.shadowBlur = 8 * glow;
    ctx.lineWidth = (points[0].pressure || 1) * CONFIG.brushSize * 1.5;
    ctx.globalAlpha = 0.5 * glow;

    drawSmoothPath(ctx, points);
    ctx.stroke();

    ctx.restore();
  }

  // Core line
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 1;

  // Draw segments with varying color and width
  for (let i = 1; i < points.length; i++) {
    const p0 = points[Math.max(0, i - 2)];
    const p1 = points[i - 1];
    const p2 = points[i];
    const p3 = points[Math.min(points.length - 1, i + 1)];

    const pressure = p2.pressure || 1;
    const width = pressure * CONFIG.brushSize;

    ctx.beginPath();
    ctx.strokeStyle = p2.color;
    ctx.lineWidth = width;

    if (!CONFIG.performanceMode) {
      ctx.shadowColor = p2.color;
      ctx.shadowBlur = 4 * glow;
    }

    // Catmull-Rom to Bezier conversion for smooth curves
    const tension = 0.3;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    ctx.moveTo(p1.x, p1.y);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawSmoothPath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }

  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

/* ============================================
   PARTICLE SYSTEM
   ============================================ */
function updateParticles() {
  for (let i = STATE.particles.length - 1; i >= 0; i--) {
    const p = STATE.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.96;
    p.vy *= 0.96;
    p.vy += 0.02; // slight gravity
    p.life--;

    if (p.life <= 0) {
      STATE.particles.splice(i, 1);
    }
  }
}

function renderParticles(ctx) {
  if (STATE.particles.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (const p of STATE.particles) {
    const alpha = p.life / p.maxLife;
    const size = p.size * alpha;

    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = p.color;

    if (!CONFIG.performanceMode) {
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* ============================================
   CURSOR RENDERING
   ============================================ */
function renderCursor(pos) {
  cursorCtx.clearRect(0, 0, DOM.cursorCanvas.width, DOM.cursorCanvas.height);

  if (!STATE.handDetected || STATE.isPaused) return;

  const time = performance.now() * 0.003;
  const pulseSize = 1 + Math.sin(time) * 0.15;
  const baseSize = CONFIG.brushSize * 2 + 8;
  const size = baseSize * pulseSize;

  let color = CONFIG.brushColor;
  if (CONFIG.rainbowMode) {
    color = hslToHex(STATE.rainbowHue, 1, 0.55);
  }

  cursorCtx.save();
  cursorCtx.globalCompositeOperation = "lighter";

  // Outer ring
  cursorCtx.beginPath();
  cursorCtx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
  cursorCtx.strokeStyle = color;
  cursorCtx.lineWidth = 1.5;
  cursorCtx.globalAlpha = 0.5 + Math.sin(time) * 0.2;
  cursorCtx.shadowColor = color;
  cursorCtx.shadowBlur = 10;
  cursorCtx.stroke();

  // Inner dot
  cursorCtx.beginPath();
  cursorCtx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
  cursorCtx.fillStyle = color;
  cursorCtx.globalAlpha = 0.9;
  cursorCtx.shadowBlur = 8;
  cursorCtx.fill();

  // Crosshair lines
  if (STATE.isDrawing) {
    cursorCtx.globalAlpha = 0.3;
    cursorCtx.lineWidth = 0.5;
    const crossSize = size + 6;

    cursorCtx.beginPath();
    cursorCtx.moveTo(pos.x - crossSize, pos.y);
    cursorCtx.lineTo(pos.x - size - 2, pos.y);
    cursorCtx.moveTo(pos.x + size + 2, pos.y);
    cursorCtx.lineTo(pos.x + crossSize, pos.y);
    cursorCtx.moveTo(pos.x, pos.y - crossSize);
    cursorCtx.lineTo(pos.x, pos.y - size - 2);
    cursorCtx.moveTo(pos.x, pos.y + size + 2);
    cursorCtx.lineTo(pos.x, pos.y + crossSize);
    cursorCtx.strokeStyle = color;
    cursorCtx.stroke();
  }

  cursorCtx.restore();
}

/* ============================================
   BACKGROUND EFFECTS
   ============================================ */
const bgParticles = [];
const BG_PARTICLE_COUNT = 40;

function initBgParticles() {
  for (let i = 0; i < BG_PARTICLE_COUNT; i++) {
    bgParticles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 2 + 0.5,
      alpha: Math.random() * 0.3 + 0.1,
      pulse: Math.random() * Math.PI * 2,
    });
  }
}

function renderBgParticles() {
  if (CONFIG.performanceMode) return;

  bgCtx.clearRect(0, 0, DOM.bgParticles.width, DOM.bgParticles.height);

  for (const p of bgParticles) {
    p.x += p.vx;
    p.y += p.vy;
    p.pulse += 0.02;

    // Wrap around
    if (p.x < 0) p.x = DOM.bgParticles.width;
    if (p.x > DOM.bgParticles.width) p.x = 0;
    if (p.y < 0) p.y = DOM.bgParticles.height;
    if (p.y > DOM.bgParticles.height) p.y = 0;

    const alpha = p.alpha * (0.7 + Math.sin(p.pulse) * 0.3);

    bgCtx.beginPath();
    bgCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    bgCtx.fillStyle = `rgba(0, 245, 255, ${alpha})`;
    bgCtx.fill();
  }
}

/* ============================================
   HAND TRACKING VISUALIZATION
   ============================================ */
function renderHandLandmarks(landmarks) {
  trackingCtx.clearRect(0, 0, DOM.trackingCanvas.width, DOM.trackingCanvas.height);

  if (!landmarks || CONFIG.performanceMode) return;

  const w = DOM.trackingCanvas.width;
  const h = DOM.trackingCanvas.height;

  trackingCtx.save();
  trackingCtx.globalAlpha = 0.4;

  // Draw connections
  const connections = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [0, 5],
    [5, 6],
    [6, 7],
    [7, 8],
    [0, 9],
    [9, 10],
    [10, 11],
    [11, 12],
    [0, 13],
    [13, 14],
    [14, 15],
    [15, 16],
    [0, 17],
    [17, 18],
    [18, 19],
    [19, 20],
    [5, 9],
    [9, 13],
    [13, 17],
  ];

  trackingCtx.strokeStyle = "rgba(0, 245, 255, 0.3)";
  trackingCtx.lineWidth = 1;

  for (const [a, b] of connections) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    trackingCtx.beginPath();
    trackingCtx.moveTo((1 - pa.x) * w, pa.y * h);
    trackingCtx.lineTo((1 - pb.x) * w, pb.y * h);
    trackingCtx.stroke();
  }

  // Draw landmark dots
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    const x = (1 - lm.x) * w;
    const y = lm.y * h;

    trackingCtx.beginPath();
    trackingCtx.arc(x, y, 2.5, 0, Math.PI * 2);
    trackingCtx.fillStyle = i === 8 ? "#00f5ff" : "rgba(168, 85, 247, 0.6)";
    trackingCtx.fill();
  }

  trackingCtx.restore();
}

/* ============================================
   MEDIAPIPE HANDS SETUP
   ============================================ */
let hands = null;
let camera = null;

function initMediaPipe() {
  updateIntroStatus("Loading MediaPipe Hands...", 30);

  hands = new Hands({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
    },
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: CONFIG.gestureConfidenceThreshold,
    minTrackingConfidence: 0.6,
  });

  hands.onResults(onHandResults);

  updateIntroStatus("Starting camera...", 60);

  camera = new Camera(DOM.webcam, {
    onFrame: async () => {
      if (!STATE.isPaused || !STATE.introComplete) {
        await hands.send({ image: DOM.webcam });
      }
    },
    width: 640,
    height: 480,
  });

  camera
    .start()
    .then(() => {
      updateIntroStatus("Ready!", 100);
      setTimeout(completeIntro, 800);
    })
    .catch((err) => {
      updateIntroStatus("Camera access required", 0);
      console.error("Camera error:", err);
    });
}

function onHandResults(results) {
  if (!STATE.introComplete) return;

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    STATE.handDetected = true;

    // Get index finger tip position (landmark 8)
    const indexTip = landmarks[8];
    const w = DOM.drawingCanvas.width;
    const h = DOM.drawingCanvas.height;

    // Mirror the x coordinate
    const rawPos = {
      x: (1 - indexTip.x) * w,
      y: indexTip.y * h,
    };

    // Smooth the position
    const smoothed = positionSmoother.update(rawPos);
    STATE.prevSmoothedPos = { ...STATE.smoothedPos };
    STATE.smoothedPos = smoothed;
    STATE.currentPos = rawPos;

    // Calculate velocity
    STATE.smoothedVelocity.x = lerp(STATE.smoothedVelocity.x, smoothed.x - STATE.prevSmoothedPos.x, 0.3);
    STATE.smoothedVelocity.y = lerp(STATE.smoothedVelocity.y, smoothed.y - STATE.prevSmoothedPos.y, 0.3);

    // Detect gesture
    const rawGesture = detectGesture(landmarks);
    processGesture(rawGesture);

    // Draw if in drawing mode
    if (STATE.isDrawing && STATE.currentGesture === "INDEX_UP") {
      addTrailPoint(smoothed);
    }

    // Erase if in erase mode
    if (STATE.currentGesture === "OPEN_PALM") {
      eraseAtPosition();
    }

    // Render hand landmarks
    renderHandLandmarks(landmarks);
  } else {
    STATE.handDetected = false;
    if (STATE.currentTrail.length > 0) {
      finalizeTrail();
    }
    positionSmoother.reset();
    trackingCtx.clearRect(0, 0, DOM.trackingCanvas.width, DOM.trackingCanvas.height);

    if (STATE.currentGesture !== "NONE") {
      STATE.currentGesture = "NONE";
      STATE.gestureFrameCount = 0;
      updateHUD("READY", "Show your hand");
      DOM.gestureHud.classList.remove("active");
    }
  }
}

/* ============================================
   RENDER LOOP
   ============================================ */
function renderLoop(timestamp) {
  requestAnimationFrame(renderLoop);

  // FPS calculation
  STATE.frameCount++;
  const elapsed = timestamp - STATE.lastFpsTime;
  if (elapsed >= 1000) {
    STATE.fps = Math.round((STATE.frameCount * 1000) / elapsed);
    STATE.frameCount = 0;
    STATE.lastFpsTime = timestamp;
    updateFPSDisplay();
  }

  // Adaptive quality
  if (CONFIG.adaptiveQuality && STATE.fps < 30) {
    STATE.qualityScale = Math.max(0.5, STATE.qualityScale - 0.05);
  } else if (STATE.fps > 50) {
    STATE.qualityScale = Math.min(1, STATE.qualityScale + 0.02);
  }

  // Clear effects canvas
  effectsCtx.clearRect(0, 0, DOM.effectsCanvas.width, DOM.effectsCanvas.height);

  // Render current trail
  if (STATE.currentTrail.length > 1) {
    renderTrail(effectsCtx, STATE.currentTrail, CONFIG.glowIntensity);
  }

  // Update and render particles
  updateParticles();
  renderParticles(effectsCtx);

  // Render cursor
  renderCursor(STATE.smoothedPos);

  // Background particles (throttled)
  if (STATE.frameCount % 2 === 0) {
    renderBgParticles();
  }
}

function updateFPSDisplay() {
  DOM.fpsValue.textContent = STATE.fps;
  DOM.fpsValue.className = "fps-value";
  if (STATE.fps < 30) {
    DOM.fpsValue.classList.add("critical");
  } else if (STATE.fps < 50) {
    DOM.fpsValue.classList.add("warning");
  }
}

/* ============================================
   INTRO SEQUENCE
   ============================================ */
function updateIntroStatus(text, progress) {
  if (DOM.introStatus) DOM.introStatus.textContent = text;
  if (DOM.introLoaderBar) DOM.introLoaderBar.style.width = progress + "%";
}

function completeIntro() {
  STATE.introComplete = true;
  DOM.introOverlay.classList.add("hidden");
  setTimeout(() => {
    DOM.introOverlay.style.display = "none";
  }, 1000);
}

/* ============================================
   TOOLBAR INTERACTIONS
   ============================================ */
function initToolbar() {
  // Color swatches
  const customColorWrapper = document.getElementById("custom-color-wrapper");
  document.querySelectorAll(".color-swatch").forEach((swatch) => {
    swatch.addEventListener(
      "click",
      () => {
        document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
        swatch.classList.add("active");
        customColorWrapper.classList.remove("active");
        CONFIG.brushColor = swatch.dataset.color;
      },
      { passive: true },
    );
  });

  // Custom color
  DOM.customColor.addEventListener(
    "input",
    (e) => {
      CONFIG.brushColor = e.target.value;
      document.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("active"));
      customColorWrapper.classList.add("active");
    },
    { passive: true },
  );

  // Brush size
  DOM.brushSizeSlider.addEventListener(
    "input",
    (e) => {
      CONFIG.brushSize = parseInt(e.target.value);
      DOM.sizeValue.textContent = CONFIG.brushSize;
    },
    { passive: true },
  );

  // Glow intensity
  DOM.glowSlider.addEventListener(
    "input",
    (e) => {
      CONFIG.glowIntensity = parseInt(e.target.value) / 100;
      DOM.glowValue.textContent = e.target.value;
    },
    { passive: true },
  );

  // Rainbow toggle
  DOM.rainbowBtn.addEventListener("click", () => {
    CONFIG.rainbowMode = !CONFIG.rainbowMode;
    DOM.rainbowBtn.classList.toggle("active", CONFIG.rainbowMode);
  });

  // Clear
  DOM.clearBtn.addEventListener("click", () => {
    clearCanvas();
  });

  // Undo / Redo
  DOM.undoBtn.addEventListener("click", undo);
  DOM.redoBtn.addEventListener("click", redo);

  // Save PNG
  DOM.saveBtn.addEventListener("click", savePNG);

  // Fullscreen
  DOM.fullscreenBtn.addEventListener("click", toggleFullscreen);

  // Performance mode
  DOM.perfBtn.addEventListener("click", () => {
    CONFIG.performanceMode = !CONFIG.performanceMode;
    DOM.perfBtn.classList.toggle("active", CONFIG.performanceMode);
  });

  // Sound toggle
  DOM.soundBtn.addEventListener("click", () => {
    CONFIG.soundEnabled = !CONFIG.soundEnabled;
    DOM.soundBtn.classList.toggle("active", CONFIG.soundEnabled);
  });

  // Collapse toolbar
  DOM.toolbarCollapseBtn.addEventListener("click", () => {
    DOM.toolbarBody.classList.toggle("collapsed");
    DOM.toolbarCollapseBtn.classList.toggle("collapsed");
  });

  // Help button
  const helpBtn = document.getElementById("help-btn");
  const helpModal = document.getElementById("help-modal");
  const helpCloseBtn = document.getElementById("help-close-btn");

  helpBtn.addEventListener("click", () => {
    helpModal.classList.add("visible");
  });

  helpCloseBtn.addEventListener("click", () => {
    helpModal.classList.remove("visible");
  });

  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) {
      helpModal.classList.remove("visible");
    }
  });

  // Draggable toolbar
  initToolbarDrag();
}

function initToolbarDrag() {
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  DOM.toolbarHeader.addEventListener("mousedown", (e) => {
    if (e.target === DOM.toolbarCollapseBtn || e.target.closest(".toolbar-collapse-btn")) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = DOM.toolbar.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    DOM.toolbar.style.transition = "none";
    e.preventDefault();
  });

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      DOM.toolbar.style.left = startLeft + dx + "px";
      DOM.toolbar.style.top = startTop + dy + "px";
      DOM.toolbar.style.bottom = "auto";
      DOM.toolbar.style.transform = "none";
    },
    { passive: true },
  );

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      DOM.toolbar.style.transition = "";
    }
  });

  // Touch support
  DOM.toolbarHeader.addEventListener(
    "touchstart",
    (e) => {
      if (e.target === DOM.toolbarCollapseBtn || e.target.closest(".toolbar-collapse-btn")) return;
      isDragging = true;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      const rect = DOM.toolbar.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      DOM.toolbar.style.transition = "none";
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!isDragging) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      DOM.toolbar.style.left = startLeft + dx + "px";
      DOM.toolbar.style.top = startTop + dy + "px";
      DOM.toolbar.style.bottom = "auto";
      DOM.toolbar.style.transform = "none";
    },
    { passive: true },
  );

  document.addEventListener(
    "touchend",
    () => {
      if (isDragging) {
        isDragging = false;
        DOM.toolbar.style.transition = "";
      }
    },
    { passive: true },
  );
}

/* ============================================
   SAVE / EXPORT
   ============================================ */
function savePNG() {
  // Flash effect
  DOM.screenshotFlash.classList.add("active");
  setTimeout(() => DOM.screenshotFlash.classList.remove("active"), 150);

  // Create composite canvas
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = DOM.drawingCanvas.width;
  exportCanvas.height = DOM.drawingCanvas.height;
  const exportCtx = exportCanvas.getContext("2d");

  // Black background
  exportCtx.fillStyle = "#0a0a0f";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  // Draw all trails
  exportCtx.drawImage(DOM.drawingCanvas, 0, 0);
  exportCtx.drawImage(DOM.effectsCanvas, 0, 0);

  // Watermark
  exportCtx.font = "12px sans-serif";
  exportCtx.fillStyle = "rgba(255, 255, 255, 0.3)";
  exportCtx.textAlign = "right";
  exportCtx.fillText("draw.mayyur.com", exportCanvas.width - 20, exportCanvas.height - 20);

  // Download
  const link = document.createElement("a");
  link.download = `mayyur-air-draw-${Date.now()}.png`;
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
}

/* ============================================
   FULLSCREEN
   ============================================ */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    DOM.fullscreenBtn.classList.add("active");
  } else {
    document.exitFullscreen();
    DOM.fullscreenBtn.classList.remove("active");
  }
}

/* ============================================
   WINDOW RESIZE
   ============================================ */
function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  [DOM.trackingCanvas, DOM.drawingCanvas, DOM.effectsCanvas, DOM.cursorCanvas].forEach((canvas) => {
    canvas.width = w;
    canvas.height = h;
  });

  DOM.bgParticles.width = w;
  DOM.bgParticles.height = h;

  // Redraw all trails after resize
  redrawAllTrails();
}

let resizeTimeout;
window.addEventListener(
  "resize",
  () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(handleResize, 150);
  },
  { passive: true },
);

/* ============================================
   KEYBOARD SHORTCUTS
   ============================================ */
function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "z") {
      e.preventDefault();
      undo();
    } else if (e.ctrlKey && e.key === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "c" && !e.ctrlKey) {
      clearCanvas();
    } else if (e.key === "r") {
      CONFIG.rainbowMode = !CONFIG.rainbowMode;
      DOM.rainbowBtn.classList.toggle("active", CONFIG.rainbowMode);
    } else if (e.key === "s" && e.ctrlKey) {
      e.preventDefault();
      savePNG();
    } else if (e.key === "f") {
      toggleFullscreen();
    } else if (e.key === "p") {
      CONFIG.performanceMode = !CONFIG.performanceMode;
      DOM.perfBtn.classList.toggle("active", CONFIG.performanceMode);
    }
  });
}

/* ============================================
   AUDIO CONTEXT (Optional Sound Effects)
   ============================================ */
let audioCtx = null;

function playTone(freq, duration, volume) {
  if (!CONFIG.soundEnabled) return;

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.setValueAtTime(volume * 0.1, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

/* ============================================
   INITIALIZATION
   ============================================ */
function init() {
  cacheDOMElements();
  initCanvases();
  initBgParticles();
  initToolbar();
  initKeyboardShortcuts();
  initMediaPipe();
  requestAnimationFrame(renderLoop);
}

// Start when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
