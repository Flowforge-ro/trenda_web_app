-- Rename Order columns to English identifiers (data preserved).
ALTER TABLE "Order" RENAME COLUMN "emailFurnizor" TO "vendorEmail";
ALTER TABLE "Order" RENAME COLUMN "serieSasiu" TO "chassisSeries";
ALTER TABLE "Order" RENAME COLUMN "piesa" TO "partCode";
