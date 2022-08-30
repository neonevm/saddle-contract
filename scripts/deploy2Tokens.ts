import { BigNumber, Signer, Contract } from "ethers"
import { ethers } from "hardhat"
import { LPToken } from "../build/typechain/"
import {
  asyncForEach,
  getCurrentBlockTimestamp,
  getUserTokenBalance,
  getUserTokenBalances,
  MAX_UINT256,
} from "./testUtils"

const toEther = ethers.utils.formatEther

const to6 = (x: any) => ethers.utils.formatUnits(x, 6)

let signers: Array<Signer>
let swap: Contract
let swapUtils: Contract
let DAI: Contract
let USDC: Contract
let swapToken: LPToken
let owner: Signer
let user1: Signer
let user2: Signer
let attacker: Signer
let ownerAddress: string
let user1Address: string
let user2Address: string
let swapStorage: {
  initialA: BigNumber
  futureA: BigNumber
  initialATime: BigNumber
  futureATime: BigNumber
  swapFee: BigNumber
  adminFee: BigNumber
  lpToken: string
}

// Test Values
const INITIAL_A_VALUE = 50
const SWAP_FEE = 1e7
const LP_TOKEN_NAME = "Test LP Token Name"
const LP_TOKEN_SYMBOL = "TESTLP"
const TOKENS: Contract[] = []

