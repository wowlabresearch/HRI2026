let currentDistance = 300;
let targetDistance = 300;
let currentPitch = 440;
let currentNoteName = "A4";
let audioEnabled = false;

let mainOsc;
let subOsc;
let filterNode;
let reverbNode;
let reader;
let serialPort;
let serialBuffer = "";

const MIN_MM = 40;
const MAX_MM = 700;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const SCALE_ROOT_MIDI = 48; // C3
const SCALE_OCTAVES = 3;

const tonePresets = [
  { name: "Glass", waveform: "triangle", cutoff: 4.4, resonance: 2.5, detune: 0.5, hue: 188 },
  { name: "Reed", waveform: "sawtooth", cutoff: 3.2, resonance: 7.0, detune: 1.2, hue: 22 },
  { name: "Velvet", waveform: "sine", cutoff: 2.1, resonance: 1.8, detune: 0.25, hue: 292 },
  { name: "Metal", waveform: "square", cutoff: 5.1, resonance: 10.0, detune: 2.5, hue: 54 }
];

let toneIndex = 0;

const statusValue = () => document.getElementById("statusValue");
const distanceValue = () => document.getElementById("distanceValue");
const pitchValue = () => document.getElementById("pitchValue");
const toneValue = () => document.getElementById("toneValue");

function setStatus(text) {
  const el = statusValue();
  if (el) {
    el.textContent = text;
  }
}

