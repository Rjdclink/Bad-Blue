/* LEXARA neural portrait worker.
 *
 * Audio/text never enter this worker as authorities. It consumes only the
 * already-derived embodiment controls. Latest-generation/latest-frame wins.
 */
'use strict';

const ORT_VERSION = '1.22.0';
const ORT_SCRIPT = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.webgpu.min.js`;
const ORT_WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const DISTILLED_MODEL_URL = 'https://huggingface.co/slperez/LP-Distilled0.1-ONNX/resolve/main/LP-Distilled0.1.onnx';
const APPEARANCE_MODEL_URL = 'https://huggingface.co/warmshao/FasterLivePortrait/resolve/main/liveportrait_onnx/appearance_feature_extractor.onnx';
const MODEL_CACHE = 'lexara-neural-avatar-models-v1';
const SIZE = 256;
const CROP = { x: 0.34, y: 0.14, width: 0.35, height: 0.35 };

let ortRuntime = null;
let appearanceSession = null;
let portraitSession = null;
let sourceTensor = null;
let appearanceTensor = null;
let currentGeneration = 0;
let currentTurnId = '';
let initializedImageUrl = '';
let busy = false;
let pendingControls = null;
let disposed = false;
let sequence = 0;
let averageInferenceMs = 0;
let inferenceSamples = 0;

function post(type, payload = {}, transfer = []) {
  self.postMessage({ type, ...payload }, transfer);
}

function bounded(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

async function cachedArrayBuffer(url) {
  let response = null;
  try {
    const cache = await caches.open(MODEL_CACHE);
    response = await cache.match(url);
    if (!response) {
      response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
      if (!response.ok) throw new Error(`model fetch failed ${response.status}: ${url}`);
      try {
        await cache.put(url, response.clone());
      } catch {
        // Cache quota failure must not disable inference.
      }
    }
  } catch (error) {
    if (!response) {
      response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
      if (!response.ok) throw new Error(`model fetch failed ${response.status}: ${url}`);
    }
  }
  return response.arrayBuffer();
}

function loadOrt() {
  if (ortRuntime) return ortRuntime;
  importScripts(ORT_SCRIPT);
  if (!self.ort) throw new Error('ONNX Runtime WebGPU runtime did not initialize');
  self.ort.env.wasm.wasmPaths = ORT_WASM_BASE;
  self.ort.env.wasm.numThreads = 1;
  self.ort.env.logLevel = 'warning';
  ortRuntime = self.ort;
  return ortRuntime;
}

async function createSession(modelBuffer, preferWebGpu = true) {
  const runtime = loadOrt();
  if (preferWebGpu && self.navigator && self.navigator.gpu) {
    try {
      return await runtime.InferenceSession.create(modelBuffer, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
      });
    } catch (error) {
      post('diagnostic', { stage: 'webgpu-session-fallback', message: String(error && error.message || error).slice(0, 180) });
    }
  }
  return runtime.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
}

function rgbaToChwFloat32(imageData) {
  const pixels = imageData.data;
  const plane = SIZE * SIZE;
  const data = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i += 1) {
    const p = i * 4;
    data[i] = pixels[p] / 255;
    data[plane + i] = pixels[p + 1] / 255;
    data[plane * 2 + i] = pixels[p + 2] / 255;
  }
  return data;
}

async function prepareSource(imageUrl) {
  const response = await fetch(imageUrl, { credentials: 'same-origin', cache: 'force-cache' });
  if (!response.ok) throw new Error(`LEXARA portrait fetch failed: ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error('OffscreenCanvas 2D unavailable');
    const sx = bitmap.width * CROP.x;
    const sy = bitmap.height * CROP.y;
    const sw = bitmap.width * CROP.width;
    const sh = bitmap.height * CROP.height;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, SIZE, SIZE);
    const data = rgbaToChwFloat32(ctx.getImageData(0, 0, SIZE, SIZE));
    sourceTensor = new ortRuntime.Tensor('float32', data, [1, 3, SIZE, SIZE]);
  } finally {
    bitmap.close();
  }
}

async function prepareAppearance() {
  const inputName = appearanceSession.inputNames.includes('img') ? 'img' : appearanceSession.inputNames[0];
  const outputName = appearanceSession.outputNames.includes('output') ? 'output' : appearanceSession.outputNames[0];
  const result = await appearanceSession.run({ [inputName]: sourceTensor });
  const output = result[outputName];
  if (!output || !output.data) throw new Error('appearance extractor returned no feature volume');
  appearanceTensor = new ortRuntime.Tensor(
    'float32',
    output.data instanceof Float32Array ? output.data : Float32Array.from(output.data),
    output.dims || [1, 32, 16, 64, 64],
  );
}

