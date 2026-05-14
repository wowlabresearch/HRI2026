let serialPort;
let reader;
let inputClosed;
let keepReading = false;

const state = {
  accel: { x: 0, y: 0, z: 0 },
  gyro: { x: 0, y: 0, z: 0 },
  angle: { roll: 0, pitch: 0, yaw: 0 },
};

const ui = {
  connectBtn: null,
  disconnectBtn: null,
  status: null,
  telemetry: null,
};

const smooth = {
  roll: 0,
  pitch: 0,
  yaw: 0,
};

const calibration = {
  map: {
    roll: "roll",
    pitch: "pitch",
    yaw: "yaw",
  },
  sign: {
    roll: 1,
    pitch: 1,
    yaw: 1,
  },
  offset: {
    roll: 0,
    pitch: 0,
    yaw: 0,
  },
  frame: {
    roll: 0,
    pitch: 0,
    yaw: 0,
  },
};

const cubeSize = {
  width: 96,
  height: 30,
  depth: 64,
};

const axisLength = 72;

function setup() {
  const holder = document.getElementById("canvas-holder");
  const canvas = createCanvas(holder.clientWidth, holder.clientHeight, WEBGL);
  canvas.parent("canvas-holder");
  frameRate(60);

  ui.connectBtn = document.getElementById("connectBtn");
  ui.disconnectBtn = document.getElementById("disconnectBtn");
  ui.status = document.getElementById("status");
  ui.telemetry = document.getElementById("telemetry");

  ui.connectBtn.addEventListener("click", onConnectClick);
  ui.disconnectBtn.addEventListener("click", onDisconnectClick);

  if (!("serial" in navigator)) {
    setStatus("상태: 이 브라우저는 Web Serial 미지원 (Chrome/Edge 필요)", true);
    ui.connectBtn.disabled = true;
  }
}

function draw() {
  background(0, 0, 0, 0);

  const calibrated = getCalibratedAngles();

  smooth.roll = lerp(smooth.roll, calibrated.roll, 0.12);
  smooth.pitch = lerp(smooth.pitch, calibrated.pitch, 0.12);
  smooth.yaw = lerp(smooth.yaw, calibrated.yaw, 0.12);

  drawWorld();
  drawCube();
}

function windowResized() {
  const holder = document.getElementById("canvas-holder");
  resizeCanvas(holder.clientWidth, holder.clientHeight);
}

function keyPressed() {
  if (key === "c" || key === "C") {
    captureCalibrationOffset();
  }
}

function drawWorld() {
  orbitControl(0, 0, 0);

  ambientLight(120);
  directionalLight(255, 220, 180, 0.6, 0.7, -1);
  directionalLight(80, 160, 255, -0.5, -0.4, -1);

  push();
  stroke(255, 255, 255, 60);
  noFill();
  rotateX(HALF_PI);
  for (let i = -200; i <= 200; i += 20) {
    line(i, -200, i, 200);
    line(-200, i, 200, i);
  }
  pop();
}

function drawCube() {
  push();
  rotateZ(radians(calibration.frame.yaw));
  rotateX(radians(calibration.frame.roll));
  rotateY(radians(calibration.frame.pitch));

  rotateZ(radians(smooth.yaw));
  rotateX(radians(smooth.roll));
  rotateY(radians(smooth.pitch));

  noStroke();
  ambientMaterial(245, 236, 200);
  box(cubeSize.width, cubeSize.height, cubeSize.depth);

  strokeWeight(4);

  push();
  stroke(255, 80, 80);
  line(0, 0, 0, axisLength, 0, 0);
  pop();

  push();
  stroke(80, 255, 120);
  line(0, 0, 0, 0, axisLength, 0);
  pop();

  push();
  stroke(80, 160, 255);
  line(0, 0, 0, 0, 0, axisLength);
  pop();

  push();
  translate(0, -20, 0);
  emissiveMaterial(0, 166, 166);
  box(cubeSize.width + 4, 2, cubeSize.depth + 4);
  pop();

  push();
  translate(0, 0, 42);
  ambientMaterial(255, 138, 0);
  plane(cubeSize.width + 2, 26);
  pop();

  pop();
}

async function onConnectClick() {
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });

    const textDecoder = new TextDecoderStream();
    inputClosed = serialPort.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();

    keepReading = true;
    ui.connectBtn.disabled = true;
    ui.disconnectBtn.disabled = false;
    setStatus("상태: 연결됨 (115200)");

    readLoop();
  } catch (error) {
    setStatus(`상태: 연결 실패 - ${error.message}`, true);
  }
}

