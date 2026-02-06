# 1inch Backend Test - High Level Design Document

## Overview

This document outlines the architecture and design decisions for a Nest.js application providing two REST endpoints:
1. **`GET /gas-price/:chainId`** - Returns current gas price with <50ms response time
<!-- TODO: -->
2. **`GET /return/:fromTokenAddress/:toTokenAddress/:amountIn`** - Returns estimated UniswapV2 swap output amount

---

## Design Approach

Before designing this API, the existing industry solutions were reviewed to understand best practices.

### Industry Reference: 1inch Gas Price API

The [1inch Gas Price API](https://api.1inch.com/gas-price/v1.6/{chain}) provides a well-established reference implementation:

- **Endpoint pattern**: `GET /gas-price/v1.6/{chainId}` with chain ID in URL path
- **EIP-1559 compliant** response format with `baseFee`, `maxPriorityFeePerGas`, `maxFeePerGas`
- **Multiple priority tiers**: low, medium, high, instant for different urgency levels
- **Multi-chain support**: Ethereum, Polygon, Arbitrum, Base, and others

This design adopts similar patterns while targeting a `<50ms` response time — significantly faster than 1inch's `<200ms` benchmark.

---

## 1. GasPrice Module

Key idea: fetch gas data asynchronously via WebSockets and serve requests synchronously from memory.

#### The Challenge

Direct calls to Ethereum nodes (`eth_gasPrice`) typically take 100–400ms (empirical data) depending on the provider, which violates the <50ms requirement.

#### Solution: WebSocket Subscription with In-Memory Cache

To ensure required response times, the application decouples data fetching from data serving.

**Why not polling?**

Polling was the first approach that came to mind. A polling-based design (e.g. every 5–10 seconds) would also satisfy the latency requirement and may be preferable due to reduced complexity.

After reviewing the QuickNode WebSocket documentation, WebSockets were chosen here to: 
1. **Not waste resources**: Polling every `N` seconds consumes RPC calls even when no new data exists
2. **Avoid potential misses**: Ethereum blocks are created at an average of ~12 seconds, not at fixed intervals
3. **Achieve real-time updates**: WebSocket pushes new block data immediately upon creation

**WebSocket Subscription Approach (eth_subscribe)**:
```bash
wscat -c wss://docs-demo.quiknode.pro/
# wait for connection
{"id":1,"jsonrpc":"2.0","method":"eth_subscribe","params":["newHeads"]}
```

```
┌─────────────────────────────────────────────────────────────────┐
│                     GasPrice Service                            │
│                                                                 │
│   ┌─────────────┐         ┌─────────────┐                       │
│   │  WebSocket  │────────▶│  In-Memory  │◀────── API Request    │
│   │  newHeads   │  event  │   Cache     │        (<50ms)        │
│   └──────┬──────┘         └─────────────┘                       │
│          │                                                      │
│          │ subscribe                                            │
│          ▼                                                      │
│   ┌─────────────┐                                               │
│   │  Ethereum   │                                               │
│   │  WebSocket  │                                               │
│   └─────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

**Components**:
- **WebSocket Listener**: Subscribes to `newHeads` events via `eth_subscribe`
- **In-Memory Cache**: Singleton object storing latest EIP-1559 fee data + timestamp
- **API Controller**: Reads directly from local variable—network latency is effectively 0ms plus minimal framework overhead
- **Staleness Monitor**: If cache freshness exceeds a defined threshold (e.g. 30s), the service falls back to a direct RPC fetch.

**Strategy**:
1. On application startup, establish WebSocket connection and fetch initial gas price
2. Subscribe to `newHeads` events
3. On each new block event, fetch updated gas price and update cache
4. API requests read directly from cache (sub-millisecond)

#### API Specification

**Endpoint**: `GET /gas-price/:chainId`

For this implementation, we support Ethereum (chainId: 1). The design allows future multi-chain expansion and follows 1inch API design, which in turn follows EIP-1559 (more info [here](https://www.blocknative.com/blog/eip-1559-fees)).

**Response** (200 OK):
```json
{
  "baseFee": "12500000000",
  "low": {
    "maxPriorityFeePerGas": "1000000000",
    "maxFeePerGas": "13500000000"
  },
  "medium": {
    "maxPriorityFeePerGas": "1500000000",
    "maxFeePerGas": "14000000000"
  },
  "high": {
    "maxPriorityFeePerGas": "2000000000",
    "maxFeePerGas": "14500000000"
  },
  "instant": {
    "maxPriorityFeePerGas": "3000000000",
    "maxFeePerGas": "15500000000"
  }
}
```



#### Why In-Memory Cache vs Redis?

| In-Memory | Redis |
|-----------|-------|
| Sub-millisecond access | ~1-2ms network overhead |
| No external dependency | Requires Redis instance |
| Zero configuration | Connection management needed |
| Sufficient for single instance | Needed for horizontal scaling |

**Decision**: In-memory cache. The requirements suggest single-instance deployment, and we want to minimize latency overhead.

##### HTTP Headers (Latency-Relevant)

To minimize end-to-end latency and enable edge caching, the API sets:

- `Cache-Control: public, s-maxage=5, stale-while-revalidate=10` (edge caching + instant responses)
- `ETag` (conditional requests)
- `Connection: keep-alive` (avoid repeated TCP/TLS handshakes)
- `Content-Encoding: br` (smaller payloads)

These are standard headers with measurable impact and minimal implementation complexity.

**Why `stale-while-revalidate`**

Gas price accuracy tolerates small staleness (1–2s). Serving slightly stale data instantly is preferable to blocking on origin fetch, especially on mobile networks.

### Advanced Optimizations (Not Required for This Test)
**The Geography Problem**

Even with sub-millisecond local cache, **client location determines latency**: a request from Tokyo to London takes [~250ms due to speed of light](https://wondernetwork.com/pings/London/Tokyo). This is why edge caching is essential.

#### Achieving Global <50ms: Cloudflare Cache API

The requirement **“you can make any technical decisions”** allows consideration of production-grade approaches for meeting strict latency SLAs.

**Edge Caching Strategy**

Standard static caching won't work since gas prices change every ~12 seconds. The Edge caching (Cloudflare) allows programmatic control over edge caching with custom TTLs, enabling us to cache dynamic data at 300+ edge locations worldwide (if we need that many).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Edge Caching (Cloudflare) Architecture                   │
│                                                                             │
│   User (Tokyo)                                                              │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────────┐                           ┌───────────────────┐       │
│   │ Cloudflare Edge │──── CACHE HIT ───────────▶│   Return cached   │       │
│   │ (Tokyo)         │                           │   response <15ms  │       │
│   └────────┬────────┘                           └───────────────────┘       │
│            │                                                                │
│       CACHE MISS (or stale-while-revalidate)                                │
│            │                                                                │
│            ▼                                                                │
│   ┌─────────────────┐     ┌──────────────────────────────────────────┐      │
│   │  Nest.js Origin │────▶│ Cache-Control: s-maxage=5,               │      │
│   │  (In-Memory)    │     │                stale-while-revalidate=10 │      │
│   └─────────────────┘     └──────────────────────────────────────────┘      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**How it works**:
1. Request hits nearest Cloudflare edge (300+ global locations)
2. **Cache HIT**: Edge returns cached response instantly (~5-15ms)
3. **Cache STALE**: Edge returns stale response instantly while revalidating in the background
4. **Cache MISS**: Request forwards to origin, response cached per `Cache-Control` headers
5. Origin serves from in-memory cache (sub-millisecond), updated in real-time via WebSocket

**Optimized Request Flow Example**

1. User in Tokyo sends request to `/gas-price/1`
2. Cloudflare Anycast routes to Tokyo Edge Data Center
3. Edge cache returns response (kept fresh via `stale-while-revalidate`)
4. **Total Latency**: ~10ms (network) + ~5ms (edge) = **~15ms**

**Further Optimizations (if <50ms still not achieved)**

| Strategy | Implementation | Benefit |
|----------|----------------|---------|
| **Multi-Region Deployment** | Deploy origin to US-East, EU-Central, AP-Southeast | Reduces origin latency on cache miss |
| **Fastify over Express** | Switch Nest.js HTTP adapter | ~5-10ms framework overhead reduction |
| **Alternative runtimes** | Go / Rust | Potential latency gains |

#### Advanced Optimizations (Future Proofing)

**1. Multi-Provider Aggregation (Anti-Lag Strategy)**

Instead of trusting a single WebSocket, connect to multiple providers (e.g., Alchemy + QuickNode + Infura):

```
┌─────────────────────────────────────────────────────────────────┐
│                  Multi-Provider WebSocket                       │
│                                                                 │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐                    │
│   │  Alchemy │   │QuickNode │   │  Infura  │                    │
│   └────┬─────┘   └────┬─────┘   └────┬─────┘                    │
│        │              │              │                          │
│        └──────────────┼──────────────┘                          │
│                       ▼                                         │
│              ┌────────────────┐                                 │
│              │  Aggregator:   │                                 │
│              │  max(gasPrice) │                                 │
│              └────────────────┘                                 │
│                       │                                         │
│                       ▼                                         │
│              ┌────────────────┐                                 │
│              │  In-Memory     │                                 │
│              │  Cache         │                                 │
│              └────────────────┘                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Logic**: Update cache with the **highest** gas value seen across all providers.

**Reasoning**: We want to avoid transactions being stuck due to undervalued gas price. Over-estimating by 1-2 gwei is safer than under-estimating due to a lagging RPC node.

**2. Hybrid Hydration (Startup Strategy)**

WebSocket connections require a handshake that can take 100-300ms. To ensure the cache is warm before the first user request:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Application Bootstrap                        │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │    Promise.any([                                        │   │
│   │      Alchemy.eth_gasPrice(),                            │   │
│   │      QuickNode.eth_gasPrice(),                          │   │
│   │      Infura.eth_gasPrice()                              │   │
│   │    ]);                                                  │   │
│   └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│                  Cache seeded (~200ms)                          │
│                           │                                     │
│         ┌─────────────────┼─────────────────┐                   │
│         ▼                 ▼                 ▼                   │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐                │
│   │ Alchemy  │     │QuickNode │     │  Infura  │                │
│   │   WS     │     │   WS     │     │   WS     │                │
│   └──────────┘     └──────────┘     └──────────┘                │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           ▼                                     │
│              WebSocket subscriptions active                     │
│              (takes over cache updates)                         │
└─────────────────────────────────────────────────────────────────┘
```

**Why `Promise.any()`?** Returns as soon as the **first** provider responds successfully. If Alchemy responds in 150ms but QuickNode is slow, we don't wait. This guarantees the cache is warm before the WebSocket handshakes complete.

---

For the purposes of this test, a single-instance deployment with in-memory caching fully satisfies the functional and latency requirements.

---

### 2. UniswapV2 Module

**Purpose**: Calculate swap output amounts off-chain using UniswapV2 reserve data.

#### Assumptions

> **Assumption**: For this implementation, we assume the UniswapV2 pair (liquidity pool) exists for any given token pair. This simplifies error handling and is reasonable for well-known token pairs (e.g., WETH/USDC, WETH/DAI).
>
> **Production consideration**: In a production system, we would handle the case where `getReserves()` fails by returning a `404 PAIR_NOT_FOUND` error.

#### The Challenge

Using on-chain view functions like `getAmountsOut()` from the UniswapV2 is expensive and also prohibited by the task itself.

#### Solution: Off-Chain Constant Product Calculation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              GET /return/:fromToken/:toToken/:amountIn                      │
│                                                                             │
│   Step 1: Compute Pair Address (CREATE2)                                    │
│   ┌─────────────────┐                                                       │
│   │ CREATE2 hash    │──────▶ No RPC call needed (deterministic)            │
│   │ (local compute) │                                                       │
│   └────────┬────────┘                                                       │
│            │                                                                │
│   Step 2: Get Reserves (single RPC call)                                    │
│   ┌────────▼────────┐                                                       │
│   │ Pair.getReserves│──────▶ Fresh fetch (validates pair exists)           │
│   │ ()              │                                                       │
│   └────────┬────────┘                                                       │
│            │                                                                │
│   Step 3: Off-Chain Math                                                    │
│   ┌────────▼────────┐                                                       │
│   │ getAmountOut()  │──────▶ Constant product formula with 0.3% fee        │
│   │ (pure function) │                                                       │
│   └────────┬────────┘                                                       │
│            │                                                                │
│            ▼                                                                │
│   Return: { amountOut: "..." }                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### UniswapV2 Math: Constant Product Formula

UniswapV2 uses the [constant product formula](https://docs.uniswap.org/contracts/v2/concepts/protocol-overview/glossary#constant-product-formula): `x × y = k`

<!-- TODO: figure out why so -->
<!-- TODO: write a description, so can be easily understood and comprehended (by myself in the first place) -->
**The Formula** (with 0.3% fee):
```
amountOut = (amountIn × 997 × reserveOut) / (reserveIn × 1000 + amountIn × 997)
```

Where:
- `997/1000` represents the 0.3% swap fee (0.997 = 1 - 0.003)
- `reserveIn` = reserve of the input token in the pair
- `reserveOut` = reserve of the output token in the pair

**Implementation** (using BigInt for precision):
- Token amounts can be up to 10^77 (uint256 max)
- JavaScript `Number` loses precision after 2^53
- BigInt provides arbitrary precision integer arithmetic

#### Token Ordering in UniswapV2

UniswapV2 pairs always [order tokens](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/library#sorttokens) by address (lexicographically):
- `token0` = address with smaller hex value
- `token1` = address with larger hex value

When fetching reserves via `getReserves()`, the returned `(reserve0, reserve1)` correspond to `(token0, token1)`. The implementation must map these to `reserveIn` and `reserveOut` based on which token is being swapped.

#### Getting Pair Address: CREATE2 vs getPair()

**Initial Approach Considered**: Calling `factory.getPair(tokenA, tokenB)`

After reviewing the [UniswapV2 documentation](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/pair-addresses), a better approach was found: computing the pair address off-chain using [CREATE2](https://docs.uniswap.org/sdk/v2/guides/getting-pair-addresses#create2) withput RPC calls.

**Why CREATE2 is superior**:
| Approach | RPC Calls | Latency | Cacheable |
|----------|-----------|---------|-----------|
| `factory.getPair()` | 1 per request | ~100-200ms | Yes, but requires initial fetch |
| CREATE2 computation | 0 | ~0.01ms | N/A (deterministic) |

**The CREATE2 Formula**:
```
pairAddress = keccak256(0xff ++ factoryAddress ++ salt ++ initCodeHash)[12:]

where:
  salt = keccak256(abi.encodePacked(token0, token1))
  initCodeHash = 0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f
```

> **Note**: The `INIT_CODE_HASH` is the keccak256 hash of the UniswapV2Pair contract creation bytecode. This is constant for all pairs on mainnet.

#### Caching Strategy

| Data | Cache | TTL | Rationale |
|------|-------|-----|-----------|
| **Pair addresses** | N/A | - | Computed via CREATE2 (no RPC, no cache needed) |
| **Reserves** | No | - | Change on every swap; must be fresh for accurate quotes |
| **Token metadata** | Yes | 24h | Decimals, symbols rarely change |

> **Note**: With CREATE2, we eliminated the need for pair address caching entirely. The address computation is ~0.01ms and purely deterministic.

#### Performance Considerations

**Comparison with getPair() approach**:
| Approach | RPC Calls | Cold Start | Warm Cache |
|----------|-----------|------------|------------|
| `factory.getPair()` + `getReserves()` | 2 (first), 1 (cached) | ~300-400ms | ~100-200ms |
| CREATE2 + `getReserves()` | 1 (always) | ~100-200ms | ~100-200ms |

CREATE2 eliminates the "cold start" penalty entirely.

#### Edge Cases

| Case | Handling |
|------|----------|
| Same token for input and output | Return `400 INVALID_REQUEST` |
| Zero amount | Return `400 INVALID_AMOUNT` |
| Pair exists but has zero liquidity | Return `422 INSUFFICIENT_LIQUIDITY` |
| Output amount would be 0 (dust trade) | Return calculated 0 (let client decide) |
| ~~Pair doesn't exist~~ | ~~Return `404 PAIR_NOT_FOUND`~~ (out of scope per assumption) |

---

## Appendix: EIP-1559 Parameters

| Parameter | Description |
|-----------|-------------|
| `baseFee` | Protocol-determined fee that gets burned. Adjusts based on block fullness (increases if >50% full, decreases otherwise). |
| `maxPriorityFeePerGas` | Tip to validators for transaction prioritization. Set by the sender. |
| `maxFeePerGas` | Maximum total fee per gas unit. Equals `baseFee + maxPriorityFeePerGas`. Difference is refunded. |

#### Priority Tiers

| Tier | Use Case |
|------|----------|
| `low` | Non-urgent transactions, willing to wait |
| `medium` | Standard transactions |
| `high` | Time-sensitive transactions |
| `instant` | Maximum priority, immediate inclusion |