import { getMainnetSdk } from '@dethcrypto/eth-sdk-client';
import { Dai, NetworkPaymentAdapter, Keep3r, Vest } from '@eth-sdk-types';
import { MakerDAOBudgetManager, MakerDAOBudgetManager__factory, JobForTest, JobForTest__factory } from '@typechained';
import { ethers } from 'hardhat';
import { evm, wallet, bn } from '@utils';
import { expect } from 'chai';
import { getNodeUrl } from 'utils/env';
import forkBlockNumber from './fork-block-numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

const makerAddress = '0xBE8E3e3618f7474F8cB1d074A26afFef007E98FB';

describe('MakerDAOBudgetManager @skip-on-coverage', () => {
  let deployer: SignerWithAddress;
  let stranger: SignerWithAddress;
  let governance: SignerWithAddress;
  let dai: Dai;
  let vest: Vest;
  let networkPaymentAdapter: NetworkPaymentAdapter;
  let job: JobForTest;
  let keep3r: Keep3r;
  let snapshotId: string;
  let budgetManager: MakerDAOBudgetManager;

  const DAY = 86400;

  before(async () => {
    [deployer, stranger, governance] = await ethers.getSigners();

    await evm.reset({
      jsonRpcUrl: getNodeUrl('ethereum'),
      blockNumber: forkBlockNumber.keep3r,
    });

    const sdk = getMainnetSdk(stranger);
    dai = sdk.dai;
    networkPaymentAdapter = sdk.networkPaymentAdapter;
    keep3r = sdk.keep3r;
    vest = sdk.vest;

    const maker = await wallet.impersonate(makerAddress);

    // setup budget manager
    const budgetManagerFactory = (await ethers.getContractFactory('MakerDAOBudgetManager')) as MakerDAOBudgetManager__factory;
    budgetManager = await budgetManagerFactory.connect(deployer).deploy(governance.address);

    // add vest
    const TOTAL_VEST_AMOUNT = bn.toUnit(365_000);
    const START_TIMESTAMP = (await ethers.provider.getBlock('latest')).timestamp;
    const DURATION = 365 * DAY; // 1yr
    const CLIFF = 1;
    const MAX_BUFFER = bn.toUnit(20_000);
    const MIN_BUFFER = bn.toUnit(4_000);

    await vest.connect(maker).create(networkPaymentAdapter.address, TOTAL_VEST_AMOUNT, START_TIMESTAMP, DURATION, CLIFF, stranger.address);
    const vestID = await vest.ids();

    // add job to Keep3r
    const jobFactory = (await ethers.getContractFactory('JobForTest')) as JobForTest__factory;
    job = await jobFactory.deploy(keep3r.address, budgetManager.address);
    await keep3r.addJob(job.address);

    // Set needed params
    await budgetManager.connect(governance).setKeep3rJob(keep3r.address, job.address);
    await budgetManager.connect(governance).setKeeper(job.address);

    const treasuryFormat = ethers.utils.formatBytes32String('treasury');
    const vestFormat = ethers.utils.formatBytes32String('vestId');
    const maxBufferFormat = ethers.utils.formatBytes32String('bufferMax');
    const minBufferFormat = ethers.utils.formatBytes32String('minimumPayment');

    await networkPaymentAdapter.connect(maker)['file(bytes32,address)'](treasuryFormat, budgetManager.address);
    await networkPaymentAdapter.connect(maker)['file(bytes32,uint256)'](vestFormat, vestID);
    await networkPaymentAdapter.connect(maker)['file(bytes32,uint256)'](maxBufferFormat, MAX_BUFFER);
    await networkPaymentAdapter.connect(maker)['file(bytes32,uint256)'](minBufferFormat, MIN_BUFFER);

    snapshotId = await evm.snapshot.take();
  });
  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  describe('job', () => {
    it('should be able to work for 0', async () => {
      await expect(job.workForKP3Rs(0)).not.to.be.reverted;
      await expect(job.workForDAIs(0)).not.to.be.reverted;
    });
  });

  describe('claim', () => {
    it('should be able to claim invoiced DAI', async () => {
      const invoice = bn.toUnit(8_000);

      // Invoice gas should be dai to claim
      await budgetManager.connect(governance).invoiceGas(0, invoice, 'TEST');
      expect(await budgetManager.daiToClaim()).to.be.eq(invoice);

      // vested expected credits: ~20K
      await evm.advanceTimeAndBlock(20 * DAY);

      // Checks unpaid and dai to claim
      const vested = await vest.unpaid(await vest.ids());
      const daiToClaim = await budgetManager.daiToClaim();
      const expectedRefill = vested.sub(daiToClaim);

      const tx = await budgetManager.connect(governance).claimDai();

      // should emit an event
      expect(tx)
        .to.emit(budgetManager, 'ClaimedDai')
        .withArgs(invoice, expect(expectedRefill).to.be.closeTo(expectedRefill, bn.toUnit(100)));

      // should refound dai to claim
      expect(await dai.balanceOf(budgetManager.address)).to.be.eq(invoice);

      // should refill credits
      const credits = await keep3r.jobTokenCredits(job.address, dai.address);
      expect(credits).to.be.closeTo(expectedRefill, bn.toUnit(100));
    });

    it('should be able to refill DAI credits', async () => {
      await evm.advanceTimeAndBlock(10 * DAY);
      // refills job with 10k DAI
      const expectedDai = await vest.unpaid(await vest.ids());
      await budgetManager.connect(governance).claimDai();

      const expectedCredits = expectedDai.mul(997).div(1000);
      const initialCredits = await keep3r.jobTokenCredits(job.address, dai.address);

      expect(initialCredits).to.be.closeTo(expectedCredits, bn.toUnit(10));

      const THOUSAND = bn.toUnit(1_000);

      await job.workForDAIs(THOUSAND);
      await job.workForDAIs(THOUSAND);
      await job.workForDAIs(THOUSAND);
      await job.workForDAIs(THOUSAND);

      // expected credits: ~6k
      await expect(budgetManager.connect(governance).claimDai()).to.be.revertedWithCustomError(networkPaymentAdapter, 'PendingDaiTooSmall');

      // expected credits: ~4k
      await job.workForDAIs(THOUSAND.mul(2));

      // expected credits: ~9k
      await evm.advanceTimeAndBlock(5 * DAY);
      await budgetManager.connect(governance).claimDai();

      const credits = await keep3r.jobTokenCredits(job.address, dai.address);
      expect(credits).to.be.closeTo(bn.toUnit(9_000), bn.toUnit(100));
    });

    it('should revert as buffer is full', async () => {
      // fullfill buffer
      await evm.advanceTimeAndBlock(20 * DAY);
      await budgetManager.connect(governance).claimDai();

      // try to claim
      await evm.advanceTimeAndBlock(5 * DAY);
      await expect(budgetManager.connect(governance).claimDai()).to.be.revertedWithCustomError(networkPaymentAdapter, 'BufferFull');
    });
  });

  describe('claimUpkeep', () => {
    it('should be able to work without previous credits', async () => {
      expect(await budgetManager.getDaiCredits()).to.be.eq(0);

      const keeperReward = await job.DAI_REWARD();
      await evm.advanceTimeAndBlock(10 * DAY);
      const expectedDAI = await vest.unpaid(await vest.ids());
      const expectedCredits = expectedDAI.mul(997).div(1000); // Keep3r protocol fees

      await job.cleanseDAIs();

      expect(await budgetManager.getDaiCredits()).to.be.closeTo(expectedCredits.sub(keeperReward), bn.toUnit(1));
    });
  });
});
