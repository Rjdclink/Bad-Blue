import assert from 'node:assert/strict';
import {
  acquireConfiguredSpectraCameras,
  spectraPublicCameraAssetUrl,
} from '../server/services/spectra/SpectraCameraDirectoryAdapters';

assert.equal(spectraPublicCameraAssetUrl('https://cameras.example.org/still.jpg'),
  'https://cameras.example.org/still.jpg');
assert.equal(spectraPublicCameraAssetUrl('https://media.example.org/live.m3u8'),
  'https://media.example.org/live.m3u8');

for (const unsafe of [
  'http://cameras.example.org/insecure.jpg',
  'https://127.0.0.1/local.jpg',
  'https://[::1]/local.jpg',
  'https://[::ffff:7f00:1]/local.jpg',
  'https://[::ffff:192.168.1.7]/local.jpg',
  'https://localhost/image.jpg',
  'https://camera.internal/private.jpg',
  'https://camera.local/private.jpg',
  'https://username:password@cameras.example.org/photo.jpg',
  'https://cameras.example.org:8443/photo.jpg',
  'file:///etc/passwd', 'javascript:alert(1)', '',
]) assert.equal(spectraPublicCameraAssetUrl(unsafe), undefined, unsafe);

// Input guards run BEFORE parsing provider configuration or initiating HTTP.
assert.deepEqual(await acquireConfiguredSpectraCameras(Number.NaN, -95, 10), []);
assert.deepEqual(await acquireConfiguredSpectraCameras(100, -95, 10), []);
assert.deepEqual(await acquireConfiguredSpectraCameras(40, 181, 10), []);
assert.deepEqual(await acquireConfiguredSpectraCameras(40, -95, 0), []);
assert.deepEqual(await acquireConfiguredSpectraCameras(40, -95, Number.POSITIVE_INFINITY), []);

console.log('Spectra camera URLs: safe public HTTPS metadata, no local/internal assets, and bounded geospatial input.');
