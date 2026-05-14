let serialPort;
let reader;
let useSim = true;

ensureAppShell();

const ui = {
  connectBtn: document.getElementById("connectBtn"),
  simBtn: document.getElementById("simBtn"),
  rollBtn: document.getElementById("rollBtn"),
  status: document.getElementById("status"),
  shakeFill: document.getElementById("shakeFill"),
};

const holder = document.getElementById("canvasHolder");

const imu = {
  ax: 0,
  ay: 0,
  az: 1,
  prevAx: 0,
  prevAy: 0,
  prevAz: 1,
  smoothMag: 1,
};

const physics = {
  world: null,
  diceBody: null,
  diceMesh: null,
  containerBodies: [],
  enabled: false,
};

const render3d = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  boxGroup: null,
};

const state = {
  lastShakeMs: 0,
  settledFrames: 0,
  lastShownFace: 1,
  lastFrameMs: performance.now(),
  boxCenter: { x: 0, y: 1.04, z: 0 },
  boxPos: { x: 0, y: 1.04, z: 0 },
  boxRot: { x: 0, y: 0, z: 0 },
  prevBoxPos: { x: 0, y: 1.04, z: 0 },
  prevBoxRot: { x: 0, y: 0, z: 0 },
  shakeVX: 0,
  shakeVY: 0,
  shakeVZ: 0,
  boxShakeEnergy: 0,
  boxShakePhase: 0,
};

const WORLD_GRAVITY = 9.82;
const SHAKE_THRESHOLD = 1.5;
const ROLL_COOLDOWN_MS = 500;
const PHYSICS_STEP = 1 / 60;
const DICE_SIZE = 0.7;
const BOX_INNER_X = 2.6;
const BOX_INNER_Y = 2.0;
const BOX_INNER_Z = 2.6;
const BOX_THICKNESS = 0.08;

bindUi();

if (!window.THREE || !window.CANNON) {
  setStatus("3D 라이브러리 로드 실패(CDN 확인 필요)");
  ui.rollBtn.disabled = true;
} else {
  try {
    init();
    animate();
  } catch (error) {
    setStatus(`3D 초기화 실패: ${error?.message || "알 수 없는 오류"}`);
  }
}

function init() {
  initScene();
  try {
    initPhysics();
    physics.enabled = true;
  } catch (error) {
    physics.enabled = false;
    setStatus(`물리 초기화 실패(렌더만 동작): ${error?.message || "알 수 없는 오류"}`);
  }

  if (!isSerialAvailable()) {
    ui.connectBtn.disabled = false;
    setStatus("Web Serial 미지원 또는 비보안 컨텍스트");
  } else {
    setStatus("시뮬레이션 모드");
  }

  window.addEventListener("resize", onResize);
}

function ensureAppShell() {
  if (
    document.getElementById("connectBtn") &&
    document.getElementById("simBtn") &&
    document.getElementById("rollBtn") &&
    document.getElementById("status") &&
    document.getElementById("shakeFill") &&
    document.getElementById("canvasHolder")
  ) {
    return;
  }

  const app = document.createElement("main");
  app.className = "app";
  app.innerHTML = `
    <header class="panel">
      <h1>IMU Dice Shaker</h1>
      <p>센서를 흔들면 주사위가 굴러갑니다.</p>
      <div class="actions">
        <button id="connectBtn">IMU 연결</button>
        <button id="simBtn" class="alt">시뮬레이션</button>
        <button id="rollBtn" class="alt">수동 굴리기</button>
        <span id="status">대기</span>
      </div>
      <div class="meter-wrap">
        <label>흔들림 강도</label>
        <div class="meter"><div id="shakeFill"></div></div>
      </div>
    </header>
    <section id="canvasHolder" class="panel canvas-panel"></section>
  `;

  document.body.appendChild(app);
}

function initScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1622);

  const camera = new THREE.PerspectiveCamera(50, holder.clientWidth / 420, 0.1, 100);
  camera.position.set(3.4, 2.8, 3.8);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(holder.clientWidth, 420);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  holder.appendChild(renderer.domElement);

  let controls = null;
  if (typeof THREE.OrbitControls === "function") {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.7, 0);
  }

  const hemi = new THREE.HemisphereLight(0xffffff, 0x2f3e57, 0.9);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(3, 6, 2);
  scene.add(key);

  const boxGroup = createTransparentBoxGroup();
  scene.add(boxGroup);

  const diceMaterials = createDiceMaterials();
  const diceMesh = new THREE.Mesh(new THREE.BoxGeometry(DICE_SIZE, DICE_SIZE, DICE_SIZE), diceMaterials);
  diceMesh.castShadow = false;
  diceMesh.position.set(0, state.boxCenter.y, 0);
  scene.add(diceMesh);

  render3d.scene = scene;
  render3d.camera = camera;
  render3d.renderer = renderer;
  render3d.controls = controls;
  render3d.boxGroup = boxGroup;
  physics.diceMesh = diceMesh;
}

