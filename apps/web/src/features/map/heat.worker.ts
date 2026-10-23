// Contas pesadas do mapa de calor fora da thread principal: o campo (a cada dado novo) e o mosaico de
// cidades (a cada zoom). Num celular simples cada uma leva 100–200 ms, o que travaria rolagem e chat.
import { cityMosaic, heatField, type Field, type FieldInput, type Mosaic } from './heat';

export type HeatRequest =
  | { type: 'init'; pts: FieldInput }
  | { type: 'field'; id: number; el: number[]; pst: Float32Array; pa: Float32Array; W: number; H: number }
  | { type: 'mosaic'; id: number; x0: number; y0: number; x1: number; y1: number; gw: number };

export type HeatReply = { type: 'field'; id: number; f: Field } | { type: 'mosaic'; id: number; mo: Mosaic };

const post = (msg: unknown, transfer: Transferable[]) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);

let pts: FieldInput | null = null;

self.onmessage = (e: MessageEvent<HeatRequest>) => {
  const d = e.data;
  if (d.type === 'init') {
    pts = d.pts;
    return;
  }
  if (!pts) return;
  if (d.type === 'field') {
    const f = heatField(pts, d.el, d.pst, d.pa, d.W, d.H);
    post({ type: 'field', id: d.id, f }, [f.share.buffer, f.prog.buffer, f.dens.buffer]);
  } else {
    const mo = cityMosaic(pts, d.x0, d.y0, d.x1, d.y1, d.gw);
    post({ type: 'mosaic', id: d.id, mo }, [mo.city.buffer]);
  }
};
