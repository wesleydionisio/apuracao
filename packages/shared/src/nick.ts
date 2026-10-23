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
