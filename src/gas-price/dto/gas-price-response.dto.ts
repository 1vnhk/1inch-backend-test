export class GasPriceTierDto {
  maxPriorityFeePerGas!: string;
  maxFeePerGas!: string;
}

export class GasPriceResponseDto {
  baseFee!: string;
  low!: GasPriceTierDto;
  medium!: GasPriceTierDto;
  high!: GasPriceTierDto;
  instant!: GasPriceTierDto;
}
