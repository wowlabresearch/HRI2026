// Synced to src/main.cpp PWM logic (ESP32 vibrotactile motor)
const PWM_FREQ_HZ = 20000;
const PERIOD_US = 1_000_000 / PWM_FREQ_HZ; // 50 us

const DUTY_MIN = 0;
const DUTY_MAX = 255;
const DUTY_STEP = 5;
const STEP_DELAY_S = 0.02; // delay(20)
const TOTAL_CYCLE_TARGET_S = 4.12;
const HOLD_TIME_DEFAULT_S = 0.5;
const HOLD_MS_MIN = 0;
const HOLD_MS_REQUEST_MAX = 2000;

// Firmware loops include both endpoints: 0..255 and 255..0
const RAMP_STEPS = Math.floor(DUTY_MAX / DUTY_STEP) + 1; // 52
const RAMP_UP_TIME_S = RAMP_STEPS * STEP_DELAY_S; // 1.04 s
const RAMP_DOWN_TIME_S = RAMP_STEPS * STEP_DELAY_S; // 1.04 s
const HOLD_AND_OFF_BUDGET_S = TOTAL_CYCLE_TARGET_S - RAMP_UP_TIME_S - RAMP_DOWN_TIME_S;
const HOLD_MS_MAX = Math.min(Math.round(HOLD_AND_OFF_BUDGET_S * 1000), HOLD_MS_REQUEST_MAX);
const TOTAL_LOOP_TIME_S = TOTAL_CYCLE_TARGET_S;
const TOTAL_LOOP_MS = Math.round(TOTAL_LOOP_TIME_S * 1000);

let simTimeS = 0;
let isPaused = false;

let connectBtn;
let disconnectBtn;
let runBtn;
let stopBtn;
let intensitySlider;
let intensityLabel;
let flatSlider;
let flatLabel;

let serialSupported = false;
let serialPort = null;
let serialReader = null;
let serialWriter = null;
let serialKeepReading = false;
let serialBuffer = "";
let isDisconnecting = false;
const serialTextEncoder = new TextEncoder();
let scaleSendTimer = null;
let lastSentScalePct = 100;
let flatSendTimer = null;
let lastSentHoldMs = 500;
const MAX_LIVE_ENVELOPE_POINTS = 220;
let liveEnvelopePoints = [];
let lastLivePhaseS = 0;

let liveData = {
  connected: false,
  lastRxMs: 0,
  phaseMs: 0,
  stage: 4,
  dutyRaw: 0,
  motorEnabled: false,
  intensityPct: 100,
  holdMs: 500
};

function getLoopTiming(holdS) {
  const clampedHoldS = constrain(holdS, HOLD_MS_MIN / 1000, HOLD_MS_MAX / 1000);
  const offS = max(0, HOLD_AND_OFF_BUDGET_S - clampedHoldS);
  const totalLoopS = RAMP_UP_TIME_S + clampedHoldS + RAMP_DOWN_TIME_S + offS;
  return {
    rampUpS: RAMP_UP_TIME_S,
    holdS: clampedHoldS,
    rampDownS: RAMP_DOWN_TIME_S,
    offS,
    totalLoopS,
    totalLoopMs: Math.round(totalLoopS * 1000)
  };
}

function setup() {
  createCanvas(860, 560);
  textFont("Pretendard, Noto Sans KR, Segoe UI, sans-serif");

  serialSupported = "serial" in navigator;

  connectBtn = createButton("Connect Serial");
  connectBtn.position(32, 12);
  connectBtn.mousePressed(connectSerial);

  disconnectBtn = createButton("Disconnect");
  disconnectBtn.position(140, 12);
  disconnectBtn.mousePressed(disconnectSerial);

  runBtn = createButton("Motor RUN");
  runBtn.position(240, 12);
  runBtn.mousePressed(() => sendSerialCommand("RUN"));

  stopBtn = createButton("Motor STOP");
  stopBtn.position(330, 12);
  stopBtn.mousePressed(() => sendSerialCommand("STOP"));

  intensitySlider = createSlider(0, 100, 100, 1);
  intensitySlider.position(430, 12);
  intensitySlider.style("width", "140px");
  intensitySlider.input(onIntensitySliderInput);

  intensityLabel = createSpan("Intensity: 100%");
  intensityLabel.position(580, 12);
  intensityLabel.style("font-family", "Pretendard, Noto Sans KR, Segoe UI, sans-serif");
  intensityLabel.style("font-size", "13px");
  intensityLabel.style("color", "#36445c");

  flatSlider = createSlider(HOLD_MS_MIN, HOLD_MS_MAX, 500, 10);
  flatSlider.position(700, 12);
  flatSlider.style("width", "120px");
  flatSlider.input(onFlatSliderInput);

  flatLabel = createSpan("Flat: 500ms");
  flatLabel.position(825, 12);
  flatLabel.style("font-family", "Pretendard, Noto Sans KR, Segoe UI, sans-serif");
  flatLabel.style("font-size", "12px");
  flatLabel.style("color", "#36445c");
}

