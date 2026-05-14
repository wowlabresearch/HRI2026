let targetPot = 0;
let currentPot = 0;
let targetDistance = 260;
let currentDistance = 260;
let targetSemitones = 0;
let currentSemitones = 0;
let targetCutoffHz = 1600;
let currentCutoffHz = 1600;
let targetResonance = 3.4;
let currentResonance = 3.4;
let targetWobbleRate = 0.8;
let currentWobbleRate = 0.8;
let targetWobbleDepth = 0;
let currentWobbleDepth = 0;

let serialPort;
let reader;
let serialBuffer = "";

let synthOsc;
let synthFilter;
let synthStarted = false;
let audioRunning = false;

const POT_MIN = 0;
const POT_MAX = 4095;
const DIST_MIN_MM = 40;
const DIST_MAX_MM = 600;
const MIN_SEMITONES = -12;
const MAX_SEMITONES = 12;
const MIN_FILTER_HZ = 180;
const MAX_FILTER_HZ = 4800;
const MIN_RESONANCE = 0.8;
const MAX_RESONANCE = 14;
const MIN_WOBBLE_RATE = 0.2;
const MAX_WOBBLE_RATE = 8.4;
const MIN_WOBBLE_DEPTH = 0;
const MAX_WOBBLE_DEPTH = 36;

const statusValue = () => document.getElementById("statusValue");
const potValue = () => document.getElementById("potValue");
const distanceValue = () => document.getElementById("distanceValue");
const pitchValue = () => document.getElementById("pitchValue");
const filterValue = () => document.getElementById("filterValue");
const resValue = () => document.getElementById("resValue");
const wobbleValue = () => document.getElementById("wobbleValue");

function setStatus(text) {
  const el = statusValue();
  if (el) {
    el.textContent = text;
  }
}

function semitonesToRatio(semitones) {
  return Math.pow(2, semitones / 12);
}

function updateTargets() {
  const constrainedPot = constrain(currentPot, POT_MIN, POT_MAX);
  const constrainedDistance = constrain(currentDistance, DIST_MIN_MM, DIST_MAX_MM);
  const distanceNorm = map(constrainedDistance, DIST_MIN_MM, DIST_MAX_MM, 1, 0);

  targetSemitones = map(constrainedPot, POT_MIN, POT_MAX, MIN_SEMITONES, MAX_SEMITONES);
  targetCutoffHz = map(constrainedDistance, DIST_MIN_MM, DIST_MAX_MM, MAX_FILTER_HZ, MIN_FILTER_HZ);
  targetResonance = map(distanceNorm, 0, 1, MIN_RESONANCE, MAX_RESONANCE);
  targetWobbleRate = map(distanceNorm, 0, 1, MIN_WOBBLE_RATE, MAX_WOBBLE_RATE);
  targetWobbleDepth = map(distanceNorm, 0, 1, MIN_WOBBLE_DEPTH, MAX_WOBBLE_DEPTH);
}

function setup() {
  const canvas = createCanvas(760, 560);
  canvas.parent("sketch-root");
  colorMode(HSB, 360, 100, 100, 100);

  synthOsc = new p5.Oscillator("sawtooth");
  synthFilter = new p5.LowPass();
  synthOsc.disconnect();
  synthFilter.process(synthOsc);
  synthFilter.freq(currentCutoffHz);
  synthFilter.res(3.6);
  synthOsc.amp(0);

  wireButtons();
  setStatus("Connect serial, then start internal synth audio");
}

function draw() {
  currentPot = lerp(currentPot, targetPot, 0.1);
  currentDistance = lerp(currentDistance, targetDistance, 0.16);
  updateTargets();

  currentSemitones = lerp(currentSemitones, targetSemitones, 0.1);
  currentCutoffHz = lerp(currentCutoffHz, targetCutoffHz, 0.12);
  currentResonance = lerp(currentResonance, targetResonance, 0.12);
  currentWobbleRate = lerp(currentWobbleRate, targetWobbleRate, 0.12);
  currentWobbleDepth = lerp(currentWobbleDepth, targetWobbleDepth, 0.12);

  drawBackdrop();
  drawBands();
  drawOrbitalControl();
  drawSignalLine();

  if (audioRunning && synthOsc && synthFilter) {
    const baseFrequency = constrain(220 * semitonesToRatio(currentSemitones), 80, 1200);
    const wobble = Math.sin(frameCount * 0.045 * currentWobbleRate) * currentWobbleDepth;
    const synthFrequency = constrain(baseFrequency + wobble, 70, 1400);
    const synthAmp = constrain(map(currentDistance, DIST_MIN_MM, DIST_MAX_MM, 0.24, 0.08), 0.06, 0.3);

    const distanceNorm = map(currentDistance, DIST_MIN_MM, DIST_MAX_MM, 1, 0);
    if (distanceNorm > 0.7) {
      synthOsc.setType("sawtooth");
    } else if (distanceNorm > 0.35) {
      synthOsc.setType("triangle");
    } else {
      synthOsc.setType("sine");
    }

    synthOsc.freq(synthFrequency, 0.08);
    synthFilter.freq(currentCutoffHz, 0.08);
    synthFilter.res(currentResonance);
    synthOsc.amp(synthAmp, 0.09);
  } else if (synthOsc) {
    synthOsc.amp(0, 0.1);
  }

  potValue().textContent = `${Math.round(currentPot)}`;
  distanceValue().textContent = `${Math.round(currentDistance)} mm`;
  pitchValue().textContent = `${currentSemitones >= 0 ? "+" : ""}${currentSemitones.toFixed(1)} st`;
  filterValue().textContent = `${Math.round(currentCutoffHz)} Hz`;
  resValue().textContent = `${currentResonance.toFixed(1)}`;
  wobbleValue().textContent = `${currentWobbleRate.toFixed(1)} r/s`;
}

