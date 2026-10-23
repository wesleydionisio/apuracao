// Compatibilidade: o gráfico da noite vive em @/features/curve.
import type { Board } from '@apuracao/shared';
import { Card, Title } from '../components/ui';
import NightChart from '@/features/curve/NightChart';

export default function Curve({ board }: { board: Board }) {
  return (
    <Card>
      <Title>A noite de hoje × 2022</Title>
      <NightChart board={board} />
    </Card>
  );
}
