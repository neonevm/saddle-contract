import { ethers } from "hardhat"
import { LPToken } from "../build/typechain/"
import { BigNumber, Contract, Signer } from "ethers"
import {
  asyncForEach,
  getCurrentBlockTimestamp,
  getUserTokenBalance,
  getUserTokenBalances,
  MAX_UINT256,
} from "./testUtils"

import {
  to6,
  toEther,
  LP_TOKEN_NAME,
  LP_TOKEN_SYMBOL,
  SWAP_FEE,
  INITIAL_A_VALUE,
  setupCommon,
} from "./common"

let swapToken: LPToken
let swapStorage: {
  initialA: BigNumber
  futureA: BigNumber
  initialATime: BigNumber
  futureATime: BigNumber
  swapFee: BigNumber
  adminFee: BigNumber
  lpToken: string
}
let tx
let swap: Contract
let swapUtils: Contract
let DAI: Contract
let USDC: Contract
let lpToken: Contract
let amplificationUtils: Contract

let owner: Signer
let user1: Signer
let user2: Signer
let attacker: Signer
let user1Address: string
let user2Address: string
const TOKENS: Contract[] = []

async function setupTest() {
  const commonData = await setupCommon()
  swapUtils = commonData.swapUtils
  DAI = commonData.DAI
  USDC = commonData.USDC
  lpToken = commonData.lpToken
  amplificationUtils = commonData.amplificationUtils
  user1 = commonData.user1
  user1Address = commonData.user1Address
  user2 = commonData.user2
  user2Address = commonData.user2Address
  owner = commonData.owner

  console.log("Deploying Swap contract")
  const Swap = await ethers.getContractFactory("Swap", {
    libraries: {
      SwapUtils: swapUtils.address,
      AmplificationUtils: amplificationUtils.address,
    },
  })

  const swap = await Swap.deploy()

  tx = await swap.initialize(
    [DAI.address, USDC.address],
    [18, 6],
    LP_TOKEN_NAME,
    LP_TOKEN_SYMBOL,
    INITIAL_A_VALUE,
    SWAP_FEE,
    0,
    lpToken.address,
  )
  await tx.wait(30)

  console.log("Vitual price is 0: ", toEther(await swap.getVirtualPrice()))

  swapStorage = await swap.swapStorage()

  swapToken = (await ethers.getContractAt(
    "LPToken",
    swapStorage.lpToken,
  )) as LPToken

  await asyncForEach([owner, user1, user2, attacker], async (signer) => {
    tx = await DAI.connect(signer).approve(swap.address, MAX_UINT256)
    await tx.wait(30)
    tx = await USDC.connect(signer).approve(swap.address, MAX_UINT256)
    await tx.wait(30)
  })

  console.log("Populate the pool with initial liquidity")
  tx = await swap.addLiquidity([String(50e18), String(50e6)], 0, MAX_UINT256)
  await tx.wait(30)

  console.log("Token 0 balance:", toEther(await swap.getTokenBalance(0)))
  console.log("Token 1 balance:", to6(await swap.getTokenBalance(1)))
  console.log(
    "LP token balance:",
    toEther(await swapToken.balanceOf(await owner.getAddress())),
  )
}