function controlsToExpression(frame) {
  const expression = new Float32Array(30);
  const mouthOpen = bounded(frame.mouthOpen, 0, 1);
  const mouthWide = bounded(frame.mouthWide, 0, 1);
  const mouthRound = bounded(frame.mouthRound, 0, 1);
  const blink = bounded(frame.blink, 0, 1);
  const brow = bounded(frame.browLift, -1, 1);
  const smile = bounded(frame.smile, -1, 1);

  // The distilled model exposes sparse LivePortrait keypoint deltas. Mouth
  // points are concentrated in kp17/kp19/kp20; eye/brow response uses the
  // kp11-kp16 group. Values remain well inside the documented [-1,1] contract.
  expression[21] = bounded(smile * 0.18 + mouthWide * 0.10, -0.32, 0.32);
  expression[22] = bounded(mouthOpen * 0.38, -0.45, 0.45);
  expression[24] = bounded(-mouthWide * 0.13 - smile * 0.11, -0.32, 0.32);
  expression[25] = bounded(-mouthOpen * 0.28 + mouthRound * 0.10, -0.42, 0.42);
  expression[27] = bounded(mouthWide * 0.13 + smile * 0.11, -0.32, 0.32);
  expression[28] = bounded(-mouthOpen * 0.28 + mouthRound * 0.10, -0.42, 0.42);

  expression[12] = bounded(-blink * 0.20 + brow * 0.08, -0.28, 0.28);
  expression[13] = bounded(blink * 0.24 + brow * 0.07, -0.28, 0.28);
  expression[14] = bounded(-blink * 0.17 + brow * 0.10, -0.28, 0.28);
  expression[15] = bounded(blink * 0.14, -0.22, 0.22);
  expression[16] = bounded(-blink * 0.16 + brow * 0.10, -0.28, 0.28);
  expression[17] = bounded(blink * 0.14, -0.22, 0.22);

  return expression;
}

function controlsToPose(frame) {
  const yaw = bounded(frame.headX * 0.34 + frame.gazeX * 0.10, -0.55, 0.55);
  const pitch = bounded(frame.headPitch * 0.24 + frame.headY * 0.08, -0.45, 0.45);
  const roll = bounded((frame.headRollDeg || 0) / 12, -0.28, 0.28);
  return new Float32Array([yaw, pitch, roll]);
}

