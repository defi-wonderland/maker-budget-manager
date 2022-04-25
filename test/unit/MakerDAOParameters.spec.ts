import { FakeContract, smock } from '@defi-wonderland/smock';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { MakerDAOParameters, MakerDAOParameters__factory, IDssVest, IDssVest__factory } from '@typechained';
import { onlyMaker } from '@utils/behaviours';
import { behaviours, wallet } from '@utils';
import { toUnit } from '@utils/bn';
import { expect } from 'chai';
import { Contract, Transaction } from 'ethers';
import { ethers } from 'hardhat';
import { JsonRpcSigner } from '@ethersproject/providers';

describe('MakerDAOParameters', () => {
  let parameters: MakerDAOParameters;
  let parametersFactory: MakerDAOParameters__factory;
  let maker: JsonRpcSigner;

  let dssVest: FakeContract<IDssVest>;
  const DSS_VEST = '0x2Cc583c0AaCDaC9e23CB601fDA8F1A0c56Cdcb71';

  const newMinBuffer = toUnit(1_000);
  const newMaxBuffer = toUnit(10_000);
  const newVestId = 42;

  before(async () => {
    // TODO: replace for MakerDAO provided address
    maker = await wallet.impersonate('0x6B175474E89094C44Da98b954EedeAC495271d0F');
    await wallet.setBalance({ account: maker._address, balance: toUnit(1) });

    parametersFactory = (await ethers.getContractFactory('MakerDAOParameters', maker)) as MakerDAOParameters__factory;
  });

  beforeEach(async () => {
    dssVest = await smock.fake<IDssVest>('IDssVest', { address: DSS_VEST });

    parameters = await parametersFactory.deploy();
  });

  describe('setBuffer', () => {
    let tx: Transaction;

    beforeEach(async () => {
      tx = await parameters.setBuffer(newMinBuffer, newMaxBuffer);
    });

    onlyMaker(
      () => parameters,
      'setBuffer',
      () => maker,
      () => [newMinBuffer, newMaxBuffer]
    );

    it('should set the specified buffer', async () => {
      expect(await parameters.buffer()).to.be.deep.eq([newMinBuffer, newMaxBuffer]);
    });

    it('should emit event', async () => {
      await expect(tx).to.be.emit(parameters, 'BufferSet').withArgs(newMinBuffer, newMaxBuffer);
    });
  });

  describe('setVestId', () => {
    let tx: Transaction;
    const randomAddress = wallet.generateRandomAddress();

    it('should fail if vestId is inexistent', async () => {
      await expect(parameters.setVestId(newVestId)).to.be.revertedWith('IncorrectVestId');
    });

    it('should fail if vestId is incorrect', async () => {
      dssVest.awards.returns([randomAddress, 0, 0, 0, randomAddress, 0, 0, 0]);

      await expect(parameters.setVestId(newVestId)).to.be.revertedWith('IncorrectVestId');
    });

    context('when vestId is correct', () => {
      beforeEach(async () => {
        dssVest.awards.returns([parameters.address, 0, 0, 0, randomAddress, 0, 0, 0]);
      });

      onlyMaker(
        () => parameters,
        'setVestId',
        () => maker,
        () => [newVestId]
      );

      it('should set the specified vestId', async () => {
        await parameters.setVestId(newVestId);

        expect(await parameters.vestId()).to.be.eq(newVestId);
      });

      it('should emit event', async () => {
        const BEGIN = 10;
        const CLIFF = 20;
        const FIN = 30;
        const TOTAL = 40;

        dssVest.awards.returns([parameters.address, BEGIN, CLIFF, FIN, randomAddress, 0, TOTAL, 0]);

        tx = await parameters.setVestId(newVestId);

        await expect(tx).to.be.emit(parameters, 'VestSet').withArgs(newVestId, BEGIN, CLIFF, FIN, TOTAL);
      });
    });
  });
});
