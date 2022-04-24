import { getMainnetSdk } from '@dethcrypto/eth-sdk-client';
import { Dai, Vest, Keep3r } from '@eth-sdk-types';
import { TransactionResponse } from '@ethersproject/abstract-provider';
import { JsonRpcSigner } from '@ethersproject/providers';
import { BigNumber, utils } from 'ethers';
import { MakerDAOBudgetManager, MakerDAOBudgetManager__factory, JobForTest, JobForTest__factory } from '@typechained';
import { ethers } from 'hardhat';
import { evm, wallet, bn } from '@utils';
import { given, then, when } from '@utils/bdd';
import { expect } from 'chai';
import { getNodeUrl } from 'utils/env';
import forkBlockNumber from './fork-block-numbers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

const daiWhaleAddress = '0x16463c0fdb6ba9618909f5b120ea1581618c1b9e';
const vestProxyAddress = '0xBE8E3e3618f7474F8cB1d074A26afFef007E98FB';

describe('MakerDAOBudgetManager @skip-on-coverage', () => {
  let deployer: SignerWithAddress;
  let stranger: SignerWithAddress;
  let governance: SignerWithAddress;
  let vestProxy: JsonRpcSigner;
  let daiWhale: JsonRpcSigner;
  let dai: Dai;
  let vest: Vest;
  let job: JobForTest;
  let keep3r: Keep3r;
  let snapshotId: string;
  let budgetManager: MakerDAOBudgetManager;

  const DAY = 86400;
  const DELTA = bn.toUnit(0.1).toString();

  const MIN_BUFFER = bn.toUnit(4_000);
  const MAX_BUFFER = bn.toUnit(20_000);

  before(async () => {
    [deployer, stranger, governance] = await ethers.getSigners();

    await evm.reset({
      jsonRpcUrl: getNodeUrl('ethereum'),
      blockNumber: forkBlockNumber.keep3r,
    });

    const sdk = getMainnetSdk(stranger);
    dai = sdk.dai;
    vest = sdk.vest;
    keep3r = sdk.keep3r;

    wallet.setBalance({ account: vestProxyAddress, balance: bn.toUnit(10) });
    vestProxy = await wallet.impersonate(vestProxyAddress);
    daiWhale = await wallet.impersonate(daiWhaleAddress);

    // add job to Keep3r
    const jobFactory = (await ethers.getContractFactory('JobForTest')) as JobForTest__factory;
    job = await jobFactory.deploy(keep3r.address);
    await keep3r.addJob(job.address);

    // add vest
    const TOTAL_VEST_AMOUNT = bn.toUnit(365_000);
    const START_TIMESTAMP = (await ethers.provider.getBlock('latest')).timestamp;
    const DURATION = 365 * DAY; // 1yr
    const CLIFF = 1; // 1000 DAI / day ?

    const budgetManagerNonce = await ethers.provider.getTransactionCount(deployer.address);
    const budgetManagerAddress = ethers.utils.getContractAddress({ from: deployer.address, nonce: budgetManagerNonce });

    /* TODO: set adequate vest parameters */
    await vest.connect(vestProxy).create(budgetManagerAddress, TOTAL_VEST_AMOUNT, START_TIMESTAMP, DURATION, CLIFF, stranger.address);
    const vestID = await vest.ids();

    // setup budget manager
    const budgetManagerFactory = (await ethers.getContractFactory('MakerDAOBudgetManager')) as MakerDAOBudgetManager__factory;
    budgetManager = await budgetManagerFactory.connect(deployer).deploy(governance.address, job.address, MIN_BUFFER, MAX_BUFFER, vestID);

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
      await budgetManager.connect(governance).invoiceGas(0, bn.toUnit(10_000), 'TEST');
      // needed to claim because of minBuffer
      await evm.advanceTimeAndBlock(4 * DAY);
      await budgetManager.connect(governance).claimDai();

      expect(await dai.balanceOf(budgetManager.address)).to.be.gt(0);
    });

    it('should be able to return surplus DAI', async () => {
      await evm.advanceTimeAndBlock(10 * DAY);
      await budgetManager.connect(governance).claimDai();
      // minBuffer is already filled

      await evm.advanceTimeAndBlock(10 * DAY);
      // should return the 10k
      await budgetManager.connect(governance).claimDai();
    });

    it('should be able to refill DAI credits', async () => {
      await evm.advanceTimeAndBlock(10 * DAY);
      // refills job with 10k DAI
      const expectedDai = bn.toUnit(10_000);
      await budgetManager.connect(governance).claimDai();

      const expectedCredits = expectedDai.mul(997).div(1000);
      const initialCredits = await keep3r.jobTokenCredits(job.address, dai.address);

      expect(initialCredits).to.be.closeTo(expectedCredits, DELTA);

      const THOUSAND = bn.toUnit(1_000);

      await job.workForDAIs(THOUSAND);
      await job.workForDAIs(THOUSAND);
      await job.workForDAIs(THOUSAND);
      await job.workForDAIs(THOUSAND);

      // expected credits: ~6k
      await expect(budgetManager.connect(governance).claimDai()).to.be.revertedWith('MinBuffer');

      // expected credits: ~4k
      await job.workForDAIs(THOUSAND.mul(2));

      await evm.advanceTimeAndBlock(5 * DAY);
      await budgetManager.connect(governance).claimDai();
      // expected credits: ~9k

      const credits = await keep3r.jobTokenCredits(job.address, dai.address);
      expect(credits).to.be.closeTo(bn.toUnit(9_000), bn.toUnit(1000));
    });
  });
});
