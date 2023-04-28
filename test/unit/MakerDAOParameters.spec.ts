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

  const MAKER_DAO = '0xBE8E3e3618f7474F8cB1d074A26afFef007E98FB';
  const DSS_VEST = '0xa4c22f0e25C6630B2017979AcF1f865e94695C4b';

  const newMinBuffer = toUnit(1_000);
  const newMaxBuffer = toUnit(10_000);

  before(async () => {
    maker = await wallet.impersonate(MAKER_DAO);
    await wallet.setBalance({ account: maker._address, balance: toUnit(1) });

    parametersFactory = (await ethers.getContractFactory('MakerDAOParameters', maker)) as MakerDAOParameters__factory;
  });

  beforeEach(async () => {
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
});