function draw() {
  drawBackground();

  const simHoldS = Number(flatSlider.value()) / 1000;
  const simTiming = getLoopTiming(simHoldS);

  if (!isPaused) {
    simTimeS += deltaTime / 1000;
    if (simTimeS >= simTiming.totalLoopS) {
      simTimeS -= simTiming.totalLoopS;
    }
  }

  const usingLive = liveData.connected && millis() - liveData.lastRxMs < 1200;
  const activeHoldS = usingLive ? liveData.holdMs / 1000 : simHoldS;
  const timing = getLoopTiming(activeHoldS);
  const liveRunning = usingLive && liveData.motorEnabled;
  const normalizedLiveTimeS =
    (((liveData.phaseMs % timing.totalLoopMs) + timing.totalLoopMs) % timing.totalLoopMs) /
    1000;
  const viewTimeS = usingLive
    ? (liveRunning ? normalizedLiveTimeS : 0)
    : simTimeS;
  const simIntensityPct = Number(intensitySlider.value());
  const activeIntensityPct = usingLive ? liveData.intensityPct : simIntensityPct;
  const state = usingLive
    ? getStateFromTelemetry()
    : getPwmStateFromTime(viewTimeS, simIntensityPct, activeHoldS);

  fill(28, 37, 54);
  noStroke();
  textSize(24);
  textStyle(BOLD);
  text("ESP32 Vibrotactile PWM Sync Visualizer", 32, 58);

  textSize(14);
  textStyle(NORMAL);
  fill(54, 68, 92);
  text(
    `Mode: ${usingLive ? "LIVE (Web Serial)" : "SIMULATION"}   Stage: ${state.stageLabel}`,
    32,
    84
  );
  text(
    `Time: ${viewTimeS.toFixed(3)}s / ${timing.totalLoopS.toFixed(2)}s   Duty: ${state.dutyRaw} / 255 (${(state.duty * 100).toFixed(1)}%)`,
    32,
    106
  );
  text(
    `Motor: ${liveData.motorEnabled ? "RUNNING" : "STOPPED"}   Intensity: ${liveData.intensityPct}%   Flat Hold: ${Math.round(activeHoldS * 1000)}ms   Off: ${Math.round(timing.offS * 1000)}ms`,
    32,
    126
  );

  drawEnvelopeGraph(
    32,
    152,
    width - 64,
    170,
    state,
    viewTimeS,
    activeIntensityPct,
    usingLive,
    timing
  );
  drawMicroPwmGraph(32, 352, width - 64, 170, state.duty);

  drawStatusPill(usingLive);

  fill(84, 95, 117);
  textSize(12);
  text("Space: pause/resume simulation  |  R: restart simulation time  |  Connect 후 RUN/STOP 제어", 32, height - 18);
}

function getPwmStateFromTime(t, scalePct = 100, holdS = HOLD_TIME_DEFAULT_S) {
  const timing = getLoopTiming(holdS);
  let baseDutyRaw = 0;
  let stage = 4;

  if (t < timing.rampUpS) {
    const stepIndex = Math.floor(t / STEP_DELAY_S);
    baseDutyRaw = Math.min(DUTY_MAX, stepIndex * DUTY_STEP);
    stage = 1;
  } else if (t < timing.rampUpS + timing.holdS) {
    baseDutyRaw = DUTY_MAX;
    stage = 2;
  } else if (t < timing.rampUpS + timing.holdS + timing.rampDownS) {
    const elapsed = t - (timing.rampUpS + timing.holdS);
    const stepIndex = Math.floor(elapsed / STEP_DELAY_S);
    baseDutyRaw = Math.max(DUTY_MIN, DUTY_MAX - stepIndex * DUTY_STEP);
    stage = 3;
  } else {
    baseDutyRaw = DUTY_MIN;
    stage = 4;
  }

  const dutyRaw = Math.round((baseDutyRaw * constrain(scalePct, 0, 100)) / 100);

  return {
    stage,
    dutyRaw,
    duty: dutyRaw / DUTY_MAX,
    stageLabel: stageToLabel(stage)
  };
}

