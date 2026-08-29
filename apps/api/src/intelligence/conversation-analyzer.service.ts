import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";

export function deterministicAnalysis(text: string) {
  const value = text.trim();
  const cyrillic = (value.match(/[А-Яа-яЁёІіЇїЄє]/g) || []).length;
  const latin = (value.match(/[A-Za-z]/g) || []).length;
  const language = cyrillic > latin ? "ru" : latin ? "en" : undefined;
  const question = /\?|\b(how|when|where|what|price|cost|can|could)\b/i.test(value);
  const commercial = /\b(price|cost|order|buy|payment|deposit|delivery)\b|цен|заказ|оплат|достав/i.test(value);
  return { language, intent: commercial ? "COMMERCIAL_INQUIRY" : question ? "QUESTION" : "MESSAGE", requiresReply: question || commercial, commercialIntent: commercial, confidence: 0.65 };
}

@Injectable()
export class ConversationAnalyzerService {
  constructor(private readonly prisma: PrismaService) {}
  async analyze(messageId: string, version = "rules-v1") {
    const message = await this.prisma.message.findUnique({ where: { id: messageId }, select: { id: true, content: true } });
    if (!message) return null;
    const result = deterministicAnalysis(message.content);
    await this.prisma.$transaction([
      this.prisma.messageAnalysis.upsert({ where: { messageId_analysisVersion: { messageId, analysisVersion: version } }, create: { messageId, ...result, extractor: "deterministic-rules", analysisVersion: version }, update: { ...result, extractor: "deterministic-rules" } }),
      this.prisma.message.update({ where: { id: messageId }, data: { normalizedText: message.content.normalize("NFKC"), language: result.language, aiProcessedAt: new Date(), aiAnalysisVersion: version } }),
    ]);
    return result;
  }
}
