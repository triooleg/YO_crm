import { AiRunStatus, Prisma } from "@prisma/client";

export type AiFeedbackReservation = {
  aiRunId: string;
  clientId: string;
  conversationId: string;
};

export async function reserveAiFeedback(tx: Prisma.TransactionClient, input: AiFeedbackReservation) {
  const result = await tx.aiResponseFeedback.updateMany({
    where: {
      aiRunId: input.aiRunId,
      sentMessageId: null,
      accepted: null,
      aiRun: {
        clientId: input.clientId,
        conversationId: input.conversationId,
        operation: "REPLY",
        status: AiRunStatus.COMPLETED,
      },
    },
    data: { accepted: false, rejected: false },
  });
  return result.count === 1;
}
