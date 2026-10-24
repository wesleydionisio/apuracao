// Peças do chat de live: selo de torcida, emoji de partido no texto, linha de mensagem, momento.
import type { CandidateDef, ChatMsg } from '@apuracao/shared';
import { MOD_LABEL, PARTY_TOKEN_RE } from '@apuracao/shared';
import { ShieldMinus } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { fmtHM } from '@/lib/format';
import { cn } from '@/lib/utils';
import { favored, mentioned, momentParts } from './moment';

/** cor do apelido: mais escura no claro, mais clara no escuro (contraste AA nos dois temas) */
export const nickColor = (hue: number) => ({ ['--h' as string]: hue }) as React.CSSProperties;
export const NICK_CLS = 'text-[hsl(var(--h)_60%_34%)] dark:text-[hsl(var(--h)_75%_72%)]';

/** fundo do selo: a cor do candidato um pouco escurecida, para o texto branco passar de 4,5:1 */
const badgeBg = (c: CandidateDef) => `color-mix(in oklab, ${c.color} 78%, black)`;

/**
 * Selo de torcida: número da urna (e a sigla, quando cabe) na cor do candidato.
 * Nada de logotipo oficial — só o número que todo mundo já associa.
 */
export function PartyBadge({
  c,
  party = false,
  size = 'sm',
  className,
}: {
  c: CandidateDef;
  party?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-[3px] rounded-[5px] font-bold leading-none text-white tabular-nums select-none',
        size === 'sm' && 'h-[17px] px-[5px] text-[11px] align-[-2px]',
        size === 'md' && 'h-6 px-2 text-[13px]',
        size === 'lg' && 'h-9 rounded-lg px-3 text-[17px]',
        className,
      )}
      style={{ background: badgeBg(c) }}
      aria-label={`${c.n}${c.party ? ` ${c.party}` : ''}`}
    >
      {c.n}
      {party && c.party && <span className="font-semibold opacity-80">{c.party}</span>}
    </span>
  );
}

/** ":13:" / ":pt:" → candidato correspondente */
export function tokenCandidate(token: string, cands: CandidateDef[] | null): CandidateDef | null {
  const t = token.toLowerCase();
  return cands?.find((c) => c.n === t || c.party?.toLowerCase() === t) ?? null;
}

/** texto com os emojis de partido desenhados como selos */
export function renderBody(body: string, cands: CandidateDef[] | null, size: 'sm' | 'md' = 'sm'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(PARTY_TOKEN_RE.source, 'gi');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const c = tokenCandidate(m[1], cands);
    if (!c) continue;
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(<PartyBadge key={m.index} c={c} party size={size} className="mx-px" />);
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|\s|:(?:[a-z]{2,12}|\d{2}):)+$/iu;

/** mensagem só de emoji/selos (até ~6): aparece maior, como reação falada */
export function isEmojiOnly(body: string): boolean {
  return body.length <= 40 && EMOJI_ONLY.test(body) && /\S/.test(body);
}

/** Uma linha por mensagem, estilo live: Apelido: texto (sem o selo do lado: o apelido já basta). Memo: o chat
 * re-renderiza a cada lote, e as 200 linhas antigas não mudam */
export const ChatLine = memo(function ChatLine({
  m,
  cands,
  fresh,
  mine,
  onPick,
}: {
  m: ChatMsg;
  cands: CandidateDef[] | null;
  fresh: boolean;
  mine: boolean;
  onPick: (m: ChatMsg) => void;
}) {
  const big = isEmojiOnly(m.body);
  return (
    <button
      type="button"
      onClick={() => onPick(m)}
      className={cn(
        'block w-full rounded-md px-3 py-[3px] text-left text-[14px] leading-[1.45] break-words transition-colors hover:bg-accent/40 active:bg-accent/70',
        fresh && 'animate-in fade-in-0 slide-in-from-bottom-1 duration-200',
        mine && 'bg-accent/30',
      )}
      aria-label={`${m.nick}: ${m.body}. Toque para opções`}
    >
      <span className={cn('font-semibold', NICK_CLS)} style={nickColor(m.hue)}>
        {m.nick}
      </span>
      <span className="text-muted-foreground">: </span>
      <span className={cn('text-pretty', big && 'text-[22px] leading-[1.3] [&>span]:align-[3px]')}>{renderBody(m.body, cands, big ? 'md' : 'sm')}</span>
    </button>
  );
});

/**
 * Mensagem barrada pela moderação. Tom neutro de propósito: informa sem fazer espetáculo.
 * - vinda do servidor: a primeira mensagem barrada de alguém, que todos veem (sem o texto);
 * - local: aviso só para o autor, quando as seguintes nem chegam ao chat.
 */
export const ModLine = memo(function ModLine({ m, fresh }: { m: ChatMsg; cands: CandidateDef[] | null; fresh: boolean }) {
  const why = m.mod ? MOD_LABEL[m.mod] : undefined;
  // uma linha só: informa sem ocupar o chat
  return (
    <div
      className={cn('flex min-w-0 items-center gap-1.5 px-3 py-[3px] text-[13px] leading-[1.45] text-muted-foreground', fresh && 'animate-in fade-in-0 duration-200')}
      role="note"
      title={why ? `Motivo: ${why}` : undefined}
    >
      <ShieldMinus className="size-3.5 shrink-0 opacity-70" aria-hidden />
      <span className="min-w-0 truncate">
        {m.local ? (
          'Sua mensagem foi censurada'
        ) : (
          <>
            <span className={cn('font-semibold opacity-80', NICK_CLS)} style={nickColor(m.hue)}>
              {m.nick}
            </span>
            <span>: </span>
            <span className="italic">mensagem censurada</span>
          </>
        )}
      </span>
    </div>
  );
});

/** Momento da apuração no meio do chat: linha destacada com o candidato citado. */
export const SystemLine = memo(function SystemLine({ m, cands, fresh }: { m: ChatMsg; cands: CandidateDef[] | null; fresh: boolean }) {
  const { Icon, kind, text } = momentParts(m.body);
  const who = mentioned(cands, text).slice(0, 2);
  const lead = favored(cands, text);
  return (
    <div
      className={cn(
        'mx-2 my-1.5 flex items-center gap-2.5 rounded-lg border-l-[3px] bg-muted/70 py-2 pr-3 pl-2.5',
        fresh && 'animate-in fade-in-0 slide-in-from-bottom-2 duration-300',
      )}
      style={{ borderLeftColor: lead?.color ?? 'var(--border)' }}
      role="note"
    >
      {who.length ? (
        <span className="flex shrink-0 -space-x-1.5">
          {who.map((c) => (
            <CandidateAvatar key={c.key} c={c} size="sm" className="ring-2 ring-muted" />
          ))}
        </span>
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background">
          <Icon className="size-4" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Icon className="size-3" aria-hidden />
          <span className="font-semibold text-foreground">{kind}</span>
          <span aria-hidden>·</span>
          <span className="num">{fmtHM(new Date(m.at).toISOString())}</span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug font-medium text-pretty">{text}</p>
      </div>
    </div>
  );
});

/** inicial do apelido sobre a cor estável do autor (perfil, gaveta de ações) */
export function NickAvatar({ m, className }: { m: Pick<ChatMsg, 'nick' | 'hue'>; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white', className)}
      style={{ background: `hsl(${m.hue} 45% 42%)` }}
    >
      {m.nick.charAt(0).toUpperCase()}
    </span>
  );
}
