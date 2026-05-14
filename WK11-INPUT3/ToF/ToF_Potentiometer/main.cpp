#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_VL53L0X.h>

#ifndef A1
#define A1 2
#endif

#ifndef D2
#define D2 4
#endif

Adafruit_VL53L0X lox;

const int POT_PIN = A1;
const int SPEAKER_PIN = D2;
const int PWM_CHANNEL = 0;
const int PWM_RESOLUTION = 8;

const int POT_MIN = 0;
const int POT_MAX = 4095;
const int DIST_MIN_MM = 40;
const int DIST_MAX_MM = 600;
const float OUTPUT_MIN_HZ = 90.0f;
const float OUTPUT_MAX_HZ = 2600.0f;
const float POT_SMOOTHING = 0.12f;
const float DIST_SMOOTHING = 0.18f;

float smoothedPot = 0.0f;
float smoothedDistance = 250.0f;
uint16_t lastDistanceMm = 250;

float midiToFrequency(float midiNote) {
  return 440.0f * powf(2.0f, (midiNote - 69.0f) / 12.0f);
}

float mapFloat(float x, float inMin, float inMax, float outMin, float outMax) {
  if (inMax == inMin) {
    return outMin;
  }
  return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

uint16_t readDistanceMm() {
  VL53L0X_RangingMeasurementData_t measure;
  lox.rangingTest(&measure, false);

  if (measure.RangeStatus != 4) {
    lastDistanceMm = measure.RangeMilliMeter;
  }

  return lastDistanceMm;
}

float computeFrequencyHz(int potRaw, uint16_t distanceMm) {
  smoothedPot += (potRaw - smoothedPot) * POT_SMOOTHING;
  smoothedDistance += (distanceMm - smoothedDistance) * DIST_SMOOTHING;

  float constrainedPot = constrain(smoothedPot, POT_MIN, POT_MAX);
  float constrainedDistance = constrain(smoothedDistance, DIST_MIN_MM, DIST_MAX_MM);

  // Potentiometer controls the base pitch across three octaves.
  float baseMidi = mapFloat(constrainedPot, POT_MIN, POT_MAX, 48.0f, 84.0f);
  float baseFrequency = midiToFrequency(baseMidi);

  // Distance sensor adds a continuous multiplier to the base pitch.
  // Hand close = brighter / higher, hand far = darker / lower.
  float distanceRatio = mapFloat(constrainedDistance, DIST_MIN_MM, DIST_MAX_MM, 1.85f, 0.55f);
  float finalFrequency = baseFrequency * distanceRatio;

  return constrain(finalFrequency, OUTPUT_MIN_HZ, OUTPUT_MAX_HZ);
}

void setupAudioOutput() {
  ledcSetup(PWM_CHANNEL, 1000, PWM_RESOLUTION);
  ledcAttachPin(SPEAKER_PIN, PWM_CHANNEL);
  ledcWrite(PWM_CHANNEL, 127);
}

void setup() {
  Serial.begin(115200);
  delay(500);

  analogReadResolution(12);
  pinMode(POT_PIN, INPUT);

  Wire.begin();
  if (!lox.begin()) {
    Serial.println("VL53L0X init failed");
    while (true) {
      delay(10);
    }
  }

  setupAudioOutput();

  Serial.println("Pot + ToF instrument ready");
  Serial.println("Potentiometer on A1, passive buzzer on D2, VL53L0X on I2C");
}

void loop() {
  int potRaw = analogRead(POT_PIN);
  uint16_t distanceMm = readDistanceMm();
  float frequencyHz = computeFrequencyHz(potRaw, distanceMm);

  ledcWriteTone(PWM_CHANNEL, frequencyHz);

  Serial.print("distance_mm=");
  Serial.print(distanceMm);
  Serial.print(", pot=");
  Serial.print(potRaw);
  Serial.print(", freq_hz=");
  Serial.println(frequencyHz, 1);

  delay(20);
}
