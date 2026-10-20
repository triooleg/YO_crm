import { ArgumentMetadata,Injectable,ValidationPipe } from '@nestjs/common';
import * as parentDtos from './parent-measurements.dto';
import * as rangeDtos from './parent-measurements-ranges.dto';
import * as taxDtos from '../taxes/taxes.dto';
const strictTypes=new Set<unknown>([...Object.values(parentDtos),...Object.values(rangeDtos),...Object.values(taxDtos)]);

/** Validate new DTOs before the legacy global whitelist can erase unknown fields. */
@Injectable()
export class ParentMeasurementsValidationPipe extends ValidationPipe {
 private readonly strict=new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true});
 constructor(){super({whitelist:true,transform:true});}
 override transform(value:unknown,metadata:ArgumentMetadata){
  return strictTypes.has(metadata.metatype)?this.strict.transform(value,metadata):super.transform(value,metadata);
 }
}
