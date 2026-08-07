import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HealthController } from "./health.controller";
import { PrismaService } from "./prisma.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { SessionGuard } from "./auth/session.guard";
import { RolesGuard } from "./auth/roles.guard";
import { ClientsController } from "./clients/clients.controller";
import { ClientsService } from "./clients/clients.service";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, AuthController, ClientsController],
  providers: [PrismaService, AuthService, SessionGuard, RolesGuard, ClientsService]
})
export class AppModule {}
