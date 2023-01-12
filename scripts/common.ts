import * as fs from 'fs'
import { ethers } from "hardhat"
import { Contract, Signer } from "ethers"
import { asyncForEach } from "./testUtils"

const toEther = ethers.utils.formatEther
const to6 = (x: any) => ethers.utils.formatUnits(x, 6)

let signers: Array<Signer>
let swapUtils: Contract
let DAI: Contract
let USDC: Contract
let USDT: Contract
let lpToken: Contract
let amplificationUtils: Contract
let swap: Contract

let owner: Signer
let user1: Signer
let user2: Signer
let attacker: Signer
let ownerAddress: string
let user1Address: string
let user2Address: string
const TOKENS: Contract[] = []

// Test Values
const INITIAL_A_VALUE = 50
const SWAP_FEE = 1e7
const LP_TOKEN_NAME = "Test LP Token Name"
const LP_TOKEN_SYMBOL = "TESTLP"

async function setupCommon() {
  let tx
  TOKENS.length = 0
  signers = await ethers.getSigners()
  owner = signers[0]
  user1 = signers[1]
  user2 = signers[2]
  attacker = signers[3]
  ownerAddress = await owner.getAddress()
  user1Address = await user1.getAddress()
  user2Address = await user2.getAddress()

  const ERC20 = await ethers.getContractFactory("GenericERC20")

  console.log("\nDeploying DAI")
  DAI = await ERC20.deploy("Dai Stablecoin", "DAI", "18")
  console.log("Deploying USDC")
  USDC = await ERC20.deploy("USD Coin", "USDC", "6")
  console.log("Deploying USDT")
  USDT = await ERC20.deploy("Tether USD", "USDT", "6")
  const LPToken = await ethers.getContractFactory("LPToken")
  lpToken = await LPToken.deploy()

  await DAI.deployed()
  await USDC.deployed()
  await USDT.deployed()

  TOKENS.push(DAI, USDC, USDT)

  // Mint dummy tokens
  await asyncForEach(
    [ownerAddress, user1Address, user2Address, await attacker.getAddress()],
    async (address) => {
      tx = await DAI.mint(address, String(1e20))
      await tx.wait(30)
      tx = await USDC.mint(address, String(1e8))
      await tx.wait(30)
      tx = await USDT.mint(address, String(1e8))
      await tx.wait(30)
    },
  )

  console.log("Deploying SwapUtils")
  const SwapUtils = await ethers.getContractFactory("SwapUtils")
  swapUtils = await SwapUtils.deploy()
  await swapUtils.deployed()

  console.log("Deploying Amplification Utils")
  const AmplificationUtils = await ethers.getContractFactory(
    "AmplificationUtils",
  )
  amplificationUtils = await AmplificationUtils.deploy()
  await amplificationUtils.deployed()

  const Swap = await ethers.getContractFactory("Swap", {
    libraries: {
      SwapUtils: swapUtils.address,
      AmplificationUtils: amplificationUtils.address,
    },
  })

  swap = await Swap.deploy()
  console.log("Deploy common contracts finished")
  return {
    signers,
    swapUtils,
    DAI,
    USDC,
    USDT,
    lpToken,
    amplificationUtils,
    owner,
    user1,
    user2,
    attacker,
    ownerAddress,
    user1Address,
    user2Address,
    TOKENS,
    swap,
  }
}

type ReportItem = { [key: string]: string | number }

function writeTXData(txs: ReportItem[]) {
  console.log("GET TXS", txs)
  let report = {
    name: "Saddle finance",
    actions: [] as ReportItem[],
  }
  if (fs.existsSync("report.json")) {
    report = JSON.parse(fs.readFileSync("report.json", "utf8"))
  }
  report.actions = report.actions.concat(txs)
  fs.writeFileSync("report.json", JSON.stringify(report, null, 2))
}

export {
  ReportItem,
  setupCommon,
  to6,
  toEther,
  LP_TOKEN_NAME,
  LP_TOKEN_SYMBOL,
  INITIAL_A_VALUE,
  SWAP_FEE,
  writeTXData,
}
