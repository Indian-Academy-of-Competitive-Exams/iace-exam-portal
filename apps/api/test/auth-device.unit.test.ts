import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Request } from 'express';
import { CLIENT_KINDS } from '@iace/contracts';
import { browserLabel, deviceFrom } from '../src/auth/device';

const requestWith = (headers: Record<string, string>): Request =>
  ({ headers, ip: '10.0.0.1' }) as unknown as Request;

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';

describe('browserLabel', () => {
  it('names the browser and the system, most specific first', () => {
    assert.equal(browserLabel(CHROME_MAC), 'Chrome on macOS');
    assert.equal(browserLabel(SAFARI_IPHONE), 'Safari on iOS');
    assert.equal(browserLabel(EDGE_WINDOWS), 'Edge on Windows');
    assert.equal(browserLabel(CHROME_ANDROID), 'Chrome on Android');
  });

  it('falls back to a plain name for what it cannot read', () => {
    assert.equal(browserLabel(null), 'A web browser');
    assert.equal(browserLabel('curl/8.0'), 'A web browser');
  });

  it('names the browsers that wear another engine', () => {
    assert.equal(
      browserLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
      ),
      'Chrome on iOS',
    );
    assert.equal(
      browserLabel(
        'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36',
      ),
      'Samsung Internet on Android',
    );
    assert.equal(
      browserLabel(
        'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 EdgA/140.0',
      ),
      'Edge on Android',
    );
  });
});

describe('deviceFrom', () => {
  it('reads the kind and the device name the app sends', () => {
    const device = deviceFrom(requestWith({ 'x-client': 'MOBILE', 'x-device-name': 'Pixel 8' }));
    assert.equal(device.client, CLIENT_KINDS.MOBILE);
    assert.equal(device.deviceName, 'Pixel 8');
  });

  it('labels a web session from its browser when no name is sent', () => {
    const device = deviceFrom(requestWith({ 'x-client': 'WEB', 'user-agent': CHROME_MAC }));
    assert.equal(device.deviceName, 'Chrome on macOS');
  });

  it('treats a missing or unknown kind as none', () => {
    assert.equal(deviceFrom(requestWith({})).client, null);
    assert.equal(deviceFrom(requestWith({ 'x-client': 'TOASTER' })).client, null);
  });
});
