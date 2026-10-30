import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
export class ParentStartDto {
 @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!:string;
 @IsOptional() @IsIn(['ru','en','fr','de','es','it']) locale?:string;
 @Equals(true) consent!:boolean;
}
export class ParentRecoveryDto { @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!:string; }
export class ParentChildDto { @IsString() @Length(1,100) firstName!:string; }
export class ParentRevisionDto { @IsInt() @Min(0) revision!:number; }
export class ParentSaveDto extends ParentRevisionDto { @IsObject() draft!:Record<string,unknown>; }
export class ParentSubmitDto extends ParentRevisionDto {
 @IsString() @Matches(/^[a-zA-Z0-9_-]{16,100}$/) operationKey!:string;
 @Equals(true) consent!:boolean;
}
export class ParentInviteDto {
 @IsIn(['SHARED','PERSONAL']) mode!:'SHARED'|'PERSONAL';
 @IsInt() @Min(1) @Max(14) days=14;
 @IsOptional() @IsIn(['ru','en','fr','de','es','it']) locale?:string;
}
export class ParentReviewDto {
 @IsDateString() expectedUpdatedAt!:string;
 @IsIn(['VERIFIED','NEEDS_CLARIFICATION']) status!:string;
 @IsOptional() @IsString() @Length(1,2000) reason?:string;
}
export class ParentAssignmentTargetDto {
 @IsString() @Length(1,100) id!:string;
 @IsDateString() expectedUpdatedAt!:string;
}
export class ParentAssignDto {
 @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ArrayUnique((t:ParentAssignmentTargetDto)=>t?.id)
 @ValidateNested({each:true}) @Type(()=>ParentAssignmentTargetDto) targets!:ParentAssignmentTargetDto[];
 @IsString() @Matches(/^[a-zA-Z0-9_-]{16,100}$/) operationKey!:string;
 @IsOptional() @IsBoolean() confirmProduction?:boolean;
 @IsOptional() @IsString() @Length(1,2000) reason?:string;
}
export class ParentBindDto {
 @IsString() @Length(1,100) athleteId!:string;
 @IsInt() @Min(0) expectedRevision!:number;
 @Equals(true) representativeVerified!:boolean;
 @IsString() @Length(3,2000) reason!:string;
}
export class ParentPhotoDto {
 @IsIn(['image/jpeg','image/png','image/webp']) mimeType!:string;
 @IsString() @Length(4,2796204) base64!:string;
}
