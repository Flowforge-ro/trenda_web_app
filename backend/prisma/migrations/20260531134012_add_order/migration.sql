-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailFurnizor" TEXT NOT NULL,
    "serieSasiu" TEXT NOT NULL,
    "piesa" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'În așteptare',
    "orderNumber" TEXT,
    "deliveryTime" TEXT,
    "internetMessageId" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'trimis',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
