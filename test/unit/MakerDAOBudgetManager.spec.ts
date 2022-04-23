import { FakeContract, MockContract, smock } from '@defi-wonderland/smock';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MakerDAOBudgetManager, MakerDAOBudgetManager__factory, IKeep3rV2, IERC20, IDssVest, IDaiJoin } from '@typechained';
import { evm, wallet } from '@utils';
import { onlyGovernor } from '@utils/behaviours';
import { toUnit } from '@utils/bn';
import chai, { expect } from 'chai';
import { BigNumber, Transaction } from 'ethers';
import { ethers } from 'hardhat';

chai.use(smock.matchers);

const JOB_ADDRESS = wallet.generateRandomAddress();

describe('MakerDAOBudgetManager', () => {
  let governor: SignerWithAddress;
  let dai: FakeContract<IERC20>;
  let keep3r: FakeContract<IKeep3rV2>;
  let vest: FakeContract<IDssVest>;
  let daiJoin: FakeContract<IDaiJoin>;

  let budgetManager: MockContract<MakerDAOBudgetManager>;

  let snapshotId: string;

  const MIN_BUFFER = toUnit(4_000);
  const MAX_BUFFER = toUnit(20_000);

  const KEEP3R_ADDRESS = '0x4A6cFf9E1456eAa3b6f37572395C6fa0c959edAB';
  const JOB_ADDRESS = '0x28937B751050FcFd47Fd49165C6E1268c296BA19';
  const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
  const VEST_ADDRESS = '0x2Cc583c0AaCDaC9e23CB601fDA8F1A0c56Cdcb71';
  const JOIN_ADDRESS = '0x9759A6Ac90977b93B58547b4A71c78317f391A28';
  const VOW_ADDRESS = '0xA950524441892A31ebddF91d3cEEFa04Bf454466';

  before(async () => {
    [, governor] = await ethers.getSigners();

    keep3r = await smock.fake<IKeep3rV2>('IKeep3rV2', { address: KEEP3R_ADDRESS });
    dai = await smock.fake<IERC20>('IERC20', { address: DAI_ADDRESS });
    vest = await smock.fake<IDssVest>('IDssVest', { address: VEST_ADDRESS });
    daiJoin = await smock.fake<IDaiJoin>('IDaiJoin', { address: JOIN_ADDRESS });

    const budgetManagerFactory = await smock.mock<MakerDAOBudgetManager__factory>('MakerDAOBudgetManager');
    budgetManager = await budgetManagerFactory.deploy(governor.address, JOB_ADDRESS, MIN_BUFFER, MAX_BUFFER, 0);

    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  describe('invoiceGas', () => {
    const ETH_AMOUNT = toUnit(1);
    const DAI_AMOUNT = toUnit(1000);
    const DESCRIPTION = 'INVOICE DESCRIPTION';

    onlyGovernor(
      () => budgetManager,
      'invoiceGas',
      () => governor,
      () => [ETH_AMOUNT, DAI_AMOUNT, DESCRIPTION]
    );

    let tx: Transaction;
    let daiAccountance: BigNumber;

    beforeEach(async () => {
      daiAccountance = await budgetManager.daiToClaim();

      tx = await budgetManager.connect(governor).invoiceGas(ETH_AMOUNT, DAI_AMOUNT, DESCRIPTION);
    });

    it('should increase claimable DAI accountance', async () => {
      const postDaiAccountance = await budgetManager.daiToClaim();
      expect(postDaiAccountance.sub(daiAccountance)).to.be.eq(DAI_AMOUNT);
    });

    it('should emit event', async () => {
      await expect(tx).to.emit(budgetManager, 'InvoicedGas').withArgs(1, ETH_AMOUNT, DAI_AMOUNT, DESCRIPTION);
    });

    /* TODO: add deleteInvoice test*/
  });

  describe('deleteInvoice', () => {
    let tx: Transaction;

    const DAI_TO_CLAIM = toUnit(10_000);
    const INVOICED_DAI = toUnit(1_000);

    beforeEach(async () => {
      await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
      await budgetManager.setVariable('invoiceAmount', { 1: INVOICED_DAI });
    });

    /* TODO: add onlyGovernor test */
    it('should revert if invoice already been claimed', async () => {
      await budgetManager.setVariable('daiToClaim', 0);

      await expect(budgetManager.connect(governor).deleteInvoice(1)).to.be.revertedWith('InvoiceClaimed');
    });

    it('should reduce DAI debt by invoice amount', async () => {
      await budgetManager.connect(governor).deleteInvoice(1);

      expect(await budgetManager.daiToClaim()).to.be.eq(DAI_TO_CLAIM.sub(INVOICED_DAI));
    });

    it('should emit event', async () => {
      tx = await budgetManager.connect(governor).deleteInvoice(1);
      await expect(tx).to.emit(budgetManager, 'DeletedInvoice').withArgs(1);
    });
  });

  describe('claimDai', () => {
    /* TODO: add onlyGovernor test */
    let tx: Transaction;

    context('when transferred DAI is less than minBuffer', () => {
      const DAI_TRANSFERRED = toUnit(1000);

      beforeEach(async () => {
        dai.balanceOf.returnsAtCall(0, 0);
        dai.balanceOf.returnsAtCall(1, DAI_TRANSFERRED);
      });

      it('should revert', async () => {
        await expect(budgetManager.connect(governor).claimDai()).to.be.revertedWith('MinBuffer');
      });
    });

    context('when transferred DAI is greater than minBuffer', () => {
      const DAI_TRANSFERRED = toUnit(10_000);

      beforeEach(async () => {
        dai.balanceOf.reset();
        daiJoin.join.reset();
        keep3r.jobTokenCredits.reset();
        vest['vest(uint256)'].reset();

        dai.balanceOf.returnsAtCall(0, 0);
        dai.balanceOf.returnsAtCall(1, DAI_TRANSFERRED);
        keep3r.jobTokenCredits.returns(MIN_BUFFER); // no need to act
      });

      it('should query DAI balance twice', async () => {
        await budgetManager.connect(governor).claimDai();
        expect(dai.balanceOf).to.have.been.calledTwice;
        expect(dai.balanceOf).to.have.been.calledWith(budgetManager.address);
      });

      it('should call DSS Vest', async () => {
        /* TODO: add arguments VEST_ID & add to constructor */
        tx = await budgetManager.connect(governor).claimDai();
        expect(vest['vest(uint256)']).to.have.been.calledOnce;
      });

      it('should query DAI credits on Keep3r', async () => {
        await budgetManager.connect(governor).claimDai();
        expect(keep3r.jobTokenCredits).to.have.been.calledOnceWith(JOB_ADDRESS, DAI_ADDRESS);
      });

      it('should return all DAI if there are no debts', async () => {
        await budgetManager.connect(governor).claimDai();
        expect(daiJoin.join).to.have.been.calledOnceWith(VOW_ADDRESS, DAI_TRANSFERRED);
      });

      context('when there is DAI debt', () => {
        context('when DAI debt is less than minBuffer', () => {
          const DAI_TO_CLAIM = toUnit(1000);

          beforeEach(async () => {
            await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
            tx = await budgetManager.connect(governor).claimDai();
          });

          it('should not reduce DAI debt', async () => {
            expect(await budgetManager.daiToClaim()).to.be.eq(DAI_TO_CLAIM);
          });

          /* TODO: remove minBuffer error revert */
          it.skip('should not emit event', async () => {
            await expect(tx).not.to.emit(budgetManager, 'ClaimedDai');
          });
        });

        context('when DAI debt is greater than minBuffer', () => {
          const DAI_TO_CLAIM = toUnit(5000);
          beforeEach(async () => {
            await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
            tx = await budgetManager.connect(governor).claimDai();
          });

          it('should reduce DAI debt', async () => {
            expect(await budgetManager.daiToClaim()).to.be.eq(0);
          });

          it('should return any excess of DAI', async () => {
            expect(daiJoin.join).to.have.been.calledOnceWith(VOW_ADDRESS, DAI_TRANSFERRED.sub(DAI_TO_CLAIM));
          });

          it('should emit event', async () => {
            await expect(tx).to.emit(budgetManager, 'ClaimedDai').withArgs(0, DAI_TO_CLAIM, 0, DAI_TRANSFERRED.sub(DAI_TO_CLAIM));
          });
        });

        context('when DAI debt is greater than transferred DAI', () => {
          const DAI_TO_CLAIM = toUnit(15_000);
          beforeEach(async () => {
            await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
            tx = await budgetManager.connect(governor).claimDai();
          });

          it('should reduce DAI debt by transferred DAI', async () => {
            expect(await budgetManager.daiToClaim()).to.be.eq(DAI_TO_CLAIM.sub(DAI_TRANSFERRED));
          });

          it('should emit event', async () => {
            await expect(tx).to.emit(budgetManager, 'ClaimedDai').withArgs(0, DAI_TRANSFERRED, 0, 0);
          });
        });

        context('when DAI transferred is greater than maxBuffer', () => {
          const DAI_TO_CLAIM = toUnit(50_000);
          const DAI_TRANSFERRED = toUnit(100_000);

          beforeEach(async () => {
            dai.balanceOf.reset();
            dai.balanceOf.returnsAtCall(1, DAI_TRANSFERRED);

            await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
            tx = await budgetManager.connect(governor).claimDai();
          });

          it('should reduce DAI debt by maxBuffer DAI', async () => {
            expect(await budgetManager.daiToClaim()).to.be.eq(DAI_TO_CLAIM.sub(MAX_BUFFER));
          });

          it('should return any excess of DAI', async () => {
            expect(daiJoin.join).to.have.been.calledOnceWith(VOW_ADDRESS, DAI_TRANSFERRED.sub(MAX_BUFFER));
          });

          it('should emit event', async () => {
            await expect(tx).to.emit(budgetManager, 'ClaimedDai').withArgs(0, MAX_BUFFER, 0, DAI_TRANSFERRED.sub(MAX_BUFFER));
          });
        });
      });

      context('when DAI credits should be refilled', () => {
        beforeEach(async () => {
          dai.approve.reset();
          keep3r.addTokenCreditsToJob.reset();
          keep3r.jobTokenCredits.reset();
          keep3r.jobTokenCredits.returns(0);
        });

        it('should call DAI approve once', async () => {
          await budgetManager.connect(governor).claimDai();
          expect(dai.approve).to.have.been.calledOnceWith(KEEP3R_ADDRESS, DAI_TRANSFERRED);
        });

        it('should refill DAI credits', async () => {
          await budgetManager.connect(governor).claimDai();
          expect(keep3r.addTokenCreditsToJob).to.have.been.calledOnceWith(JOB_ADDRESS, DAI_ADDRESS, DAI_TRANSFERRED);
        });

        it('should return any excess of DAI', async () => {
          daiJoin.join.reset();

          const DAI_TRANSFERRED = toUnit(100_000);
          dai.balanceOf.returnsAtCall(1, DAI_TRANSFERRED);

          const CURRENT_CREDITS = toUnit(1_000);
          keep3r.jobTokenCredits.returns(CURRENT_CREDITS);

          await budgetManager.connect(governor).claimDai();

          expect(daiJoin.join).to.have.been.calledOnceWith(VOW_ADDRESS, DAI_TRANSFERRED.sub(MAX_BUFFER.sub(CURRENT_CREDITS)));
        });

        it('should emit event', async () => {
          tx = await budgetManager.connect(governor).claimDai();
          await expect(tx).to.emit(budgetManager, 'ClaimedDai').withArgs(0, 0, DAI_TRANSFERRED, 0);
        });
      });
    });
  });
});
