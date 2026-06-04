# OLED spec
- 128x64 pixel (0.96 inch)
- I2C

# p5.js Web Editor sketch [https://editor.p5js.org/yun_choi/sketches/zjzcGkg__ ](https://editor.p5js.org/yun_choi/sketches/zjzcGkg__)

1. `web-p5-editor/sketch.js` 전체를 p5.js Web Editor의 `sketch.js`에 붙여넣기
2. 보드에 업로드 후 BLE 광고 이름 `ESP32S3-OLED` 확인
3. p5.js 실행 후 `BLE Connect` 버튼 클릭
4. 브라우저 디바이스 선택 창에서 `ESP32S3-OLED` 선택
5. 마우스로 그리면 OLED에 실시간 반영
6. `Pencil` / `Eraser` 버튼으로 도구 선택
7. 슬라이더로 `Pencil` / `Eraser` 굵기 조절
8. `Clear` 버튼으로 웹 캔버스와 OLED 모두 지우기

## Animation Creator

1. `< Prev` / `Next >` : 프레임 이동
2. `+ Frame` : 빈 프레임 추가
3. `Duplicate` : 현재 프레임 복제
4. `Delete` : 현재 프레임 삭제
5. `Play` / `Stop` : 웹에서 프리뷰 재생
6. `FPS` 슬라이더로 재생 속도 조절
7. `Upload Anim` : BLE로 프레임 업로드 후 OLED에서 자동 재생
8. 최대 프레임 수: 80
9. `Export GIF` : 현재 프레임 시퀀스를 GIF로 다운로드
10. `Import File` : PC에 있는 이미지/GIF 파일을 프레임으로 불러오기

## Local File Import

1. `Import File` 클릭
2. PNG/JPG/BMP/GIF 파일 선택
3. 이미지: 1프레임으로 변환
4. GIF: 최대 80프레임까지 자동 변환
5. 변환 후 바로 편집/업로드 가능

## 프로토콜
- `C` : clear
- `P,x,y,color,size` : 1 pixel/brush dot (`color`: `1`=draw, `0`=erase)
- `L,x0,y0,x1,y1,color,size` : line (`color`: `1`=draw, `0`=erase)

## Animation BLE Protocol
- `ANM,CLR`
- `ANM,CFG,fps,frameCount`
- Binary chunk packet (fast path): `[0xA5, frameIndex, seq, payloadLen, ...payload]`
- `ANM,FEND,frameIndex`
- `ANM,DONE`
- `ANM,PLAY`
- `ANM,STOP`

## Web Bluetooth 주의사항
- Chrome/Edge 권장 (HTTPS 환경 필요)
- p5.js Web Editor는 HTTPS라서 사용 가능
