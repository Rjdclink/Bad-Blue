import type { LexaraEmbodimentFrame } from '@/lib/lexaraEmbodimentEngine';

export type LexaraGpuTier = 'webgpu-60' | 'webgpu-45' | 'webgpu-30';

export interface LexaraGpuRenderer {
  tier: LexaraGpuTier;
  render(frame: LexaraEmbodimentFrame, nowMs: number): void;
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  dispose(): void;
}

const SHADER = `
struct Params {
  head: vec4f,
  body: vec4f,
  face: vec4f,
  viewport: vec4f,
}
@group(0) @binding(0) var portraitSampler: sampler;
@group(0) @binding(1) var portraitTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;

struct Out {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> Out {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  var out: Out;
  out.position = vec4f(positions[i], 0.0, 1.0);
  out.uv = uvs[i];
  return out;
}

fn influence(uv: vec2f, center: vec2f, radius: vec2f) -> f32 {
  let d = (uv - center) / radius;
  return exp(-dot(d, d) * 2.2);
}

@fragment
fn fs(input: Out) -> @location(0) vec4f {
  var uv = input.uv;
  let headMask = influence(uv, vec2f(0.515, 0.322), vec2f(0.15, 0.245));
  let torsoMask = influence(uv, vec2f(0.515, 0.76), vec2f(0.31, 0.22));
  let mouthMask = influence(uv, vec2f(0.516, 0.432), vec2f(0.052, 0.038));
  let eyeMask = influence(uv, vec2f(0.516, 0.298), vec2f(0.09, 0.035));

  uv.x -= headMask * params.head.x * 0.0048;
  uv.y -= headMask * params.head.y * 0.0038;
  uv.x -= torsoMask * params.body.x * 0.0026;
  uv.y -= torsoMask * params.body.y * 0.0035;

  let headCenter = vec2f(0.515, 0.322);
  let rel = uv - headCenter;
  let angle = -params.head.z * 0.0065 * headMask;
  let c = cos(angle);
  let s = sin(angle);
  uv = mix(uv, headCenter + vec2f(rel.x*c-rel.y*s, rel.x*s+rel.y*c), headMask);

  uv.y -= mouthMask * params.face.x * 0.010;
  uv.x -= eyeMask * params.face.y * 0.0015;
  uv.y -= eyeMask * params.face.z * 0.0010;

  return textureSample(portraitTexture, portraitSampler, clamp(uv, vec2f(0.001), vec2f(0.999)));
}
`;

function gpuApi(): any {
  return (navigator as any).gpu;
}

export async function createLexaraGpuRenderer(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  onDeviceLost: () => void,
): Promise<LexaraGpuRenderer | null> {
  const gpu = gpuApi();
  if (!gpu || !window.isSecureContext) return null;

  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
  if (!adapter) return null;
  const device = await adapter.requestDevice().catch(() => null);
  if (!device) return null;

  const context = canvas.getContext('webgpu') as any;
  if (!context) return null;

  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  const bitmap = await createImageBitmap(image);
  const texture = device.createTexture({
    size: [bitmap.width, bitmap.height, 1],
    format: 'rgba8unorm',
    usage: 0x04 | 0x02,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
  bitmap.close();

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const uniformBuffer = device.createBuffer({ size: 64, usage: 0x40 | 0x08 });
  const module = device.createShaderModule({ code: SHADER });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: texture.createView() },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
  });

  let tier: LexaraGpuTier = 'webgpu-60';
  let targetFps = 60;
  let lastRenderMs = 0;
  let sampleStart = performance.now();
  let rendered = 0;
  let disposed = false;

  device.lost.then(() => {
    if (!disposed) onDeviceLost();
  }).catch(() => {
    if (!disposed) onDeviceLost();
  });

  const resize = (cssWidth: number, cssHeight: number, dpr: number) => {
    const safeDpr = Math.min(Math.max(1, dpr), tier === 'webgpu-60' ? 1.5 : 1.25);
    canvas.width = Math.max(1, Math.round(cssWidth * safeDpr));
    canvas.height = Math.max(1, Math.round(cssHeight * safeDpr));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  };

  const render = (frame: LexaraEmbodimentFrame, nowMs: number) => {
    if (disposed || nowMs - lastRenderMs < 1000 / targetFps) return;
    lastRenderMs = nowMs;

    const values = new Float32Array([
      frame.headX, frame.headY, frame.headRollDeg, frame.headPitch,
      frame.torsoX, frame.torsoY, frame.breath, frame.gestureEnergy,
      frame.mouthOpen, frame.gazeX, frame.gazeY, frame.blink,
      canvas.width, canvas.height, 0, 0,
    ]);
    device.queue.writeBuffer(uniformBuffer, 0, values);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    device.queue.submit([encoder.finish()]);

    rendered += 1;
    const elapsed = nowMs - sampleStart;
    if (elapsed >= 2500) {
      const actualFps = rendered * 1000 / elapsed;
      if (targetFps === 60 && actualFps < 50) {
        targetFps = 45;
        tier = 'webgpu-45';
      } else if (targetFps === 45 && actualFps < 37) {
        targetFps = 30;
        tier = 'webgpu-30';
      } else if (targetFps < 60 && actualFps > targetFps * 1.18) {
        targetFps = targetFps === 30 ? 45 : 60;
        tier = targetFps === 60 ? 'webgpu-60' : 'webgpu-45';
      }
      rendered = 0;
      sampleStart = nowMs;
    }
  };

  return {
    get tier() { return tier; },
    render,
    resize,
    dispose() {
      disposed = true;
      texture.destroy();
      uniformBuffer.destroy();
      try { device.destroy(); } catch { /* fail-open cleanup */ }
    },
  };
}
