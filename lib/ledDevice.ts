// Shared BLE LED stimulus device (ESP32C3 + TLC5917) — one app-wide
// connection used by both the session PLR protocol and the standalone
// PLR LED tool. The connection survives screen changes; nobody destroys
// the manager so an operator can connect once and run multiple sessions.

import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, ScanMode, State, type Characteristic, type Device } from 'react-native-ble-plx';

export const LED_DEVICE_NAME = 'ESP32C3_LED_Control';
const SERVICE_UUID = '12345678-1234-1234-1234-1234567890ab';
const CHAR_UUID = 'abcd1234-1234-1234-1234-abcdef123456';
const SCAN_TIMEOUT_MS = 10000;

// PLR stimulus brightness levels, 0–255.
export const LED_BASELINE_LEVEL = 15; // 6%
export const LED_STIMULUS_LEVEL = 102; // 40%
export const LED_OFF = 0;

let manager: BleManager | null = null;
let device: Device | null = null;
let characteristic: Characteristic | null = null;
let connectPromise: Promise<void> | null = null;
const listeners = new Set<(connected: boolean) => void>();

function getManager(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

function notify(connected: boolean) {
  listeners.forEach((l) => l(connected));
}

export function isLedConnected(): boolean {
  return characteristic != null;
}

// Subscribe to connect/disconnect changes. Returns the unsubscribe fn.
export function onLedConnectionChange(cb: (connected: boolean) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// The firmware parses brightness as TEXT (toInt()), so values are sent as
// utf8 digits. ble-plx wants base64 payloads; Hermes has no btoa, encode here.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function asciiToBase64(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i);
    const b = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
    const c = i + 2 < text.length ? text.charCodeAt(i + 2) : -1;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)];
    out += b < 0 ? '=' : B64[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)];
    out += c < 0 ? '=' : B64[c & 63];
  }
  return out;
}

// Android 12+ needs runtime BLUETOOTH_SCAN/CONNECT; older Android needs
// location for BLE scans. iOS prompts by itself via the plist string.
async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if ((Platform.Version as number) >= 31) {
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(res).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

function scanForDevice(): Promise<Device> {
  return new Promise((resolve, reject) => {
    const m = getManager();
    const timeout = setTimeout(() => {
      m.stopDeviceScan();
      reject(new Error(`${LED_DEVICE_NAME} not found within ${SCAN_TIMEOUT_MS / 1000}s`));
    }, SCAN_TIMEOUT_MS);
    // Match localName too: Android wipes its GAP name cache when Bluetooth
    // is toggled off/on, after which `name` is null and the device name only
    // appears in the advertisement's localName.
    m.startDeviceScan(null, { scanMode: ScanMode.LowLatency }, (error, found) => {
      if (error) {
        clearTimeout(timeout);
        m.stopDeviceScan();
        reject(error);
        return;
      }
      if (found?.name === LED_DEVICE_NAME || found?.localName === LED_DEVICE_NAME) {
        clearTimeout(timeout);
        m.stopDeviceScan();
        resolve(found);
      }
    });
  });
}

// Scanning right after the adapter turns on (or during a BT restart) errors
// out; wait for PoweredOn instead of failing the whole attempt.
function waitForPoweredOn(timeoutMs = 5000): Promise<void> {
  const m = getManager();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('Bluetooth is turned off'));
    }, timeoutMs);
    const sub = m.onStateChange((s) => {
      if (s === State.PoweredOn) {
        clearTimeout(timer);
        sub.remove();
        resolve();
      }
    }, true);
  });
}

// Scan → connect → discover the brightness characteristic. Resolves when the
// LED is controllable; throws with a readable message otherwise. Concurrent
// calls share one attempt.
export function connectLed(): Promise<void> {
  if (isLedConnected()) return Promise.resolve();
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    if (!(await requestBlePermissions())) throw new Error('Bluetooth permission denied');
    await waitForPoweredOn();
    const found = await scanForDevice();
    // refreshGatt: Android caches the peripheral's GATT table across
    // connections; after a firmware update the cached handles go stale and
    // writes silently land on the wrong attribute (lamp stops responding
    // even though every write reports success).
    const dev = await found.connect({ refreshGatt: 'OnConnected' });
    device = dev;
    dev.onDisconnected((error) => {
      console.warn(`[LED] disconnected${error ? `: ${error.message}` : ''}`);
      characteristic = null;
      device = null;
      notify(false);
    });
    await dev.discoverAllServicesAndCharacteristics();
    const chars = await dev.characteristicsForService(SERVICE_UUID);
    const c = chars.find((ch) => ch.uuid.toLowerCase() === CHAR_UUID) ?? null;
    if (!c) {
      dev.cancelConnection().catch(() => {});
      device = null;
      throw new Error('Brightness characteristic not found on device');
    }
    characteristic = c;
    notify(true);
  })();
  return connectPromise.finally(() => {
    connectPromise = null;
  });
}

// Set LED brightness 0..255. No-op when not connected. Prefers
// write-without-response to keep the 0.1s stimulus timing tight.
// Logs every outcome — silent write failures froze the lamp mid-protocol
// once and were invisible without this.
export async function setLedLevel(value: number): Promise<void> {
  const c = characteristic;
  const level = Math.round(value);
  if (!c) {
    console.warn(`[LED] write ${level} skipped: not connected`);
    return;
  }
  const payload = asciiToBase64(String(level));
  try {
    if (c.isWritableWithoutResponse) await c.writeWithoutResponse(payload);
    else await c.writeWithResponse(payload);
    console.log(`[LED] wrote ${level}`);
  } catch (e) {
    console.warn(`[LED] write ${level} FAILED: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

export async function disconnectLed(): Promise<void> {
  const d = device;
  characteristic = null;
  device = null;
  if (d) await d.cancelConnection().catch(() => {});
  notify(false);
}

// --- Auto-connect -----------------------------------------------------------
// Keeps the LED linked for the app's whole lifetime: retries until the board
// is found, and reconnects automatically whenever the link drops. Manual
// connectLed() calls (Pre-Session button, PLR LED tool) still work — they
// share the same in-flight attempt via connectPromise.

const RETRY_DELAY_MS = 2000;
let autoStarted = false;
let autoLooping = false;

async function autoConnectLoop() {
  if (autoLooping) return;
  autoLooping = true;
  try {
    while (autoStarted && !isLedConnected()) {
      try {
        await connectLed();
        // Board idles at 10% whenever it is on — normalize after every (re)connect.
        await setLedLevel(LED_BASELINE_LEVEL).catch(() => {});
      } catch {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  } finally {
    autoLooping = false;
  }
}

export function startLedAutoConnect(): void {
  if (autoStarted || Platform.OS === 'web') return;
  autoStarted = true;
  onLedConnectionChange((connected) => {
    if (!connected) autoConnectLoop();
  });
  autoConnectLoop();
}
