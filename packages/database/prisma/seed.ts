import argon2 from "argon2";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error("OWNER_EMAIL and OWNER_PASSWORD (12+ chars) are required");
  }
  await prisma.user.upsert({
    where: { email },
    update: { active: true },
    create: {
      email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      displayName: process.env.OWNER_DISPLAY_NAME ?? "Yoleotard Owner",
      role: UserRole.OWNER
    }
  });
}

main().finally(() => prisma.$disconnect());
