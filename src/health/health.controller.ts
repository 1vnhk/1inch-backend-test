import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { EthWsHealthIndicator } from './eth-ws.health';

const MAX_HEAP_MEMORY_USAGE_MB = 200 * 1024 * 1024; // 200 MB

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private memory: MemoryHealthIndicator,
    private ethWs: EthWsHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', MAX_HEAP_MEMORY_USAGE_MB),
      () => this.ethWs.isHealthy(),
    ]);
  }
}