function drawBackdrop() {
  noStroke();
  for (let y = 0; y < height; y += 4) {
    const t = y / height;
    fill(lerp(330, 188, t), 46, lerp(12, 26, t), 96);
    rect(0, y, width, 4);
  }
}

function drawBands() {
  stroke(0, 0, 100, 10);
  strokeWeight(1);
  for (let i = 0; i < 8; i++) {
    const y = map(i, 0, 7, 68, height - 68);
    line(46, y, width - 46, y);
  }
}

function drawOrbitalControl() {
  const pitchX = map(currentPot, POT_MIN, POT_MAX, width * 0.16, width * 0.84);
  const filterY = map(currentDistance, DIST_MIN_MM, DIST_MAX_MM, height * 0.2, height * 0.82);
  const orbSize = map(currentCutoffHz, MIN_FILTER_HZ, MAX_FILTER_HZ, 84, 170);

  noFill();
  strokeWeight(2);
  for (let i = 0; i < 4; i++) {
    const phase = (frameCount * 2.6 + i * 36) % 220;
    stroke(40 + i * 18, 76, 100, 28 - i * 5);
    ellipse(pitchX, filterY, orbSize + phase, orbSize * 0.46 + phase * 0.34);
  }

  noStroke();
  fill(map(currentSemitones, MIN_SEMITONES, MAX_SEMITONES, 22, 170), 72, 100, 86);
  ellipse(pitchX, filterY, orbSize, orbSize);

  fill(0, 0, 100, 86);
  textAlign(CENTER, CENTER);
  textSize(16);
  text(`${currentSemitones.toFixed(1)} st`, pitchX, filterY - 10);
  textSize(12);
  text(`${Math.round(currentCutoffHz)} Hz`, pitchX, filterY + 14);
}

function drawSignalLine() {
  const pitchX = map(currentPot, POT_MIN, POT_MAX, width * 0.16, width * 0.84);
  const filterY = map(currentDistance, DIST_MIN_MM, DIST_MAX_MM, height * 0.2, height * 0.82);

  stroke(0, 0, 100, 28);
  strokeWeight(2);
  line(width * 0.16, filterY, width * 0.84, filterY);
  line(pitchX, height * 0.2, pitchX, height * 0.82);

  noStroke();
  fill(0, 0, 100, 82);
  textAlign(LEFT, TOP);
  textSize(14);
  text("Potentiometer -> pitch bend", 42, 18);
  text("Distance sensor -> cutoff + resonance + wobble", 42, 38);
}

function wireButtons() {
  const connectBtn = document.getElementById("connectBtn");
  const enableBtn = document.getElementById("enableBtn");
  const stopBtn = document.getElementById("stopBtn");

  connectBtn.addEventListener("click", async () => {
    if (!("serial" in navigator)) {
      setStatus("Web Serial not supported in this browser");
      return;
    }

    try {
      await connectSerial();
      setStatus("Serial connected");
    } catch (error) {
      setStatus(`Serial connection failed: ${error.message}`);
    }
  });

  enableBtn.addEventListener("click", async () => {
    try {
      await userStartAudio();
      if (!synthStarted) {
        synthOsc.start();
        synthStarted = true;
      }
      audioRunning = true;
      enableBtn.disabled = true;
      stopBtn.disabled = false;
      setStatus("Audio running: pot=pitch, distance=timbre/wobble");
    } catch (error) {
      setStatus(`Audio start failed: ${error.message}`);
    }
  });

  stopBtn.addEventListener("click", () => {
    if (synthOsc) {
      synthOsc.amp(0, 0.08);
    }
    audioRunning = false;
    enableBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus("Audio stopped");
  });
}

async function connectSerial() {
  serialPort = await navigator.serial.requestPort();
  await serialPort.open({ baudRate: 115200 });

  const decoder = new TextDecoderStream();
  serialPort.readable.pipeTo(decoder.writable).catch(() => {
    setStatus("Serial stream closed");
  });

  reader = decoder.readable.getReader();
  readSerialLoop();
}

async function readSerialLoop() {
  while (reader) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    if (value) {
      serialBuffer += value;
      const lines = serialBuffer.split("\n");
      serialBuffer = lines.pop() || "";
      lines.forEach(parseSensorLine);
    }
  }
}

function parseSensorLine(line) {
  const clean = line.trim();
  if (!clean) {
    return;
  }

  const pairs = clean.match(/([a-z_]+)=([\d.]+)/gi);
  if (pairs && pairs.length > 0) {
    for (const pair of pairs) {
      const [rawKey, rawValue] = pair.split("=");
      const key = rawKey.toLowerCase();
      const value = Number(rawValue);
      if (!Number.isFinite(value)) {
        continue;
      }

      if (key === "pot") {
        targetPot = value;
      }

      if (key === "distance_mm" || key === "distance") {
        targetDistance = value;
      }
    }
    return;
  }

  const distanceOnly = Number(clean);
  if (Number.isFinite(distanceOnly) && distanceOnly > 0 && distanceOnly < 5000) {
    targetDistance = distanceOnly;
  }
}
