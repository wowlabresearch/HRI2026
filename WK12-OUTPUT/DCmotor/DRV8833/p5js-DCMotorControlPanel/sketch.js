let speedSlider;
let speedLabel;
let statusLabel;
let logBox;
let graphCaption;

let dutyHistory = [];
const DUTY_HISTORY_MAX = 180;

let activeMode = 'COAST';
let lastLiveSendMs = 0;

let connectBtn;
let disconnectBtn;
let fwdBtn;
let revBtn;
let stopBtn;

let port = null;
let reader = null;
let writer = null;
let keepReading = false;

const BAUD_RATE = 115200;
const PWM_FREQ_HZ = 20000;

function setup() {
  textFont('monospace');

  const root = createDiv('');
  root.id('app');

  createElement('h2', 'DRV8833 Motor Control').parent(root);

  statusLabel = createP('Status: Disconnected');
  statusLabel.parent(root);
  statusLabel.class('status-label');

  const row1 = createDiv('');
  row1.parent(root);
  row1.class('button-row');

  connectBtn = createButton('Connect Serial');
  connectBtn.parent(row1);
  connectBtn.class('btn btn-primary');
  connectBtn.mousePressed(connectSerial);

  disconnectBtn = createButton('Disconnect');
  disconnectBtn.parent(row1);
  disconnectBtn.class('btn');
  disconnectBtn.mousePressed(disconnectSerial);

  const speedRow = createDiv('');
  speedRow.parent(root);
  speedRow.class('speed-row');

  speedLabel = createSpan('Speed: 60%');
  speedLabel.parent(speedRow);
  speedLabel.class('speed-label');

  speedSlider = createSlider(0, 100, 60, 1);
  speedSlider.parent(speedRow);
  speedSlider.class('speed-slider');
  speedSlider.input(() => {
    const speedPct = speedSlider.value();
    speedLabel.html('Speed: ' + speedPct + '%');
    pushDutySample(speedPct);
    applyLiveSpeedIfRunning(speedPct);
  });

  const row2 = createDiv('');
  row2.parent(root);
  row2.class('button-row');

  fwdBtn = createButton('Forward');
  fwdBtn.parent(row2);
  fwdBtn.class('btn btn-forward');
  fwdBtn.mousePressed(() => {
    activeMode = 'FORWARD';
    sendCommand('FWD,' + speedSlider.value());
  });

  revBtn = createButton('Reverse');
  revBtn.parent(row2);
  revBtn.class('btn btn-reverse');
  revBtn.mousePressed(() => {
    activeMode = 'REVERSE';
    sendCommand('REV,' + speedSlider.value());
  });

  stopBtn = createButton('Stop');
  stopBtn.parent(row2);
  stopBtn.class('btn btn-stop');
  stopBtn.mousePressed(() => {
    activeMode = 'COAST';
    sendCommand('STOP');
  });

  createElement('h4', 'Device Log').parent(root);
  logBox = createElement('pre', '');
  logBox.parent(root);
  logBox.id('log-box');

  createElement('h4', 'Live PWM Visualization').parent(root);
  graphCaption = createP('Duty: 60% | PWM: 20.0 kHz');
  graphCaption.parent(root);
  graphCaption.id('graph-caption');

  const cv = createCanvas(820, 340);
  cv.parent(root);
  cv.id('pwm-canvas');

  appendLog('Ready. Click Connect Serial.');
  pushDutySample(speedSlider.value());
}

function draw() {
  background(252);
  drawDutyHistoryChart(20, 20, 780, 130);
  drawPwmWaveChart(20, 165, 780, 155, speedSlider.value());
}

function drawDutyHistoryChart(x, y, w, h) {
  stroke(200);
  noFill();
  rect(x, y, w, h);

  stroke(230);
  for (let i = 1; i < 5; i++) {
    const gy = y + (h * i) / 5;
    line(x, gy, x + w, gy);
  }

  noStroke();
  fill(70);
  text('Duty history (%)', x + 8, y + 16);
  text('100', x + w - 28, y + 16);
  text('0', x + w - 18, y + h - 6);

  if (dutyHistory.length < 2) return;

  stroke(33, 150, 243);
  strokeWeight(2);
  noFill();
  beginShape();
  for (let i = 0; i < dutyHistory.length; i++) {
    const px = map(i, 0, DUTY_HISTORY_MAX - 1, x + 2, x + w - 2);
    const py = map(dutyHistory[i], 0, 100, y + h - 2, y + 2);
    vertex(px, py);
  }
  endShape();

  const latest = dutyHistory[dutyHistory.length - 1];
  noStroke();
  fill(33, 150, 243);
  text('Current: ' + latest + '%', x + w - 120, y + h - 8);
}

