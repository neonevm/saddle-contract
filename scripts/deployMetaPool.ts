import { Signer, Contract } from "ethers"
import { ethers } from "hardhat"
import { LPToken } from "../build/typechain/"
import { asyncForEach, getUserTokenBalances, MAX_UINT256 } from "./testUtils"

const toEther = ethers.utils.formatEther
const to6 = (x: any) => ethers.utils.formatUnits(x, 6)

let signers: Array<Signer>
let baseSwap: Contract
let metaSwap: Contract
let metaSwapUtils: Contract
let susd: Contract
let dai: Contract
let usdc: Contract
let usdt: Contract
let baseLPToken: Contract
let metaLPToken: Contract
let owner: Signer
let user1: Signer
let user2: Signer
let ownerAddress: string
let user1Address: string
let user2Address: string

// Test Values
const INITIAL_A_VALUE = 50
const SWAP_FEE = 1e7
const LP_TOKEN_NAME = "Test LP Token Name"
const LP_TOKEN_SYMBOL = "TESTLP"

async function setupTest() {
  signers = await ethers.getSigners()
  owner = signers[0]
  user1 = signers[1]
  user2 = signers[2]
  ownerAddress = await owner.getAddress()
  user1Address = await user1.getAddress()
  user2Address = await user2.getAddress()

  const ERC20 = await ethers.getContractFactory("GenericERC20")

  console.log("\nDeploying DAI")
  dai = await ERC20.deploy("Dai Stablecoin", "DAI", "18")
  console.log("Deploying USDC")
  usdc = await ERC20.deploy("USD Coin", "USDC", "6")
  console.log("Deploying USDT")
  usdt = await ERC20.deploy("Tether USD", "USDT", "6")

  await dai.deployed()
  await usdc.deployed()
  await usdt.deployed()

  console.log("Deploying SwapUtils")
  const SwapUtils = await ethers.getContractFactory("SwapUtils")
  const swapUtils = await SwapUtils.deploy()
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

  baseSwap = await Swap.deploy()

  const LPToken = await ethers.getContractFactory("LPToken")
  baseLPToken = await LPToken.deploy()
  await baseLPToken.deployed()

  console.log("Initializing Base swap")
  await baseSwap.initialize(
    [dai.address, usdc.address, usdt.address],
    [18, 6, 6],
    LP_TOKEN_NAME,
    LP_TOKEN_SYMBOL,
    200,
    4e6,
    0,
    baseLPToken.address,
  )

  console.log("Deploying SUSD")
  susd = await ERC20.deploy("Synthetix USD", "sUSD", "18")

  await susd.deployed()

  // Mint dummy tokens
  await asyncForEach(
    [ownerAddress, user1Address, user2Address],
    async (address) => {
      await dai.mint(address, String(2e20))
      await usdc.mint(address, String(2e8))
      await usdt.mint(address, String(2e8))
      await susd.mint(address, String(2e20))
    },
  )

  console.log("Deploying MetaSwapUtils")
  const MetaSwapUtils = await ethers.getContractFactory("MetaSwapUtils")
  metaSwapUtils = await MetaSwapUtils.deploy()
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

  baseLPToken = await ethers.getContractAt(
    "LPToken",
    (
      await baseSwap.swapStorage()
    ).lpToken,
  )

  // Set approvals
  await asyncForEach([owner, user1, user2], async (signer) => {
    await susd.connect(signer).approve(metaSwap.address, MAX_UINT256)
    await dai.connect(signer).approve(metaSwap.address, MAX_UINT256)
    await usdc.connect(signer).approve(metaSwap.address, MAX_UINT256)
    await usdt.connect(signer).approve(metaSwap.address, MAX_UINT256)
    await dai.connect(signer).approve(baseSwap.address, MAX_UINT256)
    await usdc.connect(signer).approve(baseSwap.address, MAX_UINT256)
    await usdt.connect(signer).approve(baseSwap.address, MAX_UINT256)
    await baseLPToken.connect(signer).approve(metaSwap.address, MAX_UINT256)

    // Add some liquidity to the base pool
    await baseSwap
      .connect(signer)
      .addLiquidity([String(1e20), String(1e8), String(1e8)], 0, MAX_UINT256)
  })

  // Initialize meta swap pool
  // Manually overload the signature
  console.log("Initializing MetaSwap")
  await metaSwap.initializeMetaSwap(
    [susd.address, baseLPToken.address],
    [18, 18],
    LP_TOKEN_NAME,
    LP_TOKEN_SYMBOL,
    INITIAL_A_VALUE,
    SWAP_FEE,
    0,
    baseLPToken.address,
    baseSwap.address,
  )

  metaLPToken = (await ethers.getContractAt(
    "LPToken",
    (
      await metaSwap.swapStorage()
    ).lpToken,
  )) as LPToken

  await metaSwap.addLiquidity([String(1e18), String(1e18)], 0, MAX_UINT256)

  console.log(
    "SUSD pool balance:",
    toEther(await susd.balanceOf(metaSwap.address)),
  )
  console.log(
    "Base LP pool balance:",
    toEther(await baseLPToken.balanceOf(metaSwap.address)),
  )
}

