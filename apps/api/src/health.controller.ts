import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async health() {
    await this.prisma.$queryRawUnsafe("SELECT 1");
    return { ok: true, service: "yoleotard-crm-api" };
  }
}
