(function () {
  if (window.__imuDiceSketchBooted) {
    return;
  }
  window.__imuDiceSketchBooted = true;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (isScriptReady(src)) {
        resolve();
        return;
      }

      var existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (existing.dataset.loaded === "true" || isScriptReady(src)) {
          resolve();
          return;
        }
        existing.addEventListener("load", function onLoad() {
          existing.dataset.loaded = "true";
          resolve();
        }, { once: true });
        existing.addEventListener("error", function onError() {
          reject(new Error("스크립트 로드 실패: " + src));
        }, { once: true });
        return;
      }

      var script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = function () {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = function () {
        reject(new Error("스크립트 로드 실패: " + src));
      };
      document.head.appendChild(script);
    });
  }

  function isScriptReady(src) {
    if (src.indexOf("three") !== -1 && src.indexOf("OrbitControls") === -1) {
      return !!window.THREE;
    }
    if (src.indexOf("OrbitControls") !== -1) {
      return !!(window.THREE && typeof window.THREE.OrbitControls === "function");
    }
    if (src.indexOf("cannon") !== -1) {
      return !!window.CANNON;
    }
    return false;
  }

  function loadAnyScript(sources) {
    var index = 0;

    function tryNext() {
      if (index >= sources.length) {
        return Promise.reject(new Error("스크립트 로드 실패: " + sources.join(" | ")));
      }

      var src = sources[index];
      index += 1;
      return loadScript(src).catch(function () {
        return tryNext();
      });
    }

    return tryNext();
  }

  function ensureStyles() {
    if (document.getElementById("imu-dice-inline-style")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "imu-dice-inline-style";
    style.textContent = [
      ":root { --bg: #101820; --panel: #f4f7fb; --ink: #172538; --line: #d2dce8; --accent: #ff9a1f; }",
      "* { box-sizing: border-box; }",
      "body { margin: 0; min-height: 100vh; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: var(--bg); color: var(--ink); }",
      ".app { width: min(900px, 100%); margin: 0 auto; padding: 16px; }",
      ".panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }",
      "h1 { margin: 0; }",
      "p { margin: 6px 0 12px; }",
      ".actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }",
      "button { border: 0; border-radius: 10px; padding: 8px 12px; font-weight: 700; cursor: pointer; background: var(--accent); color: #251a09; }",
      "button.alt { background: #c8d2dd; color: #1e293b; }",
      "#status { margin-left: auto; font-weight: 600; }",
      ".meter-wrap { margin-top: 12px; }",
      ".meter-wrap label { display: block; margin-bottom: 5px; font-size: 0.92rem; }",
      ".meter { height: 14px; border-radius: 999px; background: #dce6f2; overflow: hidden; }",
      "#shakeFill { width: 0%; height: 100%; transition: width 90ms linear; background: linear-gradient(90deg, #58d39d, #209a6a); }",
      ".canvas-panel { margin-top: 12px; overflow: hidden; padding: 0; min-height: 420px; }",
      "canvas { display: block; width: 100%; height: 420px; }",
      "@media (max-width: 700px) { #status { margin-left: 0; } }",
    ].join("\n");
    document.head.appendChild(style);
  }

  function boot() {
    ensureStyles();
    ensureAppShell();
    bindBootUi();
    setBootStatus("3D 라이브러리 로드 중...");

    var threeSources = [
      "https://cdn.jsdelivr.net/npm/three@0.124.0/build/three.min.js",
      "https://unpkg.com/three@0.124.0/build/three.min.js",
    ];
    var controlsSources = [
      "https://cdn.jsdelivr.net/npm/three@0.124.0/examples/js/controls/OrbitControls.js",
      "https://unpkg.com/three@0.124.0/examples/js/controls/OrbitControls.js",
    ];
    var cannonSources = [
      "https://cdn.jsdelivr.net/npm/cannon@0.6.2/build/cannon.min.js",
      "https://unpkg.com/cannon@0.6.2/build/cannon.min.js",
    ];

    loadAnyScript(threeSources)
      .then(function () {
        setBootStatus("카메라 컨트롤 로드 중...");
        return loadAnyScript(controlsSources);
      })
      .then(function () {
        setBootStatus("물리엔진 로드 중...");
        return loadAnyScript(cannonSources);
      })
      .then(function () {
        startApp();
      })
      .catch(function (error) {
        ensureAppShell();
        bindBootUi();
        setBootStatus("외부 라이브러리 로드 실패: p5 editor의 index.html에 CDN script 태그를 직접 추가하세요");
        window.__imuDiceBootError = error;
      });
  }

  function bindBootUi() {
    var connectBtn = document.getElementById("connectBtn");
    var simBtn = document.getElementById("simBtn");
    var rollBtn = document.getElementById("rollBtn");

    if (connectBtn && !connectBtn.dataset.bootBound) {
      connectBtn.dataset.bootBound = "true";
      connectBtn.addEventListener("click", function () {
        if (!window.__imuDiceAppStarted) {
          setBootStatus("앱 초기화 전입니다. p5 editor의 index.html에 Three.js/Cannon script를 추가해야 할 수 있습니다.");
        }
      });
    }

    if (simBtn && !simBtn.dataset.bootBound) {
      simBtn.dataset.bootBound = "true";
      simBtn.addEventListener("click", function () {
        if (!window.__imuDiceAppStarted) {
          setBootStatus("시뮬레이션 시작 전 로딩 실패: index.html에 외부 script 태그를 추가해보세요.");
        }
      });
    }

    if (rollBtn && !rollBtn.dataset.bootBound) {
      rollBtn.dataset.bootBound = "true";
      rollBtn.addEventListener("click", function () {
        if (!window.__imuDiceAppStarted) {
          setBootStatus("물리엔진이 아직 준비되지 않았습니다.");
        }
      });
    }
  }

  function setBootStatus(text) {
    var status = document.getElementById("status");
    if (status) {
      status.textContent = text;
    }
  }

  function startApp() {
    if (window.__imuDiceAppStarted) {
      return;
    }
    window.__imuDiceAppStarted = true;

    var serialPort;
    var reader;
    var useSim = true;

    ensureAppShell();

    var ui = {
      connectBtn: document.getElementById("connectBtn"),
      simBtn: document.getElementById("simBtn"),
      rollBtn: document.getElementById("rollBtn"),
      status: document.getElementById("status"),
      shakeFill: document.getElementById("shakeFill"),
    };

    var holder = document.getElementById("canvasHolder");

    var imu = {
      ax: 0,
      ay: 0,
      az: 1,
      prevAx: 0,
      prevAy: 0,
      prevAz: 1,
      smoothMag: 1,
    };

    var physics = {
      world: null,
      diceBody: null,
      diceMesh: null,
      containerBodies: [],
      enabled: false,
    };

    var render3d = {
      scene: null,
      camera: null,
      renderer: null,
      controls: null,
      boxGroup: null,
    };

    var state = {
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

    var WORLD_GRAVITY = 9.82;
    var SHAKE_THRESHOLD = 1.5;
    var ROLL_COOLDOWN_MS = 500;
    var PHYSICS_STEP = 1 / 60;
    var DICE_SIZE = 0.7;
    var BOX_INNER_X = 2.6;
    var BOX_INNER_Y = 2.0;
    var BOX_INNER_Z = 2.6;
    var BOX_THICKNESS = 0.08;

    bindUi();

    if (!window.THREE || !window.CANNON) {
      setStatus("3D 라이브러리 로드 실패(CDN 확인 필요)");
      ui.rollBtn.disabled = true;
    } else {
      try {
        init();
        animate();
      } catch (error) {
        setStatus("3D 초기화 실패: " + (error && error.message ? error.message : "알 수 없는 오류"));
      }
    }

    function init() {
      initScene();
      try {
        initPhysics();
        physics.enabled = true;
      } catch (error) {
        physics.enabled = false;
        setStatus("물리 초기화 실패(렌더만 동작): " + (error && error.message ? error.message : "알 수 없는 오류"));
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

      var app = document.createElement("main");
      app.className = "app";
      app.innerHTML = [
        '<header class="panel">',
        '<h1>IMU Dice Shaker</h1>',
        '<p>센서를 흔들면 주사위가 굴러갑니다.</p>',
        '<div class="actions">',
        '<button id="connectBtn">IMU 연결</button>',
        '<button id="simBtn" class="alt">시뮬레이션</button>',
        '<button id="rollBtn" class="alt">수동 굴리기</button>',
        '<span id="status">대기</span>',
        '</div>',
        '<div class="meter-wrap">',
        '<label>흔들림 강도</label>',
        '<div class="meter"><div id="shakeFill"></div></div>',
        '</div>',
        '</header>',
        '<section id="canvasHolder" class="panel canvas-panel"></section>',
      ].join("");

      document.body.appendChild(app);
    }

    function initScene() {
      var scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0f1622);

      var camera = new THREE.PerspectiveCamera(50, holder.clientWidth / 420, 0.1, 100);
      camera.position.set(3.4, 2.8, 3.8);

      var renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(holder.clientWidth, 420);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      holder.appendChild(renderer.domElement);

      var controls = null;
      if (typeof THREE.OrbitControls === "function") {
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 0.7, 0);
      }

      var hemi = new THREE.HemisphereLight(0xffffff, 0x2f3e57, 0.9);
      scene.add(hemi);

      var key = new THREE.DirectionalLight(0xffffff, 1.0);
      key.position.set(3, 6, 2);
      scene.add(key);

      var boxGroup = createTransparentBoxGroup();
      scene.add(boxGroup);

      var diceMaterials = createDiceMaterials();
      var diceMesh = new THREE.Mesh(new THREE.BoxGeometry(DICE_SIZE, DICE_SIZE, DICE_SIZE), diceMaterials);
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
      var world = new CANNON.World();
      world.gravity.set(0, -WORLD_GRAVITY, 0);
      if (typeof CANNON.SAPBroadphase === "function") {
        world.broadphase = new CANNON.SAPBroadphase(world);
      }
      world.allowSleep = true;

      var boxMaterial = new CANNON.Material("box");
      var diceMaterial = new CANNON.Material("dice");
      var contact = new CANNON.ContactMaterial(boxMaterial, diceMaterial, {
        friction: 0.38,
        restitution: 0.3,
      });
      world.defaultContactMaterial.friction = 0.35;
      world.defaultContactMaterial.restitution = 0.25;
      world.addContactMaterial(contact);

      createContainerBodies(world, boxMaterial);

      var diceBody = new CANNON.Body({
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
      var t = BOX_THICKNESS;
      var x = BOX_INNER_X;
      var y = BOX_INNER_Y;
      var z = BOX_INNER_Z;

      var wallDefs = [
        { localPos: { x: 0, y: -(y / 2 + t / 2), z: 0 }, half: { x: x / 2 + t, y: t / 2, z: z / 2 + t } },
        { localPos: { x: 0, y: y / 2 + t / 2, z: 0 }, half: { x: x / 2 + t, y: t / 2, z: z / 2 + t } },
        { localPos: { x: -(x / 2 + t / 2), y: 0, z: 0 }, half: { x: t / 2, y: y / 2, z: z / 2 + t } },
        { localPos: { x: x / 2 + t / 2, y: 0, z: 0 }, half: { x: t / 2, y: y / 2, z: z / 2 + t } },
        { localPos: { x: 0, y: 0, z: -(z / 2 + t / 2) }, half: { x: x / 2 + t, y: y / 2, z: t / 2 } },
        { localPos: { x: 0, y: 0, z: z / 2 + t / 2 }, half: { x: x / 2 + t, y: y / 2, z: t / 2 } },
      ];

      physics.containerBodies = [];
      for (var i = 0; i < wallDefs.length; i += 1) {
        var def = wallDefs[i];
        var body = new CANNON.Body({
          mass: 0,
          type: CANNON.Body.KINEMATIC,
          material: material,
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
      ui.simBtn.addEventListener("click", function () {
        useSim = true;
        setStatus("시뮬레이션 모드");
      });
      ui.rollBtn.addEventListener("click", triggerRoll);
    }

    function animate() {
      requestAnimationFrame(animate);

      var now = performance.now();
      var dt = Math.min((now - state.lastFrameMs) / 1000, 0.05);
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

      var mag = Math.sqrt(imu.ax * imu.ax + imu.ay * imu.ay + imu.az * imu.az);
      imu.smoothMag += (mag - imu.smoothMag) * 0.18;

      var fillPct = clamp((imu.smoothMag - 0.9) / 1.2, 0, 1) * 100;
      ui.shakeFill.style.width = fillPct.toFixed(1) + "%";

      var dax = imu.ax - imu.prevAx;
      var day = imu.ay - imu.prevAy;
      var daz = imu.az - imu.prevAz;

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

      var targetPosX = state.boxCenter.x + clamp(imu.ax * 0.58 + state.shakeVX * 0.14, -0.95, 0.95);
      var targetPosZ = state.boxCenter.z + clamp(-imu.ay * 0.72 + state.shakeVZ * 0.16, -1.1, 1.1);
      var targetPosY = state.boxCenter.y + clamp((imu.az - 1) * 0.22 + state.shakeVY * 0.06, -0.2, 0.24);

      var targetRotX = clamp(imu.ay * 0.38 + state.shakeVZ * 0.04, -0.5, 0.5);
      var targetRotZ = clamp(imu.ax * 0.34 + state.shakeVX * 0.04, -0.5, 0.5);
      var targetRotY = clamp((dax - day) * 0.26, -0.35, 0.35);

      var shakeOffset = Math.sin(state.boxShakePhase) * state.boxShakeEnergy * 0.08;
      var shakeRot = Math.cos(state.boxShakePhase * 1.35) * state.boxShakeEnergy * 0.07;

      var posFollow = Math.min(10 * dt, 1);
      var rotFollow = Math.min(12 * dt, 1);

      state.boxPos.x += ((targetPosX + shakeOffset) - state.boxPos.x) * posFollow;
      state.boxPos.y += ((targetPosY + Math.sin(state.boxShakePhase * 0.8) * state.boxShakeEnergy * 0.03) - state.boxPos.y) * posFollow;
      state.boxPos.z += ((targetPosZ - shakeOffset) - state.boxPos.z) * posFollow;
      state.boxRot.x += ((targetRotX + shakeRot) - state.boxRot.x) * rotFollow;
      state.boxRot.y += ((targetRotY + shakeRot * 0.65) - state.boxRot.y) * rotFollow;
      state.boxRot.z += ((targetRotZ - shakeRot) - state.boxRot.z) * rotFollow;

      syncContainerTransforms(dt);
      physics.diceBody.wakeUp();

      var imuFollow = Math.min(dt * 20, 1);
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

    function syncContainerTransforms(dt) {
      var stepDt = typeof dt === "number" ? dt : PHYSICS_STEP;
      var q3 = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(state.boxRot.x, state.boxRot.y, state.boxRot.z, "XYZ")
      );

      if (render3d.boxGroup) {
        render3d.boxGroup.position.set(state.boxPos.x, state.boxPos.y, state.boxPos.z);
        render3d.boxGroup.quaternion.copy(q3);
      }

      var q = new CANNON.Quaternion();
      q.setFromEuler(state.boxRot.x, state.boxRot.y, state.boxRot.z);
      var center = new CANNON.Vec3(state.boxPos.x, state.boxPos.y, state.boxPos.z);

      var safeDt = Math.max(stepDt, 1 / 240);
      var vx = (state.boxPos.x - state.prevBoxPos.x) / safeDt;
      var vy = (state.boxPos.y - state.prevBoxPos.y) / safeDt;
      var vz = (state.boxPos.z - state.prevBoxPos.z) / safeDt;
      var avx = (state.boxRot.x - state.prevBoxRot.x) / safeDt;
      var avy = (state.boxRot.y - state.prevBoxRot.y) / safeDt;
      var avz = (state.boxRot.z - state.prevBoxRot.z) / safeDt;

      for (var i = 0; i < physics.containerBodies.length; i += 1) {
        var body = physics.containerBodies[i];
        var rotated = q.vmult(body.localPos);
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
      var v = physics.diceBody.velocity.length();
      var av = physics.diceBody.angularVelocity.length();

      if (v < 0.08 && av < 0.12) {
        state.settledFrames += 1;
      } else {
        state.settledFrames = 0;
      }

      if (state.settledFrames < 16) {
        return;
      }

      var face = getTopFaceValue(physics.diceBody.quaternion);
      if (face !== state.lastShownFace) {
        state.lastShownFace = face;
        setStatus("굴림 결과: " + face);
      }
    }

    function getTopFaceValue(quaternion) {
      var faces = [
        { value: 1, normal: new CANNON.Vec3(0, 1, 0) },
        { value: 6, normal: new CANNON.Vec3(0, -1, 0) },
        { value: 2, normal: new CANNON.Vec3(1, 0, 0) },
        { value: 5, normal: new CANNON.Vec3(-1, 0, 0) },
        { value: 3, normal: new CANNON.Vec3(0, 0, 1) },
        { value: 4, normal: new CANNON.Vec3(0, 0, -1) },
      ];

      var best = { value: 1, y: -Infinity };
      for (var i = 0; i < faces.length; i += 1) {
        var face = faces[i];
        var worldNormal = quaternion.vmult(face.normal);
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

        var textDecoder = new TextDecoderStream();
        serialPort.readable.pipeTo(textDecoder.writable).catch(function () {
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
        setStatus("연결 실패: " + (error && error.message ? error.message : "알 수 없는 오류"));
      }
    }

    async function readLoop(buffer) {
      var carry = buffer || "";
      if (!reader) {
        return;
      }

      var result = await reader.read();
      var value = result.value;
      var done = result.done;
      if (done) {
        return;
      }

      carry += value;
      var lines = carry.split(/\r?\n/);
      carry = lines.pop() || "";

      for (var i = 0; i < lines.length; i += 1) {
        parseImuLine(lines[i].trim());
      }

      readLoop(carry);
    }

    function parseImuLine(line) {
      var m = line.match(
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
      var width = holder.clientWidth;
      var height = 420;
      render3d.camera.aspect = width / height;
      render3d.camera.updateProjectionMatrix();
      render3d.renderer.setSize(width, height);
    }

    function createDiceMaterials() {
      var faceBySide = { px: 2, nx: 5, py: 1, ny: 6, pz: 3, nz: 4 };
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
      var texture = new THREE.CanvasTexture(drawFaceTexture(value));
      if (THREE.SRGBColorSpace) {
        texture.colorSpace = THREE.SRGBColorSpace;
      }
      return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5, metalness: 0.02 });
    }

    function drawFaceTexture(value) {
      var size = 256;
      var canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;

      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#d83232";
      ctx.fillRect(0, 0, size, size);

      ctx.fillStyle = "#fff8f8";
      var r = 18;
      var m = 58;
      var c = size / 2;

      var pos = {
        tl: [m, m], tc: [c, m], tr: [size - m, m],
        ml: [m, c], mc: [c, c], mr: [size - m, c],
        bl: [m, size - m], bc: [c, size - m], br: [size - m, size - m],
      };

      var layouts = {
        1: ["mc"],
        2: ["tl", "br"],
        3: ["tl", "mc", "br"],
        4: ["tl", "tr", "bl", "br"],
        5: ["tl", "tr", "mc", "bl", "br"],
        6: ["tl", "tr", "ml", "mr", "bl", "br"],
      };

      var points = layouts[value] || layouts[1];
      for (var i = 0; i < points.length; i += 1) {
        var point = pos[points[i]];
        ctx.beginPath();
        ctx.arc(point[0], point[1], r, 0, Math.PI * 2);
        ctx.fill();
      }

      return canvas;
    }

    function createTransparentBoxGroup() {
      var group = new THREE.Group();

      var glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x8fc6ff,
        transparent: true,
        opacity: 0.18,
        roughness: 0.08,
        metalness: 0,
        transmission: 0.6,
        side: THREE.DoubleSide,
      });

      var edgeMat = new THREE.LineBasicMaterial({ color: 0xb9e0ff, transparent: true, opacity: 0.8 });
      var panels = [
        { size: [BOX_INNER_X + BOX_THICKNESS * 2, BOX_THICKNESS, BOX_INNER_Z + BOX_THICKNESS * 2], pos: [0, -(BOX_INNER_Y / 2 + BOX_THICKNESS / 2), 0] },
        { size: [BOX_INNER_X + BOX_THICKNESS * 2, BOX_THICKNESS, BOX_INNER_Z + BOX_THICKNESS * 2], pos: [0, BOX_INNER_Y / 2 + BOX_THICKNESS / 2, 0] },
        { size: [BOX_THICKNESS, BOX_INNER_Y, BOX_INNER_Z + BOX_THICKNESS * 2], pos: [-(BOX_INNER_X / 2 + BOX_THICKNESS / 2), 0, 0] },
        { size: [BOX_THICKNESS, BOX_INNER_Y, BOX_INNER_Z + BOX_THICKNESS * 2], pos: [BOX_INNER_X / 2 + BOX_THICKNESS / 2, 0, 0] },
        { size: [BOX_INNER_X + BOX_THICKNESS * 2, BOX_INNER_Y, BOX_THICKNESS], pos: [0, 0, -(BOX_INNER_Z / 2 + BOX_THICKNESS / 2)] },
        { size: [BOX_INNER_X + BOX_THICKNESS * 2, BOX_INNER_Y, BOX_THICKNESS], pos: [0, 0, BOX_INNER_Z / 2 + BOX_THICKNESS / 2] },
      ];

      for (var i = 0; i < panels.length; i += 1) {
        var panel = panels[i];
        var mesh = new THREE.Mesh(new THREE.BoxGeometry(panel.size[0], panel.size[1], panel.size[2]), glassMat);
        mesh.position.set(panel.pos[0], panel.pos[1], panel.pos[2]);
        group.add(mesh);

        var edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat);
        edges.position.copy(mesh.position);
        group.add(edges);
      }

      group.position.set(state.boxPos.x, state.boxPos.y, state.boxPos.z);
      return group;
    }

    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }
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

    var app = document.createElement("main");
    app.className = "app";
    app.innerHTML = [
      '<header class="panel">',
      '<h1>IMU Dice Shaker</h1>',
      '<p>센서를 흔들면 주사위가 굴러갑니다.</p>',
      '<div class="actions">',
      '<button id="connectBtn">IMU 연결</button>',
      '<button id="simBtn" class="alt">시뮬레이션</button>',
      '<button id="rollBtn" class="alt">수동 굴리기</button>',
      '<span id="status">준비 중...</span>',
      '</div>',
      '<div class="meter-wrap">',
      '<label>흔들림 강도</label>',
      '<div class="meter"><div id="shakeFill"></div></div>',
      '</div>',
      '</header>',
      '<section id="canvasHolder" class="panel canvas-panel"></section>',
    ].join("");
    document.body.appendChild(app);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