function getStateFromTelemetry() {
  const dutyRaw = constrain(liveData.dutyRaw, DUTY_MIN, DUTY_MAX);
  const stage = liveData.stage;
  return {
    stage,
    dutyRaw,
    duty: dutyRaw / DUTY_MAX,
    stageLabel: stageToLabel(stage)
  };
}

function stageToLabel(stage) {
  if (stage === 1) return "1) Ramp Up";
  if (stage === 2) return "2) Hold";
  if (stage === 3) return "3) Ramp Down";
  return "4) Off Interval";
}

function drawEnvelopeGraph(x, y, w, h, state, viewTimeS, intensityPct = 100, usingLive = false, timing = getLoopTiming(HOLD_TIME_DEFAULT_S)) {
  drawPanel(x, y, w, h, "Loop Envelope (actual stepped duty)");

  const left = x + 16;
  const top = y + 34;
  const gw = w - 32;
  const gh = h - 52;

  stroke(209, 219, 234);
  for (let i = 0; i <= 4; i++) {
    const yy = top + (gh * i) / 4;
    line(left, yy, left + gw, yy);
  }

  const getX = (t) => map(t, 0, timing.totalLoopS, left, left + gw);
  const getY = (duty01) => map(duty01, 0, 1, top + gh, top);
  const scale = constrain(intensityPct, 0, 100) / 100;

  stroke(40, 120, 255);
  strokeWeight(2);
  noFill();
  beginShape();
  if (usingLive && liveEnvelopePoints.length >= 2) {
    for (const point of liveEnvelopePoints) {
      vertex(getX(point.t), getY(point.d));
    }
  } else {
    for (let i = 0; i < RAMP_STEPS; i++) {
      const t0 = i * STEP_DELAY_S;
      const t1 = (i + 1) * STEP_DELAY_S;
      const d = (Math.min(DUTY_MAX, i * DUTY_STEP) / DUTY_MAX) * scale;
      vertex(getX(t0), getY(d));
      vertex(getX(t1), getY(d));
    }

    vertex(getX(RAMP_UP_TIME_S), getY(scale));
    vertex(getX(RAMP_UP_TIME_S + timing.holdS), getY(scale));

    const downStart = RAMP_UP_TIME_S + timing.holdS;
    for (let i = 0; i < RAMP_STEPS; i++) {
      const t0 = downStart + i * STEP_DELAY_S;
      const t1 = downStart + (i + 1) * STEP_DELAY_S;
      const d = (Math.max(DUTY_MIN, DUTY_MAX - i * DUTY_STEP) / DUTY_MAX) * scale;
      vertex(getX(t0), getY(d));
      vertex(getX(t1), getY(d));
    }

    const offStart = RAMP_UP_TIME_S + timing.holdS + RAMP_DOWN_TIME_S;
    vertex(getX(offStart), getY(0));
    vertex(getX(timing.totalLoopS), getY(0));
  }
  endShape();

  const cursorX = getX(viewTimeS);
  stroke(255, 72, 72);
  strokeWeight(1.5);
  line(cursorX, top, cursorX, top + gh);

  noStroke();
  fill(255, 72, 72);
  circle(cursorX, getY(state.duty), 8);

  fill(90, 104, 130);
  textSize(11);
  text("100%", left - 6, top - 6);
  text("0%", left - 2, top + gh + 14);

  const markers = [
    0,
    RAMP_UP_TIME_S,
    RAMP_UP_TIME_S + timing.holdS,
    RAMP_UP_TIME_S + timing.holdS + RAMP_DOWN_TIME_S,
    timing.totalLoopS
  ];

  markers.forEach((t) => {
    const tx = getX(t);
    stroke(170, 183, 204, 90);
    line(tx, top, tx, top + gh);
    noStroke();
    fill(90, 104, 130);
    text(`${t.toFixed(2)}s`, tx - 14, top + gh + 28);
  });
}

