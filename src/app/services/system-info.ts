/**
 * Browser-derived device specs for the System Health card.
 *
 * These are static capabilities the browser is willing to expose, not live
 * load — there is no browser API for current CPU/GPU/RAM usage. Each getter
 * returns "Not available" when the underlying API is unsupported so the UI
 * keeps reporting honestly rather than guessing.
 */

const SPEED_TEST_BYTES = 10_000_000;
const SPEED_TEST_URL = `https://speed.cloudflare.com/__down?bytes=${SPEED_TEST_BYTES}`;

export function getCpuInfo(): string {
  const cores = navigator.hardwareConcurrency;
  return cores ? `${cores} logical cores` : "Not available";
}

export function getGpuInfo(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "Not available";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "Not available";
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    return typeof renderer === "string" && renderer ? renderer : "Not available";
  } catch {
    return "Not available";
  }
}

export function getRamInfo(): string {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return mem ? `≥ ${mem} GB` : "Not available";
}

/** Downloads a fixed-size payload from a CORS-friendly CDN and times it. */
export async function measureDownloadSpeed(): Promise<string> {
  const start = performance.now();
  const response = await fetch(SPEED_TEST_URL, { cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("Speed test failed");

  const reader = response.body.getReader();
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
  }

  const elapsedSec = (performance.now() - start) / 1000;
  const mbps = (received * 8) / elapsedSec / 1_000_000;
  return `${mbps.toFixed(1)} Mbps`;
}
