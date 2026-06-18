-- Offer flow: registration number (input) + extracted offer price.
ALTER TABLE "Order" ADD COLUMN "registrationNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "offerPrice" TEXT;