function drawMicroPwmGraph(x, y, w, h, duty) {
  drawPanel(x, y, w, h, "Microscopic PWM (3 periods at 20 kHz)");

  const left = x + 16;
  const top = y + 34;
  const gw = w - 32;
  const gh = h - 52;

  const yHigh = top + 16;
  const yLow = top + gh - 12;

  stroke(220, 226, 238);
  line(left, yHigh, left + gw, yHigh);
  line(left, yLow, left + gw, yLow);

  fill(97, 112, 140);
  noStroke();
  textSize(11);
  text("High(5.0V)", left, yHigh - 6);
  text("Low(0.0dV)", left, yLow + 14);

  const periods = 3;
  const periodW = gw / periods;
  const highW = periodW * duty;

  stroke(16, 138, 124);
  strokeWeight(3);
  noFill();

  beginShape();
  for (let i = 0; i < periods; i++) {
    const sx = left + i * periodW;

    if (duty <= 0) {
      vertex(sx, yLow);
      vertex(sx + periodW, yLow);
    } else if (duty >= 1) {
      vertex(sx, yHigh);
      vertex(sx + periodW, yHigh);
    } else {
      vertex(sx, yLow);
      vertex(sx, yHigh);
      vertex(sx + highW, yHigh);
      vertex(sx + highW, yLow);
      vertex(sx + periodW, yLow);
    }
  }
  endShape();

  stroke(178, 190, 212);
  strokeWeight(1);
  line(left, top, left, top + gh);
  line(left + periodW, top, left + periodW, top + gh);

  noStroke();
  fill(97, 112, 140);
  textAlign(CENTER);
  text(`1 period = ${PERIOD_US} us (fixed)`, left + periodW * 0.5, top + gh * 0.62);
  text(`High width = ${(PERIOD_US * duty).toFixed(2)} us`, left + periodW * 0.5, top + gh * 0.78);
  textAlign(LEFT);
}

function drawStatusPill(usingLive) {
  const x = width - 250;
  const y = 18;
  const w = 220;
  const h = 28;

  noStroke();
  fill(255, 255, 255, 220);
  rect(x, y, w, h, 16);

  const ageMs = millis() - liveData.lastRxMs;
  const ok = usingLive && ageMs < 1200;

  fill(ok ? color(21, 128, 61) : color(146, 64, 14));
  circle(x + 16, y + h / 2, 10);

  fill(48, 58, 78);
  textSize(12);
  const statusText = !serialSupported
    ? "Web Serial unsupported"
    : !liveData.connected
      ? "Serial disconnected"
      : ok
        ? `Live stream (${ageMs.toFixed(0)} ms ago)`
        : "Connected, waiting data";
  text(statusText, x + 28, y + 18);
}

function drawPanel(x, y, w, h, title) {
  noStroke();
  fill(255, 255, 255, 232);
  rect(x, y, w, h, 12);

  fill(40, 52, 73);
  textSize(13);
  textStyle(BOLD);
  text(title, x + 16, y + 21);
  textStyle(NORMAL);
}

function drawBackground() {
  background(241, 247, 255);

  noStroke();
  fill(225, 239, 255, 150);
  circle(90, 70, 200);
  fill(221, 247, 235, 140);
  circle(width - 60, height - 80, 220);
}

async function connectSerial() {
  if (!serialSupported) {
    console.warn("Web Serial is not supported in this browser.");
    return;
  }

  try {
    if (serialPort) {
      await disconnectSerial();
    }

    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });
    liveData.connected = true;
    serialKeepReading = true;
    isDisconnecting = false;

    serialWriter = serialPort.writable.getWriter();
    await sendSerialCommand("STATE?");
    await sendSerialCommand(`SCALE,${Number(intensitySlider.value())}`);
    await sendSerialCommand(`HOLDMS,${Number(flatSlider.value())}`);

    const decoder = new TextDecoder();
    serialReader = serialPort.readable.getReader();
    serialBuffer = "";

    const pump = async () => {
      if (!serialKeepReading || !serialReader) {
        return;
      }

      const { value, done } = await serialReader.read();
      if (done || !serialKeepReading) {
        return;
      }

      if (value) {
        serialBuffer += decoder.decode(value, { stream: true });
        processSerialBuffer();
      }

      await pump();
    };

    await pump();
  } catch (err) {
    console.error("Serial connect/read error:", err);
  } finally {
    if (!isDisconnecting) {
      await disconnectSerial();
    }
  }
}

function onIntensitySliderInput() {
  const value = Number(intensitySlider.value());
  liveData.intensityPct = value;
  intensityLabel.html(`Intensity: ${value}%`);

  if (!liveData.connected) {
    return;
  }

  if (scaleSendTimer) {
    clearTimeout(scaleSendTimer);
  }

  scaleSendTimer = setTimeout(async () => {
    if (value === lastSentScalePct) {
      return;
    }
    await sendSerialCommand(`SCALE,${value}`);
    lastSentScalePct = value;
  }, 60);
}

