import type { ArithmeticMonitor } from '../rational';

export class BudgetExceeded extends Error {
  constructor(readonly reason: 'integer-limit' | 'operation-limit') {
    super(reason);
  }
}
export const exactBudget = Object.freeze({ bits: 4096, remainders: 1_000_000 });
/** One instance per request, shared by validation, assembly, solve and output. */
export function createBudget(limits: { bits: number; remainders: number } = exactBudget): ArithmeticMonitor {
  let operations = 0;
  const ceiling = 1n << BigInt(limits.bits);
  return {
    integer(value) {
      if (value >= ceiling || value <= -ceiling) throw new BudgetExceeded('integer-limit');
    },
    remainder() {
      if (operations >= limits.remainders) throw new BudgetExceeded('operation-limit');
      operations++;
    },
  };
}
