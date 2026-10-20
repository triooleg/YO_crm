import { IsOptional, IsString, MaxLength } from 'class-validator';
/** String-only HTTP query; semantic date/enum validation belongs to one normalizer. */
export class SalesStatisticsQueryDto {
  @IsOptional() @IsString() @MaxLength(10) from?: string;
  @IsOptional() @IsString() @MaxLength(10) to?: string;
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  @IsOptional() @IsString() @MaxLength(40) source?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(128) clientId?: string;
  @IsOptional() @IsString() @MaxLength(100) country?: string;
  @IsOptional() @IsString() @MaxLength(40) orderType?: string;
  @IsOptional() @IsString() @MaxLength(40) discipline?: string;
  @IsOptional() @IsString() @MaxLength(20) tab?: string;
  @IsOptional() @IsString() @MaxLength(2) months?: string;
  @IsOptional() @IsString() @MaxLength(20) metric?: string;
  @IsOptional() @IsString() @MaxLength(20) customerMetric?: string;
  @IsOptional() @IsString() @MaxLength(20) revenueMetric?: string;
  @IsOptional() @IsString() @MaxLength(20) ranking?: string;
  @IsOptional() @IsString() @MaxLength(20) scope?: string;
  @IsOptional() @IsString() @MaxLength(20) repeat?: string;
  @IsOptional() @IsString() @MaxLength(20) drill?: string;
  @IsOptional() @IsString() @MaxLength(6) page?: string;
  @IsOptional() @IsString() @MaxLength(3) pageSize?: string;
  @IsOptional() @IsString() @MaxLength(20) sort?: string;
  @IsOptional() @IsString() @MaxLength(4) direction?: string;
  @IsOptional() @IsString() @MaxLength(64) valuationVersion?: string;
  @IsOptional() @IsString() @MaxLength(1) refresh?: string;
}
