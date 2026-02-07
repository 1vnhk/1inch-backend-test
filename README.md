# 1inch Backend Test

A high-performance Nest.js API service providing Ethereum gas prices and UniswapV2 swap calculations.

## Architecture

See [DESIGN.md](./DESIGN.md) for detailed architecture and design decisions.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env.development.local
# Edit .env.development.local with your Ethereum node URL

# Run in development
npm run start:dev

# Run tests
npm test
```

## Requirements

- Node.js 20+
- Ethereum WebSocket RPC endpoint (Alchemy, Infura, or QuickNode)

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3000) |
| `ETH_NODE_WS` | Ethereum WebSocket URL | Yes |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start with hot reload |
| `npm run start:prod` | Production mode |
| `npm run build` | Compile TypeScript |
| `npm test` | Run unit tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run lint` | Lint and fix |

---

## Live Demo

Deployed on Render - Germany (free tier):

| Endpoint | URL |
|----------|-----|
| Root | https://oneinch-backend-test.onrender.com |
| Gas Price | https://oneinch-backend-test.onrender.com/gasPrice/1 |
| Swap 1 WETH → USDC | https://oneinch-backend-test.onrender.com/return/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/1000000000000000000 |

> **Note**: Render free tier spins down after inactivity. The first request may take longer while the instance cold-starts.

For convenience, I suggest using `Postman` to see response times.

---

## API Endpoints

### Health Check

```
GET /health
```

Returns service health status.

---

## Gas Price

```
GET /gasPrice/:chainId
```

Returns current Ethereum gas prices with EIP-1559 fee data.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `chainId` | number | Chain ID (currently only `1` for Ethereum mainnet) |

### Response

```json
{
  "baseFee": "12000000000",
  "low": {
    "maxPriorityFeePerGas": "800000000",
    "maxFeePerGas": "12800000000"
  },
  "medium": {
    "maxPriorityFeePerGas": "1000000000",
    "maxFeePerGas": "13000000000"
  },
  "high": {
    "maxPriorityFeePerGas": "1200000000",
    "maxFeePerGas": "13200000000"
  },
  "instant": {
    "maxPriorityFeePerGas": "1500000000",
    "maxFeePerGas": "13500000000"
  }
}
```

### Performance

- **Target latency**: <50ms
- **Update frequency**: Every new block (~12s)
- **Caching**: In-memory with WebSocket updates

Current latency is 50-100ms when deployed to Render Free Tier (Germany) (https://oneinch-backend-test.onrender.com/gasPrice/1):
[Screenshot](https://prnt.sc/qLzoTbyjZxR2)
It seems that the response time is dominated by the infrastructure. In a production environment, this can be solved with better hardware infrastructure and better routing.

---

## UniswapV2 Return Amount

```
GET /return/:fromTokenAddress/:toTokenAddress/:amountIn
```

Calculates expected output amount for a UniswapV2 swap using off-chain math.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fromTokenAddress` | string | Input token address (checksummed) |
| `toTokenAddress` | string | Output token address (checksummed) |
| `amountIn` | string | Input amount **in wei** (token's smallest unit) |

### Token Decimals

Amounts must be specified in the token's smallest unit (wei). Common tokens:

| Token | Decimals | 1 token in wei |
|-------|----------|----------------|
| WETH | 18 | `1000000000000000000` |
| USDC | 6 | `1000000` |
| USDT | 6 | `1000000` |
| DAI | 18 | `1000000000000000000` |

### Example Requests

**Swap 1 WETH → USDC:**
```
GET /return/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/1000000000000000000
```

**Swap 0.1 WETH → USDC:**
```
GET /return/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/100000000000000000
```

The `amountOut` is in the output token's smallest unit. For USDC (6 decimals), divide by `10^6` to get the human-readable amount:
- `2500000000` ÷ `10^6` = **2500 USDC**

### Common Token Addresses (Ethereum Mainnet)

| Token | Address |
|-------|---------|
| WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| DAI | `0x6B175474E89094C44Da98b954EedeAC495271d0F` |
