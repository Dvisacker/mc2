import * as Web3 from 'web3'
import * as chai from 'chai'
import * as abi from 'ethereumjs-abi'
import * as BigNumber from 'bignumber.js'
import * as asPromised from 'chai-as-promised'
import * as contracts from '../src/index'
import * as util from 'ethereumjs-util'
import * as truffle from 'truffle-contract'
import * as support from './support'
import TestContractWrapper from '../build/wrappers/TestContract'
import TestTokenWrapper from '../build/wrappers/TestToken'
import { InstantiationFactory } from './support/index'

chai.use(asPromised)

const web3 = (global as any).web3 as Web3
const assert = chai.assert

const ECRecovery = artifacts.require<contracts.ECRecovery.Contract>('ECRecovery.sol')
const PublicRegistry = artifacts.require<contracts.PublicRegistry.Contract>('PublicRegistry.sol')
const TransferToken = artifacts.require<contracts.TransferToken.Contract>('TransferToken.sol')
const Multisig = artifacts.require<contracts.Multisig.Contract>('Multisig.sol')
const Proxy = artifacts.require<contracts.Proxy.Contract>('Proxy.sol')
const DistributeEth = artifacts.require<contracts.DistributeEth.Contract>('DistributeEth.sol')
const DistributeToken = artifacts.require<contracts.DistributeToken.Contract>('DistributeToken.sol')

const UnidirectionalCF: truffle.TruffleContract<contracts.UnidirectionalCF.Contract> = artifacts.require<contracts.UnidirectionalCF.Contract>('UnidirectionalCF.sol')

const TestContract: truffle.TruffleContract<TestContractWrapper.Contract> = artifacts.require<TestContractWrapper.Contract>('TestContract.sol')
const TestToken: truffle.TruffleContract<TestTokenWrapper.Contract> = artifacts.require<TestTokenWrapper.Contract>('TestToken.sol')

contract('UnidirectionalCF', accounts => {
  let multisig: contracts.Multisig.Contract
  let registry: contracts.PublicRegistry.Contract
  let proxy: contracts.Proxy.Contract
  let counterFactory: support.InstantiationFactory

  let transferToken: contracts.TransferToken.Contract
  let distributeEth: contracts.DistributeEth.Contract
  let distributeToken: contracts.DistributeToken.Contract
  let uni: contracts.UnidirectionalCF.Contract

  let sender = accounts[0]
  let receiver = accounts[1]
  let alien = accounts[2]

  async function paymentSignature (instance: contracts.UnidirectionalCF.Contract, sender: string, payment: BigNumber.BigNumber): Promise<string> {
    let digest = await instance.paymentDigest(payment)
    return web3.eth.sign(sender, digest)
  }

  before(async () => {
    Multisig.link(ECRecovery)
    UnidirectionalCF.link(ECRecovery)

    multisig = await Multisig.new(sender, receiver) // TxCheck
    registry = await PublicRegistry.deployed()
    proxy = await Proxy.deployed()
    counterFactory = new InstantiationFactory(web3, multisig)
    transferToken = await TransferToken.new()
    distributeEth = await DistributeEth.new()
    distributeToken = await DistributeToken.new()
    uni = await UnidirectionalCF.new(multisig.address, registry.address, 0)
  })

  let registryNonce = util.bufferToHex(Buffer.from('secret'))

  specify('can instantiate UnidirectionalCF', async () => {
    let ecrecoveryAddress = (await ECRecovery.deployed()).address
    let bytecode = support.constructorBytecode(web3, UnidirectionalCF, multisig.address, registry.address, 0).replace('__ECRecovery____________________________', ecrecoveryAddress.replace('0x', ''))
    let counterfactualAddress = await registry.counterfactualAddress(bytecode, registryNonce)
    // Instantiate
    let instantiation = await counterFactory.call(registry.deploy.request(bytecode, registryNonce))
    // let setId = await counterFactory.call(proxy.doCall(registry.address, counterfactualAddress, new BigNumber.BigNumber(0), ))
    await support.logGas('instantiate UnidirectionalCF contract', counterFactory.execute(instantiation))
    // Check if instantiated
    let address = await registry.resolve(counterfactualAddress)
    let instance = await UnidirectionalCF.at(address)
    let isSettling = await instance.isSettling()
    assert.isTrue(isSettling)
  })

  specify('moveMoney', async () => {
    let toMultisig = new BigNumber.BigNumber(web3.toWei(15, 'ether'))
    let toTestContract = new BigNumber.BigNumber(web3.toWei(12, 'ether'))
    let countMoney = new BigNumber.BigNumber(web3.toWei(2, 'ether'))

    let ecrecoveryAddress = (await ECRecovery.deployed()).address
    let bytecode = support.constructorBytecode(web3, UnidirectionalCF, multisig.address, registry.address, 0).replace('__ECRecovery____________________________', ecrecoveryAddress.replace('0x', ''))
    let counterfactualAddress = await registry.counterfactualAddress(bytecode, registryNonce)

    let instantiation = await counterFactory.call(registry.deploy.request(bytecode, registryNonce))
    let moveMoney = await counterFactory.delegatecall(proxy.doCall.request(registry.address, counterfactualAddress, toTestContract, '0x00'), instantiation.nonce.plus(1))

    await support.assertBalance(multisig, 0)
    await web3.eth.sendTransaction({ from: sender, to: multisig.address, value: toMultisig }) // TxCheck
    await support.assertBalance(multisig, toMultisig)

    await counterFactory.execute(instantiation)
    await counterFactory.execute(moveMoney)

    let address = await registry.resolve(counterfactualAddress)

    let instance = await UnidirectionalCF.at(address)

    assert.equal(web3.fromWei(web3.eth.getBalance(address), 'ether').toNumber(), 12)

    let signature = await paymentSignature(instance, sender, countMoney)

    assert.isTrue(await instance.canWithdraw(countMoney, receiver, signature))
    let oldBalanceSender = web3.fromWei(web3.eth.getBalance(sender), 'ether').toNumber()
    let oldBalanceReceiver = web3.fromWei(web3.eth.getBalance(receiver), 'ether').toNumber()

    await instance.withdraw(countMoney, signature, { from: receiver })

    assert.equal(Math.ceil(web3.fromWei(web3.eth.getBalance(sender), 'ether').toNumber() - oldBalanceSender), 10)
    assert.equal(Math.ceil(web3.fromWei(web3.eth.getBalance(receiver), 'ether').toNumber() - oldBalanceReceiver), 2)

    assert.isTrue(true)
  })
})
