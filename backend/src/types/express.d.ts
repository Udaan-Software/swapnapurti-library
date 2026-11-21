import type { Admin, Session } from "@prisma/client";
declare global { namespace Express { interface Request { auth?: { admin: Admin; session: Session } } } }
export {};
