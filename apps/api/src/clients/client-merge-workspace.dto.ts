import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsObject, IsString, Length, Matches, Validate, ValidateIf, ValidatorConstraint, type ValidatorConstraintInterface } from "class-validator";

export const clientMergeChoiceFields = ["displayName", "firstName", "lastName", "avatarUrl", "country", "city", "address", "postalCode", "language", "timezone", "preferredChannel", "email", "phone", "whatsapp", "instagram", "instagramUsername", "facebook", "telegram"] as const;
export type ClientMergeChoiceField = typeof clientMergeChoiceFields[number];
export type ClientMergeFieldChoices = Partial<Record<ClientMergeChoiceField, string>>;

@ValidatorConstraint({ name: "clientMergeFieldChoices", async: false })
export class ClientMergeFieldChoicesValidator implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
      Object.entries(value as Record<string, unknown>).every(([key, id]) =>
        clientMergeChoiceFields.includes(key as ClientMergeChoiceField) && typeof id === "string" && id.length > 0 && id.length <= 100);
  }
  defaultMessage() { return "CLIENT_MERGE_FIELD_CHOICES_INVALID"; }
}

export class ClientMergePreviewDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 9 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(9) @ArrayUnique() @IsString({ each: true }) @Length(1, 100, { each: true })
  sourceClientIds!: string[];

  @ApiPropertyOptional({ type: Object })
  @ValidateIf((_, value) => value !== undefined) @IsObject() @Validate(ClientMergeFieldChoicesValidator)
  fieldChoices?: ClientMergeFieldChoices;
}

export class ClientMergeBatchDto extends ClientMergePreviewDto {
  @ApiProperty() @IsString() @Matches(/^[a-f0-9]{64}$/)
  previewToken!: string;
}
