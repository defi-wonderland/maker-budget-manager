import { smock } from '@defi-wonderland/smock';
import { Provider } from '@ethersproject/providers';
import chai, { expect } from 'chai';
import { Signer } from 'ethers';
import { contracts, wallet } from '.';
import { toUnit } from './bn';

chai.use(smock.matchers);

export type Impersonator = Signer | Provider | string;

export const onlyMaker = createOnlyCallableCheck(['maker'], 'OnlyMaker()');
export const onlyKeeper = createOnlyCallableCheck(['keeper'], 'OnlyKeeper()');
export const onlyGovernor = createOnlyCallableCheck(['governance'], 'OnlyGovernor()');
export const onlyPendingGovernor = createOnlyCallableCheck(['pending governance'], 'OnlyPendingGovernor()');

export function createOnlyCallableCheck(allowedLabels: string[], error: string) {
  return (
    delayedContract: () => any,
    fnName: string,
    allowedWallet: Impersonator | Impersonator[] | (() => Impersonator | Impersonator[]),
    args: unknown[] | (() => unknown[])
  ) => {
    allowedLabels.forEach((allowedLabel, index) => {
      it(`should be callable by ${allowedLabel}`, async () => {
        let impersonator = allowedWallet;
        if (typeof allowedWallet === 'function') impersonator = allowedWallet();
        if (Array.isArray(impersonator)) impersonator = impersonator[index];

        return expect(callFunction(impersonator as Impersonator)).not.to.be.revertedWith(error);
      });
    });

    it('should not be callable by any address', async () => {
      const any = await wallet.generateRandom();
      await wallet.setBalance({ account: any.address, balance: toUnit(1) });
      return expect(callFunction(any)).to.be.revertedWith(error);
    });

    function callFunction(impersonator: Impersonator) {
      const argsArray: unknown[] = typeof args === 'function' ? args() : args;
      const fn = delayedContract().connect(impersonator)[fnName] as (...args: unknown[]) => unknown;
      return fn(...argsArray, {
        gasLimit: 1e6,
        gasPrice: 500e9,
      });
    }
  };
}
