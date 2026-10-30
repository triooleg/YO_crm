import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const enabled = process.env.YO_TRACKING_PGLITE === '1';
// Explicitly opt-in: this is a local test-only installation, not an API/runtime
// dependency. Failure to load it with opt-in enabled must fail, never skip.
const packageUrl = new URL('../../../.local/tracking-notifications/pg-test/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url);
const migrationUrl = new URL('../../../packages/database/prisma/migrations/20261027120000_shipment_notifications/migration.sql', import.meta.url);
const sqlCode = code => error => { assert.equal(error.code, code); return true; };

// The minimal pre-migration shell deliberately contains only referenced tables
// and representative money/status/history fields. This tests the actual new
// SQL and PostgreSQL trigger/constraint semantics, not the complete Prisma diff.
const shell = `
CREATE TYPE "ShippingCarrier" AS ENUM ('NOVA_GLOBAL','DHL');
CREATE TABLE "Client" (id TEXT PRIMARY KEY);
CREATE TABLE "User" (id TEXT PRIMARY KEY);
CREATE TABLE "Conversation" (id TEXT PRIMARY KEY);
CREATE TABLE "Order" (id TEXT PRIMARY KEY, "priceMinor" INTEGER NOT NULL, "paymentStatus" TEXT NOT NULL);
CREATE TABLE "OrderShipment" (id TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"(id),
  carrier "ShippingCarrier" NOT NULL, "trackingNumber" TEXT, "costMinor" INTEGER NOT NULL,
  "shippingStatus" TEXT NOT NULL, "archivedAt" TIMESTAMP(3));
INSERT INTO "Client" VALUES ('client');
INSERT INTO "User" VALUES ('staff');
INSERT INTO "Conversation" VALUES ('chat');
INSERT INTO "Order" VALUES ('order',30000,'PAID');
INSERT INTO "OrderShipment" VALUES ('parcel','order','NOVA_GLOBAL','A123',500,'SHIPPED',NULL);
`;

test('shipment notification migration: real PostgreSQL trigger, uniqueness and history retention',
  { skip: !enabled, timeout: 120_000 }, async t => {
    const { PGlite } = await import(packageUrl.href);
    const db = new PGlite();
    const parcel = async () => (await db.query('SELECT * FROM "OrderShipment" WHERE id=$1', ['parcel'])).rows[0];
    const notification = (id, revision = 1, tracking = 'A123', shipment = 'parcel') => db.query(`
      INSERT INTO "ShipmentNotification"
      (id,"shipmentId","orderId","clientId","conversationId","conversationExternalId","conversationChannel",
       "trackingRevision","trackingNumber","trackingUrl",carrier,language,content,subject,"actorId")
      VALUES ($1,$2,'order','client','chat','provider-recipient','FACEBOOK',$3,$4,$5,'NOVA_GLOBAL','en','Confirmed text','Shipped','staff')`,
    [id, shipment, revision, tracking, `https://novaposhtaglobal.ua/track/?Tracking_ID=${tracking}`]);
    const delivery = (id, channel, requestId, notificationId = 'notice-1', status = 'PENDING') => db.query(`
      INSERT INTO "ShipmentNotificationDelivery"
      (id,"notificationId",channel,recipient,"clientRequestId",status,"updatedAt")
      VALUES ($1,$2,$3,'recipient@example.test',$4,$5,CURRENT_TIMESTAMP)`, [id, notificationId, channel, requestId, status]);
    try {
      await db.exec(shell);
      await db.exec(await readFile(migrationUrl, 'utf8'));
      await t.test('migration preserves historical shipment, money and order status; adds revision 1 and UPS', async () => {
        const p = await parcel();
        assert.equal(p.trackingNumber, 'A123'); assert.equal(p.trackingRevision, 1); assert.equal(p.trackingUrl, null);
        assert.equal(p.costMinor, 500); assert.equal(p.shippingStatus, 'SHIPPED');
        assert.deepEqual((await db.query('SELECT "priceMinor","paymentStatus" FROM "Order"')).rows, [{ priceMinor: 30000, paymentStatus: 'PAID' }]);
        assert.equal((await db.query(`SELECT 'UPS'::"ShippingCarrier" AS carrier`)).rows[0].carrier, 'UPS');
      });
      await t.test('status/money/archive edits and direct revision override cannot invent a tracking revision', async () => {
        await db.exec(`UPDATE "OrderShipment" SET "costMinor"=750,"shippingStatus"='DELIVERED',"archivedAt"=CURRENT_TIMESTAMP,"trackingRevision"=999 WHERE id='parcel'`);
        assert.equal((await parcel()).trackingRevision, 1);
        await db.exec(`UPDATE "OrderShipment" SET "trackingNumber"='A123',"trackingRevision"=-5,"archivedAt"=NULL WHERE id='parcel'`);
        assert.equal((await parcel()).trackingRevision, 1);
      });
      await t.test('A to B to A gets distinct monotonic revisions; carrier/link edits also increment exactly once', async () => {
        await notification('notice-1');
        await db.exec(`UPDATE "OrderShipment" SET "trackingNumber"='B123',"trackingRevision"=999 WHERE id='parcel'`);
        assert.equal((await parcel()).trackingRevision, 2);
        await db.exec(`UPDATE "OrderShipment" SET "trackingNumber"='A123',"trackingRevision"=1 WHERE id='parcel'`);
        assert.equal((await parcel()).trackingRevision, 3);
        await notification('notice-3', 3);
        await db.exec(`UPDATE "OrderShipment" SET carrier='DHL',"trackingUrl"='https://www.dhl.com/track/A123' WHERE id='parcel'`);
        assert.equal((await parcel()).trackingRevision, 4);
        await db.exec(`UPDATE "OrderShipment" SET "trackingUrl"='https://www.dhl.com/track/A123' WHERE id='parcel'`);
        assert.equal((await parcel()).trackingRevision, 4);
        await db.exec(`UPDATE "OrderShipment" SET "trackingUrl"=NULL WHERE id='parcel'`);
        assert.equal((await parcel()).trackingRevision, 5);
        assert.deepEqual((await db.query('SELECT id,"trackingRevision","trackingNumber",content FROM "ShipmentNotification" ORDER BY id')).rows,
          [{ id: 'notice-1', trackingRevision: 1, trackingNumber: 'A123', content: 'Confirmed text' },
            { id: 'notice-3', trackingRevision: 3, trackingNumber: 'A123', content: 'Confirmed text' }]);
      });
      await t.test('one operation per shipment revision, one delivery per channel, globally unique request identity', async () => {
        await assert.rejects(notification('duplicate', 1), sqlCode('23505'));
        await delivery('chat-delivery', 'CHAT', 'request-chat');
        await delivery('email-delivery', 'EMAIL', 'request-email');
        await assert.rejects(delivery('duplicate-channel', 'CHAT', 'new-request'), sqlCode('23505'));
        await assert.rejects(delivery('duplicate-request', 'EMAIL', 'request-email', 'notice-3'), sqlCode('23505'));
        await assert.rejects(delivery('invalid-channel', 'SMS', 'sms-request'), sqlCode('23514'));
        await assert.rejects(delivery('invalid-status', 'CHAT', 'status-request', 'notice-3', 'SOMETHING'), sqlCode('23514'));
        assert.equal((await db.query('SELECT count(*)::int AS n FROM "ShipmentNotificationDelivery"')).rows[0].n, 2);
      });
      await t.test('FK restrictions retain notification history and block removal of every referenced parent', async () => {
        const before = (await db.query('SELECT * FROM "ShipmentNotification" ORDER BY id')).rows;
        for (const [table, id] of [['OrderShipment', 'parcel'], ['Order', 'order'], ['Client', 'client'], ['Conversation', 'chat'], ['User', 'staff'], ['ShipmentNotification', 'notice-1']])
          await assert.rejects(db.query(`DELETE FROM "${table}" WHERE id=$1`, [id]), error => {
            assert.ok(['23001', '23503'].includes(error.code), `restrict/FK violation for ${table}: ${error.code}`);
            return true;
          });
        await assert.rejects(notification('orphan', 1, 'A123', 'missing-parcel'), sqlCode('23503'));
        await assert.rejects(delivery('orphan-delivery', 'EMAIL', 'orphan-request', 'missing-notification'), sqlCode('23503'));
        assert.deepEqual((await db.query('SELECT * FROM "ShipmentNotification" ORDER BY id')).rows, before);
        assert.equal((await parcel()).costMinor, 750);
        assert.equal((await parcel()).shippingStatus, 'DELIVERED');
      });
    } finally { await db.close(); }
  });
