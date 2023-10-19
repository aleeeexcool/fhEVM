import { AddressLike, BigNumberish, Signer } from 'ethers';
import { ethers } from 'hardhat';

import type { SimpleCFMM } from '../../types';

export async function deploySimpleCFMMFixture(
  account: Signer,
  fee: BigNumberish,
  tokenContract: AddressLike,
  tokenContract2: AddressLike,
  stoppable: boolean,
): Promise<SimpleCFMM> {
  const contractFactory = await ethers.getContractFactory('SimpleCFMM');
  const contract = await contractFactory.connect(account).deploy(fee, tokenContract, tokenContract2, stoppable);
  await contract.waitForDeployment();
  return contract;
}
