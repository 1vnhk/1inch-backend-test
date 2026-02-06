import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ethers } from 'ethers';
import { EthService } from '../eth/eth.service';

const UNISWAP_V2_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const UNISWAP_V2_INIT_CODE =
  '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f';

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'event Sync(uint112 reserve0, uint112 reserve1)',
];

interface ReservesCache {
  reserve0: bigint;
  reserve1: bigint;
  lastUpdated: number;
}

@Injectable()
export class UniswapService implements OnModuleDestroy {
  private readonly logger = new Logger(UniswapService.name);

  // pairAddress -> reserves
  private readonly reservesCache = new Map<string, ReservesCache>();

  // Track subscribed pairs to avoid duplicate subscriptions
  private readonly subscribedPairs = new Set<string>();

  // Track contract instances for cleanup
  private readonly pairContracts = new Map<string, ethers.Contract>();

  constructor(private readonly ethService: EthService) {}

  onModuleDestroy() {
    for (const contract of this.pairContracts.values()) {
      contract.removeAllListeners();
    }

    this.pairContracts.clear();
    this.subscribedPairs.clear();
    this.reservesCache.clear();
  }

  public async getReturnAmount(
    fromToken: string,
    toToken: string,
    amountIn: number,
  ): Promise<bigint> {
    const pairAddress = this.computePairAddress(fromToken, toToken);

    // Get reserves (from cache or fetch + subscribe)
    const { reserveIn, reserveOut } = await this.getReserves(
      pairAddress,
      fromToken,
      toToken,
    );

    const amountInBigInt = BigInt(amountIn);
    return this.getAmountOut(amountInBigInt, reserveIn, reserveOut);
  }

  /**
   * Compute UniswapV2 pair address using CREATE2.
   * Pure function - no RPC call needed.
   */
  public computePairAddress(tokenA: string, tokenB: string): string {
    const [token0, token1] = this.sortTokens(tokenA, tokenB);
    const salt = ethers.utils.keccak256(
      ethers.utils.solidityPack(['address', 'address'], [token0, token1]),
    );

    return ethers.utils.getCreate2Address(
      UNISWAP_V2_FACTORY,
      salt,
      UNISWAP_V2_INIT_CODE,
    );
  }

  /**
   * Get reserves - from cache if available, otherwise fetch and subscribe.
   */
  private async getReserves(
    pairAddress: string,
    fromToken: string,
    toToken: string,
  ): Promise<{ reserveIn: bigint; reserveOut: bigint }> {
    const cached = this.reservesCache.get(pairAddress);

    if (cached) {
      // Cache hit - return immediately (<1ms)
      this.logger.debug(`Cache HIT for pair ${pairAddress}`);
      return this.mapReserves(cached, fromToken, toToken);
    }

    // Cache miss - fetch reserves and subscribe to Sync events
    this.logger.debug(`Cache MISS for pair ${pairAddress}, fetching...`);
    const reserves = await this.fetchAndSubscribe(pairAddress);

    return this.mapReserves(reserves, fromToken, toToken);
  }

  /**
   * Fetch reserves via WebSocket and subscribe to Sync events.
   */
  private async fetchAndSubscribe(pairAddress: string): Promise<ReservesCache> {
    const provider = this.ethService.getProvider();

    if (!provider) {
      throw new Error('WebSocket provider not available');
    }

    const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, provider);

    // Fetch current reserves (ethers v5 dynamic contract - type assertion required)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const [reserve0, reserve1] = (await pairContract.getReserves()) as [
      ethers.BigNumber,
      ethers.BigNumber,
      number,
    ];

    const reserves: ReservesCache = {
      reserve0: reserve0.toBigInt(),
      reserve1: reserve1.toBigInt(),
      lastUpdated: Date.now(),
    };

    // Update cache
    this.reservesCache.set(pairAddress, reserves);

    // Subscribe to Sync events (if not already subscribed)
    if (!this.subscribedPairs.has(pairAddress)) {
      this.subscribeToSync(pairAddress, pairContract);
    }

    return reserves;
  }

  /**
   * Subscribe to Sync events for real-time reserve updates.
   * Sync is emitted on every swap/mint/burn.
   */
  private subscribeToSync(
    pairAddress: string,
    pairContract: ethers.Contract,
  ): void {
    this.subscribedPairs.add(pairAddress);
    this.pairContracts.set(pairAddress, pairContract);

    pairContract.on(
      'Sync',
      (reserve0: ethers.BigNumber, reserve1: ethers.BigNumber) => {
        this.reservesCache.set(pairAddress, {
          reserve0: reserve0.toBigInt(),
          reserve1: reserve1.toBigInt(),
          lastUpdated: Date.now(),
        });
        this.logger.debug(`Sync event: ${pairAddress} updated`);
      },
    );

    this.logger.log(`Subscribed to Sync events for pair ${pairAddress}`);
  }

  /**
   * Map reserves to input/output based on token order.
   */
  private mapReserves(
    reserves: ReservesCache,
    fromToken: string,
    toToken: string,
  ): { reserveIn: bigint; reserveOut: bigint } {
    const [token0] = this.sortTokens(fromToken, toToken);
    const isFromToken0 = fromToken.toLowerCase() === token0.toLowerCase();

    return {
      reserveIn: isFromToken0 ? reserves.reserve0 : reserves.reserve1,
      reserveOut: isFromToken0 ? reserves.reserve1 : reserves.reserve0,
    };
  }

  /**
   * Calculate output amount using UniswapV2 constant product formula.
   * amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
   */
  private getAmountOut(
    amountIn: bigint,
    reserveIn: bigint,
    reserveOut: bigint,
  ): bigint {
    if (amountIn <= 0n) {
      throw new Error('INSUFFICIENT_INPUT_AMOUNT');
    }
    if (reserveIn <= 0n || reserveOut <= 0n) {
      throw new Error('INSUFFICIENT_LIQUIDITY');
    }

    const amountInWithFee = amountIn * 997n;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000n + amountInWithFee;

    return numerator / denominator;
  }

  /**
   * Sort tokens lexicographically (token0 < token1).
   */
  private sortTokens(tokenA: string, tokenB: string): [string, string] {
    const addressA = tokenA.toLowerCase();
    const addressB = tokenB.toLowerCase();

    if (addressA === addressB) {
      throw new Error('IDENTICAL_ADDRESSES');
    }

    return addressA < addressB ? [tokenA, tokenB] : [tokenB, tokenA];
  }
}
