import { FakeContract, MockContract, MockContractFactory, smock } from '@defi-wonderland/smock';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MakerDAOBudgetManager, MakerDAOBudgetManager__factory, IKeep3rV2, IERC20, IDssVest } from '@typechained';
import { evm, wallet } from '@utils';
import { onlyGovernor } from '@utils/behaviours';
import { toUnit } from '@utils/bn';
import chai, { expect } from 'chai';
import { BigNumber, Transaction } from 'ethers';
import { ethers } from 'hardhat';

chai.use(smock.matchers);

describe.only('MakerDAOBudgetManager', () => {
  let governor: SignerWithAddress;
  let dai: FakeContract<IERC20>;
  let keep3r: FakeContract<IKeep3rV2>;
  let vest: FakeContract<IDssVest>;

  let budgetManager: MockContract<MakerDAOBudgetManager>;

  let snapshotId: string;

  const MIN_BUFFER = toUnit(4_000);
  const MAX_BUFFER = toUnit(20_000);

  const JOB_ADDRESS = '0x28937B751050FcFd47Fd49165C6E1268c296BA19';
  const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

  before(async () => {
    [, governor] = await ethers.getSigners();

    keep3r = await smock.fake<IKeep3rV2>('IKeep3rV2', { address: '0x4A6cFf9E1456eAa3b6f37572395C6fa0c959edAB' });
    dai = await smock.fake<IERC20>('IERC20', { address: DAI_ADDRESS });
    vest = await smock.fake<IDssVest>('IDssVest', { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' });

    const budgetManagerFactory = await smock.mock<MakerDAOBudgetManager__factory>('MakerDAOBudgetManager');
    budgetManager = await budgetManagerFactory.deploy(governor.address, MIN_BUFFER, MAX_BUFFER);

    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  describe('buffer', () => {
    beforeEach(async () => {
      keep3r.jobTokenCredits.returns(MIN_BUFFER);
    });

    it('should query Keep3r DAI credits', async () => {
      await budgetManager.buffer();

      expect(keep3r.jobTokenCredits).to.have.been.calledOnceWith(JOB_ADDRESS, DAI_ADDRESS);
    });

    it('should return credits - daiToClaim', async () => {
      const daiToClaim = toUnit(1_000);
      await budgetManager.setVariable('daiToClaim', daiToClaim);

      const buffer = await budgetManager.buffer();
      expect(buffer).to.be.eq(MIN_BUFFER.sub(daiToClaim));
    });
  });

  describe('invoiceGas', () => {
    // it('should be onlyGovernor')
    const ETH_AMOUNT = toUnit(1);
    const DAI_AMOUNT = toUnit(1000);
    const DESCRIPTION = 'INVOICE DESCRIPTION';

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
  });

  describe('claimDai', () => {
    let tx: Transaction;

    context('when buffer is greater than minBuffer', () => {
      it('should revert', async () => {
        keep3r.jobTokenCredits.returns(MIN_BUFFER);
        await expect(budgetManager.connect(governor).claimDai()).to.be.revertedWith('MinBuffer');
      });
    });

    context('when buffer is less than minBuffer', () => {
      const DAI_TRANSFERRED = toUnit(5000);
      const DAI_TO_CLAIM = toUnit(1000);

      beforeEach(async () => {
        vest['vest(uint256)'].reset();
        dai.balanceOf.reset();
        keep3r.jobTokenCredits.reset();

        dai.balanceOf.returnsAtCall(0, 0);
        dai.balanceOf.returnsAtCall(1, DAI_TRANSFERRED);
        keep3r.jobTokenCredits.returns(MIN_BUFFER);

        await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
      });

      /* TODO: add call arguments */
      it('should query DAI balance twice', async () => {
        tx = await budgetManager.connect(governor).claimDai();
        expect(dai.balanceOf).to.have.been.calledTwice; //.withArgs(budgetManager.address);
      });

      /* TODO: add arguments VEST_ID & add to constructor */
      it('should call DSS Vest', async () => {
        tx = await budgetManager.connect(governor).claimDai();
        expect(vest['vest(uint256)']).to.have.been.calledOnce;
      });

      /* TODO: reduce to 1 call to jobTokenCredits */
      it.skip('should query DAI credits on Keep3r', async () => {
        tx = await budgetManager.connect(governor).claimDai();
        expect(keep3r.jobTokenCredits).to.have.been.calledOnce;
      });

      it('should reduce DAI debt', async () => {
        tx = await budgetManager.connect(governor).claimDai();
        expect(await budgetManager.daiToClaim()).to.be.eq(0);
      });

      it('should emit event', async () => {
        tx = await budgetManager.connect(governor).claimDai();
        await expect(tx).to.emit(budgetManager, 'ClaimedDai'); //.withArgs
      });

      context('when credits need refill', () => {
        const USED_CREDITS = toUnit(1000);

        beforeEach(async () => {
          keep3r.jobTokenCredits.reset();
          keep3r.addTokenCreditsToJob.reset();
          keep3r.jobTokenCredits.returns(MIN_BUFFER.sub(USED_CREDITS));
        });

        it('should approve DAI expenditure', async () => {
          tx = await budgetManager.connect(governor).claimDai();
          expect(dai.approve).to.have.been.calledOnceWith(keep3r.address, USED_CREDITS);
        });

        it('should add DAI to job', async () => {
          tx = await budgetManager.connect(governor).claimDai();
          expect(keep3r.addTokenCreditsToJob).to.have.been.calledOnceWith(JOB_ADDRESS, DAI_ADDRESS, USED_CREDITS);
        });

        /* TODO: credits refill should not be accounted in daiToClaim */
        it.skip('should not reduce claimed DAI accountance', async () => {
          const beforeDaiToClaim = await budgetManager.daiToClaim();
          tx = await budgetManager.connect(governor).claimDai();
          const postDaiToClaim = await budgetManager.daiToClaim();

          expect(beforeDaiToClaim).to.be.eq(postDaiToClaim);
        });

        it('should emit event', async () => {
          tx = await budgetManager.connect(governor).claimDai();

          await expect(tx).to.emit(budgetManager, 'TokenCreditsRefilled').withArgs(USED_CREDITS);
        });
      });
    });

    context('when claimed DAI is greater than maxBuffer', () => {
      const STREAMED_DAI = toUnit(100_000);
      const RETURNED_DAI = STREAMED_DAI.sub(MAX_BUFFER);

      beforeEach(async () => {
        dai.transfer.reset();
        dai.balanceOf.reset();

        dai.balanceOf.returnsAtCall(0, 0);
        dai.balanceOf.returnsAtCall(1, STREAMED_DAI);

        keep3r.jobTokenCredits.reset();
        keep3r.jobTokenCredits.returns(MIN_BUFFER);

        // contract can claim 100k DAI
        await budgetManager.setVariable('daiToClaim', toUnit(100_000));
      });

      it('should return DAI difference', async () => {
        tx = await budgetManager.connect(governor).claimDai();

        /* TODO: change destination and return mechanism */
        expect(dai.transfer).to.have.been.calledOnceWith(DAI_ADDRESS, RETURNED_DAI);
      });

      it('should emit event', async () => {
        tx = await budgetManager.connect(governor).claimDai();

        await expect(tx).to.emit(budgetManager, 'DaiReturned').withArgs(RETURNED_DAI);
      });
    });
  });
});
