-- Update only the explicitly approved existing order. Historical records are otherwise untouched.
UPDATE "Order"
SET number = 'YO-26-0001'
WHERE number = 'YO-2026-1945722'
  AND NOT EXISTS (
    SELECT 1 FROM "Order" WHERE number = 'YO-26-0001'
  );