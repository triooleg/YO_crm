import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { OmitType } from '@nestjs/swagger';
export class TaxCommandDto {
 @IsString() @MaxLength(160) operationKey!:string;
 @IsInt() @Min(0) expectedRevision!:number;
}
export class TaxSettingsDto extends TaxCommandDto { @IsBoolean() enabled!:boolean; }
export class TaxPolicyDto extends TaxCommandDto {
 @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom!:string;
 @IsIn([2,3]) group!:2|3;
 @IsIn(['PERCENT','FIXED']) unifiedMode!:'PERCENT'|'FIXED';
 @IsInt() @Min(0) @Max(10000) unifiedRateBps!:number;
 @IsOptional() @IsInt() @Min(0) fixedUnifiedMinor!:number|null;
 @IsOptional() @IsInt() @Min(1) @Max(2000) fixedUnifiedWageRateBps?:number|null;
 @IsInt() @Min(0) @Max(10000) militaryRateBps!:number;
 @IsInt() @Min(0) @Max(10000) esvRateBps!:number;
 @IsOptional() @IsString() @MaxLength(4000) transitionEvidence?:string;
 @IsOptional() @IsString() supersedesId?:string;
}
export class TaxReportDto {
 @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) from?:string;
 @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) to?:string;
}
/** Read-only: revision is compared, but no command/idempotency key is accepted. */
export class TaxPolicyPreviewDto extends OmitType(TaxPolicyDto, ['operationKey'] as const) {}
export class TaxBackfillPreviewDto {
 @Matches(/^\d{4}-\d{2}-\d{2}$/) from!:string;
 @Matches(/^\d{4}-\d{2}-\d{2}$/) to!:string;
}
export class TaxBackfillApplyDto extends TaxCommandDto {
 @Matches(/^\d{4}-\d{2}-\d{2}$/) from!:string;
 @Matches(/^\d{4}-\d{2}-\d{2}$/) to!:string;
 @IsString() token!:string;
}
export class TaxConfirmSourceDto extends TaxCommandDto {
 @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) postingPeriod?:string;
 @IsInt() @Min(1) grossMinor!:number;
 @Matches(/^\d{4}-\d{2}-\d{2}$/) incomeDate!:string;
 @IsString() @MaxLength(4000) evidence!:string;
}
export class TaxSettlementDto extends TaxCommandDto {
 @IsIn(['UNIFIED','MILITARY','ESV']) component!:'UNIFIED'|'MILITARY'|'ESV';
 @IsOptional() @IsString() expenseId?:string;
 @IsOptional() @IsString() categoryId?:string;
 @IsOptional() @IsInt() @Min(1) amountMinor?:number;
 @IsOptional() @IsString() incurredAt?:string;
 @IsOptional() @IsString() @MaxLength(4000) notes?:string;
}
export class TaxAllocationDto extends TaxCommandDto {
 @IsString() linkId!:string;
 @IsString() rootId!:string;
 @IsInt() @Min(1) amountMinor!:number;
}
export class TaxReasonDto extends TaxCommandDto { @IsString() @MaxLength(4000) reason!:string; }
export class TaxSettlementCorrectionDto extends TaxReasonDto {
 @IsOptional() @IsInt() @Min(1) amountMinor?:number;
 @IsOptional() @IsString() incurredAt?:string;
 @IsOptional() @IsBoolean() cancel?:boolean;
}
export class TaxCorrectionDto extends TaxReasonDto {
 @IsString() rootId!:string;
 @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!:string;
 @IsInt() amountMinor!:number;
 @IsString() @MaxLength(4000) evidence!:string;
}
export class TaxCloseDto extends TaxCommandDto { @IsString() @MaxLength(4000) completenessEvidence!:string; }
export class TaxExemptionDto extends TaxReasonDto { @IsString() @MaxLength(4000) evidence!:string; @IsBoolean() exempt!:boolean; }
