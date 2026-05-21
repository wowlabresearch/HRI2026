#include <Arduino.h>

constexpr int VIBRO_PIN = 1;

constexpr uint32_t PWM_FREQ_HZ = 20000;      // 20 kHz to reduce audible noise
constexpr uint8_t PWM_RES_BITS = 8;          // Duty range: 0~255
constexpr uint16_t DUTY_MAX = (1 << PWM_RES_BITS) - 1;
constexpr uint8_t DUTY_STEP = 5;
constexpr uint16_t STEP_DELAY_MS = 20;
constexpr uint16_t TOTAL_CYCLE_TARGET_MS = 4120;
constexpr uint16_t HOLD_TIME_DEFAULT_MS = 500;
constexpr uint16_t HOLD_TIME_MIN_MS = 0;
constexpr uint16_t IDLE_TELEMETRY_MS = 100;
constexpr uint8_t SCALE_MIN = 0;
constexpr uint8_t SCALE_MAX = 100;
constexpr uint16_t HOLD_TIME_REQUEST_MAX_MS = 2000;

// Education-friendly default: keep waveform logic simple and predictable.
// Set true when you need robust low-intensity startup on real hardware.
constexpr bool ENABLE_STARTUP_ASSIST = false;

constexpr uint16_t MIN_EFFECTIVE_DUTY = 70;
constexpr uint16_t KICKSTART_DUTY = 180;
constexpr uint16_t KICKSTART_MS = 120;

#if ESP_ARDUINO_VERSION_MAJOR < 3
constexpr int PWM_CHANNEL = 0;
#endif

enum PwmStage : uint8_t {
  STAGE_RAMP_UP = 1,
  STAGE_HOLD = 2,
  STAGE_RAMP_DOWN = 3,
  STAGE_OFF = 4,
};

constexpr uint16_t RAMP_STEPS = (DUTY_MAX / DUTY_STEP) + 1;
constexpr uint16_t RAMP_TIME_MS = RAMP_STEPS * STEP_DELAY_MS;
constexpr uint16_t HOLD_AND_OFF_BUDGET_MS = TOTAL_CYCLE_TARGET_MS - (RAMP_TIME_MS * 2);
constexpr uint16_t HOLD_TIME_MAX_MS =
  HOLD_AND_OFF_BUDGET_MS < HOLD_TIME_REQUEST_MAX_MS ? HOLD_AND_OFF_BUDGET_MS
                            : HOLD_TIME_REQUEST_MAX_MS;

bool motorEnabled = false;
uint8_t intensityScalePct = 100;
uint16_t holdTimeMs = HOLD_TIME_DEFAULT_MS;
PwmStage currentStage = STAGE_OFF;

uint16_t getOffTimeMs() {
  return HOLD_AND_OFF_BUDGET_MS - holdTimeMs;
}

uint16_t currentRawDuty = 0;
uint16_t currentOutputDuty = 0;
uint16_t stageStepIndex = 0;
bool kickstartActive = false;
uint32_t kickstartUntilMs = 0;

uint32_t cycleStartMs = 0;
uint32_t stageStartMs = 0;
uint32_t nextTickMs = 0;
uint32_t lastIdleTelemetryMs = 0;

String serialLine;

uint16_t applyScale(uint16_t rawDuty) {
  if (rawDuty == 0 || intensityScalePct == 0) {
    return 0;
  }

  const uint32_t scaled =
      static_cast<uint32_t>(rawDuty) * static_cast<uint32_t>(intensityScalePct) /
      SCALE_MAX;
  uint16_t duty = static_cast<uint16_t>(min<uint32_t>(scaled, DUTY_MAX));
  if (ENABLE_STARTUP_ASSIST && duty > 0 && duty < MIN_EFFECTIVE_DUTY) {
    duty = MIN_EFFECTIVE_DUTY;
  }
  return duty;
}

void setMotorDuty(uint16_t duty) {
  duty = min<uint16_t>(duty, DUTY_MAX);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(VIBRO_PIN, duty);
#else
  ledcWrite(PWM_CHANNEL, duty);
#endif
}

void emitTelemetry(PwmStage stage, uint16_t duty, uint32_t cycleStartMs) {
  const uint32_t phaseMs = millis() - cycleStartMs;
  Serial.printf(
      "PWM,%lu,%u,%u\n",
      static_cast<unsigned long>(phaseMs),
      static_cast<unsigned>(stage),
      static_cast<unsigned>(duty));
}

void emitState() {
  Serial.printf(
  "STATE,%u,%u,%u\n",
      static_cast<unsigned>(motorEnabled ? 1 : 0),
  static_cast<unsigned>(intensityScalePct),
  static_cast<unsigned>(holdTimeMs));
}

void applyOutputAndEmit(PwmStage stage, uint16_t rawDuty) {
  const uint32_t now = millis();

  currentRawDuty = rawDuty;
  uint16_t targetOutputDuty = applyScale(rawDuty);

  if (!ENABLE_STARTUP_ASSIST) {
    kickstartActive = false;
  } else {
    if (targetOutputDuty == 0) {
      kickstartActive = false;
    } else if (currentOutputDuty == 0 && !kickstartActive) {
      kickstartActive = true;
      kickstartUntilMs = now + KICKSTART_MS;
    }
  }

  uint16_t effectiveDuty = targetOutputDuty;
  if (ENABLE_STARTUP_ASSIST && kickstartActive) {
    if (now < kickstartUntilMs) {
      effectiveDuty = max<uint16_t>(targetOutputDuty, KICKSTART_DUTY);
    } else {
      kickstartActive = false;
    }
  }

  currentOutputDuty = effectiveDuty;
  setMotorDuty(effectiveDuty);
  emitTelemetry(stage, effectiveDuty, cycleStartMs);
}

