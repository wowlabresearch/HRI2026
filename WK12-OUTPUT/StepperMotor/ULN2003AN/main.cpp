#include <Arduino.h>

// XIAO ESP32S3 + ULN2003AN (for 28BYJ-48 style 4-phase stepper)
// Wiring example:
//   ULN2003 IN1 -> GPIO2
//   ULN2003 IN2 -> GPIO3
//   ULN2003 IN3 -> GPIO4
//   ULN2003 IN4 -> GPIO5
//   ULN2003 GND -> ESP32 GND (common ground)
//   ULN2003 VCC -> motor supply (typically 5V module input)

constexpr int COIL_IN1 = 2;
constexpr int COIL_IN2 = 3;
constexpr int COIL_IN3 = 4;
constexpr int COIL_IN4 = 5;

constexpr uint8_t DIR_FWD = 1;
constexpr uint8_t DIR_REV = 2;

constexpr uint16_t STEPS_PER_REV_HALF = 2048;  // typical 28BYJ-48 geared motor
constexpr uint8_t RPM_MIN = 1;
constexpr uint8_t RPM_MAX = 18;

// Half-step sequence: smoother motion than full-step.
const uint8_t HALF_STEP_SEQ[8][4] = {
    {1, 0, 0, 0},
    {1, 1, 0, 0},
    {0, 1, 0, 0},
    {0, 1, 1, 0},
    {0, 0, 1, 0},
    {0, 0, 1, 1},
    {0, 0, 0, 1},
    {1, 0, 0, 1},
};

enum MotorMode : uint8_t {
  MODE_IDLE = 0,
  MODE_RUN = 1,
  MODE_STEP = 2,
};

MotorMode mode = MODE_IDLE;
uint8_t runDir = DIR_FWD;
uint8_t rpm = 8;
int8_t halfStepIndex = 0;
uint32_t stepIntervalUs = 0;
uint32_t lastStepMicros = 0;
uint32_t remainingSteps = 0;

String serialLine;

static const char* modeLabel() {
  switch (mode) {
    case MODE_RUN: return "RUN";
    case MODE_STEP: return "STEP";
    default: return "IDLE";
  }
}

static const char* dirLabel(uint8_t d) {
  return (d == DIR_REV) ? "REV" : "FWD";
}

void setCoils(uint8_t a, uint8_t b, uint8_t c, uint8_t d) {
  digitalWrite(COIL_IN1, a);
  digitalWrite(COIL_IN2, b);
  digitalWrite(COIL_IN3, c);
  digitalWrite(COIL_IN4, d);
}

void releaseCoils() {
  setCoils(0, 0, 0, 0);
}

void applyCurrentHalfStep() {
  const uint8_t* p = HALF_STEP_SEQ[halfStepIndex];
  setCoils(p[0], p[1], p[2], p[3]);
}

void advanceHalfStep(uint8_t direction) {
  if (direction == DIR_REV) {
    halfStepIndex = (halfStepIndex + 7) % 8;
  } else {
    halfStepIndex = (halfStepIndex + 1) % 8;
  }
  applyCurrentHalfStep();
}

void recalcStepInterval() {
  const uint32_t clampedRpm = constrain(rpm, RPM_MIN, RPM_MAX);
  // us per step = 60e6 / (steps_per_rev * rpm)
  stepIntervalUs = 60000000UL / (STEPS_PER_REV_HALF * clampedRpm);
  if (stepIntervalUs == 0) {
    stepIntervalUs = 1;
  }
}

void emitState() {
  Serial.printf("STATE,%s,%s,%u,%lu\n",
      modeLabel(),
      dirLabel(runDir),
      static_cast<unsigned>(rpm),
      static_cast<unsigned long>(remainingSteps));
}

uint8_t parseDir(const String& s) {
  if (s == "REV") return DIR_REV;
  return DIR_FWD;
}

void startRun(uint8_t direction, uint8_t targetRpm) {
  runDir = direction;
  rpm = constrain(targetRpm, RPM_MIN, RPM_MAX);
  mode = MODE_RUN;
  remainingSteps = 0;
  recalcStepInterval();
  emitState();
  Serial.println("ACK,RUN");
}

void stopMotor(bool replyAck = true) {
  mode = MODE_IDLE;
  remainingSteps = 0;
  releaseCoils();
  emitState();
  if (replyAck) {
    Serial.println("ACK,STOP");
  }
}

