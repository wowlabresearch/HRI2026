# p5.js Motor Control Panel

Simple control panel for DRV8833 motor firmware running on XIAO ESP32S3.

## Files
- sketch.js: Paste this into p5.js Web Editor sketch.
- style.css: Add this as the style tab in p5.js Web Editor.

## Firmware Command Format
- FWD,<0..100>
- REV,<0..100>
- BRAKE
- COAST
- STATE?

## Use in p5.js Web Editor
(You can directly open this control panel as well https://editor.p5js.org/yun_choi/sketches/ndlqV4leB)
1. Open https://editor.p5js.org
2. Create a new sketch.
3. Replace sketch.js content with this folder's sketch.js.
4. Create/edit style.css and paste this folder's style.css.
5. Run the sketch.
6. Click Connect Serial and choose your ESP32 COM port.
7. Use slider + buttons to control the motor.

## Notes
- Use Chrome or Edge (Web Serial supported).
- The board monitor in PlatformIO must be closed when using Web Serial.
- Firmware baud is 115200.
