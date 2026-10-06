/**
 * A cumulus deck at its real altitude (base 1.8 km, tops 3.2 km), anchored to the ground around the places the film
 * descends to. Not a screen effect: each pixel's view ray from the film camera (same position, heading, pitch, roll
 * and lens as the map) is marched through the slab. From above the deck lies over the ground with gaps; inside it the
 * view whites out; below it the ground is clear. Clouds are atmosphere, not data, and the page says so.
 *
 * Coordinates: metres east/north/up from the first anchor (see math.enu).
 */
const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const frag = (steps: number) => `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform vec3 uEye, uF, uR, uU, uSun;
uniform float uTanHalf, uAspect, uOn;
uniform vec2 uShift;
uniform vec2 uC0, uC1;
const float BASE = 1800.0, TOP = 3200.0;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
float region(vec2 xy) {
  return max(1.0 - smoothstep(30000.0, 110000.0, length(xy - uC0)), 1.0 - smoothstep(30000.0, 110000.0, length(xy - uC1)));
}
float density(vec3 p) {
  float h = (p.z - BASE) / (TOP - BASE);
  if (h < 0.0 || h > 1.0) return 0.0;
  float cov = smoothstep(0.42, 0.68, fbm(p.xy / 5200.0)) * region(p.xy);
  if (cov <= 0.0) return 0.0;
  // flat bases, towering rounded tops; detail erodes the edges
  float top = 0.35 + 0.65 * cov;
  float prof = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(top * 0.55, top, h));
  float detail = fbm(p.xy / 820.0 + vec2(h * 2.7, -h * 1.9));
  return clamp(cov * prof * (0.55 + detail), 0.0, 1.0);
}
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  ndc -= uShift; // off-centre lens when the map is padded
  vec3 dir = normalize(uF + ndc.x * uTanHalf * uAspect * uR + ndc.y * uTanHalf * uU);
  float t0, t1;
  if (abs(dir.z) < 1e-5) {
    if (uEye.z < BASE || uEye.z > TOP) { o = vec4(0.0); return; }
    t0 = 0.0; t1 = 40000.0;
  } else {
    float ta = (BASE - uEye.z) / dir.z, tb = (TOP - uEye.z) / dir.z;
    t0 = max(0.0, min(ta, tb)); t1 = max(ta, tb);
    if (t1 <= 0.0) { o = vec4(0.0); return; }
  }
  if (t0 > 160000.0) { o = vec4(0.0); return; }
  t1 = min(t1, t0 + 14000.0);
  float dt = (t1 - t0) / float(${steps});
  float j = hash(gl_FragCoord.xy + fract(uEye.xy * 0.001));
  float T = 1.0; vec3 col = vec3(0.0);
  for (int i = 0; i < ${steps}; i++) {
    vec3 p = uEye + dir * (t0 + dt * (float(i) + j));
    float d = density(p);
    if (d > 0.002) {
      float a = 1.0 - exp(-d * dt * 0.0032);
      float h = (p.z - BASE) / (TOP - BASE);
      // sunlit tops, cool shaded bases; a little light through thin edges
      float lit = clamp(0.35 + 0.65 * h + 0.25 * dot(normalize(vec3(0.0, 0.0, 1.0) + uSun * 0.4), uSun) - d * 0.3, 0.0, 1.0);
      vec3 c = mix(vec3(0.58, 0.64, 0.70), vec3(1.0, 0.985, 0.955), lit);
      col += T * a * c; T *= 1.0 - a;
      if (T < 0.02) break;
    }
  }
  // far clouds melt into the map's own haze
  float fade = exp(-t0 / 65000.0) * uOn;
  o = vec4(col * fade, (1.0 - T) * fade);
}`;

export interface CloudCamera { eye: [number, number, number]; f: number[]; r: number[]; u: number[]; tanHalf: number; shift: [number, number] }

export class CloudDeck {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private scale: number;
  constructor(private canvas: HTMLCanvasElement, quality: 'high' | 'low') {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) throw new Error('WebGL2 unavailable for the cloud deck');
    this.gl = gl;
    this.scale = quality === 'high' ? 0.6 : 0.4; // clouds are soft: render below full resolution
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'cloud shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag(quality === 'high' ? 14 : 8)));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'cloud program');
    this.prog = p;
    for (const n of ['uEye', 'uF', 'uR', 'uU', 'uSun', 'uTanHalf', 'uAspect', 'uOn', 'uShift', 'uC0', 'uC1']) this.loc[n] = gl.getUniformLocation(p, n);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // warm-up: a 1-pixel draw forces the driver to compile the program now, not on the first frame of the dive
    gl.useProgram(p); gl.viewport(0, 0, 1, 1); gl.uniform1f(this.loc.uOn, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  resize(w: number, h: number) {
    const W = Math.max(1, Math.round(w * this.scale)), H = Math.max(1, Math.round(h * this.scale));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
  }
  /** Draws the deck; `on` 0 clears it (and costs nothing). */
  render(cam: CloudCamera, anchors: [[number, number], [number, number]], sun: [number, number, number], on: number) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (on <= 0.001) return;
    gl.useProgram(this.prog);
    const L = this.loc;
    gl.uniform3fv(L.uEye, cam.eye); gl.uniform3fv(L.uF, cam.f); gl.uniform3fv(L.uR, cam.r); gl.uniform3fv(L.uU, cam.u);
    gl.uniform3fv(L.uSun, sun);
    gl.uniform1f(L.uTanHalf, cam.tanHalf); gl.uniform1f(L.uAspect, this.canvas.width / this.canvas.height); gl.uniform1f(L.uOn, on); gl.uniform2fv(L.uShift, cam.shift);
    gl.uniform2fv(L.uC0, anchors[0]); gl.uniform2fv(L.uC1, anchors[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  dispose() { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
}

/** Camera basis in east/north/up for a MapLibre-style bearing (deg, clockwise from north), pitch (0 = straight down)
 *  and roll (deg). */
export function cameraBasis(bearing: number, pitch: number, roll: number) {
  const b = (bearing * Math.PI) / 180, p = (pitch * Math.PI) / 180, r = (roll * Math.PI) / 180;
  const f = [Math.sin(p) * Math.sin(b), Math.sin(p) * Math.cos(b), -Math.cos(p)];
  const rt = [Math.cos(b), -Math.sin(b), 0];
  const up = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
  const c = Math.cos(r), s = Math.sin(r);
  return { f, r: rt.map((v, i) => v * c + up[i] * s), u: up.map((v, i) => v * c - rt[i] * s) };
}
