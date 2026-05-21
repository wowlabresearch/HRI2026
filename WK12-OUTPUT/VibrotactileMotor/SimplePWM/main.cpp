#include <Arduino.h>

constexpr int VIBRO_PIN = 1;

constexpr uint32_t PWM_FREQ_HZ = 20000;      // 20 kHz to reduce audible noise
constexpr uint8_t PWM_RES_BITS = 8;          // Duty range: 0~255
constexpr uint16_t DUTY_MAX = (1 << PWM_RES_BITS) - 1;

#if ESP_ARDUINO_VERSION_MAJOR < 3
constexpr int PWM_CHANNEL = 0;
#endif

void setMotorDuty(uint16_t duty) {
  duty = min<uint16_t>(duty, DUTY_MAX);

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(VIBRO_PIN, duty);
#else
  ledcWrite(PWM_CHANNEL, duty);
#endif
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

  setMotorDuty(0);
  Serial.println("Vibro motor PWM test start");
}

void loop() {
  // 1) Ramp up: 0% -> 100%
  for (uint16_t duty = 0; duty <= DUTY_MAX; duty += 5) {
    setMotorDuty(duty);
    delay(30);
  }

  // 2) Hold full power
  delay(500);

  // 3) Ramp down: 100% -> 0%
  for (int duty = DUTY_MAX; duty >= 0; duty -= 5) {
    setMotorDuty(static_cast<uint16_t>(duty));
    delay(30);
  }

  // 4) Off interval
  setMotorDuty(0);
  delay(1000);
}