void setRpm(uint8_t targetRpm) {
  rpm = constrain(targetRpm, RPM_MIN, RPM_MAX);
  recalcStepInterval();
  emitState();
  Serial.printf("ACK,RPM,%u\n", static_cast<unsigned>(rpm));
}

void stepFixed(uint32_t steps, uint8_t direction, uint8_t targetRpm) {
  runDir = direction;
  rpm = constrain(targetRpm, RPM_MIN, RPM_MAX);
  recalcStepInterval();
  remainingSteps = steps;
  mode = (remainingSteps > 0) ? MODE_STEP : MODE_IDLE;
  if (mode == MODE_IDLE) {
    releaseCoils();
  }
  emitState();
  Serial.printf("ACK,STEP,%lu\n", static_cast<unsigned long>(remainingSteps));
}

void processCommand(const String& line) {
  if (line == "STOP") {
    stopMotor();
    return;
  }

  if (line == "STATE?") {
    emitState();
    Serial.println("ACK,STATE");
    return;
  }

  if (line.startsWith("RPM,")) {
    const int val = line.substring(4).toInt();
    if (val >= RPM_MIN && val <= RPM_MAX) {
      setRpm(static_cast<uint8_t>(val));
    } else {
      Serial.println("ERR,RPM");
    }
    return;
  }

  // RUN,FWD,10  or RUN,REV,6
  if (line.startsWith("RUN,")) {
    const int c1 = line.indexOf(',', 4);
    if (c1 < 0) {
      Serial.println("ERR,RUN_FMT");
      return;
    }

    const String dir = line.substring(4, c1);
    const int val = line.substring(c1 + 1).toInt();
    if (val < RPM_MIN || val > RPM_MAX) {
      Serial.println("ERR,RUN_RPM");
      return;
    }

    startRun(parseDir(dir), static_cast<uint8_t>(val));
    return;
  }

  // STEP,512,FWD,8
  if (line.startsWith("STEP,")) {
    const int c1 = line.indexOf(',', 5);
    const int c2 = (c1 >= 0) ? line.indexOf(',', c1 + 1) : -1;
    if (c1 < 0 || c2 < 0) {
      Serial.println("ERR,STEP_FMT");
      return;
    }

    const long steps = line.substring(5, c1).toInt();
    const String dir = line.substring(c1 + 1, c2);
    const int val = line.substring(c2 + 1).toInt();

    if (steps <= 0 || val < RPM_MIN || val > RPM_MAX) {
      Serial.println("ERR,STEP_PARAM");
      return;
    }

    stepFixed(static_cast<uint32_t>(steps), parseDir(dir), static_cast<uint8_t>(val));
    return;
  }

  Serial.println("ERR,UNKNOWN_CMD");
}

void pollSerialCommands() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());

    if (c == '\r' || c == '\n') {
      if (!serialLine.isEmpty()) {
        processCommand(serialLine);
        serialLine = "";
      }
      continue;
    }

    serialLine += c;
  }
}

void serviceMotor() {
  if (mode == MODE_IDLE) {
    return;
  }

  const uint32_t now = micros();
  if (now - lastStepMicros < stepIntervalUs) {
    return;
  }

  lastStepMicros = now;
  advanceHalfStep(runDir);

  if (mode == MODE_STEP) {
    if (remainingSteps > 0) {
      remainingSteps--;
    }

    if (remainingSteps == 0) {
      mode = MODE_IDLE;
      releaseCoils();
      emitState();
      Serial.println("ACK,STEP_DONE");
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);

  pinMode(COIL_IN1, OUTPUT);
  pinMode(COIL_IN2, OUTPUT);
  pinMode(COIL_IN3, OUTPUT);
  pinMode(COIL_IN4, OUTPUT);

  releaseCoils();
  recalcStepInterval();
  serialLine.reserve(80);

  Serial.println("ULN2003 Stepper Controller ready");
  Serial.println("CMD: RUN,<FWD|REV>,<1..18>");
  Serial.println("CMD: STOP");
  Serial.println("CMD: RPM,<1..18>");
  Serial.println("CMD: STEP,<count>,<FWD|REV>,<1..18>");
  Serial.println("CMD: STATE?");
  emitState();
}

void loop() {
  pollSerialCommands();
  serviceMotor();
}
