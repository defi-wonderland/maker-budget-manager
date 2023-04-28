import { FakeContract, MockContract, smock } from '@defi-wonderland/smock';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MakerDAOBudgetManager, MakerDAOBudgetManager__factory, IKeep3rV2, IERC20, INetworkPaymentAdapter } from '@typechained';
import { evm, wallet } from '@utils';
import { onlyGovernor, onlyKeeper } from '@utils/behaviours';
import { toUnit } from '@utils/bn';
import chai, { expect } from 'chai';
import { BigNumber, Transaction } from 'ethers';
import { ethers } from 'hardhat';
chai.use(smock.matchers);

describe('MakerDAOBudgetManager', () => {
  let governor: SignerWithAddress;
  let keeper: SignerWithAddress;
  let dai: FakeContract<IERC20>;
  let keep3r: FakeContract<IKeep3rV2>;
  let networkPaymentAdapter: FakeContract<INetworkPaymentAdapter>;

  let budgetManager: MockContract<MakerDAOBudgetManager>;

  let snapshotId: string;

  const MAX_BUFFER = toUnit(20_000);

  const KEEP3R_ADDRESS = '0xeb02addCfD8B773A5FFA6B9d1FE99c566f8c44CC';
  const JOB_ADDRESS = '0x5D469E1ef75507b0E0439667ae45e280b9D81B9C';
  const DAI_ADDRESS = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
  const NPA_ADDRESS = '0xaeFed819b6657B3960A8515863abe0529Dfc444A';

  before(async () => {
    [, governor, keeper] = await ethers.getSigners();

    keep3r = await smock.fake<IKeep3rV2>('IKeep3rV2', { address: KEEP3R_ADDRESS });
    dai = await smock.fake<IERC20>('IERC20', { address: DAI_ADDRESS });
    networkPaymentAdapter = await smock.fake<INetworkPaymentAdapter>('INetworkPaymentAdapter', { address: NPA_ADDRESS });

    const budgetManagerFactory = await smock.mock<MakerDAOBudgetManager__factory>('MakerDAOBudgetManager');
    budgetManager = await budgetManagerFactory.deploy(governor.address);

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

    it('should increase invoice nonce', async () => {
      expect(await budgetManager.invoiceNonce()).to.be.eq(1);
      await budgetManager.connect(governor).invoiceGas(ETH_AMOUNT, DAI_AMOUNT, DESCRIPTION);

      expect(await budgetManager.invoiceNonce()).to.be.eq(2);
    });

    it('should emit event', async () => {
      await expect(tx).to.emit(budgetManager, 'InvoicedGas').withArgs(1, ETH_AMOUNT, DAI_AMOUNT, DESCRIPTION);
    });
  });

  describe('deleteInvoice', () => {
    let tx: Transaction;

    const DAI_TO_CLAIM = toUnit(10_000);
    const INVOICED_DAI = toUnit(1_000);

    beforeEach(async () => {
      await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
      await budgetManager.setVariable('invoiceAmount', { 1: INVOICED_DAI });
    });

    onlyGovernor(
      () => budgetManager,
      'deleteInvoice',
      () => governor,
      () => [1]
    );

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
    let tx: Transaction;

    context('when transferred DAI is greater than minBuffer', () => {
      beforeEach(async () => {
        networkPaymentAdapter['topUp'].reset();
        await budgetManager.connect(governor).claimDai();
      });

      onlyGovernor(
        () => budgetManager,
        'claimDai',
        () => governor,
        () => []
      );

      it('should call NPA topUp', async () => {
        expect(networkPaymentAdapter['topUp']).to.have.been.called;
      });
    });

    context('when DAI debt is smaller than dai streamed', async () => {
      const DAI_TO_CLAIM = toUnit(5_000);
      const DAI_TO_STREAMED = toUnit(1_000);
      beforeEach(async () => {
        networkPaymentAdapter.topUp.returns(DAI_TO_STREAMED);
        await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
        tx = await budgetManager.connect(governor).claimDai();
      });

      it('should reduce DAI debt', async () => {
        expect(await budgetManager.daiToClaim()).to.be.eq(DAI_TO_CLAIM.sub(DAI_TO_STREAMED));
      });

      it('should not refill credits', async () => {
        expect(dai.approve).to.not.have.been.called;
        expect(keep3r.addTokenCreditsToJob).to.not.have.been.called;
      });

      it('should emit event', async () => {
        await expect(tx).to.emit(budgetManager, 'ClaimedDai').withArgs(DAI_TO_STREAMED, 0);
      });
    });

    context('when DAI debt is equal to dai streamed', () => {
      const DAI_TO_CLAIM = toUnit(5_000);
      const DAI_TO_STREAMED = DAI_TO_CLAIM;
      beforeEach(async () => {
        networkPaymentAdapter.topUp.returns(DAI_TO_STREAMED);
        await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
        tx = await budgetManager.connect(governor).claimDai();
      });

      it('should reduce DAI debt to 0', async () => {
        expect(await budgetManager.daiToClaim()).to.be.eq(0);
      });

      it('should not refill credits', async () => {
        expect(dai.approve).to.not.have.been.called;
        expect(keep3r.addTokenCreditsToJob).to.not.have.been.called;
      });

      it('should emit event', async () => {
        await expect(tx).to.emit(budgetManager, 'ClaimedDai').withArgs(DAI_TO_STREAMED, 0);
      });
    });

    context('when DAI credits should be refilled', () => {
      const DAI_TO_STREAMED = toUnit(10_000);
      const DAI_TO_CLAIM = toUnit(5_000);
      beforeEach(async () => {
        dai.approve.reset();
        keep3r.addTokenCreditsToJob.reset();
        await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
        networkPaymentAdapter.topUp.returns(DAI_TO_STREAMED);
        await budgetManager.connect(governor).claimDai();
      });

      it('should reduce DAI debt', async () => {
        expect(await budgetManager.daiToClaim()).to.be.eq(0);
      });

      it('should call DAI approve once', async () => {
        expect(dai.approve).to.have.been.calledOnceWith(KEEP3R_ADDRESS, DAI_TO_STREAMED.sub(DAI_TO_CLAIM));
      });

      it('should refill DAI credits', async () => {
        expect(keep3r.addTokenCreditsToJob).to.have.been.calledOnceWith(JOB_ADDRESS, DAI_ADDRESS, DAI_TO_STREAMED.sub(DAI_TO_CLAIM));
      });

      it('should emit event', async () => {
        await expect(tx).to.emit(budgetManager, 'ClaimedDai').withArgs(DAI_TO_CLAIM, DAI_TO_STREAMED.sub(DAI_TO_CLAIM));
      });
    });

    context('when DAI streamed is greater than refilled plus claim', () => {
      const DAI_TO_STREAMED = toUnit(40_000);
      const DAI_TO_CLAIM = toUnit(5_000);
      beforeEach(async () => {
        dai.approve.reset();
        keep3r.addTokenCreditsToJob.reset();
        await budgetManager.setVariable('daiToClaim', DAI_TO_CLAIM);
        networkPaymentAdapter.topUp.returns(DAI_TO_STREAMED);
        await budgetManager.connect(governor).claimDai();
      });

      it('should reduce DAI debt', async () => {
        expect(await budgetManager.daiToClaim()).to.be.eq(0);
      });

      it('should DAI credits be greater than max buffer', async () => {
        expect(keep3r.addTokenCreditsToJob).to.have.been.calledWith(JOB_ADDRESS, DAI_ADDRESS, DAI_TO_STREAMED.sub(DAI_TO_CLAIM));
        expect(DAI_TO_STREAMED.sub(DAI_TO_CLAIM)).to.be.greaterThan(MAX_BUFFER);
      });
    });
  });

  describe('claimUpkeep', () => {
    beforeEach(async () => {
      await budgetManager.connect(governor).setKeeper(keeper.address);
    });

    onlyKeeper(
      () => budgetManager,
      'claimDaiUpkeep',
      () => keeper,
      () => []
    );
  });

  describe('setKeep3rJob', () => {
    let tx: Transaction;
    const randomKeep3r = wallet.generateRandomAddress();
    const randomJob = wallet.generateRandomAddress();

    onlyGovernor(
      () => budgetManager,
      'setKeep3rJob',
      () => governor,
      () => [randomKeep3r, randomJob]
    );

    it('should set the keep3r address', async () => {
      await budgetManager.connect(governor).setKeep3rJob(randomKeep3r, randomJob);

      expect(await budgetManager.keep3r()).to.be.deep.eq(randomKeep3r);
      expect(await budgetManager.job()).to.be.deep.eq(randomJob);
    });

    it('should emit event', async () => {
      tx = await budgetManager.connect(governor).setKeep3rJob(randomKeep3r, randomJob);

      await expect(tx).to.emit(budgetManager, 'Keep3rJobSet').withArgs(randomKeep3r, randomJob);
    });
  });

  describe('setKeeper', () => {
    let tx: Transaction;
    const randomKeeper = wallet.generateRandomAddress();

    onlyGovernor(
      () => budgetManager,
      'setKeeper',
      () => governor,
      () => [randomKeeper]
    );

    it('should set the keeper address', async () => {
      await budgetManager.connect(governor).setKeeper(randomKeeper);

      expect(await budgetManager.keeper()).to.be.deep.eq(randomKeeper);
    });

    it('should emit event', async () => {
      tx = await budgetManager.connect(governor).setKeeper(randomKeeper);

      await expect(tx).to.emit(budgetManager, 'KeeperSet').withArgs(randomKeeper);
    });
  });

  describe('setNetworkPaymentAdapter', () => {
    let tx: Transaction;
    const randomNetworkPaymentAdapter = wallet.generateRandomAddress();

    onlyGovernor(
      () => budgetManager,
      'setNetworkPaymentAdapter',
      () => governor,
      () => [randomNetworkPaymentAdapter]
    );

    it('should set the keeper address', async () => {
      await budgetManager.connect(governor).setNetworkPaymentAdapter(randomNetworkPaymentAdapter);

      expect(await budgetManager.networkPaymentAdapter()).to.be.deep.eq(randomNetworkPaymentAdapter);
    });

    it('should emit event', async () => {
      tx = await budgetManager.connect(governor).setNetworkPaymentAdapter(randomNetworkPaymentAdapter);

      await expect(tx).to.emit(budgetManager, 'NetworkPaymentAdapterSet').withArgs(randomNetworkPaymentAdapter);
    });
  });
});
