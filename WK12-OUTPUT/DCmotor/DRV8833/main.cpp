#include <Arduino.h>

// DRV8833 Dual H-Bridge DC Motor Controller
//
// Wiring (single DC motor, channel A):
//   DRV8833 AIN1  ->  ESP32 GPIO2
//   DRV8833 AIN2  ->  ESP32 GPIO3
//   DRV8833 STBY  ->  3.3V  (always enabled; pull low to put driver to sleep)
//   DRV8833 VM    ->  motor supply voltage (2.7V – 10.8V)
//   DRV8833 GND   ->  common GND
//   DRV8833 AOUT1 ->  motor terminal 1
//   DRV8833 AOUT2 ->  motor terminal 2
//
// Drive truth table (IN1/IN2 → AOUT1/AOUT2):
//   0 / 0  → Hi-Z   (coast / free spin)
//   1 / 0  → H / L  (forward)
//   0 / 1  → L / H  (reverse)
//   1 / 1  → L / L  (fast decay brake)
//
// Serial commands (115200 baud):
//   FWD,<0..100>   – run forward at given speed percentage
//   REV,<0..100>   – run reverse at given speed percentage
//   BRAKE          – fast-decay brake
//   COAST          – hi-z coast (same as STOP)
//   STOP           – alias for COAST
//   STATE?         – report current state

// ──────────────────────────────────────────────────────────
// Pin / PWM constants
// ──────────────────────────────────────────────────────────
constexpr int MOTOR_IN1 = 2;  // AIN1 – controls AOUT1
constexpr int MOTOR_IN2 = 3;  // AIN2 – controls AOUT2

constexpr uint8_t PWM_CH_IN1 = 0;
constexpr uint8_t PWM_CH_IN2 = 1;

constexpr uint32_t PWM_FREQ_HZ  = 20000;  // 20 kHz: above audible range
constexpr uint8_t  PWM_RES_BITS = 8;      // duty range 0..255
constexpr uint16_t DUTY_MAX     = (1 << PWM_RES_BITS) - 1;

constexpr uint8_t SPEED_MIN = 0;
constexpr uint8_t SPEED_MAX = 100;
constexpr bool RUN_BOOT_SELF_TEST = true;

// ──────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────
enum MotorMode : uint8_t {
  MODE_COAST   = 0,
  MODE_FORWARD = 1,
  MODE_REVERSE = 2,
  MODE_BRAKE   = 3,
};

MotorMode currentMode     = MODE_COAST;
uint8_t   currentSpeedPct = 0;

String serialLine;

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
static inline uint16_t pctToDuty(uint8_t pct) {
  return static_cast<uint16_t>(
      static_cast<uint32_t>(pct) * DUTY_MAX / SPEED_MAX);
}

static const char* modeLabel() {
  switch (currentMode) {
    case MODE_FORWARD: return "FORWARD";
    case MODE_REVERSE: return "REVERSE";
    case MODE_BRAKE:   return "BRAKE";
    default:           return "COAST";
  }
}

// ──────────────────────────────────────────────────────────
// Motor drive functions
// ──────────────────────────────────────────────────────────
void motorCoast() {
  ledcWrite(PWM_CH_IN1, 0);
  ledcWrite(PWM_CH_IN2, 0);
  currentMode     = MODE_COAST;
  currentSpeedPct = 0;
}

void motorBrake() {
  ledcWrite(PWM_CH_IN1, DUTY_MAX);
  ledcWrite(PWM_CH_IN2, DUTY_MAX);
  currentMode     = MODE_BRAKE;
  currentSpeedPct = 0;
}

void motorForward(uint8_t speedPct) {
  speedPct = constrain(speedPct, SPEED_MIN, SPEED_MAX);
  ledcWrite(PWM_CH_IN1, pctToDuty(speedPct));
  ledcWrite(PWM_CH_IN2, 0);
  currentMode     = MODE_FORWARD;
  currentSpeedPct = speedPct;
}

void motorReverse(uint8_t speedPct) {
  speedPct = constrain(speedPct, SPEED_MIN, SPEED_MAX);
  ledcWrite(PWM_CH_IN1, 0);
  ledcWrite(PWM_CH_IN2, pctToDuty(speedPct));
  currentMode     = MODE_REVERSE;
  currentSpeedPct = speedPct;
}

// ──────────────────────────────────────────────────────────
// Serial telemetry
// ──────────────────────────────────────────────────────────
void emitState() {
  Serial.printf("STATE,%u,%u,%s\n",
      static_cast<unsigned>(currentMode),
      static_cast<unsigned>(currentSpeedPct),
      modeLabel());
}

// ──────────────────────────────────────────────────────────
// Command parser
// ──────────────────────────────────────────────────────────
void processCommand(const String& line) {
  if (line == "COAST" || line == "STOP") {
    motorCoast();
    emitState();
    Serial.println("ACK,COAST");
    return;
  }

  if (line == "BRAKE") {
    motorBrake();
    emitState();
    Serial.println("ACK,BRAKE");
    return;
  }

  if (line.startsWith("FWD,")) {
    const int spd = line.substring(4).toInt();
    if (spd >= SPEED_MIN && spd <= SPEED_MAX) {
      motorForward(static_cast<uint8_t>(spd));
      emitState();
      Serial.printf("ACK,FWD,%u\n", static_cast<unsigned>(currentSpeedPct));
    } else {
      Serial.println("ERR,FWD");
    }
    return;
  }

  if (line.startsWith("REV,")) {
    const int spd = line.substring(4).toInt();
    if (spd >= SPEED_MIN && spd <= SPEED_MAX) {
      motorReverse(static_cast<uint8_t>(spd));
      emitState();
      Serial.printf("ACK,REV,%u\n", static_cast<unsigned>(currentSpeedPct));
    } else {
      Serial.println("ERR,REV");
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

// ──────────────────────────────────────────────────────────
// Arduino entry points
// ──────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  ledcSetup(PWM_CH_IN1, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcSetup(PWM_CH_IN2, PWM_FREQ_HZ, PWM_RES_BITS);
  ledcAttachPin(MOTOR_IN1, PWM_CH_IN1);
  ledcAttachPin(MOTOR_IN2, PWM_CH_IN2);

  motorCoast();

  // Quick wiring sanity-check: motor should move even without serial commands.
  if (RUN_BOOT_SELF_TEST) {
    motorForward(60);
    delay(1200);
    motorCoast();
    delay(300);
    motorReverse(60);
    delay(1200);
    motorCoast();
  }

  serialLine.reserve(64);
  Serial.println("DRV8833 DC Motor Controller ready");
  Serial.println("CMD: FWD,<0..100> | REV,<0..100> | BRAKE | COAST | STATE?");
  emitState();
}

void loop() {
  pollSerialCommands();
}