async function setupTest() {
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

  await DAI.deployed()
  await USDC.deployed()

  TOKENS.push(DAI, USDC)

  // Mint dummy tokens
  await asyncForEach(
    [ownerAddress, user1Address, user2Address, await attacker.getAddress()],
    async (address) => {
      await DAI.mint(address, String(1e20))
      await USDC.mint(address, String(1e8))
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
  const amplificationUtils = await AmplificationUtils.deploy()
  await amplificationUtils.deployed()

  console.log("Deploying Swap contract")
  const Swap = await ethers.getContractFactory("Swap", {
    libraries: {
      SwapUtils: swapUtils.address,
      AmplificationUtils: amplificationUtils.address,
    },
  })

  swap = await Swap.deploy()

  const LPToken = await ethers.getContractFactory("LPToken")
  const lpToken = await LPToken.deploy()
  await lpToken.deployed()

  await swap.initialize(
    [DAI.address, USDC.address],
    [18, 6],
    LP_TOKEN_NAME,
    LP_TOKEN_SYMBOL,
    INITIAL_A_VALUE,
    SWAP_FEE,
    0,
    lpToken.address,
  )

  console.log("Vitual price is 0: ", toEther(await swap.getVirtualPrice()))

  swapStorage = await swap.swapStorage()

  swapToken = (await ethers.getContractAt(
    "LPToken",
    swapStorage.lpToken,
  )) as LPToken

  await asyncForEach([owner, user1, user2, attacker], async (signer) => {
    await DAI.connect(signer).approve(swap.address, MAX_UINT256)
    await USDC.connect(signer).approve(swap.address, MAX_UINT256)
  })

  console.log("Populate the pool with initial liquidity")
  await swap.addLiquidity([String(50e18), String(50e6)], 0, MAX_UINT256)

  console.log("Token 0 balance:", toEther(await swap.getTokenBalance(0)))
  console.log("Token 1 balance:", to6(await swap.getTokenBalance(1)))
  console.log(
    "LP token balance:",
    toEther(await getUserTokenBalance(owner, swapToken)),
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
  await swap
    .connect(user1)
    .addLiquidity(
      [String(1e18), String(1e6)],
      calcTokenAmount.mul(99).div(100),
      (await getCurrentBlockTimestamp()) + 60,
    )

  // Verify swapToken balance
  console.log(
    "User1 LP balance:",
    toEther(await swapToken.balanceOf(await user1.getAddress())),
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
    await DAI.connect(user1).approve(swap.address, String(1e6))
    await swap
      .connect(user1)
      .swap(
        1,
        0,
        String(1e6),
        calcTokenAmount,
        (await getCurrentBlockTimestamp()) + 60,
      )
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
    await DAI.connect(user1).approve(swap.address, String(1e18))
    await swap
      .connect(user1)
      .swap(
        0,
        1,
        String(1e18),
        calcTokenAmount,
        (await getCurrentBlockTimestamp()) + 60,
      )
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
  await swapToken.connect(user2).approve(swap.address, lpAmount)
  const beforeTokenBalances = await getUserTokenBalances(user2, TOKENS)

  console.log("User2 DAI balance before:", toEther(beforeTokenBalances[0]))
  console.log("User2 USDC balance before:", to6(beforeTokenBalances[1]))

  console.log("Transfer LP token to user2")
  await swapToken.connect(user1).transfer(user2Address, lpAmount)

  console.log(
    "Withdraw user2's share via all tokens in proportion to pool's balances",
  )
  await swap
    .connect(user2)
    .removeLiquidity(
      lpAmount,
      expectedAmounts,
      (await getCurrentBlockTimestamp()) + 60,
    )

  const afterTokenBalances = await getUserTokenBalances(user2, TOKENS)

  console.log("User2 DAI balance after:", toEther(afterTokenBalances[0]))
  console.log("User2 USDC balance after:", to6(afterTokenBalances[1]))

  // await setupTest()
  // console.log("removeLiquidity")
  // console.log("Remove Liquidity succeeds")
  // calcTokenAmount = await swap.calculateTokenAmount(
  //   [String(1e18), 0],
  //   true,
  // )
  // console.log("calcTokenAmount", "999854620735777893")

  // // Add liquidity (1e18 DAI) as user1
  // await swap
  //   .connect(user1)
  //   .addLiquidity(
  //     [String(1e18), 0],
  //     calcTokenAmount.mul(99).div(100),
  //     (await getCurrentBlockTimestamp()) + 60,
  //   )

  // // Verify swapToken balance
  // console.log(
  //   await swapToken.balanceOf(await user1.getAddress()),
  //   "999355335447632820",
  // )

  // // Calculate expected amounts of tokens user1 will receive
  // const expectedAmounts = await swap.calculateRemoveLiquidity(
  //   "999355335447632820",
  // )

  // console.log(expectedAmounts[0], "253568584947798923")
  // console.log(expectedAmounts[1], "248596")
  // console.log(expectedAmounts[2], "248596")
  // console.log(expectedAmounts[3], "248596651909606787")

  // // Allow burn of swapToken
  // await swapToken.connect(user1).approve(swap.address, "999355335447632820")
  // const beforeTokenBalances = await getUserTokenBalances(user1, TOKENS)

  // // Withdraw user1's share via all tokens in proportion to pool's balances
  // await swap
  //   .connect(user1)
  //   .removeLiquidity(
  //     "999355335447632820",
  //     expectedAmounts,
  //     (await getCurrentBlockTimestamp()) + 60,
  //   )

  // const afterTokenBalances = await getUserTokenBalances(user1, TOKENS)

  // // Verify the received amounts are correct
  // console.log(
  //   afterTokenBalances[0].sub(beforeTokenBalances[0]),
  //   "253568584947798923",
  // )
  // console.log(afterTokenBalances[1].sub(beforeTokenBalances[1]), "248596")
  // console.log(afterTokenBalances[2].sub(beforeTokenBalances[2]), "248596")
  // console.log(
  //   afterTokenBalances[3].sub(beforeTokenBalances[3]),
  //   "248596651909606787",
  // )

  // await setupTest()
  // console.log("withdrawAdminFees")
  // console.log("Succeeds when there are no fees withdrawn")
  // // Sets adminFee to 1% of the swap fees
  // await swap.setAdminFee(BigNumber.from(10 ** 8))

  // let balancesBefore = await getUserTokenBalances(owner, [DAI, USDC])

  // await swap.withdrawAdminFees()

  // let balancesAfter = await getUserTokenBalances(owner, [DAI, USDC])

  // console.log(balancesBefore, balancesAfter)

  // console.log("Succeeds with expected amount of fees withdrawn")
  // // Sets adminFee to 1% of the swap fees
  // await swap.setAdminFee(BigNumber.from(10 ** 8))
  // await swap.connect(user1).swap(0, 1, String(1e18), 0, MAX_UINT256)
  // await swap.connect(user1).swap(1, 0, String(1e6), 0, MAX_UINT256)

  // console.log(await swap.getAdminBalance(0), String(10003917589952))
  // console.log(await swap.getAdminBalance(1), String(9))

  // balancesBefore = await getUserTokenBalances(owner, [DAI, USDC])

  // await swap.withdrawAdminFees()

  // balancesAfter = await getUserTokenBalances(owner, [DAI, USDC])

  // console.log(balancesAfter[0].sub(balancesBefore[0]), String(10003917589952))
  // console.log(balancesAfter[1].sub(balancesBefore[1]), String(9))

  // console.log("Withdrawing admin fees has no impact on users' withdrawal")
  // // Sets adminFee to 1% of the swap fees
  // await swap.setAdminFee(BigNumber.from(10 ** 8))
  // await swap.connect(user1).addLiquidity([String(1e18), String(1e6)])

  // let i
  // for (i = 0; i < 10; i++) {
  //   await swap.connect(user2).swap(0, 1, String(1e18), 0, MAX_UINT256)
  //   await swap.connect(user2).swap(1, 0, String(1e6), 0, MAX_UINT256)
  // }

  // console.log(await swap.getAdminBalance(0), String(100038269603084))
  // console.log(await swap.getAdminBalance(1), String(90))

  // await swap.withdrawAdminFees()

  // balancesBefore = await getUserTokenBalances(user1, [DAI, USDC])

  // const user1LPTokenBalance = await swapToken.balanceOf(user1Address)
  // await swapToken.connect(user1).approve(swap.address, user1LPTokenBalance)
  // await swap
  //   .connect(user1)
  //   .removeLiquidity(user1LPTokenBalance, [0, 0], MAX_UINT256)

  // balancesAfter = await getUserTokenBalances(user1, [DAI, USDC])

  // console.log(
  //   balancesAfter[0].sub(balancesBefore[0]),
  //   BigNumber.from("1000119153497686425"),
  // )

  // console.log(
  //   balancesAfter[1].sub(balancesBefore[1]),
  //   BigNumber.from("1000269"),
  // )

  // await setupTest()
  // console.log("Check for timestamp manipulations")

  // console.log(
  //   "Check for maximum differences in A and virtual price when increasing",
  // )
  // // Create imbalanced pool to measure virtual price change
  // // Number of tokens are in 2:1 ratio
  // // We expect virtual price to increase as A increases
  // await swap.connect(user1).addLiquidity([String(1e20), 0], 0, MAX_UINT256)

  // // Start ramp
  // await swap.rampA(100, (await getCurrentBlockTimestamp()) + 14 * TIME.DAYS + 1)

  // // +0 seconds since ramp A
  // console.log(await swap.getA(), 50)
  // console.log(await swap.getAPrecise(), 5000)
  // console.log(swap.getVirtualPrice(), "1000166120891616093")

  // // Malicious miner skips 900 seconds
  // await setTimestamp((await getCurrentBlockTimestamp()) + 900)

  // // +900 seconds since ramp A
  // console.log(await swap.getA(), 50)
  // console.log(await swap.getAPrecise(), 5003)
  // console.log(await swap.getVirtualPrice(), "1000168045277768276")

  // // Max change of A between two blocks
  // // 5003 / 5000
  // // = 1.0006

  // // Max change of virtual price between two blocks
  // // 1000168045277768276 / 1000166120891616093
  // // = 1.00000192407

  // await setupTest()
  // console.log(
  //   "Check for maximum differences in A and virtual price when decreasing",
  // )
  // // Create imbalanced pool to measure virtual price change
  // // Number of tokens are in 2:1:1:1 ratio
  // // We expect virtual price to decrease as A decreases
  // await swap.connect(user1).addLiquidity([String(1e20), 0], 0, MAX_UINT256)

  // // Start ramp
  // await swap.rampA(25, (await getCurrentBlockTimestamp()) + 14 * TIME.DAYS + 1)

  // // +0 seconds since ramp A
  // console.log(await swap.getA(), 50)
  // console.log(await swap.getAPrecise(), 5000)
  // console.log(await swap.getVirtualPrice(), "1000166120891616093")

  // // Malicious miner skips 900 seconds
  // await setTimestamp((await getCurrentBlockTimestamp()) + 900)

  // // +900 seconds since ramp A
  // console.log(await swap.getA(), 49)
  // console.log(await swap.getAPrecise(), 4999)
  // console.log(await swap.getVirtualPrice(), "1000165478934301535")

  // // Max change of A between two blocks
  // // 4999 / 5000
  // // = 0.9998

  // // Max change of virtual price between two blocks
  // // 1000165478934301535 / 1000166120891616093
  // // = 0.99999935814

  // // Below tests try to verify the issues found in Curve Vulnerability Report are resolved.
  // // https://medium.com/@peter_4205/curve-vulnerability-report-a1d7630140ec
  // // The two cases we are most concerned are:
  // //
  // // 1. A is ramping up, and the pool is at imbalanced state.
  // //
  // // Attacker can 'resolve' the imbalance prior to the change of A. Then try to recreate the imbalance after A has
  // // changed. Due to the price curve becoming more linear, recreating the imbalance will become a lot cheaper. Thus
  // // benefiting the attacker.
  // //
  // // 2. A is ramping down, and the pool is at balanced state
  // //
  // // Attacker can create the imbalance in token balances prior to the change of A. Then try to resolve them
  // // near 1:1 ratio. Since downward change of A will make the price curve less linear, resolving the token balances
  // // to 1:1 ratio will be cheaper. Thus benefiting the attacker
  // //
  // // For visual representation of how price curves differ based on A, please refer to Figure 1 in the above
  // // Curve Vulnerability Report.

  // await setupTest()
  // console.log("Check for attacks while A is ramping upwards")
  // let initialAttackerBalances: BigNumber[] = []
  // let initialPoolBalances: BigNumber[] = []

  // initialAttackerBalances = await getUserTokenBalances(attacker, TOKENS)

  // console.log(initialAttackerBalances[0], String(1e20))
  // console.log(initialAttackerBalances[1], String(1e8))

  // // Start ramp upwards
  // await swap.rampA(
  //   100,
  //   (await getCurrentBlockTimestamp()) + 14 * TIME.DAYS + 10,
  // )
  // console.log(await swap.getAPrecise(), 5000)

  // // Check current pool balances
  // initialPoolBalances = await getPoolBalances(swap, 2)
  // console.log(initialPoolBalances[0], String(50e18))
  // console.log(initialPoolBalances[1], String(50e6))

  // await setupTest()
  // console.log(
  //   "When tokens are priced equally: " +
  //     "attacker creates massive imbalance prior to A change, and resolves it after",
  // )

  // // This attack is achieved by creating imbalance in the first block then
  // // trading in reverse direction in the second block.

  // console.log("Attack fails with 900 seconds between blocks")
  // // Swap 16e6 of USDC to SUSD, causing massive imbalance in the pool
  // await swap.connect(attacker).swap(0, 1, String(16e6), 0, MAX_UINT256)
  // let SUSDOutput = (await getUserTokenBalance(attacker, USDC)).sub(
  //   initialAttackerBalances[3],
  // )

  // // First trade results in 15.87e18 of SUSD
  // console.log(SUSDOutput, "15873636661935380627")

  // // Pool is imbalanced! Now trades from SUSD -> USDC may be profitable in small sizes
  // // USDC balance in the pool : 66e6
  // // SUSD balance in the pool : 34.13e18
  // console.log(await swap.getTokenBalance(1), String(66e6))
  // console.log(await swap.getTokenBalance(3), "34126363338064619373")

  // // Malicious miner skips 900 seconds
  // await setTimestamp((await getCurrentBlockTimestamp()) + 900)

  // // Verify A has changed upwards
  // // 5000 -> 5003 (0.06%)
  // console.log(await swap.getAPrecise(), 5003)

  // // Trade SUSD to USDC, taking advantage of the imbalance and change of A
  // let balanceBefore = await getUserTokenBalance(attacker, USDC)
  // await swap.connect(attacker).swap(3, 1, SUSDOutput, 0, MAX_UINT256)
  // let USDCOutput = (await getUserTokenBalance(attacker, USDC)).sub(
  //   balanceBefore,
  // )

  // // If USDCOutput > 16e6, the attacker leaves with more USDC than the start.
  // console.log(USDCOutput, "15967909")

  // let finalAttackerBalances = await getUserTokenBalances(attacker, TOKENS)

  // console.log(finalAttackerBalances[1], initialAttackerBalances[1])
  // console.log(finalAttackerBalances[3], initialAttackerBalances[3])
  // console.log(initialAttackerBalances[1].sub(finalAttackerBalances[1]), "32091")
  // console.log(initialAttackerBalances[3].sub(finalAttackerBalances[3]), "0")
  // // Attacker lost 3.209e4 USDC (0.201% of initial deposit)

  // // Check for pool balance changes
  // let finalPoolBalances = await getPoolBalances(swap, 4)

  // console.log(finalPoolBalances[1], initialPoolBalances[1])
  // console.log(finalPoolBalances[3], initialPoolBalances[3])
  // console.log(finalPoolBalances[1].sub(initialPoolBalances[1]), "32091")
  // console.log(finalPoolBalances[3].sub(initialPoolBalances[3]), "0")
  // // Pool (liquidity providers) gained 3.209e4 USDC (0.0642% of USDC balance)
  // // The attack did not benefit the attacker.

  // await setupTest()
  // console.log(
  //   "Attack fails with 2 weeks between transactions (mimics rapid A change)",
  // )
  // // This test assumes there are no other transactions during the 2 weeks period of ramping up.
  // // Purpose of this test case is to mimic rapid ramp up of A.

  // // Swap 16e6 of USDC to SUSD, causing massive imbalance in the pool
  // await swap.connect(attacker).swap(1, 3, String(16e6), 0, MAX_UINT256)
  // SUSDOutput = (await getUserTokenBalance(attacker, SUSD)).sub(
  //   initialAttackerBalances[3],
  // )

  // // First trade results in 15.87e18 of SUSD
  // console.log(SUSDOutput, "15873636661935380627")

  // // Pool is imbalanced! Now trades from SUSD -> USDC may be profitable in small sizes
  // // USDC balance in the pool : 66e6
  // // SUSD balance in the pool : 34.13e18
  // console.log(await swap.getTokenBalance(1), String(66e6))
  // console.log(await swap.getTokenBalance(3), "34126363338064619373")

  // // Assume no other transactions occur during the 2 weeks ramp period
  // await setTimestamp((await getCurrentBlockTimestamp()) + 2 * TIME.WEEKS + 10)

  // // Verify A has changed upwards
  // // 5000 -> 10000 (100%)
  // console.log(await swap.getAPrecise(), 10000)

  // // Trade SUSD to USDC, taking advantage of the imbalance and sudden change of A
  // balanceBefore = await getUserTokenBalance(attacker, USDC)
  // await swap.connect(attacker).swap(3, 1, SUSDOutput, 0, MAX_UINT256)
  // USDCOutput = (await getUserTokenBalance(attacker, USDC)).sub(balanceBefore)

  // // If USDCOutput > 16e6, the attacker leaves with more USDC than the start.
  // console.log(USDCOutput, "15913488")

  // finalAttackerBalances = await getUserTokenBalances(attacker, TOKENS)

  // console.log(finalAttackerBalances[1], initialAttackerBalances[1])
  // console.log(finalAttackerBalances[3], initialAttackerBalances[3])
  // console.log(initialAttackerBalances[1].sub(finalAttackerBalances[1]), "86512")
  // console.log(initialAttackerBalances[3].sub(finalAttackerBalances[3]), "0")
  // // Attacker lost 8.65e4 USDC (0.54% of initial deposit)

  // // Check for pool balance changes
  // finalPoolBalances = await getPoolBalances(swap, 4)

  // console.log(finalPoolBalances[1], initialPoolBalances[1])
  // console.log(finalPoolBalances[3], initialPoolBalances[3])
  // console.log(finalPoolBalances[1].sub(initialPoolBalances[1]), "86512")
  // console.log(finalPoolBalances[3].sub(initialPoolBalances[3]), "0")
  // // Pool (liquidity providers) gained 8.65e4 USDC (0.173024% of USDC balance)
  // // The attack did not benefit the attacker.

  // await setupTest()
  // console.log(
  //   "When token price is unequal: " +
  //     "attacker 'resolves' the imbalance prior to A change, then recreates the imbalance.",
  // )
  // // This attack is achieved by attempting to resolve the imbalance by getting as close to 1:1 ratio of tokens.
  // // Then re-creating the imbalance when A has changed.

  // // Set up pool to be imbalanced prior to the attack
  // await swap
  //   .connect(user2)
  //   .addLiquidity([0, 0], 0, (await getCurrentBlockTimestamp()) + 60)

  // // Check current pool balances
  // initialPoolBalances = await getPoolBalances(swap, 4)
  // console.log(initialPoolBalances[0], String(50e18))
  // console.log(initialPoolBalances[1], String(50e6))
  // console.log(initialPoolBalances[2], String(50e6))
  // console.log(initialPoolBalances[3], String(100e18))

  // console.log("Attack fails with 900 seconds between blocks")
  // // Swapping 25e6 of USDC to SUSD, resolving imbalance in the pool
  // await swap.connect(attacker).swap(1, 3, String(25e6), 0, MAX_UINT256)
  // SUSDOutput = (await getUserTokenBalance(attacker, SUSD)).sub(
  //   initialAttackerBalances[3],
  // )

  // // First trade results in 25.14e18 of SUSD
  // // Because the pool was imbalanced in the beginning, this trade results in more than 25e18 SUSD
  // console.log(SUSDOutput, "25140480043410581418")

  // // Pool is now almost balanced!
  // // USDC balance in the pool : 75.00e6
  // // SUSD balance in the pool : 74.86e18
  // console.log(await swap.getTokenBalance(1), String(75e6))
  // console.log(await swap.getTokenBalance(3), "74859519956589418582")

  // // Malicious miner skips 900 seconds
  // await setTimestamp((await getCurrentBlockTimestamp()) + 900)

  // // Verify A has changed upwards
  // // 5000 -> 5003 (0.06%)
  // console.log(await swap.getAPrecise(), 5003)

  // // Trade SUSD to USDC, taking advantage of the imbalance and sudden change of A
  // balanceBefore = await getUserTokenBalance(attacker, USDC)
  // await swap.connect(attacker).swap(3, 1, SUSDOutput, 0, MAX_UINT256)
  // USDCOutput = (await getUserTokenBalance(attacker, USDC)).sub(balanceBefore)

  // // If USDCOutput > 25e6, the attacker leaves with more USDC than the start.
  // console.log(USDCOutput, "24950174")

  // finalAttackerBalances = await getUserTokenBalances(attacker, TOKENS)

  // console.log(finalAttackerBalances[1], initialAttackerBalances[1])
  // console.log(finalAttackerBalances[3], initialAttackerBalances[3])
  // console.log(initialAttackerBalances[1].sub(finalAttackerBalances[1]), "49826")
  // console.log(initialAttackerBalances[3].sub(finalAttackerBalances[3]), "0")
  // // Attacker lost 4.982e4 USDC (0.199% of initial attack deposit)

  // // Check for pool balance changes
  // finalPoolBalances = await getPoolBalances(swap, 4)

  // console.log(finalPoolBalances[1], initialPoolBalances[1])
  // console.log(finalPoolBalances[3], initialPoolBalances[3])
  // console.log(finalPoolBalances[1].sub(initialPoolBalances[1]), "49826")
  // console.log(finalPoolBalances[3].sub(initialPoolBalances[3]), "0")
  // // Pool (liquidity providers) gained 4.982e4 USDC (0.0996% of USDC balance of pool)
  // // The attack did not benefit the attacker.

  // await setupTest()
  // console.log(
  //   "Attack succeeds with 2 weeks between transactions (mimics rapid A change)",
  // )
  // // This test assumes there are no other transactions during the 2 weeks period of ramping up.
  // // Purpose of this test case is to mimic rapid ramp up of A.

  // // Swap 25e6 of USDC to SUSD, resolving the imbalance in the pool
  // await swap.connect(attacker).swap(1, 3, String(25e6), 0, MAX_UINT256)
  // SUSDOutput = (await getUserTokenBalance(attacker, SUSD)).sub(
  //   initialAttackerBalances[3],
  // )

  // // First trade results in 25.14e18 of SUSD
  // console.log(SUSDOutput, "25140480043410581418")

  // // Pool is now almost balanced!
  // // USDC balance in the pool : 75.00e6
  // // SUSD balance in the pool : 74.86e18
  // console.log(await swap.getTokenBalance(1), String(75e6))
  // console.log(await swap.getTokenBalance(3), "74859519956589418582")

  // // Assume no other transactions occur during the 2 weeks ramp period
  // await setTimestamp((await getCurrentBlockTimestamp()) + 2 * TIME.WEEKS + 10)

  // // Verify A has changed upwards
  // // 5000 -> 10000 (100%)
  // console.log(await swap.getAPrecise(), 10000)

  // // Trade SUSD to USDC, taking advantage of the imbalance and sudden change of A
  // balanceBefore = await getUserTokenBalance(attacker, USDC)
  // await swap.connect(attacker).swap(3, 1, SUSDOutput, 0, MAX_UINT256)
  // USDCOutput = (await getUserTokenBalance(attacker, USDC)).sub(balanceBefore)

  // // If USDCOutput > 25e6, the attacker leaves with more USDC than the start.
  // console.log(USDCOutput, "25031387")
  // // Attack was successful!

  // finalAttackerBalances = await getUserTokenBalances(attacker, TOKENS)

  // console.log(initialAttackerBalances[1], finalAttackerBalances[1])
  // console.log(initialAttackerBalances[3], finalAttackerBalances[3])
  // console.log(finalAttackerBalances[1].sub(initialAttackerBalances[1]), "31387")
  // console.log(finalAttackerBalances[3].sub(initialAttackerBalances[3]), "0")
  // // Attacker gained 3.139e4 USDC (0.12556% of attack deposit)

  // // Check for pool balance changes
  // finalPoolBalances = await getPoolBalances(swap, 4)

  // console.log(finalPoolBalances[1], initialPoolBalances[1])
  // console.log(finalPoolBalances[3], initialPoolBalances[3])
  // console.log(initialPoolBalances[1].sub(finalPoolBalances[1]), "31387")
  // console.log(initialPoolBalances[3].sub(finalPoolBalances[3]), "0")
  // // Pool (liquidity providers) lost 3.139e4 USDC (0.06278% of USDC balance in pool)

  // // The attack benefited the attacker.
  // // Note that this attack is only possible when there are no swaps happening during the 2 weeks ramp period.

  // await setupTest()
  // console.log("Check for attacks while A is ramping downwards")
  // initialAttackerBalances = []
  // initialPoolBalances = []

  // // Set up the downward ramp A
  // initialAttackerBalances = await getUserTokenBalances(attacker, TOKENS)

  // console.log(initialAttackerBalances[0], String(1e20))
  // console.log(initialAttackerBalances[1], String(1e8))
  // console.log(initialAttackerBalances[2], String(1e8))
  // console.log(initialAttackerBalances[3], String(1e20))

  // // Start ramp downwards
  // await swap.rampA(25, (await getCurrentBlockTimestamp()) + 14 * TIME.DAYS + 10)
  // console.log(await swap.getAPrecise(), 5000)

  // // Check current pool balances
  // initialPoolBalances = await getPoolBalances(swap, 4)
  // console.log(initialPoolBalances[0], String(50e18))
  // console.log(initialPoolBalances[1], String(50e6))
  // console.log(initialPoolBalances[2], String(50e6))
  // console.log(initialPoolBalances[3], String(50e18))

  // await setupTest()
  // console.log(
  //   "When tokens are priced equally: " +
  //     "attacker creates massive imbalance prior to A change, and resolves it after",
  // )

  // // This attack is achieved by creating imbalance in the first block then
  // // trading in reverse direction in the second block.

  // console.log("Attack fails with 900 seconds between blocks")
  // // Swap 16e6 of USDC to SUSD, causing massive imbalance in the pool
  // await swap.connect(attacker).swap(1, 3, String(16e6), 0, MAX_UINT256)
  // SUSDOutput = (await getUserTokenBalance(attacker, SUSD)).sub(
  //   initialAttackerBalances[3],
  // )

  // // First trade results in 15.87e18 of SUSD
  // console.log(SUSDOutput, "15873636661935380627")

  // // Pool is imbalanced! Now trades from SUSD -> USDC may be profitable in small sizes
  // // USDC balance in the pool : 66e6
  // // SUSD balance in the pool : 34.13e18
  // console.log(await swap.getTokenBalance(1), String(66e6))
  // console.log(await swap.getTokenBalance(3), "34126363338064619373")

  // // Malicious miner skips 900 seconds
  // await setTimestamp((await getCurrentBlockTimestamp()) + 900)

  // // Verify A has changed downwards
  // console.log(await swap.getAPrecise(), 4999)

  // balanceBefore = await getUserTokenBalance(attacker, USDC)
  // await swap.connect(attacker).swap(3, 1, SUSDOutput, 0, MAX_UINT256)
  // USDCOutput = (await getUserTokenBalance(attacker, USDC)).sub(balanceBefore)

  // // If USDCOutput > 16e6, the attacker leaves with more USDC than the start.
  // console.log(USDCOutput, "15967995")

  // finalAttackerBalances = await getUserTokenBalances(attacker, TOKENS)

  // // Check for attacker's balance changes
  // console.log(finalAttackerBalances[1], initialAttackerBalances[1])
  // console.log(finalAttackerBalances[3], initialAttackerBalances[3])
  // console.log(initialAttackerBalances[1].sub(finalAttackerBalances[1]), "32005")
  // console.log(initialAttackerBalances[3].sub(finalAttackerBalances[3]), "0")
  // // Attacker lost 3.2e4 USDC (0.2% of initial deposit)

  // // Check for pool balance changes
  // finalPoolBalances = await getPoolBalances(swap, 4)

  // console.log(finalPoolBalances[1], initialPoolBalances[1])
  // console.log(finalPoolBalances[3], initialPoolBalances[3])
  // console.log(finalPoolBalances[1].sub(initialPoolBalances[1]), "32005")
  // console.log(finalPoolBalances[3].sub(initialPoolBalances[3]), "0")
  // // Pool (liquidity providers) gained 3.2e4 USDC (0.064% of USDC pool balance)
  // // The attack did not benefit the attacker.

  // await setupTest()
  // console.log(
  //   "Attack succeeds with 2 weeks between transactions (mimics rapid A change)",
  // )
  // // This test assumes there are no other transactions during the 2 weeks period of ramping down.
  // // Purpose of this test is to show how dangerous rapid A ramp is.

  // // Swap 16e6 USDC to sUSD, causing imbalance in the pool
  // await swap.connect(attacker).swap(1, 3, String(16e6), 0, MAX_UINT256)
  // SUSDOutput = (await getUserTokenBalance(attacker, SUSD)).sub(
  //   initialAttackerBalances[3],
  // )

  // // First trade results in 15.87e18 of SUSD
  // console.log(SUSDOutput, "15873636661935380627")

  // // Pool is imbalanced! Now trades from SUSD -> USDC may be profitable in small sizes
  // // USDC balance in the pool : 66e6
  // // SUSD balance in the pool : 34.13e18
  // console.log(await swap.getTokenBalance(1), String(66e6))
  // console.log(await swap.getTokenBalance(3), "34126363338064619373")

  // // Assume no other transactions occur during the 2 weeks ramp period
  // await setTimestamp((await getCurrentBlockTimestamp()) + 2 * TIME.WEEKS + 10)

  // // Verify A has changed downwards
  // console.log(await swap.getAPrecise(), 2500)

  // balanceBefore = await getUserTokenBalance(attacker, USDC)
  // await swap.connect(attacker).swap(3, 1, SUSDOutput, 0, MAX_UINT256)
  // USDCOutput = (await getUserTokenBalance(attacker, USDC)).sub(balanceBefore)

  // // If USDCOutput > 16e6, the attacker leaves with more USDC than the start.
  // console.log(USDCOutput, "16073391")

  // finalAttackerBalances = await getUserTokenBalances(attacker, TOKENS)

  // // Check for attacker's balance changes
  // console.log(finalAttackerBalances[1], initialAttackerBalances[1])
  // console.log(finalAttackerBalances[3], initialAttackerBalances[3])
  // console.log(finalAttackerBalances[1].sub(initialAttackerBalances[1]), "73391")
  // console.log(finalAttackerBalances[3].sub(initialAttackerBalances[3]), "0")
  // // Attacker gained 7.34e4 USDC (0.45875% of initial deposit)

  // // Check for pool balance changes
  // finalPoolBalances = await getPoolBalances(swap, 4)

  // console.log(finalPoolBalances[1], initialPoolBalances[1])
  // console.log(finalPoolBalances[3], initialPoolBalances[3])
  // console.log(initialPoolBalances[1].sub(finalPoolBalances[1]), "73391")
  // console.log(initialPoolBalances[3].sub(finalPoolBalances[3]), "0")
  // // Pool (liquidity providers) lost 7.34e4 USDC (0.1468% of USDC balance)

  // // The attack was successful. The change of A (-50%) gave the attacker a chance to swap
  // // more efficiently. The swap fee (0.1%) was not sufficient to counter the efficient trade, giving
  // // the attacker more tokens than initial deposit.

  // await setupTest()
  // console.log(
  //   "When token price is unequal: " +
  //     "attacker 'resolves' the imbalance prior to A change, then recreates the imbalance.",
  // )

  // // This attack is achieved by attempting to resolve the imbalance by getting as close to 1:1 ratio of tokens.
  // // Then re-creating the imbalance when A has changed.

  // // Set up pool to be imbalanced prior to the attack
  // await swap
  //   .connect(user2)
  //   .addLiquidity(
  //     [0, 0, 0, String(50e18)],
  //     0,
  //     (await getCurrentBlockTimestamp()) + 60,
  //   )

  // // Check current pool balances
  // initialPoolBalances = await getPoolBalances(swap, 4)
  // console.log(initialPoolBalances[0], String(50e18))
  // console.log(initialPoolBalances[1], String(50e6))
  // console.log(initialPoolBalances[2], String(50e6))
  // console.log(initialPoolBalances[3], String(100e18))

  // await setupTest()
  // console.log("Attack fails with 900 seconds between blocks")
  // // Swap 25e6 of USDC to SUSD, resolving imbalance in the pool
  // await swap.connect(attacker).swap(1, 3, String(25e6), 0, MAX_UINT256)
  // SUSDOutput = (await getUserTokenBalance(attacker, SUSD)).sub(
  //   initialAttackerBalances[3],
  // )

  // // First trade results in 25.14e18 of SUSD
  // // Because the pool was imbalanced in the beginning, this trade results in more than 25e18 SUSD
  // console.log(SUSDOutput, "25140480043410581418")

  // // Pool is now almost balanced!
  // // USDC balance in the pool : 75.00e6
  // // SUSD balance in the pool : 74.86e18
  // console.log(await swap.getTokenBalance(1), String(75e6))
  // console.log(await swap.getTokenBalance(3), "74859519956589418582")

  // // Malicious miner skips 900 seconds
  // await setTimestamp((await getCurrentBlockTimestamp()) + 900)

  // // Verify A has changed downwards
  // console.log(await swap.getAPrecise(), 4999)

  // balanceBefore = await getUserTokenBalance(attacker, USDC)
  // await swap.connect(attacker).swap(3, 1, SUSDOutput, 0, MAX_UINT256)
  // USDCOutput = (await getUserTokenBalance(attacker, USDC)).sub(balanceBefore)

  // // If USDCOutput > 25e6, the attacker leaves with more USDC than the start.
  // console.log(USDCOutput, "24950046")

  // finalAttackerBalances = await getUserTokenBalances(attacker, TOKENS)

  // // Check for attacker's balance changes
  // console.log(finalAttackerBalances[1], initialAttackerBalances[1])
  // console.log(finalAttackerBalances[3], initialAttackerBalances[3])
  // console.log(initialAttackerBalances[1].sub(finalAttackerBalances[1]), "49954")
  // console.log(initialAttackerBalances[3].sub(finalAttackerBalances[3]), "0")
  // // Attacker lost 4.995e4 USDC (0.2% of initial deposit)

  // // Check for pool balance changes
  // finalPoolBalances = await getPoolBalances(swap, 4)

  // console.log(finalPoolBalances[1], initialPoolBalances[1])
  // console.log(finalPoolBalances[3], initialPoolBalances[3])
  // console.log(finalPoolBalances[1].sub(initialPoolBalances[1]), "49954")
  // console.log(finalPoolBalances[3].sub(initialPoolBalances[3]), "0")
  // // Pool (liquidity providers) gained 1.22e6 USDC (0.1% of pool balance)
  // // The attack did not benefit the attacker.

  // await setupTest()
  // console.log(
  //   "Attack fails with 2 weeks between transactions (mimics rapid A change)",
  // )
  // // This test assumes there are no other transactions during the 2 weeks period of ramping down.
  // // Purpose of this test case is to mimic rapid ramp down of A.

  // // Swap 25e6 of USDC to SUSD, resolving imbalance in the pool
  // await swap.connect(attacker).swap(1, 3, String(25e6), 0, MAX_UINT256)
  // SUSDOutput = (await getUserTokenBalance(attacker, SUSD)).sub(
  //   initialAttackerBalances[3],
  // )

  // // First trade results in 25.14e18 of SUSD
  // // Because the pool was imbalanced in the beginning, this trade results in more than 1e18 SUSD
  // console.log(SUSDOutput, "25140480043410581418")

  // // Pool is now almost balanced!
  // // USDC balance in the pool : 75.00e6
  // // SUSD balance in the pool : 74.86e18
  // console.log(await swap.getTokenBalance(1), String(75e6))
  // console.log(await swap.getTokenBalance(3), "74859519956589418582")

  // // Assume no other transactions occur during the 2 weeks ramp period
  // await setTimestamp((await getCurrentBlockTimestamp()) + 2 * TIME.WEEKS + 10)

  // // Verify A has changed downwards
  // console.log(await swap.getAPrecise(), 2500)

  // balanceBefore = await getUserTokenBalance(attacker, USDC)
  // await swap.connect(attacker).swap(3, 1, SUSDOutput, 0, MAX_UINT256)
  // USDCOutput = (await getUserTokenBalance(attacker, USDC)).sub(balanceBefore)

  // // If USDCOutput > 25e6, the attacker leaves with more USDC than the start.
  // console.log(USDCOutput, "24794844")
  // // Attack was not successful

  // finalAttackerBalances = await getUserTokenBalances(attacker, TOKENS)

  // // Check for attacker's balance changes
  // console.log(finalAttackerBalances[1], initialAttackerBalances[1])
  // console.log(finalAttackerBalances[3], initialAttackerBalances[3])
  // console.log(
  //   initialAttackerBalances[1].sub(finalAttackerBalances[1]),
  //   "205156",
  // )
  // console.log(initialAttackerBalances[3].sub(finalAttackerBalances[3]), "0")
  // // Attacker lost 2.05e5 USDC (0.820624% of initial deposit)

  // // Check for pool balance changes
  // finalPoolBalances = await getPoolBalances(swap, 4)

  // console.log(finalPoolBalances[1], initialPoolBalances[1])
  // console.log(finalPoolBalances[3], initialPoolBalances[3])
  // console.log(finalPoolBalances[1].sub(initialPoolBalances[1]), "205156")
  // console.log(finalPoolBalances[3].sub(initialPoolBalances[3]), "0")
  // // Pool (liquidity providers) gained 2.05e5 USDC (0.410312% of USDC balance of pool)
  // // The attack did not benefit the attacker
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
