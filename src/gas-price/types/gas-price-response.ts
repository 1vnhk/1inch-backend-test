export interface GasPriceTier {
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
}

export interface GasPriceResponse {
  baseFee: string;
  low: GasPriceTier;
  medium: GasPriceTier;
  high: GasPriceTier;
  instant: GasPriceTier;
}
