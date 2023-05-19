import { Contract, Signer } from "ethers"
import { ethers } from "hardhat"
import { LPToken } from "../build/typechain/"
import {asyncForEach, getUserTokenBalance, getUserTokenBalances, MAX_UINT256} from "./testUtils"

import {
  setupCommon,
  to6,
  toEther,
  LP_TOKEN_NAME,
  LP_TOKEN_SYMBOL,
  SWAP_FEE,
  INITIAL_A_VALUE,
  ReportItem,
  writeTXData,
} from "./common"

let SUSD: Contract
let metaSwap: Contract
let metaLPToken: Contract
let tx
let swap: Contract
let swapUtils: Contract
let DAI: Contract
let USDC: Contract
let USDT: Contract
let lpToken: Contract
let amplificationUtils: Contract

let owner: Signer
let user1: Signer
let user2: Signer
let ownerAddress: string
let user1Address: string
let user2Address: string

async function setupTest() {
  const commonData = await setupCommon()
  swapUtils = commonData.swapUtils
  DAI = commonData.DAI
  USDC = commonData.USDC
  USDT = commonData.USDT
  lpToken = commonData.lpToken
  amplificationUtils = commonData.amplificationUtils
  user1 = commonData.user1
  user1Address = commonData.user1Address
  user2 = commonData.user2
  user2Address = commonData.user2Address
  owner = commonData.owner
  ownerAddress = commonData.ownerAddress
  swap = commonData.swap

  console.log("Initialize Swap contract")
  tx = await swap.initialize(
    [DAI.address, USDC.address, USDT.address],
    [18, 6, 6],
    LP_TOKEN_NAME,
    LP_TOKEN_SYMBOL,
    200,
    4e6,
    0,
    lpToken.address,
  )
  await tx.wait(10)

  console.log("Deploying SUSD")
  const ERC20 = await ethers.getContractFactory("GenericERC20")
  SUSD = await ERC20.deploy("Synthetix USD", "sUSD", "18")

  await SUSD.deployed()

  // Mint dummy tokens
  await asyncForEach(
    [ownerAddress, user1Address, user2Address],
    async (address) => {
      tx = await DAI.mint(address, String(2e20))
      await tx.wait(10)
      tx = await USDC.mint(address, String(2e8))
      await tx.wait(10)
      tx = await USDT.mint(address, String(2e8))
      await tx.wait(10)
      tx = await SUSD.mint(address, String(2e20))
      await tx.wait(10)
    },
  )

  console.log("Deploying MetaSwapUtils")
  const MetaSwapUtils = await ethers.getContractFactory("MetaSwapUtils")
  const metaSwapUtils = await MetaSwapUtils.deploy()
  await metaSwapUtils.deployed()

  console.log("Deploying MetaSwap")
  const MetaSwap = await ethers.getContractFactory("MetaSwap", {
    libraries: {
      SwapUtils: swapUtils.address,
      MetaSwapUtils: metaSwapUtils.address,
      AmplificationUtils: amplificationUtils.address,
    },
  })

  metaSwap = await MetaSwap.deploy()

  const baseLpToken = await ethers.getContractAt(
    "LPToken",
    (
      await swap.swapStorage()
    ).lpToken,
  )

  // Set approvals
  await asyncForEach([owner, user1, user2], async (signer) => {
    tx = await SUSD.connect(signer).approve(metaSwap.address, MAX_UINT256)
    await tx.wait(10)
    tx = await DAI.connect(signer).approve(metaSwap.address, MAX_UINT256)
    await tx.wait(10)
    tx = await USDC.connect(signer).approve(metaSwap.address, MAX_UINT256)
    await tx.wait(10)
    tx = await USDT.connect(signer).approve(metaSwap.address, MAX_UINT256)
    await tx.wait(10)
    tx = await DAI.connect(signer).approve(swap.address, MAX_UINT256)
    await tx.wait(10)
    tx = await USDC.connect(signer).approve(swap.address, MAX_UINT256)
    await tx.wait(10)
    tx = await USDT.connect(signer).approve(swap.address, MAX_UINT256)
    await tx.wait(10)
    tx = await baseLpToken
      .connect(signer)
      .approve(metaSwap.address, MAX_UINT256)
    await tx.wait(10)

    // Add some liquidity to the base pool
    tx = await swap
      .connect(signer)
      .addLiquidity([String(1e20), String(1e8), String(1e8)], 0, MAX_UINT256)
    await tx.wait(10)
  })

  // Initialize meta swap pool
  // Manually overload the signature
  console.log("Initializing MetaSwap")
  tx = await metaSwap.initializeMetaSwap(
    [SUSD.address, baseLpToken.address],
    [18, 18],
    LP_TOKEN_NAME,
    LP_TOKEN_SYMBOL,
    INITIAL_A_VALUE,
    SWAP_FEE,
    0,
    baseLpToken.address,
    swap.address,
  )
  await tx.wait(10)

  metaLPToken = (await ethers.getContractAt(
    "LPToken",
    (
      await metaSwap.swapStorage()
    ).lpToken,
  )) as LPToken

  tx = await metaSwap.addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)
  await tx.wait(10)

  console.log(
    "SUSD pool balance:",
    toEther(await SUSD.balanceOf(metaSwap.address)),
  )
  console.log(
    "Base LP pool balance:",
    toEther(await lpToken.balanceOf(metaSwap.address)),
  )
}