async function main() {
  await setupTest()

  console.log("\nUser 1 adds Liquidity")

  await metaSwap
    .connect(user1)
    .addLiquidity([String(1e18), String(3e18)], 0, MAX_UINT256)

  const actualPoolTokenAmount = await metaLPToken.balanceOf(user1Address)

  // Verify swapToken balance
  console.log("User1 LP balance:", toEther(actualPoolTokenAmount))

  //await setupTest()
  console.log("\nPerforming swaps SUSD -> Base LP")

  for (let i = 0; i < 10; i++) {
    const calculatedSwapReturn = await metaSwap.calculateSwap(
      0,
      1,
      String(1e17),
    )
    console.log("\nCalculated swap amount:", toEther(calculatedSwapReturn))

    const [tokenFromBalanceBefore, tokenToBalanceBefore] =
      await getUserTokenBalances(user1, [susd, baseLPToken])

    console.log(
      "User1 SUSD amount before",
      toEther(tokenFromBalanceBefore),
      "Base LP before:",
      toEther(tokenToBalanceBefore),
    )

    // User 1 successfully initiates swap
    await metaSwap
      .connect(user1)
      .swap(0, 1, String(1e17), calculatedSwapReturn, MAX_UINT256)

    // Check the sent and received amounts are as expected
    const [tokenFromBalanceAfter, tokenToBalanceAfter] =
      await getUserTokenBalances(user1, [susd, baseLPToken])

    console.log(
      "User1 SUSD amount after",
      toEther(tokenFromBalanceAfter),
      "Base LP after:",
      toEther(tokenToBalanceAfter),
    )
  }

  console.log("\nPerforming swaps USDC -> SUSD")
  console.log("From 6 decimal token (base) to 18 decimal token (meta)")

  for (let i = 0; i < 10; i++) {
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
      await getUserTokenBalances(user1, [usdc, susd])

    console.log(
      "User1 USDC amount before",
      to6(tokenFromBalanceBefore),
      "SUSD before:",
      toEther(tokenToBalanceBefore),
    )

    // User 1 successfully initiates swap
    await metaSwap
      .connect(user1)
      .swapUnderlying(
        2,
        0,
        String(1e5),
        minReturnWithNegativeSlippage,
        MAX_UINT256,
      )

    const [tokenFromBalanceAfter, tokenToBalanceAfter] =
      await getUserTokenBalances(user1, [usdc, susd])
    console.log(
      "User1 USDC amount after",
      to6(tokenFromBalanceAfter),
      "SUSD after:",
      toEther(tokenToBalanceAfter),
    )
  }

  console.log("\nPerforming swaps DAI -> USDT")
  console.log("From 18 decimal token (base) to 6 decimal token (base)")

  for (let i = 0; i < 10; i++) {
    const calculatedSwapReturn = await metaSwap.calculateSwapUnderlying(
      1,
      3,
      String(1e17),
    )
    console.log("\nCalculated swap amount:", to6(calculatedSwapReturn))

    const [tokenFromBalanceBefore, tokenToBalanceBefore] =
      await getUserTokenBalances(user1, [dai, usdt])

    console.log(
      "User1 DAI amount before",
      toEther(tokenFromBalanceBefore),
      "USDT before:",
      to6(tokenToBalanceBefore),
    )

    // User 1 successfully initiates swap
    await metaSwap
      .connect(user1)
      .swapUnderlying(1, 3, String(1e17), calculatedSwapReturn, MAX_UINT256)

    // Check the sent and received amounts are as expected
    const [tokenFromBalanceAfter, tokenToBalanceAfter] =
      await getUserTokenBalances(user1, [dai, usdt])

    console.log(
      "User1 DAI amount after",
      toEther(tokenFromBalanceAfter),
      "USDT after:",
      to6(tokenToBalanceAfter),
    )
  }

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
  await metaLPToken
    .connect(user2)
    .approve(metaSwap.address, currentUser1Balance)
  const beforeTokenBalances = await getUserTokenBalances(user2, [
    susd,
    baseLPToken,
  ])

  console.log("\nUser2 SUSD balance before:", toEther(beforeTokenBalances[0]))
  console.log("User2 Base LP balance before:", toEther(beforeTokenBalances[1]))

  console.log("Transfer LP token to user2")
  await metaLPToken.connect(user1).transfer(user2Address, currentUser1Balance)

  console.log(
    "User2 Meta LP token balance",
    toEther(await metaLPToken.balanceOf(user2Address)),
  )

  console.log(
    "Withdraw user2's share via all tokens in proportion to pool's balances",
  )

  await metaLPToken
    .connect(user2)
    .approve(metaSwap.address, currentUser1Balance)

  metaSwap
    .connect(user2)
    .removeLiquidity(currentUser1Balance, [0, 0], MAX_UINT256)

  const afterTokenBalances = await getUserTokenBalances(user2, [
    susd,
    baseLPToken,
  ])

  console.log("User2 SUSD balance after:", toEther(afterTokenBalances[0]))
  console.log("User2 Base LP balance after:", toEther(afterTokenBalances[1]))
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
