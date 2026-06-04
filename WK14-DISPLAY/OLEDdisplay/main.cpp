#include <Arduino.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <string.h>

// ===== OLED =====
static const uint8_t SCREEN_WIDTH = 128;
static const uint8_t SCREEN_HEIGHT = 64;
static const uint8_t OLED_ADDR = 0x3C;
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ===== BLE =====
static const char* BLE_DEVICE_NAME = "ESP32S3-OLED";
static const char* SERVICE_UUID = "6f16e82a-8df5-4210-9115-9b7c8d7f1001";
static const char* COMMAND_CHAR_UUID = "6f16e82a-8df5-4210-9115-9b7c8d7f1002";

bool displayDirty = false;
unsigned long lastRefreshMs = 0;
bool isBleConnected = false;

static const int FRAME_BYTES = (SCREEN_WIDTH * SCREEN_HEIGHT) / 8;
static const int MAX_ANIM_FRAMES = 80;
static const uint8_t BIN_PKT_MARKER = 0xA5;
static const int BIN_CHUNK_BYTES = 16;
uint8_t animFrames[MAX_ANIM_FRAMES][FRAME_BYTES];
int animFrameCount = 0;
int animFps = 8;
bool animPlaying = false;
int animCurrentFrame = 0;
unsigned long animLastMs = 0;

int parseIntToken(char* token) {
  if (token == nullptr) {
    return 0;
  }
  return atoi(token);
}

void handleBinaryFrameChunk(const uint8_t* data, size_t length) {
  // Binary packet format:
  // [0]=0xA5, [1]=frameIndex, [2]=seq, [3]=payloadLen, [4..]=payload
  if (length < 5 || data[0] != BIN_PKT_MARKER) {
    return;
  }

  int frameIndex = static_cast<int>(data[1]);
  int seq = static_cast<int>(data[2]);
  int payloadLen = static_cast<int>(data[3]);

  if (frameIndex < 0 || frameIndex >= animFrameCount || seq < 0 || payloadLen < 0) {
    return;
  }

  if (payloadLen > static_cast<int>(length) - 4) {
    payloadLen = static_cast<int>(length) - 4;
  }

  int offset = seq * BIN_CHUNK_BYTES;
  if (offset >= FRAME_BYTES) {
    return;
  }

  int copyLen = payloadLen;
  if (copyLen > FRAME_BYTES - offset) {
    copyLen = FRAME_BYTES - offset;
  }

  memcpy(&animFrames[frameIndex][offset], &data[4], static_cast<size_t>(copyLen));
}
int parseIntTokenOr(char* token, int defaultValue) {
  if (token == nullptr) {
    return defaultValue;
  }
  return atoi(token);
}

void markDirty() {
  displayDirty = true;
}

int fromHexNibble(char c) {
  if (c >= '0' && c <= '9') {
    return c - '0';
  }
  if (c >= 'a' && c <= 'f') {
    return 10 + (c - 'a');
  }
  if (c >= 'A' && c <= 'F') {
    return 10 + (c - 'A');
  }
  return -1;
}

void renderFrameBufferToDisplay(const uint8_t* frame) {
  display.clearDisplay();
  for (int y = 0; y < SCREEN_HEIGHT; ++y) {
    for (int xb = 0; xb < SCREEN_WIDTH / 8; ++xb) {
      uint8_t packed = frame[y * (SCREEN_WIDTH / 8) + xb];
      if (packed == 0) {
        continue;
      }
      for (int bit = 0; bit < 8; ++bit) {
        if (packed & (1 << (7 - bit))) {
          int x = xb * 8 + bit;
          display.drawPixel(x, y, SSD1306_WHITE);
        }
      }
    }
  }
  markDirty();
}

void drawConnectionBanner(const char* text) {
  display.fillRect(0, 0, SCREEN_WIDTH, 8, SSD1306_BLACK);
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print(text);
  markDirty();
}