async function main() {
  await setupTest()

  console.log("User 1 adds Liquidity")
  let calcTokenAmount = await swap.calculateTokenAmount(
    [String(1e18), String(1e6)],
    true,
  )
  console.log("LP amount calculated ", toEther(calcTokenAmount))

  // Add liquidity as user1
  tx = await swap
    .connect(user1)
    .addLiquidity(
      [String(1e18), String(1e6)],
      calcTokenAmount.mul(99).div(100),
      (await getCurrentBlockTimestamp()) + 60,
    )
  await tx.wait(30)

  console.log(
    "User1 LP balance:",
    toEther(await swapToken.balanceOf(user1Address)),
  )

  console.log("\nPerforming swaps DAI -> USDC")

  for (let i = 0; i < 10; i++) {
    calcTokenAmount = await swap.connect(user1).calculateSwap(1, 0, String(1e6))
    console.log("\nCalculated swap amount:", toEther(calcTokenAmount))
    const DAIBefore = await getUserTokenBalance(user1, DAI)
    console.log(
      "User1 DAI amount before:",
      toEther(DAIBefore),
      "USDC before:",
      to6(await getUserTokenBalance(user1, USDC)),
    )
    tx = await DAI.connect(user1).approve(swap.address, String(1e6))
    await tx.wait(30)

    tx = await swap
      .connect(user1)
      .swap(
        1,
        0,
        String(1e6),
        calcTokenAmount,
        (await getCurrentBlockTimestamp()) + 60,
      )
    await tx.wait(30)
    const DAIAfter = await getUserTokenBalance(user1, DAI)

    // Verify user1 balance changes
    console.log(
      "User1 DAI amount after",
      toEther(DAIAfter),
      "USDC after:",
      to6(await getUserTokenBalance(user1, USDC)),
    )

    // Verify pool balance changes
    console.log(
      "Pool DAI balance",
      toEther(await swap.getTokenBalance(0)),
      "USDC balance",
      to6(await swap.getTokenBalance(1)),
    )
  }

  console.log("\nPerforming swaps USDC -> DAI")

  for (let i = 0; i < 10; i++) {
    calcTokenAmount = await swap
      .connect(user1)
      .calculateSwap(0, 1, String(1e18))
    console.log("\nCalculated swap amount:", to6(calcTokenAmount))
    const DAIBefore = await getUserTokenBalance(user1, DAI)
    console.log(
      "User1 DAI amount before:",
      toEther(DAIBefore),
      "USDC before:",
      to6(await getUserTokenBalance(user1, USDC)),
    )
    tx = await DAI.connect(user1).approve(swap.address, String(1e18))
    await tx.wait(30)
    tx = await swap
      .connect(user1)
      .swap(
        0,
        1,
        String(1e18),
        calcTokenAmount,
        (await getCurrentBlockTimestamp()) + 60,
      )
    await tx.wait(30)

    const DAIAfter = await getUserTokenBalance(user1, DAI)

    // Verify user1 balance changes
    console.log(
      "User1 DAI amount after",
      toEther(DAIAfter),
      "USDC after:",
      to6(await getUserTokenBalance(user1, USDC)),
    )

    // Verify pool balance changes
    console.log(
      "Pool DAI balance",
      toEther(await swap.getTokenBalance(0)),
      "USDC balance",
      to6(await swap.getTokenBalance(1)),
    )
  }

  console.log("\nRemove Liquidity")

  const lpAmount = await swapToken.balanceOf(await user1.getAddress())

  // Verify swapToken balance
  console.log("SwapToken balance", toEther(lpAmount))

  // Calculate expected amounts of tokens user1 will receive
  const expectedAmounts = await swap.calculateRemoveLiquidity(
    await swapToken.balanceOf(await user1.getAddress()),
  )

  console.log("Removed liquidity in DAI:", toEther(expectedAmounts[0]))
  console.log("Removed liquidity in USDC:", to6(expectedAmounts[1]))

  // Allow burn of swapToken
  tx = await swapToken.connect(user2).approve(swap.address, lpAmount)
  await tx.wait(30)
  const beforeTokenBalances = await getUserTokenBalances(user2, TOKENS)

  console.log("User2 DAI balance before:", toEther(beforeTokenBalances[0]))
  console.log("User2 USDC balance before:", to6(beforeTokenBalances[1]))

  console.log("Transfer LP token to user2")
  tx = await swapToken.connect(user1).transfer(user2Address, lpAmount)
  await tx.wait(30)

  console.log(
    "Withdraw user2's share via all tokens in proportion to pool's balances",
  )
  tx = await swap
    .connect(user2)
    .removeLiquidity(
      lpAmount,
      expectedAmounts,
      (await getCurrentBlockTimestamp()) + 60,
    )
  await tx.wait(30)

  const afterTokenBalances = await getUserTokenBalances(user2, TOKENS)

  console.log("User2 DAI balance after:", toEther(afterTokenBalances[0]))
  console.log("User2 USDC balance after:", to6(afterTokenBalances[1]))
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
