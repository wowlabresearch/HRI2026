#include <Arduino.h>
#include <Wire.h>

namespace {
constexpr uint8_t MPU6500_ADDR = 0x68;
constexpr uint8_t REG_PWR_MGMT_1 = 0x6B;
constexpr uint8_t REG_ACCEL_CONFIG = 0x1C;
constexpr uint8_t REG_GYRO_CONFIG = 0x1B;
constexpr uint8_t REG_ACCEL_XOUT_H = 0x3B;

// +/-2g, +/-250 dps full scale settings
constexpr float ACCEL_SCALE = 16384.0f;
constexpr float GYRO_SCALE = 131.0f;

float angleRoll = 0.0f;
float anglePitch = 0.0f;
float angleYaw = 0.0f;
unsigned long lastMs = 0;
}

bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU6500_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool readBytes(uint8_t reg, uint8_t *buf, size_t len) {
  Wire.beginTransmission(MPU6500_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  const size_t readCount = Wire.requestFrom(static_cast<int>(MPU6500_ADDR), static_cast<int>(len), static_cast<int>(true));
  if (readCount != len) {
    return false;
  }

  for (size_t i = 0; i < len; ++i) {
    buf[i] = Wire.read();
  }
  return true;
}

bool initMPU6500() {
  delay(100);

  if (!writeRegister(REG_PWR_MGMT_1, 0x00)) {
    return false;
  }
  delay(50);

  if (!writeRegister(REG_ACCEL_CONFIG, 0x00)) {
    return false;
  }

  if (!writeRegister(REG_GYRO_CONFIG, 0x00)) {
    return false;
  }

  return true;
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin();

  Serial.println("MPU6500 init...");
  if (!initMPU6500()) {
    Serial.println("MPU6500 init failed. Check wiring and I2C address.");
    while (true) {
      delay(1000);
    }
  }

  lastMs = millis();
  Serial.println("MPU6500 ready");
}

void loop() {
  uint8_t raw[14] = {0};
  if (!readBytes(REG_ACCEL_XOUT_H, raw, sizeof(raw))) {
    Serial.println("Read error");
    delay(100);
    return;
  }

  const int16_t axRaw = (static_cast<int16_t>(raw[0]) << 8) | raw[1];
  const int16_t ayRaw = (static_cast<int16_t>(raw[2]) << 8) | raw[3];
  const int16_t azRaw = (static_cast<int16_t>(raw[4]) << 8) | raw[5];
  const int16_t gxRaw = (static_cast<int16_t>(raw[8]) << 8) | raw[9];
  const int16_t gyRaw = (static_cast<int16_t>(raw[10]) << 8) | raw[11];
  const int16_t gzRaw = (static_cast<int16_t>(raw[12]) << 8) | raw[13];

  const float ax = static_cast<float>(axRaw) / ACCEL_SCALE;
  const float ay = static_cast<float>(ayRaw) / ACCEL_SCALE;
  const float az = static_cast<float>(azRaw) / ACCEL_SCALE;

  const float gx = static_cast<float>(gxRaw) / GYRO_SCALE;
  const float gy = static_cast<float>(gyRaw) / GYRO_SCALE;
  const float gz = static_cast<float>(gzRaw) / GYRO_SCALE;

  const unsigned long now = millis();
  const float dt = (now - lastMs) / 1000.0f;
  lastMs = now;

  const float rollAcc = atan2f(ay, az) * 180.0f / PI;
  const float pitchAcc = atan2f(-ax, sqrtf(ay * ay + az * az)) * 180.0f / PI;

  // Complementary filter: gyro short-term + accel long-term stability
  constexpr float alpha = 0.98f;
  angleRoll = alpha * (angleRoll + gx * dt) + (1.0f - alpha) * rollAcc;
  anglePitch = alpha * (anglePitch + gy * dt) + (1.0f - alpha) * pitchAcc;
  angleYaw += gz * dt;

  Serial.print("ACC[g] X:");
  Serial.print(ax, 3);
  Serial.print(" Y:");
  Serial.print(ay, 3);
  Serial.print(" Z:");
  Serial.print(az, 3);

  Serial.print(" | GYRO[dps] X:");
  Serial.print(gx, 2);
  Serial.print(" Y:");
  Serial.print(gy, 2);
  Serial.print(" Z:");
  Serial.print(gz, 2);

  Serial.print(" | ANGLE[deg] Roll:");
  Serial.print(angleRoll, 2);
  Serial.print(" Pitch:");
  Serial.print(anglePitch, 2);
  Serial.print(" Yaw:");
  Serial.println(angleYaw, 2);

  delay(100);
}
