export interface GasPriceTierDto {
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
}

export interface GasPriceResponseDto {
  baseFee: string;
  low: GasPriceTierDto;
  medium: GasPriceTierDto;
  high: GasPriceTierDto;
  instant: GasPriceTierDto;
}
