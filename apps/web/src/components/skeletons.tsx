// Esqueletos com a forma da primeira dobra de cada tela, medidos nas telas reais (375×812 e 1024×768).
// São os mesmos no fallback do lazy() (App) e no "carregando" de cada página: trocar um pelo outro não mexe nada,
// e quando o conteúdo chega cada bloco ocupa o lugar do seu esqueleto. Fica no bundle inicial (é pequeno).
import { Skeleton as Shimmer } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function Bone({ className }: { className?: string }) {
  return <Shimmer className={cn('rounded-xl', className)} />;
}

/** título de página: rótulo pequeno, h1, linha de apoio */
function PageTitle({ sub = true }: { sub?: boolean }) {
  return (
    <div className="pt-1">
      <Bone className="h-3.5 w-40 rounded-md" />
      <Bone className="mt-1.5 h-7 w-48 rounded-lg" />
      {sub && <Bone className="mt-2 h-4 w-3/4 rounded-md" />}
    </div>
  );
}

function Wrap({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className} aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

/** Painel: topo (título, barra de apuração, fonte), gráfico da noite, chips, linhas dos candidatos, KPIs */
export function PainelSkeleton() {
  const hero = (
    <>
      <div className="pt-1 pb-3">
        <div className="flex h-[25px] items-center justify-between">
          <Bone className="h-6 w-52 rounded-lg" />
          <Bone className="h-6 w-24 rounded-full" />
        </div>
        <Bone className="mt-3 h-[23px] w-full rounded-full" />
        <Bone className="mt-1.5 h-[18px] w-56 rounded-md" />
      </div>
      <Bone className="h-[260px] lg:h-[324px]" />
      <div className="mt-3 flex h-8 gap-1.5">
        <Bone className="h-8 w-20 rounded-full" />
        <Bone className="h-8 w-16 rounded-full" />
      </div>
      <Bone className="mt-2 h-[275px]" />
      <Bone className="mt-2 h-[191px] lg:hidden" />
    </>
  );
  return (
    <Wrap label="Carregando painel" className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-10">
      <div className="lg:col-span-8">{hero}</div>
      <div className="hidden pt-1 lg:col-span-4 lg:block">
        <Bone className="h-[253px]" />
        <Bone className="mt-5 h-[184px]" />
        <Bone className="mt-5 h-[400px]" />
      </div>
    </Wrap>
  );
}

/** Mapa: título, a faixa "Agora / 1º turno / 2022" com os modos de ver à direita, o resumo de estados e o mapa na proporção dele */
export function MapSkeleton() {
  return (
    <Wrap label="Carregando mapa" className="space-y-4 pb-2">
      {/* no celular o título quebra em duas linhas */}
      <div className="pt-1">
        <Bone className="h-3.5 w-40 rounded-md" />
        <Bone className="mt-1.5 h-7 w-44 rounded-lg lg:w-72" />
        <Bone className="mt-1.5 h-7 w-32 rounded-lg lg:hidden" />
      </div>
      <Bone className="h-[135px] rounded-2xl" />
      {/* chips da camada e modo de ver ficam dentro do cartão do mapa */}
      <div className="rounded-2xl border bg-card p-3 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Bone className="h-8 w-[290px] rounded-full" />
          <Bone className="ml-auto h-8 w-[124px] shrink-0 rounded-md" />
        </div>
        <Bone className="mx-auto aspect-[1000/1051] w-full max-w-[620px] lg:max-w-none" />
      </div>
    </Wrap>
  );
}

/** Cidade (busca): título e o cartão da busca */
export function CitySearchSkeleton() {
  return (
    <Wrap label="Carregando busca de cidades" className="space-y-5 pt-1 pb-2">
      <PageTitle />
      <Bone className="h-[525px] rounded-2xl lg:h-[499px]" />
    </Wrap>
  );
}

/** Cidade (detalhe): trilha + nome, o placar da cidade e a comparação */
export function CityDetailSkeleton() {
  return (
    <Wrap label="Carregando cidade" className="space-y-4 pt-1 pb-2">
      <div>
        <div className="flex h-10 items-center justify-between">
          <Bone className="h-4 w-32 rounded-md" />
          <Bone className="h-9 w-24 rounded-full" />
        </div>
        <Bone className="mt-1 h-[69px] w-2/3 rounded-lg" />
      </div>
      <Bone className="h-[340px] rounded-2xl lg:h-[304px]" />
      <Bone className="h-[467px] rounded-2xl lg:h-[449px]" />
    </Wrap>
  );
}

/** Palpite: o cartão do palpite (formulário antes das 19h, aviso depois) */
export function GuessSkeleton({ released }: { released: boolean }) {
  return (
    <Wrap label="Carregando palpite" className="space-y-3 pt-1">
      <Bone className={cn('rounded-2xl', released ? 'h-[144px]' : 'h-[520px]')} />
    </Wrap>
  );
}

/** Momento compartilhado: o cartão do momento */
export function MomentSkeleton() {
  return (
    <Wrap label="Carregando momento" className="space-y-3 pt-1">
      <Bone className="h-[320px] rounded-2xl" />
    </Wrap>
  );
}

/** Páginas de texto (privacidade, termos) */
export function TextSkeleton() {
  return (
    <Wrap label="Carregando" className="space-y-3 pt-1">
      <PageTitle />
      {Array.from({ length: 8 }, (_, i) => (
        <Bone key={i} className={cn('h-4 rounded-md', i % 3 === 2 ? 'w-2/3' : 'w-full')} />
      ))}
    </Wrap>
  );
}

/**
 * Uma linha de texto fantasma. A altura vem da linha (fonte e entrelinha de quem usa, ex.: `text-sm`), não de um
 * `h-*` chutado: quando o texto chega ocupa exatamente o mesmo espaço.
 */
export function LineBone({ className, w = 'w-24' }: { className?: string; w?: string }) {
  return (
    <span className={cn('block', className)} aria-hidden>
      {/* span (não div): pode ir dentro de <p> e de botões */}
      <span className={cn('inline-block h-[0.8em] max-w-full animate-pulse rounded-sm bg-accent align-middle', w)} />
    </span>
  );
}

const NAME_W = ['w-32', 'w-24', 'w-40', 'w-28', 'w-36', 'w-20'];

/**
 * Lista de cidades carregando dentro de um Command (cmdk): mesmo grupo, mesmo cabeçalho e linhas com a altura
 * dos itens de verdade (`min-h-12`, uma ou duas linhas), para a gaveta não pular quando os municípios chegam.
 */
export function CityRowsSkeleton({ heading, rows = 8, twoLine = false }: { heading?: string; rows?: number; twoLine?: boolean }) {
  return (
    <div className="overflow-hidden p-1 text-foreground" aria-busy="true" aria-label="Carregando cidades">
      {heading && <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{heading}</div>}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-12 items-center gap-3 px-2 py-1.5 text-sm">
          <Shimmer className="size-4 shrink-0 rounded-full" />
          <span className="min-w-0 flex-1">
            <LineBone w={NAME_W[i % NAME_W.length]} />
            {twoLine && <LineBone className="text-[11px]" w="w-32" />}
          </span>
          {!twoLine && <LineBone className="text-xs" w="w-5" />}
        </div>
      ))}
    </div>
  );
}