function initPhysics() {
  const world = new CANNON.World();
  world.gravity.set(0, -WORLD_GRAVITY, 0);
  if (typeof CANNON.SAPBroadphase === "function") {
    world.broadphase = new CANNON.SAPBroadphase(world);
  }
  world.allowSleep = true;

  const boxMaterial = new CANNON.Material("box");
  const diceMaterial = new CANNON.Material("dice");
  const contact = new CANNON.ContactMaterial(boxMaterial, diceMaterial, {
    friction: 0.38,
    restitution: 0.3,
  });
  world.defaultContactMaterial.friction = 0.35;
  world.defaultContactMaterial.restitution = 0.25;
  world.addContactMaterial(contact);

  createContainerBodies(world, boxMaterial);

  const diceBody = new CANNON.Body({
    mass: 1,
    material: diceMaterial,
    shape: new CANNON.Box(new CANNON.Vec3(DICE_SIZE / 2, DICE_SIZE / 2, DICE_SIZE / 2)),
    position: new CANNON.Vec3(0, state.boxCenter.y, 0),
    angularDamping: 0.1,
    linearDamping: 0.07,
    sleepTimeLimit: 0.35,
    sleepSpeedLimit: 0.14,
  });
  world.addBody(diceBody);

  physics.world = world;
  physics.diceBody = diceBody;
}

function createContainerBodies(world, material) {
  const t = BOX_THICKNESS;
  const x = BOX_INNER_X;
  const y = BOX_INNER_Y;
  const z = BOX_INNER_Z;

  const wallDefs = [
    {
      localPos: { x: 0, y: -(y / 2 + t / 2), z: 0 },
      half: { x: x / 2 + t, y: t / 2, z: z / 2 + t },
    },
    {
      localPos: { x: 0, y: y / 2 + t / 2, z: 0 },
      half: { x: x / 2 + t, y: t / 2, z: z / 2 + t },
    },
    {
      localPos: { x: -(x / 2 + t / 2), y: 0, z: 0 },
      half: { x: t / 2, y: y / 2, z: z / 2 + t },
    },
    {
      localPos: { x: x / 2 + t / 2, y: 0, z: 0 },
      half: { x: t / 2, y: y / 2, z: z / 2 + t },
    },
    {
      localPos: { x: 0, y: 0, z: -(z / 2 + t / 2) },
      half: { x: x / 2 + t, y: y / 2, z: t / 2 },
    },
    {
      localPos: { x: 0, y: 0, z: z / 2 + t / 2 },
      half: { x: x / 2 + t, y: y / 2, z: t / 2 },
    },
  ];

  physics.containerBodies = [];
  for (const def of wallDefs) {
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      material,
      shape: new CANNON.Box(new CANNON.Vec3(def.half.x, def.half.y, def.half.z)),
      position: new CANNON.Vec3(0, 0, 0),
    });
    body.localPos = new CANNON.Vec3(def.localPos.x, def.localPos.y, def.localPos.z);
    world.addBody(body);
    physics.containerBodies.push(body);
  }

  syncContainerTransforms();
}

function bindUi() {
  ui.connectBtn.addEventListener("click", onConnectClick);
  ui.simBtn.addEventListener("click", () => {
    useSim = true;
    setStatus("시뮬레이션 모드");
  });
  ui.rollBtn.addEventListener("click", triggerRoll);
}

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - state.lastFrameMs) / 1000, 0.05);
  state.lastFrameMs = now;

  if (useSim) {
    runSimInput(now / 1000);
  }

  if (physics.enabled) {
    updateFromImu(dt);
    physics.world.step(PHYSICS_STEP, dt, 3);
    syncMeshToPhysics();
    updateSettledFace();
  } else {
    // Physics failed: keep a visible 3D cube so the user can confirm rendering works.
    physics.diceMesh.rotation.y += dt * 0.8;
    physics.diceMesh.rotation.x += dt * 0.45;
  }

  if (render3d.controls) {
    render3d.controls.target.set(state.boxPos.x, state.boxPos.y, state.boxPos.z);
    render3d.controls.update();
  }
  render3d.renderer.render(render3d.scene, render3d.camera);
}

