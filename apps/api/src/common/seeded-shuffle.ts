/** One seeded shuffle for the whole server. A second PRNG is a second answer to "same seed, same order". */

const PRNG_INCREMENT = 0x6d2b79f5;
const UINT32 = 4294967296;

/** mulberry32. Reproducible, not secret — nothing that uses it guards anything. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + PRNG_INCREMENT) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
