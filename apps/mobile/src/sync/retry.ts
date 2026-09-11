export function demoraReintento(intento: number): number {
  return Math.min(60_000, 2_000 * (2 ** Math.max(0, intento)));
}