function runSimInput(t) {
  imu.ax = Math.sin(t * 2.0) * 0.8 + Math.sin(t * 5.4) * 0.25;
  imu.ay = Math.cos(t * 1.7) * 0.75 + Math.sin(t * 4.3) * 0.22;
  imu.az = 1 + Math.sin(t * 3.1) * 0.16;
}

function updateFromImu(dt) {
  if (!physics.world || !physics.diceBody) {
    return;
  }

  const mag = Math.sqrt(imu.ax * imu.ax + imu.ay * imu.ay + imu.az * imu.az);
  imu.smoothMag += (mag - imu.smoothMag) * 0.18;

  const fillPct = clamp((imu.smoothMag - 0.9) / 1.2, 0, 1) * 100;
  ui.shakeFill.style.width = `${fillPct.toFixed(1)}%`;

  const dax = imu.ax - imu.prevAx;
  const day = imu.ay - imu.prevAy;
  const daz = imu.az - imu.prevAz;

  if (imu.smoothMag > SHAKE_THRESHOLD && performance.now() - state.lastShakeMs > ROLL_COOLDOWN_MS) {
    state.lastShakeMs = performance.now();
    state.boxShakeEnergy = Math.min(state.boxShakeEnergy + 1.0, 2.0);
    triggerRoll();
  }

  state.shakeVX = state.shakeVX * 0.88 + dax * 1.8;
  state.shakeVZ = state.shakeVZ * 0.88 - day * 2.1;
  state.shakeVY = state.shakeVY * 0.85 + (imu.az - 1) * 0.28 + daz * 0.9;

  state.boxShakeEnergy = Math.max(0, state.boxShakeEnergy - dt * 1.4);
  state.boxShakePhase += dt * (8 + state.boxShakeEnergy * 4);

  const targetPosX = state.boxCenter.x + clamp(imu.ax * 0.58 + state.shakeVX * 0.14, -0.95, 0.95);
  const targetPosZ = state.boxCenter.z + clamp(-imu.ay * 0.72 + state.shakeVZ * 0.16, -1.1, 1.1);
  const targetPosY = state.boxCenter.y + clamp((imu.az - 1) * 0.22 + state.shakeVY * 0.06, -0.2, 0.24);

  const targetRotX = clamp(imu.ay * 0.38 + state.shakeVZ * 0.04, -0.5, 0.5);
  const targetRotZ = clamp(imu.ax * 0.34 + state.shakeVX * 0.04, -0.5, 0.5);
  const targetRotY = clamp((dax - day) * 0.26, -0.35, 0.35);

  const shakeOffset = Math.sin(state.boxShakePhase) * state.boxShakeEnergy * 0.08;
  const shakeRot = Math.cos(state.boxShakePhase * 1.35) * state.boxShakeEnergy * 0.07;

  const posFollow = Math.min(10 * dt, 1);
  const rotFollow = Math.min(12 * dt, 1);

  state.boxPos.x += ((targetPosX + shakeOffset) - state.boxPos.x) * posFollow;
  state.boxPos.y += ((targetPosY + Math.sin(state.boxShakePhase * 0.8) * state.boxShakeEnergy * 0.03) - state.boxPos.y) * posFollow;
  state.boxPos.z += ((targetPosZ - shakeOffset) - state.boxPos.z) * posFollow;
  state.boxRot.x += ((targetRotX + shakeRot) - state.boxRot.x) * rotFollow;
  state.boxRot.y += ((targetRotY + shakeRot * 0.65) - state.boxRot.y) * rotFollow;
  state.boxRot.z += ((targetRotZ - shakeRot) - state.boxRot.z) * rotFollow;

  syncContainerTransforms(dt);
  physics.diceBody.wakeUp();

  const imuFollow = Math.min(dt * 20, 1);
  imu.prevAx += (imu.ax - imu.prevAx) * imuFollow;
  imu.prevAy += (imu.ay - imu.prevAy) * imuFollow;
  imu.prevAz += (imu.az - imu.prevAz) * imuFollow;
}

function triggerRoll() {
  if (!physics.enabled) {
    setStatus("물리 비활성 상태: 렌더만 동작 중");
    return;
  }

  state.lastShakeMs = performance.now();
  state.boxShakeEnergy = Math.min(state.boxShakeEnergy + 1.3, 2.2);
  if (physics.diceBody) {
    physics.diceBody.wakeUp();
  }
  setStatus("굴리는 중...");
}