function drawPwmWaveChart(x, y, w, h, dutyPct) {
  stroke(200);
  noFill();
  rect(x, y, w, h);

  noStroke();
  fill(70);
  text('One PWM cycle (conceptual)', x + 8, y + 16);

  const yHigh = y + 36;
  const yLow = y + h - 28;
  const xStart = x + 20;
  const xEnd = x + w - 20;
  const cycleW = xEnd - xStart;
  const highW = cycleW * (dutyPct / 100);

  stroke(120);
  line(xStart, yLow, xEnd, yLow);

  stroke(244, 67, 54);
  strokeWeight(3);
  if (dutyPct <= 0) {
    line(xStart, yLow, xEnd, yLow);
  } else if (dutyPct >= 100) {
    line(xStart, yHigh, xEnd, yHigh);
  } else {
    line(xStart, yLow, xStart, yHigh);
    line(xStart, yHigh, xStart + highW, yHigh);
    line(xStart + highW, yHigh, xStart + highW, yLow);
    line(xStart + highW, yLow, xEnd, yLow);
  }

  stroke(120, 120, 120, 120);
  strokeWeight(1);
  const edgeX = xStart + highW;
  line(edgeX, y + 22, edgeX, y + h - 8);

  noStroke();
  fill(40);
  text('HIGH ' + nf(dutyPct, 1, 0) + '%', xStart + 4, y + 30);
  textAlign(RIGHT, BASELINE);
  text('LOW ' + nf(100 - dutyPct, 1, 0) + '%', xEnd - 4, y + h - 8);
  textAlign(LEFT, BASELINE);
}

function pushDutySample(value) {
  const v = constrain(Number(value), 0, 100);
  dutyHistory.push(v);
  if (dutyHistory.length > DUTY_HISTORY_MAX) {
    dutyHistory.shift();
  }
  graphCaption.html('Duty: ' + v + '% | PWM: ' + (PWM_FREQ_HZ / 1000).toFixed(1) + ' kHz');
}

function applyLiveSpeedIfRunning(speedPct) {
  const now = millis();
  if (now - lastLiveSendMs < 80) {
    return;
  }

  if (!writer) {
    return;
  }

  if (activeMode === 'FORWARD') {
    sendCommand('FWD,' + speedPct);
    lastLiveSendMs = now;
  } else if (activeMode === 'REVERSE') {
    sendCommand('REV,' + speedPct);
    lastLiveSendMs = now;
  }
}

function appendLog(msg) {
  const now = new Date().toLocaleTimeString();
  logBox.html(logBox.html() + '[' + now + '] ' + msg + '\n');
  logBox.elt.scrollTop = logBox.elt.scrollHeight;
}

async function connectSerial() {
  if (!('serial' in navigator)) {
    appendLog('Web Serial is not supported in this browser.');
    return;
  }

  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: BAUD_RATE });

    const encoder = new TextEncoderStream();
    encoder.readable.pipeTo(port.writable);
    writer = encoder.writable.getWriter();

    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable);
    reader = decoder.readable.getReader();

    keepReading = true;
    readLoop();

    statusLabel.html('Status: Connected @ ' + BAUD_RATE);
    appendLog('Connected.');
    sendCommand('STATE?');
  } catch (err) {
    appendLog('Connect failed: ' + err.message);
  }
}

async function disconnectSerial() {
  try {
    keepReading = false;

    if (reader) {
      await reader.cancel();
      reader.releaseLock();
      reader = null;
    }

    if (writer) {
      await writer.close();
      writer.releaseLock();
      writer = null;
    }

    if (port) {
      await port.close();
      port = null;
    }

    statusLabel.html('Status: Disconnected');
    appendLog('Disconnected.');
  } catch (err) {
    appendLog('Disconnect warning: ' + err.message);
  }
}

async function sendCommand(cmd) {
  if (!writer) {
    appendLog('Not connected.');
    return;
  }

  try {
    await writer.write(cmd + '\n');
    appendLog('TX: ' + cmd);
    updateModeFromTx(cmd);
  } catch (err) {
    appendLog('TX error: ' + err.message);
  }
}

function updateModeFromTx(cmd) {
  if (cmd.startsWith('FWD,')) {
    activeMode = 'FORWARD';
    const spd = Number(cmd.split(',')[1] || 0);
    pushDutySample(spd);
  } else if (cmd.startsWith('REV,')) {
    activeMode = 'REVERSE';
    const spd = Number(cmd.split(',')[1] || 0);
    pushDutySample(spd);
  } else if (cmd === 'BRAKE' || cmd === 'COAST' || cmd === 'STOP') {
    activeMode = 'COAST';
    pushDutySample(0);
  }
}

async function readLoop() {
  if (!keepReading || !reader) {
    statusLabel.html('Status: Disconnected');
    return;
  }

  try {
    const { value, done } = await reader.read();
    if (done) {
      statusLabel.html('Status: Disconnected');
      return;
    }

    if (value) {
      const lines = value.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          appendLog('RX: ' + trimmed);
        }
      }
    }
  } catch (err) {
    appendLog('RX error: ' + err.message);
    statusLabel.html('Status: Disconnected');
    return;
  }

  // Yield back to browser event loop to avoid p5 infinite-loop detection.
  setTimeout(readLoop, 0);
}
