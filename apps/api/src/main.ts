import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { json, urlencoded, type Request, type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { parentMeasurementsSecurityMiddleware,setParentMeasurementsHeaders } from './parent-measurements/parent-measurements-security';
import { ParentMeasurementsValidationPipe } from './parent-measurements/parent-measurements-validation.pipe';

import { websiteOrdersSecurity, websiteOrdersBodyError } from "./website-orders/website-orders-security";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use('/api/public/parent-measurements', parentMeasurementsSecurityMiddleware);
  app.use('/api/public/parent-measurements/photos', json({limit:'3mb'}));
  app.use('/api/public/parent-measurements', json({limit:'32kb'}));
  const parentBodyErrors:ErrorRequestHandler=(error,_request,response,next)=>{
    if(!error){next();return;}
    setParentMeasurementsHeaders(response);
    const candidate=typeof error.getStatus==='function'?error.getStatus():error.status;
    const status=Number.isInteger(candidate)&&candidate>=400&&candidate<=599?candidate:500;
    response.status(status).json({message:status===413?'Слишком большой запрос формы':'Не удалось обработать запрос формы'});
  };
  app.use('/api/public/parent-measurements',parentBodyErrors);
  app.use("/api/integrations/website/orders", websiteOrdersSecurity, json({limit:"256kb"}), websiteOrdersBodyError);
  app.use("/api/communications/attachments", json({ limit: "24mb" }));
  app.use(json({ limit: "8mb", verify: (request: Request & { rawBody?: Buffer }, _response, buffer) => { request.rawBody = Buffer.from(buffer); } }));
  app.use(urlencoded({ extended: true, limit: "8mb" }));
  app.setGlobalPrefix("api");
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: (process.env.WEB_ORIGIN ?? "http://localhost:3500").split(","), credentials: true });
  app.useGlobalPipes(new ParentMeasurementsValidationPipe());
  const config = new DocumentBuilder().setTitle("Yoleotard CRM API").setVersion("0.1").build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, config));
  await app.listen(Number(process.env.API_PORT ?? 4500), "0.0.0.0");
}
bootstrap();
