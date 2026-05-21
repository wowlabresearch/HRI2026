# p5.js Stepper Control Panel (ULN2003)

Use this in p5.js Web Editor to control the ESP32S3 stepper firmware.

## Files
- sketch.js
- style.css

## Firmware Commands
- RUN,FWD,<1..18>
- RUN,REV,<1..18>
- STOP
- RPM,<1..18>
- STEP,<count>,<FWD|REV>,<1..18>
- STATE?

## Use in p5.js Web Editor
(OR, you can directly access to: https://editor.p5js.org/yun_choi/sketches/RMbdKf1va)
1. Open https://editor.p5js.org
2. Create a new sketch.
3. Paste sketch.js content.
4. Paste style.css content in style tab.
5. Run.
6. Click Connect Serial and choose ESP32 serial port.

## Note
Close PlatformIO serial monitor before using Web Serial in browser.