async function main() {
  await setupTest()

  const gasPrice = await ethers.provider.getGasPrice()
  const report = [] as ReportItem[]

  console.log("\nUser 1 adds Liquidity")

  tx = await metaSwap
    .connect(user1)
    .addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)
  let receipt = await tx.wait(10)

  report.push({
    name: "Add liquidity in metapool",
    usedGas: receipt["gasUsed"].toString(),
    gasPrice: gasPrice.toString(),
    tx: receipt["transactionHash"],
  })

  const actualPoolTokenAmount = await metaLPToken.balanceOf(user1Address)

  // Verify swapToken balance
  console.log("User1 LP balance:", toEther(actualPoolTokenAmount))

  //await setupTest()
  console.log("\nPerforming swaps SUSD -> Base LP")

  for (let i = 0; i < 5; i++) {
    const calculatedSwapReturn = await metaSwap.calculateSwap(
      0,
      1,
      String(1e17),
    )
    console.log("\nCalculated swap amount:", toEther(calculatedSwapReturn))

    const [tokenFromBalanceBefore, tokenToBalanceBefore] =
      await getUserTokenBalances(user1, [SUSD, lpToken])

    console.log(
      "User1 SUSD amount before",
      toEther(tokenFromBalanceBefore),
      "Base LP before:",
      toEther(tokenToBalanceBefore),
    )

    // User 1 successfully initiates swap
    tx = await metaSwap
      .connect(user1)
      .swap(0, 1, String(1e17), calculatedSwapReturn, MAX_UINT256)
    receipt = await tx.wait(10)

    // Check the sent and received amounts are as expected
    const [tokenFromBalanceAfter, tokenToBalanceAfter] =
      await getUserTokenBalances(user1, [SUSD, lpToken])

    console.log(
      "User1 SUSD amount after",
      toEther(tokenFromBalanceAfter),
      "Base LP after:",
      toEther(tokenToBalanceAfter),
    )
  }
  report.push({
    name: "Swap SUSD -> LP metapool",
    usedGas: receipt["gasUsed"].toString(),
    gasPrice: gasPrice.toString(),
    tx: receipt["transactionHash"],
  })

  console.log("\nPerforming swaps USDC -> SUSD")
  console.log("From 6 decimal token (base) to 18 decimal token (meta)")

  for (let i = 0; i < 5; i++) {
    const calculatedSwapReturn = await metaSwap.calculateSwapUnderlying(
      2,
      0,
      String(1e5),
    )
    console.log("\nCalculated swap amount:", toEther(calculatedSwapReturn))

    // Calculating swapping from a base token to a meta level token
    // could be wrong by about half of the base pool swap fee, i.e. 0.02% in this example
    const minReturnWithNegativeSlippage = calculatedSwapReturn
      .mul(9998)
      .div(10000)

    const [tokenFromBalanceBefore, tokenToBalanceBefore] =
      await getUserTokenBalances(user1, [USDC, SUSD])

    console.log(
      "User1 USDC amount before",
      to6(tokenFromBalanceBefore),
      "SUSD before:",
      toEther(tokenToBalanceBefore),
    )

    // User 1 successfully initiates swap
    tx = await metaSwap
      .connect(user1)
      .swapUnderlying(
        2,
        0,
        String(1e5),
        minReturnWithNegativeSlippage,
        MAX_UINT256,
      )
    receipt = await tx.wait(10)

    const [tokenFromBalanceAfter, tokenToBalanceAfter] =
      await getUserTokenBalances(user1, [USDC, SUSD])
    console.log(
      "User1 USDC amount after",
      to6(tokenFromBalanceAfter),
      "SUSD after:",
      toEther(tokenToBalanceAfter),
    )
  }

  report.push({
    name: "Swap USDC -> SUSD metapool",
    usedGas: receipt["gasUsed"].toString(),
    gasPrice: gasPrice.toString(),
    tx: receipt["transactionHash"],
  })
  console.log("\nPerforming swaps DAI -> USDT")
  console.log("From 18 decimal token (base) to 6 decimal token (base)")

  for (let i = 0; i < 5; i++) {
    const calculatedSwapReturn = await metaSwap.calculateSwapUnderlying(
      1,
      3,
      String(1e17),
    )
    console.log("\nCalculated swap amount:", to6(calculatedSwapReturn))

    const [tokenFromBalanceBefore, tokenToBalanceBefore] =
      await getUserTokenBalances(user1, [DAI, USDT])

    console.log(
      "User1 DAI amount before",
      toEther(tokenFromBalanceBefore),
      "USDT before:",
      to6(tokenToBalanceBefore),
    )

    // User 1 successfully initiates swap
    tx = await metaSwap
      .connect(user1)
      .swapUnderlying(1, 3, String(1e17), calculatedSwapReturn, MAX_UINT256)
    receipt = await tx.wait(10)

    // Check the sent and received amounts are as expected
    const [tokenFromBalanceAfter, tokenToBalanceAfter] =
      await getUserTokenBalances(user1, [DAI, USDT])

    console.log(
      "User1 DAI amount after",
      toEther(tokenFromBalanceAfter),
      "USDT after:",
      to6(tokenToBalanceAfter),
    )
  }

  report.push({
    name: "Swap DAI -> USDT metapool",
    usedGas: receipt["gasUsed"].toString(),
    gasPrice: gasPrice.toString(),
    tx: receipt["transactionHash"],
  })
  console.log("\nRemove Liquidity")

  const currentUser1Balance = await metaLPToken.balanceOf(user1Address)

  // Verify swapToken balance
  console.log("User1 Meta LP token balance", toEther(currentUser1Balance))

  // Calculate expected amounts of tokens user1 will receive
  const expectedAmounts = await metaSwap.calculateRemoveLiquidity(
    currentUser1Balance,
  )

  console.log("Removed liquidity in SUSD:", toEther(expectedAmounts[0]))
  console.log("Removed liquidity in Base LP:", toEther(expectedAmounts[1]))

  // Allow burn of swapToken
  tx = await metaLPToken
    .connect(user2)
    .approve(metaSwap.address, currentUser1Balance)
  await tx.wait(10)
  const beforeUser2SUSD = await getUserTokenBalance(user2, SUSD)
  const beforeUser2lpToken = await getUserTokenBalance(user2, lpToken)

  console.log("User2 SUSD balance before:", toEther(beforeUser2SUSD))
  console.log("User2 lpToken balance before:", to6(beforeUser2lpToken))

  console.log("Transfer LP token to user2")
  tx = await metaLPToken
    .connect(user1)
    .transfer(user2Address, currentUser1Balance)
  await tx.wait(10)

  console.log(
    "User2 Meta LP token balance",
    toEther(await metaLPToken.balanceOf(user2Address)),
  )

  console.log(
    "Withdraw user2's share via all tokens in proportion to pool's balances",
  )

  tx = await metaLPToken
    .connect(user2)
    .approve(metaSwap.address, currentUser1Balance)
  await tx.wait(10)

  tx = await metaSwap
    .connect(user2)
    .removeLiquidity(currentUser1Balance, [0, 0], MAX_UINT256)

  receipt = await tx.wait(10)
  report.push({
    name: "Remove liquidity in Metapool",
    usedGas: receipt["gasUsed"].toString(),
    gasPrice: gasPrice.toString(),
    tx: receipt["transactionHash"],
  })
  const afterUser2SUSD = await getUserTokenBalance(user2, SUSD)
  const afterUser2lpToken = await getUserTokenBalance(user2, lpToken)

  console.log("User2 SUSD balance after:", toEther(afterUser2SUSD))
  console.log("User2 lpToken balance after:", to6(afterUser2lpToken))

  writeTXData(report)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

export { main }