function syncContainerTransforms(dt = PHYSICS_STEP) {
  const q3 = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(state.boxRot.x, state.boxRot.y, state.boxRot.z, "XYZ")
  );

  if (render3d.boxGroup) {
    render3d.boxGroup.position.set(state.boxPos.x, state.boxPos.y, state.boxPos.z);
    render3d.boxGroup.quaternion.copy(q3);
  }

  const q = new CANNON.Quaternion();
  q.setFromEuler(state.boxRot.x, state.boxRot.y, state.boxRot.z);
  const center = new CANNON.Vec3(state.boxPos.x, state.boxPos.y, state.boxPos.z);

  const safeDt = Math.max(dt, 1 / 240);
  const vx = (state.boxPos.x - state.prevBoxPos.x) / safeDt;
  const vy = (state.boxPos.y - state.prevBoxPos.y) / safeDt;
  const vz = (state.boxPos.z - state.prevBoxPos.z) / safeDt;
  const avx = (state.boxRot.x - state.prevBoxRot.x) / safeDt;
  const avy = (state.boxRot.y - state.prevBoxRot.y) / safeDt;
  const avz = (state.boxRot.z - state.prevBoxRot.z) / safeDt;

  for (const body of physics.containerBodies) {
    const rotated = q.vmult(body.localPos);
    body.position.set(center.x + rotated.x, center.y + rotated.y, center.z + rotated.z);
    body.quaternion.copy(q);
    body.velocity.set(vx, vy, vz);
    body.angularVelocity.set(avx, avy, avz);
    body.aabbNeedsUpdate = true;
  }

  state.prevBoxPos.x = state.boxPos.x;
  state.prevBoxPos.y = state.boxPos.y;
  state.prevBoxPos.z = state.boxPos.z;
  state.prevBoxRot.x = state.boxRot.x;
  state.prevBoxRot.y = state.boxRot.y;
  state.prevBoxRot.z = state.boxRot.z;
}

function syncMeshToPhysics() {
  physics.diceMesh.position.copy(physics.diceBody.position);
  physics.diceMesh.quaternion.copy(physics.diceBody.quaternion);
}

function updateSettledFace() {
  const v = physics.diceBody.velocity.length();
  const av = physics.diceBody.angularVelocity.length();

  if (v < 0.08 && av < 0.12) {
    state.settledFrames += 1;
  } else {
    state.settledFrames = 0;
  }

  if (state.settledFrames < 16) {
    return;
  }

  const face = getTopFaceValue(physics.diceBody.quaternion);
  if (face !== state.lastShownFace) {
    state.lastShownFace = face;
    setStatus(`굴림 결과: ${face}`);
  }
}

function getTopFaceValue(quaternion) {
  const faces = [
    { value: 1, normal: new CANNON.Vec3(0, 1, 0) },
    { value: 6, normal: new CANNON.Vec3(0, -1, 0) },
    { value: 2, normal: new CANNON.Vec3(1, 0, 0) },
    { value: 5, normal: new CANNON.Vec3(-1, 0, 0) },
    { value: 3, normal: new CANNON.Vec3(0, 0, 1) },
    { value: 4, normal: new CANNON.Vec3(0, 0, -1) },
  ];

  let best = { value: 1, y: -Infinity };
  for (const face of faces) {
    const worldNormal = quaternion.vmult(face.normal);
    if (worldNormal.y > best.y) {
      best = { value: face.value, y: worldNormal.y };
    }
  }

  return best.value;
}

async function onConnectClick() {
  if (!physics.diceMesh) {
    setStatus("3D 렌더 초기화 실패: 페이지 새로고침 후 다시 시도");
    return;
  }

  if (!isSerialAvailable()) {
    setStatus("연결 불가: Chrome/Edge + localhost(또는 https)에서 실행하세요");
    return;
  }

  try {
    setStatus("포트 선택 대기...");
    serialPort = await navigator.serial.requestPort();
    setStatus("포트 연결 중...");
    await serialPort.open({ baudRate: 115200 });

    const textDecoder = new TextDecoderStream();
    serialPort.readable.pipeTo(textDecoder.writable).catch(() => {
      setStatus("시리얼 스트림 종료");
    });
    reader = textDecoder.readable.getReader();

    useSim = false;
    setStatus("IMU 연결됨");
    readLoop();
  } catch (error) {
    if (error && error.name === "NotFoundError") {
      setStatus("포트 선택이 취소됨");
      return;
    }
    if (error && error.name === "SecurityError") {
      setStatus("보안 오류: localhost 또는 https 환경에서 실행 필요");
      return;
    }
    setStatus(`연결 실패: ${error?.message || "알 수 없는 오류"}`);
  }
}

async function readLoop() {
  let buffer = "";
  while (reader) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += value;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      parseImuLine(line.trim());
    }
  }
}