function mmToHz(mm) {
  const constrained = constrain(mm, MIN_MM, MAX_MM);
  const scaleMaxIndex = SCALE_FREQUENCIES.length - 1;
  const scaleIndex = Math.round(map(constrained, MIN_MM, MAX_MM, scaleMaxIndex, 0));
  const safeIndex = constrain(scaleIndex, 0, scaleMaxIndex);
  currentNoteName = SCALE_NOTE_LABELS[safeIndex];
  return SCALE_FREQUENCIES[safeIndex];
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToLabel(midi) {
  const noteName = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${noteName}${octave}`;
}

function buildMajorScale(rootMidi, octaves) {
  const frequencies = [];
  const labels = [];

  for (let octave = 0; octave < octaves; octave++) {
    for (const offset of MAJOR_OFFSETS) {
      const midi = rootMidi + octave * 12 + offset;
      frequencies.push(midiToFreq(midi));
      labels.push(midiToLabel(midi));
    }
  }

  const topRootMidi = rootMidi + octaves * 12;
  frequencies.push(midiToFreq(topRootMidi));
  labels.push(midiToLabel(topRootMidi));

  return { frequencies, labels };
}

const majorScale = buildMajorScale(SCALE_ROOT_MIDI, SCALE_OCTAVES);
const SCALE_FREQUENCIES = majorScale.frequencies;
const SCALE_NOTE_LABELS = majorScale.labels;

function getTonePreset() {
  return tonePresets[toneIndex];
}

function applyTonePreset() {
  const preset = getTonePreset();
  mainOsc.setType(preset.waveform);
  subOsc.setType(preset.waveform === "sine" ? "triangle" : "sine");
  filterNode.res(preset.resonance);
  toneValue().textContent = preset.name;
  setStatus(`Tone changed: ${preset.name}`);
}

function setup() {
  const canvas = createCanvas(760, 560);
  canvas.parent("sketch-root");
  colorMode(HSB, 360, 100, 100, 100);

  mainOsc = new p5.Oscillator("triangle");
  subOsc = new p5.Oscillator("sine");
  filterNode = new p5.LowPass();
  reverbNode = new p5.Reverb();

  mainOsc.disconnect();
  subOsc.disconnect();
  mainOsc.connect(filterNode);
  subOsc.connect(filterNode);
  reverbNode.process(filterNode, 1.8, 2.2);

  mainOsc.amp(0);
  subOsc.amp(0);
  mainOsc.start();
  subOsc.start();

  applyTonePreset();
  wireButtons();
  setStatus("Idle: connect serial, then enable audio");
}

function draw() {
  currentDistance = lerp(currentDistance, targetDistance, 0.12);
  currentPitch = mmToHz(currentDistance);

  const preset = getTonePreset();
  const orbX = map(currentDistance, MIN_MM, MAX_MM, width * 0.16, width * 0.86);
  const orbSize = map(currentDistance, MIN_MM, MAX_MM, 210, 76);
  const toneHue = preset.hue;

  drawBackdrop(toneHue);
  drawLanes();
  drawHarmonicRings(orbX, orbSize, toneHue);
  drawToneOrb(orbX, orbSize, toneHue);
  drawOverlayText();

  if (audioEnabled) {
    const targetCutoff = constrain(currentPitch * preset.cutoff, 220, 5200);
    const leadAmp = map(currentDistance, MIN_MM, MAX_MM, 0.22, 0.06);
    const subAmp = leadAmp * 0.45;

    mainOsc.freq(currentPitch, 0.08);
    subOsc.freq(currentPitch * (1 - preset.detune / 100), 0.08);
    filterNode.freq(targetCutoff, 0.08);
    mainOsc.amp(leadAmp, 0.1);
    subOsc.amp(subAmp, 0.1);
  } else {
    mainOsc.amp(0, 0.08);
    subOsc.amp(0, 0.08);
  }

  distanceValue().textContent = `${Math.round(currentDistance)} mm`;
  pitchValue().textContent = `${currentNoteName} (${Math.round(currentPitch)} Hz)`;
}

function drawBackdrop(toneHue) {
  noStroke();
  for (let y = 0; y < height; y += 4) {
    const t = y / height;
    fill((toneHue + 210 + t * 32) % 360, 58, lerp(10, 26, t), 94);
    rect(0, y, width, 4);
  }
}

function drawLanes() {
  stroke(0, 0, 100, 12);
  strokeWeight(1);
  for (let i = 0; i < 7; i++) {
    const y = map(i, 0, 6, 64, height - 64);
    line(48, y, width - 48, y);
  }
}

function drawHarmonicRings(x, size, hue) {
  noFill();
  strokeWeight(2);
  for (let i = 0; i < 4; i++) {
    const phase = (frameCount * 2.8 + i * 44) % 260;
    stroke((hue + i * 10) % 360, 70, 100, 22 - i * 4);
    ellipse(x, height * 0.56, size + phase, size * 0.52 + phase * 0.4);
  }
}

function drawToneOrb(x, size, hue) {
  noStroke();
  fill(hue, 76, 100, 88);
  ellipse(x, height * 0.56, size, size);

  fill(0, 0, 100, 26);
  ellipse(x - size * 0.15, height * 0.56 - size * 0.18, size * 0.34, size * 0.34);
}

function drawOverlayText() {
  noStroke();
  fill(0, 0, 100, 88);
  textAlign(LEFT, TOP);
  textSize(15);
  text("Move hand for pitch (C Major scale). Use UP / DOWN for tone.", 36, 22);
}

function wireButtons() {
  const connectBtn = document.getElementById("connectBtn");
  const enableAudioBtn = document.getElementById("enableAudioBtn");
  const disableAudioBtn = document.getElementById("disableAudioBtn");

  connectBtn.addEventListener("click", async () => {
    if (!("serial" in navigator)) {
      setStatus("Web Serial not supported in this browser");
      return;
    }

    try {
      setStatus("Opening serial chooser...");
      await connectSerial();
      setStatus("Serial connected");
    } catch (error) {
      setStatus(`Serial connection failed: ${error.message}`);
    }
  });

  enableAudioBtn.addEventListener("click", async () => {
    await userStartAudio();
    audioEnabled = true;
    enableAudioBtn.disabled = true;
    disableAudioBtn.disabled = false;
    setStatus(`Audio enabled: ${getTonePreset().name}`);
  });

  disableAudioBtn.addEventListener("click", () => {
    audioEnabled = false;
    enableAudioBtn.disabled = false;
    disableAudioBtn.disabled = true;
    setStatus("Audio disabled");
  });
}

function keyPressed() {
  if (keyCode === UP_ARROW) {
    toneIndex = (toneIndex + 1) % tonePresets.length;
    applyTonePreset();
    return false;
  }

  if (keyCode === DOWN_ARROW) {
    toneIndex = (toneIndex - 1 + tonePresets.length) % tonePresets.length;
    applyTonePreset();
    return false;
  }
}

async function connectSerial() {
  serialPort = await navigator.serial.requestPort();
  await serialPort.open({ baudRate: 115200 });

  const decoder = new TextDecoderStream();
  serialPort.readable.pipeTo(decoder.writable).catch(() => {
    setStatus("Serial stream closed");
  });
  reader = decoder.readable.getReader();
  readSerialOnce();
}

async function readSerialOnce() {
  if (!reader) {
    return;
  }

  try {
    const { value, done } = await reader.read();
    if (done) {
      reader = null;
      return;
    }

    if (value) {
      serialBuffer += value;
      const lines = serialBuffer.split("\n");
      serialBuffer = lines.pop() || "";
      lines.forEach(parseDistanceLine);
    }
  } catch (error) {
    setStatus(`Serial read error: ${error.message}`);
    reader = null;
    return;
  }

  readSerialOnce();
}

function parseDistanceLine(line) {
  const clean = line.trim();
  const match = clean.match(/(\d+)/);
  if (!match) {
    return;
  }

  const mm = Number(match[1]);
  if (Number.isFinite(mm) && mm > 0 && mm < 5000) {
    targetDistance = mm;
  }
}
