export const UFS: Record<string, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
  ZZ: 'Exterior',
};

/** UFs + exterior, na forma usada nas URLs do TSE (minúsculas) */
export const TSE_UFS = Object.keys(UFS).map((u) => u.toLowerCase());

export const ufName = (uf: string) => UFS[uf.toUpperCase()] ?? uf.toUpperCase();

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const UF_PREP: Record<string, 'no' | 'na' | 'em'> = {
  AC: 'no', AL: 'em', AP: 'no', AM: 'no', BA: 'na', CE: 'no', DF: 'no', ES: 'no', GO: 'em', MA: 'no',
  MT: 'em', MS: 'em', MG: 'em', PA: 'no', PB: 'na', PR: 'no', PE: 'em', PI: 'no', RJ: 'no', RN: 'no',
  RS: 'no', RO: 'em', RR: 'em', SC: 'em', SP: 'em', SE: 'em', TO: 'em', ZZ: 'no',
};

/** "na Bahia", "em São Paulo", "no Rio de Janeiro" */
export const inUf = (uf: string) => `${UF_PREP[uf.toUpperCase()] ?? 'em'} ${ufName(uf)}`;
