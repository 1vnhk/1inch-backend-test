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

## API Endpoints

### Health Check

```
GET /health
```

Returns service health status with memory indicators.

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

Current latency is 50-100ms when deployed to Render Free Tier (https://oneinch-backend-test.onrender.com/gasPrice/1):
[Screenshot](https://prnt.sc/qLzoTbyjZxR2)
It seems that the response time is dominated by the infrastructure. Local testing showed results <50ms. In a production environment, this can be solved with better hardware infrastructure and better routing. Using TLS 1.3 also should reduce the handshake time. 

---

## UniswapV2 Return Amount