function parseImuLine(line) {
  const m = line.match(
    /ACC\[g\] X:([\-\d.]+) Y:([\-\d.]+) Z:([\-\d.]+) \| GYRO\[dps\] X:([\-\d.]+) Y:([\-\d.]+) Z:([\-\d.]+) \| ANGLE\[deg\] Roll:([\-\d.]+) Pitch:([\-\d.]+) Yaw:([\-\d.]+)/
  );

  if (!m) {
    return;
  }

  imu.ax = parseFloat(m[1]);
  imu.ay = parseFloat(m[2]);
  imu.az = parseFloat(m[3]);
}

function setStatus(text) {
  ui.status.textContent = text;
}

function isSerialAvailable() {
  return "serial" in navigator && window.isSecureContext;
}

function onResize() {
  const width = holder.clientWidth;
  const height = 420;
  render3d.camera.aspect = width / height;
  render3d.camera.updateProjectionMatrix();
  render3d.renderer.setSize(width, height);
}

function createDiceMaterials() {
  const faceBySide = {
    px: 2,
    nx: 5,
    py: 1,
    ny: 6,
    pz: 3,
    nz: 4,
  };

  return [
    makeFaceMaterial(faceBySide.px),
    makeFaceMaterial(faceBySide.nx),
    makeFaceMaterial(faceBySide.py),
    makeFaceMaterial(faceBySide.ny),
    makeFaceMaterial(faceBySide.pz),
    makeFaceMaterial(faceBySide.nz),
  ];
}

function makeFaceMaterial(value) {
  const texture = new THREE.CanvasTexture(drawFaceTexture(value));
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5, metalness: 0.02 });
}

function drawFaceTexture(value) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#d83232";
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "#fff8f8";
  const r = 18;
  const m = 58;
  const c = size / 2;

  const pos = {
    tl: [m, m],
    tc: [c, m],
    tr: [size - m, m],
    ml: [m, c],
    mc: [c, c],
    mr: [size - m, c],
    bl: [m, size - m],
    bc: [c, size - m],
    br: [size - m, size - m],
  };

  const layouts = {
    1: ["mc"],
    2: ["tl", "br"],
    3: ["tl", "mc", "br"],
    4: ["tl", "tr", "bl", "br"],
    5: ["tl", "tr", "mc", "bl", "br"],
    6: ["tl", "tr", "ml", "mr", "bl", "br"],
  };

  for (const key of layouts[value]) {
    const [x, y] = pos[key];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

function createTransparentBoxGroup() {
  const group = new THREE.Group();

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x8fc6ff,
    transparent: true,
    opacity: 0.18,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.6,
    side: THREE.DoubleSide,
  });

  const edgeMat = new THREE.LineBasicMaterial({ color: 0xb9e0ff, transparent: true, opacity: 0.8 });

  const panels = [
    { size: [BOX_INNER_X + BOX_THICKNESS * 2, BOX_THICKNESS, BOX_INNER_Z + BOX_THICKNESS * 2], pos: [0, -(BOX_INNER_Y / 2 + BOX_THICKNESS / 2), 0] },
    { size: [BOX_INNER_X + BOX_THICKNESS * 2, BOX_THICKNESS, BOX_INNER_Z + BOX_THICKNESS * 2], pos: [0, BOX_INNER_Y / 2 + BOX_THICKNESS / 2, 0] },
    { size: [BOX_THICKNESS, BOX_INNER_Y, BOX_INNER_Z + BOX_THICKNESS * 2], pos: [-(BOX_INNER_X / 2 + BOX_THICKNESS / 2), 0, 0] },
    { size: [BOX_THICKNESS, BOX_INNER_Y, BOX_INNER_Z + BOX_THICKNESS * 2], pos: [BOX_INNER_X / 2 + BOX_THICKNESS / 2, 0, 0] },
    { size: [BOX_INNER_X + BOX_THICKNESS * 2, BOX_INNER_Y, BOX_THICKNESS], pos: [0, 0, -(BOX_INNER_Z / 2 + BOX_THICKNESS / 2)] },
    { size: [BOX_INNER_X + BOX_THICKNESS * 2, BOX_INNER_Y, BOX_THICKNESS], pos: [0, 0, BOX_INNER_Z / 2 + BOX_THICKNESS / 2] },
  ];

  for (const panel of panels) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(panel.size[0], panel.size[1], panel.size[2]), glassMat);
    mesh.position.set(panel.pos[0], panel.pos[1], panel.pos[2]);
    group.add(mesh);

    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat);
    edges.position.copy(mesh.position);
    group.add(edges);
  }

  group.position.set(state.boxPos.x, state.boxPos.y, state.boxPos.z);
  return group;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}
