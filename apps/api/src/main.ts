import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { json, urlencoded, type Request } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: "8mb", verify: (request: Request & { rawBody?: Buffer }, _response, buffer) => { request.rawBody = Buffer.from(buffer); } }));
  app.use(urlencoded({ extended: true, limit: "8mb" }));
  app.setGlobalPrefix("api");
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: (process.env.WEB_ORIGIN ?? "http://localhost:3500").split(","), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const config = new DocumentBuilder().setTitle("Yoleotard CRM API").setVersion("0.1").build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, config));
  await app.listen(Number(process.env.API_PORT ?? 4500), "0.0.0.0");
}
bootstrap();