function tensorToBitmap(tensor) {
  const data = tensor.data;
  const dims = tensor.dims || [1, 3, SIZE, SIZE];
  const height = Number(dims[dims.length - 2]) || SIZE;
  const width = Number(dims[dims.length - 1]) || SIZE;
  const plane = width * height;
  const rgba = new Uint8ClampedArray(plane * 4);

  let min = Infinity;
  let max = -Infinity;
  const sampleStride = Math.max(1, Math.floor(data.length / 2048));
  for (let i = 0; i < data.length; i += sampleStride) {
    const value = Number(data[i]);
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const signedRange = min < -0.05 && max <= 1.2;

  for (let i = 0; i < plane; i += 1) {
    const r0 = Number(data[i]);
    const g0 = Number(data[plane + i]);
    const b0 = Number(data[plane * 2 + i]);
    const normalize = value => {
      const unit = signedRange ? (value + 1) * 0.5 : value;
      return Math.round(Math.max(0, Math.min(1, unit)) * 255);
    };
    const p = i * 4;
    rgba[p] = normalize(r0);
    rgba[p + 1] = normalize(g0);
    rgba[p + 2] = normalize(b0);
    rgba[p + 3] = 255;
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas.transferToImageBitmap();
}

async function renderControls(request) {
  if (!portraitSession || !appearanceTensor || !sourceTensor) return;
  if (request.generation !== currentGeneration || request.turnId !== currentTurnId) return;

  const started = performance.now();
  const expression = controlsToExpression(request.frame || {});
  const pose = controlsToPose(request.frame || {});
  const feeds = {
    feature_3d: appearanceTensor,
    pose_control_vector: new ortRuntime.Tensor('float32', pose, [1, 3]),
    input_rgb: sourceTensor,
    expression_control_vector: new ortRuntime.Tensor('float32', expression, [1, 30]),
  };
  const result = await portraitSession.run(feeds);
  if (request.generation !== currentGeneration || request.turnId !== currentTurnId) return;
  const outputName = portraitSession.outputNames.includes('rgb') ? 'rgb' : portraitSession.outputNames[0];
  const output = result[outputName];
  if (!output) throw new Error('neural portrait model returned no rgb output');
  const bitmap = tensorToBitmap(output);
  const inferenceMs = performance.now() - started;
  inferenceSamples += 1;
  averageInferenceMs += (inferenceMs - averageInferenceMs) / inferenceSamples;
  sequence += 1;
  post('frame', {
    generation: request.generation,
    turnId: request.turnId,
    sequence,
    inferenceMs,
    averageInferenceMs,
    renderer: self.navigator && self.navigator.gpu ? 'onnx-webgpu' : 'onnx-wasm',
    bitmap,
  }, [bitmap]);
}

async function pump() {
  if (busy || disposed) return;
  busy = true;
  try {
    while (pendingControls && !disposed) {
      const request = pendingControls;
      pendingControls = null;
      try {
        await renderControls(request);
      } catch (error) {
        post('error', {
          stage: 'inference',
          generation: request.generation,
          turnId: request.turnId,
          message: String(error && error.message || error).slice(0, 240),
        });
        break;
      }
    }
  } finally {
    busy = false;
  }
}

async function initialize(message) {
  if (disposed) return;
  if (!(self.navigator && self.navigator.gpu)) {
    post('unavailable', { reason: 'webgpu_unavailable' });
    return;
  }
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
    post('unavailable', { reason: 'worker_canvas_unavailable' });
    return;
  }

  const imageUrl = String(message.imageUrl || '');
  if (portraitSession && appearanceSession && sourceTensor && initializedImageUrl === imageUrl) {
    post('ready', { renderer: 'onnx-webgpu', cached: true, crop: CROP });
    return;
  }

  post('status', { stage: 'loading-runtime' });
  loadOrt();
  post('status', { stage: 'loading-models' });
  const [appearanceBuffer, portraitBuffer] = await Promise.all([
    cachedArrayBuffer(APPEARANCE_MODEL_URL),
    cachedArrayBuffer(DISTILLED_MODEL_URL),
  ]);

  post('status', { stage: 'creating-sessions' });
  [appearanceSession, portraitSession] = await Promise.all([
    createSession(appearanceBuffer, true),
    createSession(portraitBuffer, true),
  ]);

  post('status', { stage: 'preparing-identity' });
  await prepareSource(imageUrl);
  await prepareAppearance();
  initializedImageUrl = imageUrl;
  post('ready', {
    renderer: 'onnx-webgpu',
    cached: false,
    crop: CROP,
    inputNames: portraitSession.inputNames,
    outputNames: portraitSession.outputNames,
  });
}

self.onmessage = event => {
  const message = event.data || {};
  if (message.type === 'init') {
    initialize(message).catch(error => {
      post('error', { stage: 'init', message: String(error && error.message || error).slice(0, 240) });
    });
    return;
  }
  if (message.type === 'generation') {
    const generation = Number(message.generation);
    if (!Number.isSafeInteger(generation) || generation < 0) return;
    if (generation < currentGeneration) return;
    currentGeneration = generation;
    currentTurnId = String(message.turnId || '');
    pendingControls = null;
    return;
  }
  if (message.type === 'render') {
    const generation = Number(message.generation);
    if (generation !== currentGeneration || String(message.turnId || '') !== currentTurnId) return;
    // Backpressure rule: one pending slot. New visual state replaces old visual
    // state instead of building latency behind the authoritative audio clock.
    pendingControls = message;
    void pump();
    return;
  }
  if (message.type === 'cancel') {
    const generation = Number(message.generation);
    if (!Number.isFinite(generation) || generation >= currentGeneration) {
      currentGeneration = Math.max(currentGeneration + 1, Number.isFinite(generation) ? generation + 1 : currentGeneration + 1);
      currentTurnId = '';
      pendingControls = null;
    }
    return;
  }
  if (message.type === 'dispose') {
    disposed = true;
    pendingControls = null;
    appearanceSession = null;
    portraitSession = null;
    sourceTensor = null;
    appearanceTensor = null;
    close();
  }
};
