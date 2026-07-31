#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SDI 7
#define CLK 6
#define LE  10
#define OE  20

#define PWM_FREQ 5000
#define PWM_RES  8

// Custom UUIDs
#define SERVICE_UUID        "12345678-1234-1234-1234-1234567890ab"
#define BRIGHTNESS_UUID     "abcd1234-1234-1234-1234-abcdef123456"

// Idle brightness — the board holds 10% whenever it is on and no test is running.
#define IDLE_BRIGHTNESS 26  // 10% of 255

int brightnessValue = IDLE_BRIGHTNESS; // 0 = off, 255 = full brightness

void setBrightness(int value) {
  value = constrain(value, 0, 255);
  brightnessValue = value;

  // TLC5917 OE is active LOW, so invert user brightness
  int oePWM = 255 - value;
  ledcWrite(OE, oePWM);

  Serial.print("Brightness set to: ");
  Serial.println(value);
}

// Connection fix: without this, the ESP32 stops advertising after the
// first client disconnects and can never be found again until power-cycle.
class ServerCallback : public BLEServerCallbacks {
  void onConnect(BLEServer *pServer) {
    Serial.println("BLE client connected");
  }
  void onDisconnect(BLEServer *pServer) {
    Serial.println("BLE client disconnected, restarting advertising");
    // Return to idle brightness so the board never sticks at a stimulus level.
    setBrightness(IDLE_BRIGHTNESS);
    pServer->getAdvertising()->start();
  }
};

class BrightnessCallback : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String rxValue = pCharacteristic->getValue();

    if (rxValue.length() == 0) return;

    int value;

    // If app sends one raw byte: 0-255
    if (rxValue.length() == 1 && !isDigit(rxValue[0])) {
      value = (uint8_t)rxValue[0];
    }
    // If app sends text like "100"
    else {
      value = rxValue.toInt();
    }

    if (value >= 0 && value <= 255) {
      setBrightness(value);

      Serial.print("BLE received: ");
      Serial.println(value);
    } else {
      Serial.println("Invalid BLE value");
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(SDI, OUTPUT);
  pinMode(CLK, OUTPUT);
  pinMode(LE, OUTPUT);

  ledcAttach(OE, PWM_FREQ, PWM_RES);

  // Start OFF
  ledcWrite(OE, 255);

  // Turn ON OUT0 on TLC5917
  digitalWrite(LE, LOW);
  shiftOut(SDI, CLK, MSBFIRST, 0b00001110);
  digitalWrite(LE, HIGH);
  delayMicroseconds(1);
  digitalWrite(LE, LOW);

  // BLE setup
  BLEDevice::init("ESP32C3_LED_Control");

  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallback());
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // WRITE_NR (write without response) lets the app hit the 0.1s stimulus
  // window without waiting a full connection interval for the ACK.
  BLECharacteristic *pBrightnessCharacteristic = pService->createCharacteristic(
    BRIGHTNESS_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );

  pBrightnessCharacteristic->setCallbacks(new BrightnessCallback());

  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->start();

  Serial.println("BLE LED controller ready.");
  Serial.println("Connect to ESP32C3_LED_Control and write 0-255.");

  // Default brightness — 10% at power-on
  setBrightness(IDLE_BRIGHTNESS);
}

void loop() {
  // Nothing needed here
}
