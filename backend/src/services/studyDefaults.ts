import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/http.js";

export type StudyDb = Prisma.TransactionClient | typeof prisma;

export async function permanentShift(db: StudyDb) {
  const shift = await db.shift.findFirst({
    where: { active: true },
    orderBy: [{ fullDay: "desc" }, { createdAt: "asc" }],
  });
  if (!shift) throw new AppError(409, "The permanent study schedule is not configured.", "STUDY_SCHEDULE_MISSING");
  return shift;
}

export async function primaryRoom(db: StudyDb) {
  const room = await db.studyRoom.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!room) throw new AppError(409, "The study space is not configured.", "STUDY_SPACE_MISSING");
  return room;
}
