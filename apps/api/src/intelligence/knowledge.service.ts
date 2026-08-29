import { Injectable } from "@nestjs/common";
import { KnowledgeStatus } from "@prisma/client";
import { PrismaService } from "../prisma.service";

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async active(language: string, now = new Date(), limit = 12) {
    const items = await this.prisma.knowledgeItem.findMany({
      where: {
        status: KnowledgeStatus.PUBLISHED,
        language: { in: [language, "ru"] },
        OR: [{ validFrom: null }, { validFrom: { lte: now } }],
        AND: [{ OR: [{ validUntil: null }, { validUntil: { gt: now } }] }],
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      take: limit,
      include: { versions: true },
    });
    return items.map(item => ({ ...item, versions: item.versions.filter(version => version.version === item.currentVersion) })).filter(item => item.versions.length === 1);
  }
}
