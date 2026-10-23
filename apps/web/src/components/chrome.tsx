// Compatibilidade: as peças do shell vivem em ./shell. Este módulo mantém os nomes antigos.
import { fmtTime } from '../lib/format';
import type { LinkStatus } from '../store/board';
import { LivePill } from './core/live';

export { countdownParts, fmtCountdown, LegalFooter, SplitBar } from './shell/bits';
export { Header } from './shell/Header';
export { TabBar } from './shell/TabBar';

export function LiveBadge({ link }: { link: LinkStatus }) {
  return <LivePill link={link} />;
}

export function UpdatedAt({ iso }: { iso?: string | null }) {
  return <span className="num">{fmtTime(iso)}</span>;
}
