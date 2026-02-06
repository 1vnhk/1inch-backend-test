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

**NOTE**: The first request may work slower than 50ms but all the subsequent requests should be below the specified limit.

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

## 2. UniswapV2 Module

**Purpose**: Calculate swap output amounts off-chain using UniswapV2 reserve data.

### Assumptions & Scope

> **Assumption**: For this implementation, we assume the UniswapV2 pair exists for the requested token pair.
>
> **Production Consideration**: In a production system, we would support multi-hop routing (e.g. `TokenA` → `...Intermediate Tokens` → `TokenB`) when a direct pair does not exist. 

### The Challenge

Using on-chain view functions like `getAmountsOut()` from the UniswapV2 is latency-expensive and is explicitly prohibited by the task.

### Solution Architecture

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
│   │ Pair.getReserves│──────▶ Fresh fetch (fails if pair does not exist)           │
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

UniswapV2 uses the [constant product formula](https://docs.uniswap.org/contracts/v2/concepts/protocol-overview/glossary#constant-product-formula): `x * y = k`

**The Formula** (with 0.3% fee):
### UniswapV2 Math: The "Input with Fee" Logic

The core of UniswapV2 is the [Constant Product Formula](https://docs.uniswap.org/contracts/v2/concepts/protocol-overview/glossary#constant-product-formula).

**The Derivation**:

1. **Invariant**: The product of reserves after the swap must equal (or exceed) the product before:
```
(reserveIn + amountInWithFee) * (reserveOut - amountOut) >= k

which is

(reserveIn + amountInWithFee) * (reserveOut − amountOut) >= reserveIn * reserveOut
```

2. **Fee deduction**: Uniswap takes a 0.3% fee. This means for every 1000 units input, only 997 units actually hit the liquidity pool. All calculations are performed with integers to avoid floating-point errors.
```
amountInWithFee = (amountIn * 997) / 1000
```

3. **Final Formula (Integer Math)**:

To avoid floating point errors, we multiply the numerator and denominator by 1000 to work with integers:

```
numerator   = amountIn * 997 * reserveOut
denominator = (reserveIn * 1000) + (amountIn * 997)
amountOut   = numerator / denominator  // Integer division floors the result
```

NOTE: the math could be derived from [periphery](https://github.com/Uniswap/v2-periphery/blob/master/contracts/libraries/UniswapV2Library.sol#L43), just performed off-chain.

**Implementation Note**: Token amounts can reach 10^77 (uint256 max). JavaScript `Number` loses precision after 2^53, so **BigInt** is required for all calculations.

### Deterministic Addressing: The CREATE2 Strategy

Instead of asking the blockchain *"Where is this pair?"*, we calculate *"Where must this pair be?"* using the [CREATE2](https://eips.ethereum.org/EIPS/eip-1014) opcode standard.

**Initial Approach Considered**: `factory.getPair(tokenA, tokenB)`

After reviewing the [UniswapV2 documentation](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/pair-addresses), a better approach was found.

**Why CREATE2 is superior**:

| Benefit | Explanation |
|---------|-------------|
| **Zero RPC Overhead** | `factory.getPair()` requires a network call (~100-200ms). CREATE2 is a local hash calculation (~0.01ms). |
| **Security** | Pair addresses are computed locally and cannot differ between RPC providers. |
| **No Cold Start** | Eliminates the "first request is slow" problem entirely. |

[CREATE2 Formula](https://docs.uniswap.org/contracts/v2/guides/smart-contract-integration/getting-pair-addresses#create2)

**Token Ordering**: UniswapV2 pairs always [order tokens](https://docs.uniswap.org/contracts/v2/reference/smart-contracts/library#sorttokens) lexicographically by address (`token0 < token1`). The implementation must sort tokens before computing the salt.

### Edge Case Handling

| Scenario | HTTP Code | Resolution Logic |
|----------|-----------|------------------|
| Zero Liquidity | `422` | If `reserveIn` or `reserveOut` is 0, mathematics break. Return `INSUFFICIENT_LIQUIDITY`. |
| Identical Tokens | `400` | If `tokenA === tokenB`, swap is impossible. Return `INVALID_REQUEST`. |
| Zero Amount | `400` | If `amountIn <= 0`, return `INVALID_AMOUNT`. |
| Pair Not Found | - | Out of scope per assumption. |

### Performance Summary

| Metric | Value |
|--------|-------|
| RPC Calls per Request | 1 (`getReserves()` only) |
| Pair Address Computation | ~0.01ms (local) |
| Total Latency | ~100-200ms (dominated by RPC) |

Note: Achieving sub-50ms latency requires co-locating the service with a low-latency Ethereum node (e.g. dedicated QuickNode/Alchemy instance in the same region) or using a cached reserve snapshot for slightly stale quotes.

### Future Considerations (Out of Scope)

The following enhancements are not implemented in this MVP but would be valuable in a production system:

**1. Multi-Hop Routing**

Multi-hop routing requires graph search across pools and is out of scope for this MVP.

When a direct pair doesn't exist (e.g., `TokenA/TokenB`), route through an intermediary:
```
TokenA → ...Intermediary Tokens → TokenB
```

This requires:
- Graph traversal to find optimal path
- Chaining multiple `getAmountOut()` calculations
- Comparing routes to find best output

**2. Slippage Protection & Price Impact**

The current endpoint returns a point-in-time quote. Enhanced response could include:

| Field | Description |
|-------|-------------|
| `priceImpact` | Percentage price movement caused by this trade size |
| `minAmountOut` | Suggested minimum with configurable slippage tolerance (e.g., 0.5%) |

**3. Multi-DEX Aggregation**

Query reserves from multiple DEXs (Uniswap, Sushiswap, etc.) and return the best rate—similar to what 1inch does in production.

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