async function onDisconnectClick() {
  keepReading = false;
  try {
    if (reader) {
      await reader.cancel();
      reader.releaseLock();
      reader = null;
    }
    if (inputClosed) {
      await inputClosed.catch(() => {});
      inputClosed = null;
    }
    if (serialPort) {
      await serialPort.close();
      serialPort = null;
    }
  } finally {
    ui.connectBtn.disabled = false;
    ui.disconnectBtn.disabled = true;
    setStatus("상태: 연결 해제됨");
  }
}

async function readLoop() {
  let buffer = "";

  const pump = async () => {
    if (!keepReading || !reader) {
      return;
    }

    try {
      const { value, done } = await reader.read();
      if (done) {
        if (keepReading) {
          await onDisconnectClick();
        }
        return;
      }

      buffer += value || "";
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        parseTelemetry(line.trim());
      }
    } catch (error) {
      setStatus(`상태: 수신 오류 - ${error.message}`, true);
      if (keepReading) {
        await onDisconnectClick();
      }
      return;
    }

    pump();
  };

  pump();
}

function parseTelemetry(line) {
  if (!line) {
    return;
  }

  const m = line.match(
    /ACC\[g\] X:([\-\d.]+) Y:([\-\d.]+) Z:([\-\d.]+) \| GYRO\[dps\] X:([\-\d.]+) Y:([\-\d.]+) Z:([\-\d.]+) \| ANGLE\[deg\] Roll:([\-\d.]+) Pitch:([\-\d.]+) Yaw:([\-\d.]+)/
  );

  if (!m) {
    return;
  }

  state.accel.x = parseFloat(m[1]);
  state.accel.y = parseFloat(m[2]);
  state.accel.z = parseFloat(m[3]);
  state.gyro.x = parseFloat(m[4]);
  state.gyro.y = parseFloat(m[5]);
  state.gyro.z = parseFloat(m[6]);
  state.angle.roll = parseFloat(m[7]);
  state.angle.pitch = parseFloat(m[8]);
  state.angle.yaw = parseFloat(m[9]);

  ui.telemetry.textContent =
    `ACC [g]\n` +
    `  X: ${state.accel.x.toFixed(3)}\n` +
    `  Y: ${state.accel.y.toFixed(3)}\n` +
    `  Z: ${state.accel.z.toFixed(3)}\n\n` +
    `GYRO [dps]\n` +
    `  X: ${state.gyro.x.toFixed(2)}\n` +
    `  Y: ${state.gyro.y.toFixed(2)}\n` +
    `  Z: ${state.gyro.z.toFixed(2)}\n\n` +
    `ANGLE [deg]\n` +
    `  Roll: ${state.angle.roll.toFixed(2)}\n` +
    `  Pitch: ${state.angle.pitch.toFixed(2)}\n` +
    `  Yaw: ${state.angle.yaw.toFixed(2)}\n`;
}

function getCalibratedAngles() {
  const rollRaw = state.angle[calibration.map.roll];
  const pitchRaw = state.angle[calibration.map.pitch];
  const yawRaw = state.angle[calibration.map.yaw];

  return {
    roll: calibration.sign.roll * (rollRaw - calibration.offset.roll),
    pitch: calibration.sign.pitch * (pitchRaw - calibration.offset.pitch),
    yaw: calibration.sign.yaw * (yawRaw - calibration.offset.yaw),
  };
}

function captureCalibrationOffset() {
  const current = getCalibratedAngles();

  // Keep the current visual pose as the new axis basis when calibrating.
  calibration.frame.roll = normalizeAngle(calibration.frame.roll + current.roll);
  calibration.frame.pitch = normalizeAngle(calibration.frame.pitch + current.pitch);
  calibration.frame.yaw = normalizeAngle(calibration.frame.yaw + current.yaw);

  calibration.offset.roll = state.angle[calibration.map.roll];
  calibration.offset.pitch = state.angle[calibration.map.pitch];
  calibration.offset.yaw = state.angle[calibration.map.yaw];

  smooth.roll = 0;
  smooth.pitch = 0;
  smooth.yaw = 0;

  setStatus("상태: 축 프레임 + 영점 캘리브레이션 저장됨 (C)");
}

function normalizeAngle(angle) {
  let wrapped = angle;
  while (wrapped > 180) {
    wrapped -= 360;
  }
  while (wrapped < -180) {
    wrapped += 360;
  }
  return wrapped;
}

function setStatus(text, isError = false) {
  ui.status.textContent = text;
  ui.status.style.color = isError ? "#b30000" : "#0f1a2b";
}
