-- CreateTable
CREATE TABLE "BudgetState" (
    "userId" TEXT NOT NULL,
    "dataJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetState_pkey" PRIMARY KEY ("userId")
);
