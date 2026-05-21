let statusLabel;
let rpmSlider;
let rpmLabel;
let stepCountInput;
let logBox;

let port = null;
let reader = null;
let writer = null;
let keepReading = false;

let runMode = 'STOP';
let lastLiveSendMs = 0;

const BAUD_RATE = 115200;

function setup() {
  noCanvas();

  const root = createDiv('');
  root.id('app');

  createElement('h2', 'ULN2003 Stepper Control Panel').parent(root);

  statusLabel = createP('Status: Disconnected');
  statusLabel.class('status-label');
  statusLabel.parent(root);

  const connRow = createDiv('');
  connRow.class('row');
  connRow.parent(root);

  const connectBtn = createButton('Connect Serial');
  connectBtn.class('btn btn-primary');
  connectBtn.parent(connRow);
  connectBtn.mousePressed(connectSerial);

  const disconnectBtn = createButton('Disconnect');
  disconnectBtn.class('btn');
  disconnectBtn.parent(connRow);
  disconnectBtn.mousePressed(disconnectSerial);

  const rpmRow = createDiv('');
  rpmRow.class('block');
  rpmRow.parent(root);

  rpmLabel = createSpan('RPM: 8');
  rpmLabel.class('rpm-label');
  rpmLabel.parent(rpmRow);

  rpmSlider = createSlider(1, 18, 8, 1);
  rpmSlider.class('slider');
  rpmSlider.parent(rpmRow);
  rpmSlider.input(() => {
    const rpm = rpmSlider.value();
    rpmLabel.html('RPM: ' + rpm);
    applyLiveRpm(rpm);
  });

  const runRow = createDiv('');
  runRow.class('row');
  runRow.parent(root);

  const fwdBtn = createButton('Run Forward');
  fwdBtn.class('btn btn-forward');
  fwdBtn.parent(runRow);
  fwdBtn.mousePressed(() => {
    runMode = 'FWD';
    sendCommand('RUN,FWD,' + rpmSlider.value());
  });

  const revBtn = createButton('Run Reverse');
  revBtn.class('btn btn-reverse');
  revBtn.parent(runRow);
  revBtn.mousePressed(() => {
    runMode = 'REV';
    sendCommand('RUN,REV,' + rpmSlider.value());
  });

  const stopBtn = createButton('Stop');
  stopBtn.class('btn btn-stop');
  stopBtn.parent(runRow);
  stopBtn.mousePressed(() => {
    runMode = 'STOP';
    sendCommand('STOP');
  });

  const stepBlock = createDiv('');
  stepBlock.class('block');
  stepBlock.parent(root);

  createSpan('Step count: ').parent(stepBlock);
  stepCountInput = createInput('512', 'number');
  stepCountInput.attribute('min', '1');
  stepCountInput.class('step-input');
  stepCountInput.parent(stepBlock);

  const stepRow = createDiv('');
  stepRow.class('row');
  stepRow.parent(stepBlock);

  const stepFwdBtn = createButton('Step + (FWD)');
  stepFwdBtn.class('btn');
  stepFwdBtn.parent(stepRow);
  stepFwdBtn.mousePressed(() => {
    const count = sanitizeStepCount(stepCountInput.value());
    stepCountInput.value(String(count));
    runMode = 'STOP';
    sendCommand('STEP,' + count + ',FWD,' + rpmSlider.value());
  });

  const stepRevBtn = createButton('Step - (REV)');
  stepRevBtn.class('btn');
  stepRevBtn.parent(stepRow);
  stepRevBtn.mousePressed(() => {
    const count = sanitizeStepCount(stepCountInput.value());
    stepCountInput.value(String(count));
    runMode = 'STOP';
    sendCommand('STEP,' + count + ',REV,' + rpmSlider.value());
  });

  const stateBtn = createButton('State?');
  stateBtn.class('btn');
  stateBtn.parent(stepRow);
  stateBtn.mousePressed(() => sendCommand('STATE?'));

  createElement('h4', 'Device Log').parent(root);
  logBox = createElement('pre', '');
  logBox.id('log-box');
  logBox.parent(root);

  appendLog('Ready. Connect serial and control motor.');
}

function sanitizeStepCount(v) {
  const cleaned = String(v).replace(/[,_\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(200000, Math.floor(n));
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
  } catch (err) {
    appendLog('TX error: ' + err.message);
  }
}

function applyLiveRpm(rpm) {
  if (!writer) return;
  if (runMode !== 'FWD' && runMode !== 'REV') return;

  const now = millis();
  if (now - lastLiveSendMs < 120) return;

  sendCommand('RUN,' + runMode + ',' + rpm);
  lastLiveSendMs = now;
}

function parseStateLine(line) {
  if (!line.startsWith('STATE,')) return;
  const parts = line.split(',');
  if (parts.length < 5) return;

  const mode = parts[1];
  const dir = parts[2];
  const currentRpm = Number(parts[3]);
  const remaining = parts[4];

  if (mode === 'RUN') {
    runMode = dir === 'REV' ? 'REV' : 'FWD';
  } else {
    runMode = 'STOP';
  }

  if (Number.isFinite(currentRpm) && currentRpm >= 1 && currentRpm <= 18) {
    rpmSlider.value(currentRpm);
    rpmLabel.html('RPM: ' + currentRpm);
  }

  statusLabel.html('Status: Connected | Mode: ' + mode + ' | Dir: ' + dir + ' | Remaining: ' + remaining);
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
          parseStateLine(trimmed);
        }
      }
    }
  } catch (err) {
    appendLog('RX error: ' + err.message);
    statusLabel.html('Status: Disconnected');
    return;
  }

  setTimeout(readLoop, 0);
}
