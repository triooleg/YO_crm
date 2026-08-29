import { Injectable } from "@nestjs/common";
import { AiMode, ContactChannel } from "@prisma/client";
import { PrismaService } from "../prisma.service";

function enabled(name: string, fallback = false) {
  const value = process.env[name];
  return value === undefined ? fallback : value.toLowerCase() === "true";
}

@Injectable()
export class AiFeatureFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  snapshot() {
    return {
      aiEnabled: enabled("AI_ENABLED"),
      messageAnalysisEnabled: enabled("AI_MESSAGE_ANALYSIS_ENABLED"),
      memoryEnabled: enabled("AI_MEMORY_ENABLED"),
      knowledgeEnabled: enabled("AI_KNOWLEDGE_ENABLED"),
      draftsEnabled: enabled("AI_DRAFTS_ENABLED", true),
      autoReplyEnabled: enabled("AI_AUTO_REPLY_ENABLED", false),
    };
  }

  async resolveMode(input: { channel?: ContactChannel; clientId?: string; conversationId?: string }) {
    const flags = this.snapshot();
    if (!flags.aiEnabled) return AiMode.OFF;
    const overrides = await this.prisma.aiModeOverride.findMany({
      where: { OR: [
        ...(input.conversationId ? [{ conversationId: input.conversationId }] : []),
        ...(input.clientId ? [{ clientId: input.clientId, conversationId: null }] : []),
        ...(input.channel ? [{ channel: input.channel, clientId: null, conversationId: null }] : []),
      ] },
    });
    const requested = overrides.find(x => x.conversationId)?.mode
      ?? overrides.find(x => x.clientId && !x.conversationId)?.mode
      ?? overrides.find(x => x.channel && !x.clientId)?.mode
      ?? AiMode.ASSIST;
    if (requested === AiMode.AUTO_SAFE || requested === AiMode.AGENT || requested === AiMode.AUTONOMOUS) {
      // P0 is assist-only. The flag is an additional safety gate, not an implementation switch.
      return AiMode.ASSIST;
    }
    return requested;
  }
}
