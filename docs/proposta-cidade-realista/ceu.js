// Céu e luz pela hora da cidade no street view (fase 1 do mundo aberto).
//
// A hora é a de Brasília (o mesmo fuso da agenda de eventos do realtime), ou a de ?hora=HH na URL
// para testar. O sol nasce às 6 h e se põe às 18 h; ao meio-dia sobe a 70°. Com o sol baixo, a luz
// fica quente; à noite, o céu escurece, a neblina fica azul-escura e as luminárias dos postes acendem.
// Na visão de mapa, o céu volta ao de sempre (fixo, de tarde).
//
// PREMISSAS: nascer e pôr do sol fixos (6 h e 18 h, sem estação do ano) e a curva de luz.

export const CITY_UTC_OFFSET_MIN = -180;
export const SUNRISE = 6;
export const SUNSET = 18;

/** Hora decimal da cidade agora (0 a 24), ou a de \`?hora=\`. */
export function cityHour(now = new Date(), params = new URLSearchParams(location.search)) {
  const forced = Number(params.get('hora'));
  if (params.has('hora') && Number.isFinite(forced)) return ((forced % 24) + 24) % 24;
  const m = now.getUTCHours() * 60 + now.getUTCMinutes() + CITY_UTC_OFFSET_MIN;
  return (((m % 1440) + 1440) % 1440) / 60;
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * Como a cena fica numa hora: altura e rumo do sol (graus), força do sol e do céu, exposição, cor da
 * neblina e se é noite (luminárias acesas). Sem THREE: os números, para testar e aplicar.
 */
export function lightAt(hour) {
  const dayT = (hour - SUNRISE) / (SUNSET - SUNRISE); // 0 no nascer, 1 no pôr
  const up = Math.sin(Math.PI * dayT); // >0 de dia
  const elevation = dayT >= 0 && dayT <= 1 ? 70 * up : -12;
  const azimuth = mix(95, 265, clamp01(dayT)); // leste → oeste
  const day = clamp01(up * 3); // 0 à noite, 1 quando o sol já subiu um pouco
  const golden = dayT >= 0 && dayT <= 1 ? clamp01(1 - up * 2.2) : 0; // sol baixo: luz quente
  const night = !(dayT > -0.02 && dayT < 1.02);
  return {
    elevation,
    azimuth,
    sun: 2.6 * day,
    sky: mix(0.35, 2.2, day),
    exposure: mix(0.55, 0.85, day),
    // Cor do sol: branca ao meio-dia, laranja no nascer e no pôr.
    sunColor: [1, mix(0.96, 0.72, golden), mix(0.9, 0.48, golden)],
    fog: day > 0 ? [mix(0.1, 0.81, day), mix(0.14, 0.88, day), mix(0.22, 0.94, day)] : [0.1, 0.14, 0.22],
    night,
  };
}

/**
 * Aplica a hora na cena: \`sky\` (Sky do three.js), \`sun\` (DirectionalLight), \`hemi\` (HemisphereLight),
 * \`renderer\` e a neblina. Devolve o que aplicou.
 */
export function applyLight(THREE, { sky, sun, hemi, renderer, scene }, hour) {
  const l = lightAt(hour);
  const dir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - l.elevation), THREE.MathUtils.degToRad(l.azimuth));
  sky.material.uniforms.sunPosition.value.copy(dir);
  sun.position.copy(dir).multiplyScalar(1000);
  sun.intensity = l.sun;
  sun.color.setRGB(...l.sunColor);
  hemi.intensity = l.sky;
  renderer.toneMappingExposure = l.exposure;
  scene.fog?.color.setRGB(...l.fog);
  return l;
}
