// Monta os três níveis da grade hexagonal fora da thread principal: no nível mais fino são ~70 mil hexágonos
// e uma busca em largura, o que num celular simples travaria a tela por umas centenas de ms.
import { buildLevel, type DotsInput, type HexLevel } from './hex';

export interface HexRequest {
  pts: DotsInput;
  el: number[];
  mask: Uint8Array;
  mw: number;
  mh: number;
  radii: number[];
}

export type HexReply = { levels: HexLevel[] };

self.onmessage = (e: MessageEvent<HexRequest>) => {
  const { pts, el, mask, mw, mh, radii } = e.data;
  const levels = radii.map((R) => buildLevel(pts, el, mask, mw, mh, R));
  const transfer = levels.flatMap((l) => [l.cx.buffer, l.cy.buffer, l.ofDot.buffer, l.src.buffer, l.city.buffer, l.grid.buffer]);
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage({ levels } satisfies HexReply, transfer);
};
