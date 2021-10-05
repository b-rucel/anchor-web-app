import { CreateTxOptions } from '@terra-money/terra.js';
import { TxResultRendering, TxStreamPhase } from '@libs/webapp-fns';

export function _createTxOptions(tx: CreateTxOptions) {
  return (_: void) => {
    return {
      value: tx,
      phase: TxStreamPhase.POST,
      receipts: [],
    } as TxResultRendering<CreateTxOptions>;
  };
}