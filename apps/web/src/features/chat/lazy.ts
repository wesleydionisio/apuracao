import { useEffect, useState } from 'react';

/** fica true na primeira vez que `open` vira true (e continua montado para a animação de saída) */
export function useMountOnce(open: boolean): boolean {
  const [m, setM] = useState(open);
  useEffect(() => {
    if (open) setM(true);
  }, [open]);
  return m || open;
}
