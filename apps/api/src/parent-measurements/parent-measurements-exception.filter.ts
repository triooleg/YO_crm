import { ArgumentsHost,Catch,ExceptionFilter,HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { setParentMeasurementsHeaders } from './parent-measurements-security';

/** Never hand public payloads or ORM parameter errors to the default exception logger. */
@Catch()
export class ParentMeasurementsExceptionFilter implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost){
  const response=host.switchToHttp().getResponse<Response>();
  const status=error instanceof HttpException?error.getStatus():500;
  setParentMeasurementsHeaders(response);
  response.status(status).json({statusCode:status,message:status===409?'Данные изменились. Обновите форму':status>=500?'Форма временно недоступна. Повторите позже':'Проверьте доступ и поля формы'});
 }
}
