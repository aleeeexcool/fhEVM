import { expect } from 'chai';
import { ethers } from 'hardhat';

import { deployEncryptedERC20Fixture } from '../encryptedERC20/EncryptedERC20.fixture';
import { createInstances } from '../instance';
import { getSigners, initSigners } from '../signers';
import { deploySimpleCFMMFixture } from './SimpleCFMM.fixture';

describe('SimpleCFMM', function () {
  before(async function () {
    await initSigners(3);
    this.signers = await getSigners();
  });

  beforeEach(async function () {
    // Deploy two ERC20 contracts with Alice account
    const contractErc20 = await deployEncryptedERC20Fixture();
    this.erc20 = contractErc20;
    this.contractERC20Address = await contractErc20.getAddress();
    const instance = await createInstances(this.contractERC20Address, ethers, this.signers);

    const contractErc20_2 = await deployEncryptedERC20Fixture();
    this.erc20_2 = contractErc20_2;
    this.contractERC20Address2 = await contractErc20_2.getAddress();
    const instance2 = await createInstances(this.contractERC20Address2, ethers, this.signers);

    // Mint with Alice account
    const encryptedAmount = instance.alice.encrypt32(10000);
    const transaction = await this.erc20.mint(encryptedAmount);

    const encryptedAmount2 = instance2.alice.encrypt32(10000);
    const transaction2 = await this.erc20.mint(encryptedAmount2);

    // Set fee | 500 = 5%
    const fee = 500;

    // Deploy blind auction
    const contractPromise = deploySimpleCFMMFixture(
      this.signers.alice,
      fee,
      this.contractERC20Address,
      this.contractERC20Address2,
      true,
    );

    const [contract] = await Promise.all([contractPromise, transaction.wait(), transaction2.wait()]);

    // Transfer 100 tokens to Bob from each ERC20 contract
    const encryptedTransferAmount = instance.alice.encrypt32(1000);
    const tx_first = await this.erc20['transfer(address,bytes)'](this.signers.bob.address, encryptedTransferAmount);
    const tx_second = await this.erc20_2['transfer(address,bytes)'](this.signers.bob.address, encryptedTransferAmount);

    // Transfer 100 tokens to Carol from each ERC20 contract
    const tx2_first = await this.erc20['transfer(address,bytes)'](this.signers.carol.address, encryptedTransferAmount);
    const tx2_second = await this.erc20_2['transfer(address,bytes)'](
      this.signers.carol.address,
      encryptedTransferAmount,
    );
    await Promise.all([tx_first.wait(), tx_second.wait(), tx2_first.wait(), tx2_second.wait()]);

    this.contractAddress = await contract.getAddress();
    this.simpleCfmm = contract;
    const instances = await createInstances(this.contractAddress, ethers, this.signers);
    this.instances = instances;
  });

  it('should allow Bob and Carol add liquidity and remove it after', async function () {
    const bobAmountA = this.instances.bob.encrypt32(100);
    const bobAmountB = this.instances.bob.encrypt32(100);
    const carolAmountA = this.instances.carol.encrypt32(200);
    const carolAmountB = this.instances.carol.encrypt32(200);

    // Get all approvals for transferFrom()
    const txBobApproveA = await this.erc20.connect(this.signers.bob).approve(this.contractAddress, bobAmountA);
    const txBobApproveB = await this.erc20_2.connect(this.signers.bob).approve(this.contractAddress, bobAmountB);
    const txCarolApproveA = await this.erc20.connect(this.signers.carol).approve(this.contractAddress, carolAmountA);
    const txCarolApproveB = await this.erc20_2.connect(this.signers.carol).approve(this.contractAddress, carolAmountB);
    await Promise.all([txBobApproveA.wait(), txBobApproveB.wait(), txCarolApproveA.wait(), txCarolApproveB.wait()]);

    // Bob and Carol add liquidity
    const txCarolDeposit = await this.simpleCfmm
      .connect(this.signers.carol)
      .addLiquidity(carolAmountA, carolAmountB, { gasLimit: 5000000 });
    const txBobDeposit = await this.simpleCfmm
      .connect(this.signers.bob)
      .addLiquidity(bobAmountA, bobAmountB, { gasLimit: 5000000 });
    await Promise.all([txCarolDeposit.wait(), txBobDeposit.wait()]);

    // Check if the balances changed
    const instance = await createInstances(this.contractERC20Address, ethers, this.signers);
    const tokenCarol = instance.carol.getTokenSignature(this.contractERC20Address)!;
    const encryptedBalanceCarolBefore = await this.erc20
      .connect(this.signers.carol)
      .balanceOf(tokenCarol.publicKey, tokenCarol.signature);
    const tokenBob = instance.bob.getTokenSignature(this.contractERC20Address)!;
    const encryptedBalanceBobBefore = await this.erc20
      .connect(this.signers.bob)
      .balanceOf(tokenBob.publicKey, tokenBob.signature);

    const balanceBobBefore = instance.bob.decrypt(this.contractERC20Address, encryptedBalanceBobBefore);
    expect(balanceBobBefore).to.equal(900);
    const balanceCarolBefore = instance.carol.decrypt(this.contractERC20Address, encryptedBalanceCarolBefore);
    expect(balanceCarolBefore).to.equal(800);

    const bobAmount = this.instances.bob.encrypt32(100);
    const carolAmount = this.instances.carol.encrypt32(150);

    // Bob and Carol remove liquidity
    const txBobWithdraw = await this.simpleCfmm
      .connect(this.signers.bob)
      .removeLiquidity(bobAmount, { gasLimit: 5000000 });
    const txCarolWithdraw = await this.simpleCfmm
      .connect(this.signers.carol)
      .removeLiquidity(carolAmount, { gasLimit: 5000000 });
    await Promise.all([txCarolWithdraw.wait(), txBobWithdraw.wait()]);

    // Again check if the balances changed
    const encryptedBalanceBobAfter = await this.erc20
      .connect(this.signers.bob)
      .balanceOf(tokenBob.publicKey, tokenBob.signature);
    const encryptedBalanceCarolAfter = await this.erc20
      .connect(this.signers.carol)
      .balanceOf(tokenCarol.publicKey, tokenCarol.signature);

    const balanceBob = instance.bob.decrypt(this.contractERC20Address, encryptedBalanceBobAfter);
    expect(balanceBob).to.equal(100);
    const balanceCarol = instance.carol.decrypt(this.contractERC20Address, encryptedBalanceCarolAfter);
    expect(balanceCarol).to.equal(100);
  });

  it('should allow Carol to trade', async function () {
    const bobAmountA = this.instances.bob.encrypt32(200);
    const bobAmountB = this.instances.bob.encrypt32(200);
    const carolAmountA = this.instances.carol.encrypt32(250);
    const carolAmountB = this.instances.carol.encrypt32(250);

    // Get all approvals for transferFrom()
    const txBobApproveA = await this.erc20.connect(this.signers.bob).approve(this.contractAddress, bobAmountA);
    const txBobApproveB = await this.erc20_2.connect(this.signers.bob).approve(this.contractAddress, bobAmountB);
    const txCarolApproveA = await this.erc20.connect(this.signers.carol).approve(this.contractAddress, carolAmountA);
    const txCarolApproveB = await this.erc20_2.connect(this.signers.carol).approve(this.contractAddress, carolAmountB);
    await Promise.all([txBobApproveA.wait(), txBobApproveB.wait(), txCarolApproveA.wait(), txCarolApproveB.wait()]);

    // Bob and Carol add liquidity
    const txCarolDeposit = await this.simpleCfmm
      .connect(this.signers.carol)
      .addLiquidity(carolAmountA, carolAmountB, { gasLimit: 5000000 });
    const txBobDeposit = await this.simpleCfmm
      .connect(this.signers.bob)
      .addLiquidity(bobAmountA, bobAmountB, { gasLimit: 5000000 });
    await Promise.all([txCarolDeposit.wait(), txBobDeposit.wait()]);

    // Carol try to trade with token A
    const carolTradeAmountA = this.instances.carol.encrypt32(100);
    const txCarolTradeApproveA = await this.erc20
      .connect(this.signers.carol)
      .approve(this.contractAddress, carolTradeAmountA);
    await Promise.all([txCarolTradeApproveA.wait()]);

    const txCarolTradeA = await this.simpleCfmm
      .connect(this.signers.carol)
      .trade(this.contractERC20Address, carolTradeAmountA, { gasLimit: 5000000 });
    await Promise.all([txCarolTradeA.wait()]);

    // Check if the Carol's balance changed
    const instance = await createInstances(this.contractERC20Address, ethers, this.signers);
    const tokenCarol = instance.carol.getTokenSignature(this.contractERC20Address)!;
    const encryptedBalanceCarol = await this.erc20
      .connect(this.signers.carol)
      .balanceOf(tokenCarol.publicKey, tokenCarol.signature);
    const balanceCarol = instance.carol.decrypt(this.contractERC20Address, encryptedBalanceCarol);
    expect(balanceCarol).to.equal(895);
  });

  it('should allow Alice to withdraw fee', async function () {
    const aliceAmountA = this.instances.alice.encrypt32(500);
    const aliceAmountB = this.instances.alice.encrypt32(500);

    // Get all approvals for transferFrom()
    const txAliceApproveA = await this.erc20.connect(this.signers.alice).approve(this.contractAddress, aliceAmountA);
    const txAliceApproveB = await this.erc20_2.connect(this.signers.alice).approve(this.contractAddress, aliceAmountB);
    await Promise.all([txAliceApproveA.wait(), txAliceApproveB.wait()]);

    // Alice adds liquidity
    const txAliceDeposit = await this.simpleCfmm
      .connect(this.signers.alice)
      .addLiquidity(aliceAmountA, aliceAmountB, { gasLimit: 5000000 });
    await Promise.all([txAliceDeposit.wait()]);

    // Check if Alice's balance changed
    const tokenAlice = this.instances.alice.getTokenSignature(this.contractAddress)!;
    const encryptedBalanceAlice = await this.simpleCfmm
      .connect(this.signers.alice)
      .getBalanceOfToken(this.contractERC20Address, tokenAlice.publicKey, tokenAlice.signature);
    const balanceAlice = this.instances.alice.decrypt(this.contractAddress, encryptedBalanceAlice);
    expect(balanceAlice).to.equal(500);

    // Alice try to trade with token A
    const aliceTradeAmountA = this.instances.alice.encrypt32(500);
    const txAliceTradeApproveA = await this.erc20
      .connect(this.signers.alice)
      .approve(this.contractAddress, aliceTradeAmountA);
    await Promise.all([txAliceTradeApproveA.wait()]);

    const txAliceTradeA = await this.simpleCfmm
      .connect(this.signers.alice)
      .trade(this.contractERC20Address, aliceTradeAmountA, { gasLimit: 5000000 });
    await Promise.all([txAliceTradeA.wait()]);

    // Now Alice decided to withdraw fee
    const aliceFeeAmountA = this.instances.alice.encrypt32(25);
    const txAliceWithdrawfee = await this.simpleCfmm
      .connect(this.signers.alice)
      .withdrawFee(this.contractERC20Address, aliceFeeAmountA, { gasLimit: 5000000 });
    await Promise.all([txAliceWithdrawfee.wait()]);

    // Check if the Alice's balance changed
    const instance = await createInstances(this.contractERC20Address, ethers, this.signers);
    const token = instance.alice.getTokenSignature(this.contractERC20Address)!;
    const encryptedBalanceAliceAfterFeeWithdraw = await this.erc20
      .connect(this.signers.alice)
      .balanceOf(token.publicKey, token.signature);
    const balanceCarol = instance.alice.decrypt(this.contractERC20Address, encryptedBalanceAliceAfterFeeWithdraw);
    expect(balanceCarol).to.equal(7025);
  });

  it('should return balance of token for Bob', async function () {
    const bobAmountA = this.instances.bob.encrypt32(100);
    const bobAmountB = this.instances.bob.encrypt32(100);
    const carolAmountA = this.instances.carol.encrypt32(200);
    const carolAmountB = this.instances.carol.encrypt32(200);

    // Get all approvals for transferFrom()
    const txBobApproveA = await this.erc20.connect(this.signers.bob).approve(this.contractAddress, bobAmountA);
    const txBobApproveB = await this.erc20_2.connect(this.signers.bob).approve(this.contractAddress, bobAmountB);
    const txCarolApproveA = await this.erc20.connect(this.signers.carol).approve(this.contractAddress, carolAmountA);
    const txCarolApproveB = await this.erc20_2.connect(this.signers.carol).approve(this.contractAddress, carolAmountB);
    await Promise.all([txBobApproveA.wait(), txBobApproveB.wait(), txCarolApproveA.wait(), txCarolApproveB.wait()]);

    // Bob and Carol add liquidity
    const txCarolDeposit = await this.simpleCfmm
      .connect(this.signers.carol)
      .addLiquidity(carolAmountA, carolAmountB, { gasLimit: 5000000 });
    const txBobDeposit = await this.simpleCfmm
      .connect(this.signers.bob)
      .addLiquidity(bobAmountA, bobAmountB, { gasLimit: 5000000 });
    await Promise.all([txCarolDeposit.wait(), txBobDeposit.wait()]);

    // Check if the balances changed
    const instance = await createInstances(this.simpleCfmm, ethers, this.signers);
    const tokenBob = instance.bob.getTokenSignature(this.simpleCfmm)!;
    const encryptedBalanceBob = await this.simpleCfmm
      .connect(this.signers.bob)
      .getUserBalanceOfToken(this.contractERC20Address, tokenBob.publicKey, tokenBob.signature);
    const balanceBob = instance.bob.decrypt(this.simpleCfmm, encryptedBalanceBob);
    expect(balanceBob).to.equal(100);
  });

  it('should return balance of token A', async function () {
    const bobAmountA = this.instances.bob.encrypt32(150);
    const bobAmountB = this.instances.bob.encrypt32(150);
    const carolAmountA = this.instances.carol.encrypt32(200);
    const carolAmountB = this.instances.carol.encrypt32(200);

    // Get all approvals for transferFrom()
    const txBobApproveA = await this.erc20.connect(this.signers.bob).approve(this.contractAddress, bobAmountA);
    const txBobApproveB = await this.erc20_2.connect(this.signers.bob).approve(this.contractAddress, bobAmountB);
    const txCarolApproveA = await this.erc20.connect(this.signers.carol).approve(this.contractAddress, carolAmountA);
    const txCarolApproveB = await this.erc20_2.connect(this.signers.carol).approve(this.contractAddress, carolAmountB);
    await Promise.all([txBobApproveA.wait(), txBobApproveB.wait(), txCarolApproveA.wait(), txCarolApproveB.wait()]);

    // Bob and Carol add liquidity
    const txCarolDeposit = await this.simpleCfmm
      .connect(this.signers.carol)
      .addLiquidity(carolAmountA, carolAmountB, { gasLimit: 5000000 });
    const txBobDeposit = await this.simpleCfmm
      .connect(this.signers.bob)
      .addLiquidity(bobAmountA, bobAmountB, { gasLimit: 5000000 });
    await Promise.all([txCarolDeposit.wait(), txBobDeposit.wait()]);

    // Check if the balances changed
    const instance = await createInstances(this.simpleCfmm, ethers, this.signers);
    const tokenBob = instance.bob.getTokenSignature(this.simpleCfmm)!;
    const encryptedBalanceBob = await this.simpleCfmm
      .connect(this.signers.bob)
      .getBalanceOfToken(this.contractERC20Address, tokenBob.publicKey, tokenBob.signature);
    const balanceBob = instance.bob.decrypt(this.simpleCfmm, encryptedBalanceBob);
    expect(balanceBob).to.equal(350);
  });
});