void startPattern() {
  motorEnabled = true;
  currentStage = STAGE_RAMP_UP;
  stageStepIndex = 0;
  currentRawDuty = 0;
  currentOutputDuty = 0;
  kickstartActive = false;

  const uint32_t now = millis();
  cycleStartMs = now;
  stageStartMs = now;
  nextTickMs = now;

  emitState();
}

void stopPattern() {
  motorEnabled = false;
  currentStage = STAGE_OFF;
  stageStepIndex = 0;
  currentRawDuty = 0;
  currentOutputDuty = 0;
  kickstartActive = false;
  setMotorDuty(0);
  emitTelemetry(STAGE_OFF, 0, cycleStartMs);
  emitState();
}

void processCommand(const String& line) {
  if (line == "RUN") {
    startPattern();
    Serial.println("ACK,RUN");
    return;
  }

  if (line == "STOP") {
    stopPattern();
    Serial.println("ACK,STOP");
    return;
  }

  if (line.startsWith("SCALE,")) {
    const int value = line.substring(6).toInt();
    if (value >= SCALE_MIN && value <= SCALE_MAX) {
      intensityScalePct = static_cast<uint8_t>(value);
      emitState();
      applyOutputAndEmit(currentStage, currentRawDuty);
      Serial.printf("ACK,SCALE,%u\n", static_cast<unsigned>(intensityScalePct));
    } else {
      Serial.println("ERR,SCALE");
    }
    return;
  }

  if (line.startsWith("HOLDMS,")) {
    const int value = line.substring(7).toInt();
    if (value >= HOLD_TIME_MIN_MS && value <= HOLD_TIME_MAX_MS) {
      holdTimeMs = static_cast<uint16_t>(value);
      emitState();
      Serial.printf("ACK,HOLDMS,%u\n", static_cast<unsigned>(holdTimeMs));
    } else {
      Serial.println("ERR,HOLDMS");
    }
    return;
  }

  if (line == "STATE?") {
    emitState();
    Serial.println("ACK,STATE");
    return;
  }

  Serial.println("ERR,UNKNOWN_CMD");
}

void pollSerialCommands() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());

    if (c == '\n' || c == '\r') {
      if (!serialLine.isEmpty()) {
        processCommand(serialLine);
        serialLine = "";
      }
      continue;
    }

    serialLine += c;
  }
}

void updatePatternTick() {
  const uint32_t now = millis();

  if (!motorEnabled) {
    if (now - lastIdleTelemetryMs >= IDLE_TELEMETRY_MS) {
      lastIdleTelemetryMs = now;
      emitTelemetry(STAGE_OFF, 0, cycleStartMs);
    }
    return;
  }

  if (now < nextTickMs) {
    return;
  }

  switch (currentStage) {
    case STAGE_RAMP_UP: {
      const uint16_t rawDuty = min<uint16_t>(DUTY_MAX, stageStepIndex * DUTY_STEP);
      applyOutputAndEmit(STAGE_RAMP_UP, rawDuty);

      stageStepIndex++;
      if (stageStepIndex >= RAMP_STEPS) {
        currentStage = STAGE_HOLD;
        stageStepIndex = 0;
        stageStartMs = now;
      }
      break;
    }

    case STAGE_HOLD: {
      applyOutputAndEmit(STAGE_HOLD, DUTY_MAX);
      if (now - stageStartMs >= holdTimeMs) {
        currentStage = STAGE_RAMP_DOWN;
        stageStepIndex = 0;
        stageStartMs = now;
      }
      break;
    }

    case STAGE_RAMP_DOWN: {
      const uint16_t down = min<uint16_t>(DUTY_MAX, stageStepIndex * DUTY_STEP);
      const uint16_t rawDuty = DUTY_MAX - down;
      applyOutputAndEmit(STAGE_RAMP_DOWN, rawDuty);

      stageStepIndex++;
      if (stageStepIndex >= RAMP_STEPS) {
        currentStage = STAGE_OFF;
        stageStepIndex = 0;
        stageStartMs = now;
      }
      break;
    }

    case STAGE_OFF:
    default: {
      applyOutputAndEmit(STAGE_OFF, 0);
      if (now - stageStartMs >= getOffTimeMs()) {
        currentStage = STAGE_RAMP_UP;
        stageStepIndex = 0;
        cycleStartMs = now;
        stageStartMs = now;
      }
      break;
    }
  }

  nextTickMs = now + STEP_DELAY_MS;
}

void setup() {
  Serial.begin(115200);
  delay(500);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(VIBRO_PIN, PWM_FREQ_HZ, PWM_RES_BITS);
#else
  ledcSetup(PWM_CHANNEL, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcAttachPin(VIBRO_PIN, PWM_CHANNEL);
#endif

  serialLine.reserve(64);
  setMotorDuty(0);
  Serial.println("Vibro motor command mode start");
  Serial.println("CMD: RUN | STOP | SCALE,0..100 | HOLDMS,0..2000 | STATE?");
  emitState();
}

void loop() {
  pollSerialCommands();
  updatePatternTick();
}
