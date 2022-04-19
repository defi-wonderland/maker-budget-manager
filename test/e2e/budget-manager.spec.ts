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
  let vestProxy: JsonRpcSigner;
  let daiWhale: JsonRpcSigner;
  let dai: Dai;
  let vest: Vest;
  let job: JobForTest;
  let keep3r: Keep3r;
  let snapshotId: string;
  let budgetManager: MakerDAOBudgetManager;

  const MIN_BUFFER = bn.toUnit(4_000);
  const MAX_BUFFER = bn.toUnit(20_000);

  before(async () => {
    [deployer, stranger] = await ethers.getSigners();

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
    const TOTAL_VEST_AMOUNT = bn.toUnit(1_000_000);
    const START_TIMESTAMP = (await ethers.provider.getBlock('latest')).timestamp;
    const DURATION = 86400 * 365; // 1yr
    const CLIFF = 1000; // 1000 DAI / day ?

    const budgetManagerNonce = await ethers.provider.getTransactionCount(deployer.address);
    const budgetManagerAddress = ethers.utils.getContractAddress({ from: deployer.address, nonce: budgetManagerNonce });

    /* TODO: set adequate vest parameters */
    await vest.connect(vestProxy).create(budgetManagerAddress, TOTAL_VEST_AMOUNT, START_TIMESTAMP, DURATION, CLIFF, stranger.address);
    const vestID = await vest.ids();

    // setup budget manager
    const budgetManagerFactory = (await ethers.getContractFactory('MakerDAOBudgetManager')) as MakerDAOBudgetManager__factory;
    budgetManager = await budgetManagerFactory.connect(deployer).deploy(stranger.address, job.address, MIN_BUFFER, MAX_BUFFER, vestID);

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
    it('should be able to claim vested DAI', async () => {
      await budgetManager.connect(stranger).invoiceGas(0, bn.toUnit(10_000), 'TEST');
      await evm.advanceTimeAndBlock(432000);
      await budgetManager.connect(stranger).claimDai();

      expect(await dai.balanceOf(budgetManager.address)).to.be.gt(0);
    });
  });

  describe.skip('DAI credits', () => {
    when('job has less DAI credits than minBuffer', () => {
      let minBuffer: BigNumber;

      beforeEach(async () => {
        minBuffer = await budgetManager.minBuffer();
        await evm.advanceTimeAndBlock(1000000);
        await budgetManager.connect(stranger).claimDai();
      });

      it('should refill credits until minBuffer', async () => {
        expect(await keep3r.jobTokenCredits(job.address, dai.address)).to.be.gt(0);

        await evm.advanceTimeAndBlock(4320000);
        await budgetManager.connect(stranger).claimDai();

        // TODO: handle Keep3r fees
        expect(await keep3r.jobTokenCredits(job.address, dai.address)).to.be.closeTo(minBuffer, bn.toUnit(1).toString());
      });

      it('should return any DAI above minBuffer', async () => {
        expect(await keep3r.jobTokenCredits(job.address, dai.address)).to.be.gt(0);

        await evm.advanceTimeAndBlock(4320000);
        const tx = await budgetManager.connect(stranger).claimDai();

        await expect(tx).to.emit(dai, 'Transfer'); //.withArgs(budgetManager.address, dai.address, )
      });

      it('should revert to claim when reaches minBuffer');
    });
  });
  describe('Gas invoices', () => {
    when('job has gas invoices', () => {
      it('should cancel debt with claimed DAI');
      it('should be able to claim up to maxBuffer at once');
      it('should return any DAI above maxBuffer');
    });
  });
});
