// Apelidos anônimos neutros: "Tucano Atento 42"
const ANIMALS = [
  'Tucano', 'Capivara', 'Onça', 'Arara', 'Jabuti', 'Tamanduá', 'Sabiá', 'Lobo-guará', 'Boto', 'Mico',
  'Quati', 'Tatu', 'Jacaré', 'Bem-te-vi', 'Coruja', 'Preguiça', 'Ariranha', 'Siriema', 'Peixe-boi', 'Gavião',
];
const ADJ = [
  'Atento', 'Curioso', 'Ligado', 'Calmo', 'Ansioso', 'Esperto', 'Paciente', 'Ligeiro', 'Sereno', 'Firme',
  'Desperto', 'Focado', 'Animado', 'Tranquilo', 'Antenado',
];

export function randomNick(rand: () => number = Math.random): string {
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  return `${pick(ANIMALS)} ${pick(ADJ)} ${Math.floor(rand() * 90 + 10)}`;
}

/** Apelido padrão estável para um id anônimo (API e WS precisam dar o mesmo). */
export function nickForId(id: string): string {
  let seed = 7;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) % 2147483647;
  seed = seed || 1;
  return randomNick(() => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646);
}
