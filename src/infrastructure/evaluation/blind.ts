/**
 * The order to show `count` things in, shuffled the same way for the same
 * seed, so that whoever judges them cannot tell which is which by where it
 * is, and the order can be made again to find out. A Fisher–Yates shuffle with
 * the mulberry32 generator; not for anything secret.
 */
export function blindOrder(count: number, seed: number): number[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}
