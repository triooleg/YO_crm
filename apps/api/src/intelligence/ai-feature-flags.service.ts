import { Injectable } from "@nestjs/common";
import { AiMode, ContactChannel } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import {AiControlService} from "./ai-control.service";

function enabled(name: string, fallback = false) {
  const value = process.env[name];
  return value === undefined ? fallback : value.toLowerCase() === "true";
}

@Injectable()
export class AiFeatureFlagsService {
  constructor(private readonly prisma: PrismaService,private readonly control:AiControlService) {}

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

  effective(input:{channel?:ContactChannel;clientId?:string;conversationId?:string}={}){return this.control.effective(input)}

  async resolveMode(input: { channel?: ContactChannel; clientId?: string; conversationId?: string }) {
    const effective=await this.effective(input);
    if (!effective.masterEnabled) return AiMode.OFF;
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
      ?? effective.mode as AiMode;
    // Legacy overrides may restrict a scope to OFF, but cannot elevate the
    // effective server/database policy to ASSIST or an autonomous mode.
    if(requested===AiMode.OFF)return AiMode.OFF;
    return effective.mode as AiMode;
  }
}
