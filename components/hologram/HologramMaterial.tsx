import * as THREE from "three";
import { V, heightAt } from "./geometry";

export const COLORS = {
  bg: "#071726",
  cyan: "#00E5F0",
  cyanHi: "#B9FFFF",
  amber: "#F5A400",
  core: "#FFF4C2",
} as const;

/**
 * Shared vertex prelude.
 *
 * The head turns toward the pointer, the shoulders do not. Rather than split
 * the bust into two objects — which would tear at the neck — the rotation is
 * applied in the shader with a weight that falls off from the jaw down to the
 * base of the neck. The geometry stays one continuous surface and the turn
 * reads as a neck articulating.
 */
export const HEAD_TURN_GLSL = /* glsl */ `
  uniform vec2 uTurn;      // yaw, pitch in radians (already clamped)
  uniform float uReveal;   // 0..1 staged build

  const float Y_JAW  = ${heightAt(V.jawBottom).toFixed(4)};
  const float Y_NECK = ${heightAt(V.neckBottom).toFixed(4)};

  vec3 applyHeadTurn(vec3 p) {
    // 1 across the head, easing to 0 by the base of the neck.
    float w = smoothstep(Y_NECK, Y_JAW, p.y);
    if (w <= 0.0001) return p;

    vec3 pivot = vec3(0.0, Y_NECK, 0.0);
    vec3 q = p - pivot;

    float yaw = uTurn.x * w;
    float pitch = uTurn.y * w;

    float cy = cos(yaw), sy = sin(yaw);
    q = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);

    float cp = cos(pitch), sp = sin(pitch);
    q = vec3(q.x, q.y * cp - q.z * sp, q.y * sp + q.z * cp);

    return q + pivot;
  }
`;

/** Solid shell: writes depth so back-facing contours are hidden, and adds the rim. */
export function makeShellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    uniforms: {
      uTurn: { value: new THREE.Vector2() },
      uReveal: { value: 0 },
      uTime: { value: 0 },
      uCyan: { value: new THREE.Color(COLORS.cyan) },
      uCyanHi: { value: new THREE.Color(COLORS.cyanHi) },
      uBg: { value: new THREE.Color(COLORS.bg) },
    },
    vertexShader: /* glsl */ `
      ${HEAD_TURN_GLSL}
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec3 p = applyHeadTurn(position);
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = n;
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCyan;
      uniform vec3 uCyanHi;
      uniform vec3 uBg;
      uniform float uReveal;
      varying vec3 vN;
      varying vec3 vView;

      void main() {
        // Fresnel: bright exactly where the surface turns away from us.
        float f = 1.0 - clamp(dot(normalize(vN), normalize(vView)), 0.0, 1.0);
        float rim = pow(f, 2.6);
        vec3 col = mix(uCyan, uCyanHi, pow(f, 6.0));
        // A near-black body keeps the far side of the contours hidden.
        vec3 body = uBg * 0.55;
        gl_FragColor = vec4(body + col * rim * 1.5, (0.55 + rim * 0.45) * uReveal);
      }
    `,
  });
}

/**
 * Contour lines. `uScan` sweeps a brighter band upward, and `uBuild` reveals
 * rings from the crown down as the figure assembles.
 */
export function makeContourMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTurn: { value: new THREE.Vector2() },
      uReveal: { value: 0 },
      uBuild: { value: 0 },
      uScan: { value: 0 },
      uCyan: { value: new THREE.Color(COLORS.cyan) },
      uCyanHi: { value: new THREE.Color(COLORS.cyanHi) },
    },
    vertexShader: /* glsl */ `
      ${HEAD_TURN_GLSL}
      attribute float aV;
      varying float vV;
      varying float vFres;
      varying float vLight;
      void main() {
        vV = aV;
        vec3 p = applyHeadTurn(position);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        vec3 view = normalize(-mv.xyz);

        // Rim: lines turning away from the camera brighten, giving depth.
        vFres = 1.0 - clamp(dot(n, view), 0.0, 1.0);
        // Key light from above-front, so the brow, nose and cheeks catch it and
        // the eye sockets fall into shadow. This is what makes the face read
        // head-on, where the relief itself is edge-on and invisible.
        vLight = clamp(dot(n, normalize(vec3(0.18, 0.62, 0.76))), 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uBuild;
      uniform float uScan;
      uniform float uReveal;
      uniform vec3 uCyan;
      uniform vec3 uCyanHi;
      varying float vV;
      varying float vFres;
      varying float vLight;

      void main() {
        // Rings appear top-down while the figure builds.
        if (vV > uBuild) discard;

        // A slow band travelling up the body.
        float band = exp(-pow((fract(vV - uScan) - 0.5) * 6.0, 2.0));

        float edge = pow(clamp(vFres, 0.0, 1.0), 1.7);
        float lit = 0.30 + vLight * 0.95;

        vec3 col = mix(uCyan, uCyanHi, clamp(edge * 0.7 + vLight * 0.45 + band * 0.4, 0.0, 1.0));
        float a = (0.10 + edge * 0.55 + lit * 0.42 + band * 0.3) * uReveal;
        gl_FragColor = vec4(col * (0.45 + lit * 0.7 + band * 0.7), a);
      }
    `,
  });
}

export function disposeMaterial(m?: THREE.Material | null) {
  m?.dispose();
}