function onFlatSliderInput() {
  const value = constrain(Number(flatSlider.value()), HOLD_MS_MIN, HOLD_MS_MAX);
  flatSlider.value(value);
  liveData.holdMs = value;
  flatLabel.html(`Flat: ${value}ms`);
  liveEnvelopePoints = [];
  lastLivePhaseS = 0;

  if (!liveData.connected) {
    return;
  }

  if (flatSendTimer) {
    clearTimeout(flatSendTimer);
  }

  flatSendTimer = setTimeout(async () => {
    if (value === lastSentHoldMs) {
      return;
    }
    await sendSerialCommand(`HOLDMS,${value}`);
    lastSentHoldMs = value;
  }, 60);
}

async function disconnectSerial() {
  if (isDisconnecting) {
    return;
  }
  isDisconnecting = true;

  serialKeepReading = false;
  liveData.connected = false;
  liveEnvelopePoints = [];
  lastLivePhaseS = 0;

  if (serialReader) {
    try {
      await serialReader.cancel();
    } catch (err) {
      console.warn("Reader cancel error:", err);
    }
    serialReader.releaseLock();
    serialReader = null;
  }

  if (serialWriter) {
    try {
      serialWriter.releaseLock();
    } catch (err) {
      console.warn("Writer release error:", err);
    }
    serialWriter = null;
  }

  if (serialPort) {
    try {
      await serialPort.close();
    } catch (err) {
      console.warn("Port close error:", err);
    }
    serialPort = null;
  }

  isDisconnecting = false;
}

async function sendSerialCommand(cmd) {
  if (!serialWriter || !liveData.connected) {
    console.warn("Serial is not connected.");
    return;
  }

  try {
    const payload = `${cmd}\n`;
    await serialWriter.write(serialTextEncoder.encode(payload));
  } catch (err) {
    console.error("Serial write error:", err);
  }
}

function processSerialBuffer() {
  const lines = serialBuffer.split("\n");
  serialBuffer = lines.pop();

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith("PWM,")) {
      const parts = line.split(",");
      if (parts.length !== 4) continue;

      const phaseMs = Number(parts[1]);
      const stage = Number(parts[2]);
      const dutyRaw = Number(parts[3]);

      if (
        Number.isNaN(phaseMs) ||
        Number.isNaN(stage) ||
        Number.isNaN(dutyRaw)
      ) {
        continue;
      }

      liveData.phaseMs = phaseMs;
      liveData.stage = stage;
      liveData.dutyRaw = dutyRaw;
      liveData.lastRxMs = millis();

      const loopMs = getLoopTiming(liveData.holdMs / 1000).totalLoopMs;
      const phaseS = (((phaseMs % loopMs) + loopMs) % loopMs) / 1000;
      const duty01 = constrain(dutyRaw, DUTY_MIN, DUTY_MAX) / DUTY_MAX;

      // New cycle detection: phase wraps from near end to near start.
      if (phaseS + 0.1 < lastLivePhaseS) {
        liveEnvelopePoints = [];
      }
      lastLivePhaseS = phaseS;

      liveEnvelopePoints.push({ t: phaseS, d: duty01 });
      if (liveEnvelopePoints.length > MAX_LIVE_ENVELOPE_POINTS) {
        liveEnvelopePoints.shift();
      }
      continue;
    }

    if (line.startsWith("STATE,")) {
      const parts = line.split(",");
      if (parts.length !== 3 && parts.length !== 4) continue;

      const enabled = Number(parts[1]);
      const intensity = Number(parts[2]);
      const holdMs = parts.length === 4 ? Number(parts[3]) : liveData.holdMs;
      if (Number.isNaN(enabled) || Number.isNaN(intensity)) {
        continue;
      }

      liveData.motorEnabled = enabled === 1;
      liveData.intensityPct = constrain(intensity, 0, 100);
      liveData.holdMs = constrain(holdMs, HOLD_MS_MIN, HOLD_MS_MAX);
      liveEnvelopePoints = [];
      lastLivePhaseS = 0;
      lastSentScalePct = liveData.intensityPct;
      lastSentHoldMs = liveData.holdMs;
      intensitySlider.value(liveData.intensityPct);
      intensityLabel.html(`Intensity: ${liveData.intensityPct}%`);
      flatSlider.value(liveData.holdMs);
      flatLabel.html(`Flat: ${liveData.holdMs}ms`);
      continue;
    }

    if (line.startsWith("ACK,") || line.startsWith("ERR,")) {
      console.log(line);
    }
  }
}

function keyPressed() {
  if (key === " ") {
    isPaused = !isPaused;
  }

  if (key === "r" || key === "R") {
    simTimeS = 0;
  }
}
