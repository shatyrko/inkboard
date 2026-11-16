// A recording stand-in for CanvasRenderingContext2D, so drawing code can be tested without a canvas.
import type { Ctx2D } from './draw';

export type Call = { op: string; args: unknown[]; font: string; fillStyle: unknown };

/** measureText is 0.5 em per character, which makes widths easy to compute by hand */
export function fakeContext(): { g: Ctx2D; calls: Call[]; texts: () => string[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { font: '500 10px sans-serif', fillStyle: '#000000' };
  const g = new Proxy({} as Record<string, unknown>, {
    get(_, prop: string) {
      if (prop === 'measureText') {
        return (text: string) => ({ width: text.length * (Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1]) || 10) * 0.5 });
      }
      if (prop in state) return state[prop];
      return (...args: unknown[]) => { calls.push({ op: prop, args, font: String(state.font), fillStyle: state.fillStyle }); };
    },
    set(_, prop: string, value) { state[prop] = value; return true; },
  }) as unknown as Ctx2D;
  return { g, calls, texts: () => calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0])) };
}
