# p5.js PWM Sync Workspace
(ENG)--------

This folder visualizes the PWM behavior and timing in sync with `src/main.cpp`.

## Sync Reference (matches the firmware)
- PWM frequency: 20kHz (`1 period = 50us`)
- Ramp up: `0 -> 255` in `+5` steps, `20ms` per step (`52 steps`, `1.04s`)
- Hold (Flat): variable from `0.0s` to `2.0s`
- Ramp down: `255 -> 0` in `-5` steps, `20ms` per step (`52 steps`, `1.04s`)
- OFF: automatically adjusted as `2.04s - Flat`
- Total loop time: fixed at `4.12s`

## Run Locally
1. Open `p5js-workspace/index.html` in a browser.
2. Or run the folder with Live Server.

## Real-Time Sync (Web Serial)
1. Upload the firmware and make sure the board is running.
2. Open `index.html` or the Live Server page in Chrome or Edge.
3. Click `Connect Serial`, then select the ESP32 port.
4. Click `Motor RUN` to start the motor.
5. Click `Motor STOP` to stop it.
6. Move the intensity slider to immediately update the output level (`0~100%`).
7. Use the `Flat` slider to immediately adjust the hold plateau duration in milliseconds.

Notes:
- Web Serial typically works in Chromium-based browsers.
- `http://localhost` or `https` is recommended.
- Serial telemetry format: `PWM,phaseMs,stage,duty`
- State data format: `STATE,enabled,intensityPct`
- Stage values: `1=RampUp`, `2=Hold`, `3=RampDown`, `4=Off`

## Firmware Command Protocol
- `RUN`: start the motor pattern
- `STOP`: stop the motor immediately
- `SCALE,<0..100>`: set the output intensity scale
- `HOLDMS,<0..2000>`: set the Hold (Flat) duration in milliseconds
- `STATE?`: request the current state

## For the p5.js Web Editor
- You can copy the contents of this folder's `sketch.js` directly into a p5.js Web Editor sketch.
- `index.html` and `style.css` are provided for local preview.


(KOR)--------
이 폴더는 `src/main.cpp`의 PWM 동작과 시간축을 동기화해서 시각화합니다.

## 동기화 기준 (펌웨어와 동일)
- PWM 주파수: 20kHz (`1주기 = 50us`)
- 램프업: `0 -> 255`를 `+5`씩, 각 스텝 `20ms` (`52스텝`, `1.04s`)
- 홀드(Flat): `0.0s ~ 2.0s` 가변
- 램프다운: `255 -> 0`를 `-5`씩, 각 스텝 `20ms` (`52스텝`, `1.04s`)
- OFF: `2.04s - Flat` 로 자동 조절
- 총 루프: `4.12s` 고정

## 로컬 실행
1. `p5js-workspace/index.html`을 브라우저로 열기
2. 또는 Live Server로 폴더 실행

## 실시간 동기화 (Web Serial)
1. 펌웨어 업로드 후 보드가 동작 중인지 확인
2. Chrome/Edge에서 `index.html` 또는 Live Server 페이지 열기
3. `Connect Serial` 버튼 클릭 후 ESP32 포트 선택
4. `Motor RUN` 버튼을 눌러 진동 시작
5. `Motor STOP` 버튼으로 정지
6. 슬라이더를 움직이면 강도(0~100%)가 즉시 반영됨
7. `Flat` 슬라이더로 상단 Hold(평탄) 구간 길이(ms) 즉시 조절

주의:
- Web Serial은 보통 Chromium 계열 브라우저에서 동작합니다.
- `http://localhost` 또는 `https` 환경이 권장됩니다.
- 직렬 데이터 포맷은 `PWM,phaseMs,stage,duty` 입니다.
- 상태 데이터 포맷은 `STATE,enabled,intensityPct` 입니다.
- stage 값: `1=RampUp`, `2=Hold`, `3=RampDown`, `4=Off`

## 펌웨어 명령 프로토콜
- `RUN` : 모터 패턴 시작
- `STOP` : 모터 즉시 정지
- `SCALE,<0..100>` : 출력 강도 스케일 설정
- `HOLDMS,<0..2000>` : Hold(Flat) 구간 시간 설정(ms)
- `STATE?` : 현재 상태 조회

## p5.js 웹 에디터용
- 이 폴더의 `sketch.js` 내용을 p5.js Web Editor의 스케치에 그대로 붙여넣으면 됩니다.
- `index.html`/`style.css`는 로컬 확인용입니다.