void drawBrushPoint(int x, int y, uint16_t color, int size) {
  int radius = size - 1;
  if (radius < 0) {
    radius = 0;
  }

  for (int dy = -radius; dy <= radius; ++dy) {
    for (int dx = -radius; dx <= radius; ++dx) {
      if (dx * dx + dy * dy > radius * radius) {
        continue;
      }
      int px = x + dx;
      int py = y + dy;
      if (px >= 0 && px < SCREEN_WIDTH && py >= 0 && py < SCREEN_HEIGHT) {
        display.drawPixel(px, py, color);
      }
    }
  }
}

void drawThickLine(int x0, int y0, int x1, int y1, uint16_t color, int size) {
  int dx = abs(x1 - x0);
  int sx = x0 < x1 ? 1 : -1;
  int dy = -abs(y1 - y0);
  int sy = y0 < y1 ? 1 : -1;
  int err = dx + dy;

  while (true) {
    drawBrushPoint(x0, y0, color, size);
    if (x0 == x1 && y0 == y1) {
      break;
    }
    int e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

void handleAnimationCommand(char* cmd) {
  // Protocol:
  // ANM,CLR
  // ANM,CFG,fps,count
  // ANM,FRM,frameIndex,seq,hexChunk
  // ANM,FEND,frameIndex
  // ANM,DONE
  // ANM,PLAY
  // ANM,STOP
  char* action = strtok(nullptr, ",");
  if (action == nullptr) {
    return;
  }

  if (strcmp(action, "CLR") == 0) {
    animFrameCount = 0;
    animCurrentFrame = 0;
    animPlaying = false;
    memset(animFrames, 0, sizeof(animFrames));
    Serial.println("[ANM] cleared");
    return;
  }

  if (strcmp(action, "CFG") == 0) {
    int fps = parseIntTokenOr(strtok(nullptr, ","), 8);
    int count = parseIntTokenOr(strtok(nullptr, ","), 1);

    if (fps < 1) fps = 1;
    if (fps > 30) fps = 30;
    if (count < 1) count = 1;
    if (count > MAX_ANIM_FRAMES) count = MAX_ANIM_FRAMES;

    animFps = fps;
    animFrameCount = count;
    animCurrentFrame = 0;
    animPlaying = false;
    memset(animFrames, 0, sizeof(animFrames));

    Serial.printf("[ANM] config fps=%d frames=%d\n", animFps, animFrameCount);
    return;
  }

  if (strcmp(action, "FRM") == 0) {
    int frameIndex = parseIntTokenOr(strtok(nullptr, ","), -1);
    int seq = parseIntTokenOr(strtok(nullptr, ","), -1);
    char* hex = strtok(nullptr, ",");

    if (frameIndex < 0 || frameIndex >= animFrameCount || seq < 0 || hex == nullptr) {
      return;
    }

    int offset = seq * 24;
    int hexLen = strlen(hex);
    int bytes = hexLen / 2;
    for (int i = 0; i < bytes; ++i) {
      int hi = fromHexNibble(hex[i * 2]);
      int lo = fromHexNibble(hex[i * 2 + 1]);
      if (hi < 0 || lo < 0) {
        return;
      }

      int dst = offset + i;
      if (dst < FRAME_BYTES) {
        animFrames[frameIndex][dst] = static_cast<uint8_t>((hi << 4) | lo);
      }
    }
    return;
  }

  if (strcmp(action, "FEND") == 0) {
    return;
  }

  if (strcmp(action, "DONE") == 0) {
    if (animFrameCount > 0) {
      renderFrameBufferToDisplay(animFrames[0]);
    }
    Serial.println("[ANM] upload done");
    return;
  }

  if (strcmp(action, "PLAY") == 0) {
    if (animFrameCount > 0) {
      animPlaying = true;
      animCurrentFrame = 0;
      animLastMs = millis();
      renderFrameBufferToDisplay(animFrames[0]);
      Serial.println("[ANM] play");
    }
    return;
  }

  if (strcmp(action, "STOP") == 0) {
    animPlaying = false;
    Serial.println("[ANM] stop");
    return;
  }
}

void handleDrawCommand(char* payload) {
  // Protocol:
  // C | P,x,y[,color,size] | L,x0,y0,x1,y1[,color,size]
  // ANM,... for animation upload/playback
  char* cmd = strtok(payload, ",");
  if (cmd == nullptr) {
    return;
  }

  if (strcmp(cmd, "ANM") == 0) {
    handleAnimationCommand(cmd);
    return;
  }

  if (cmd[0] == 'C') {
    display.clearDisplay();
    markDirty();
    return;
  }

  if (cmd[0] == 'P') {
    int x = parseIntToken(strtok(nullptr, ","));
    int y = parseIntToken(strtok(nullptr, ","));
    int color = parseIntTokenOr(strtok(nullptr, ","), 1);
    int size = parseIntTokenOr(strtok(nullptr, ","), 1);
    if (size < 1) {
      size = 1;
    }
    uint16_t pixelColor = (color == 0) ? SSD1306_BLACK : SSD1306_WHITE;
    if (x >= 0 && x < SCREEN_WIDTH && y >= 0 && y < SCREEN_HEIGHT) {
      drawBrushPoint(x, y, pixelColor, size);
      markDirty();
    }
    return;
  }

  if (cmd[0] == 'L') {
    int x0 = parseIntToken(strtok(nullptr, ","));
    int y0 = parseIntToken(strtok(nullptr, ","));
    int x1 = parseIntToken(strtok(nullptr, ","));
    int y1 = parseIntToken(strtok(nullptr, ","));
    int color = parseIntTokenOr(strtok(nullptr, ","), 1);
    int size = parseIntTokenOr(strtok(nullptr, ","), 1);
    if (size < 1) {
      size = 1;
    }
    uint16_t lineColor = (color == 0) ? SSD1306_BLACK : SSD1306_WHITE;
    drawThickLine(x0, y0, x1, y1, lineColor, size);
    markDirty();
    return;
  }
}

class ServerCallback : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    (void)server;
    isBleConnected = true;
    Serial.println("[BLE] Client connected");
    drawConnectionBanner("connected");
  }

  void onDisconnect(BLEServer* server) override {
    isBleConnected = false;
    Serial.println("[BLE] Client disconnected");
    drawConnectionBanner("waiting...");
    server->getAdvertising()->start();
  }
};

class CommandCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    std::string value = characteristic->getValue();
    if (value.empty()) {
      return;
    }

    const uint8_t* raw = reinterpret_cast<const uint8_t*>(value.data());
    if (raw[0] == BIN_PKT_MARKER) {
      handleBinaryFrameChunk(raw, value.size());
      return;
    }

    char buffer[80];
    size_t copyLen = value.size();
    if (copyLen > sizeof(buffer) - 1) {
      copyLen = sizeof(buffer) - 1;
    }
    memcpy(buffer, value.data(), copyLen);
    buffer[copyLen] = '\0';
    handleDrawCommand(buffer);
  }
};

void setupBle() {
  BLEDevice::init(BLE_DEVICE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallback());
  BLEService* service = server->createService(SERVICE_UUID);

  BLECharacteristic* cmdChar = service->createCharacteristic(
      COMMAND_CHAR_UUID,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);

  cmdChar->setCallbacks(new CommandCallback());
  cmdChar->addDescriptor(new BLE2902());

  service->start();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising started");
}

void setup() {
  Serial.begin(115200);
  delay(300);

  Wire.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("[OLED] SSD1306 init failed");
    while (true) {
      delay(1000);
    }
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("OLED ready");
  display.println("BLE waiting...");
  display.display();

  setupBle();
}

void loop() {
  if (animPlaying && animFrameCount > 0) {
    unsigned long interval = 1000UL / static_cast<unsigned long>(animFps);
    if (interval < 20) {
      interval = 20;
    }
    if (millis() - animLastMs >= interval) {
      animCurrentFrame = (animCurrentFrame + 1) % animFrameCount;
      renderFrameBufferToDisplay(animFrames[animCurrentFrame]);
      animLastMs = millis();
    }
  }

  // Limit OLED refresh rate to keep drawing responsive under frequent messages.
  if (displayDirty && millis() - lastRefreshMs >= 33) {
    display.display();
    lastRefreshMs = millis();
    displayDirty = false;
  }
}
