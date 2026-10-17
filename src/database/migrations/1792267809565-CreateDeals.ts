import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeals1792267809565 implements MigrationInterface {
  name = 'CreateDeals1792267809565';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Hand-written: the invoices table's default needs these before the table exists.
    await queryRunner.query(`CREATE SEQUENCE invoice_number_seq`);
    // INV-<year>-<number>, padded to at least 6 digits and never cut, so
    // numbers past 999999 cannot collide with earlier ones.
    await queryRunner.query(`
            CREATE FUNCTION next_invoice_number() RETURNS text LANGUAGE plpgsql AS $$
            DECLARE
                n bigint := nextval('invoice_number_seq');
            BEGIN
                RETURN 'INV-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-'
                    || lpad(n::text, greatest(6, length(n::text)), '0');
            END
            $$`);
    await queryRunner.query(
      `CREATE TABLE "deals" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "lot_id" uuid NOT NULL, "buyer_company_id" uuid NOT NULL, "seller_company_id" uuid NOT NULL, "quantity" integer NOT NULL, "unit_price_minor" bigint NOT NULL, "total_minor" bigint NOT NULL, "status" text NOT NULL, "confirmation_due_at" TIMESTAMP WITH TIME ZONE, "idempotency_key" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "deals_buyer_idempotency_key_key" UNIQUE ("buyer_company_id", "idempotency_key"), CONSTRAINT "deals_shipped_has_deadline" CHECK (("status" IN ('shipped', 'disputed', 'completed')) <= ("confirmation_due_at" IS NOT NULL)), CONSTRAINT "deals_status_check" CHECK ("status" IN ('awaiting_payment', 'paid', 'shipped', 'disputed', 'completed', 'cancelled', 'expired', 'refunded')), CONSTRAINT "deals_buyer_not_seller" CHECK ("buyer_company_id" <> "seller_company_id"), CONSTRAINT "deals_total_matches" CHECK ("total_minor" = "quantity" * "unit_price_minor"), CONSTRAINT "deals_unit_price_positive" CHECK ("unit_price_minor" > 0), CONSTRAINT "deals_quantity_positive" CHECK ("quantity" >= 1), CONSTRAINT "deals_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "deals_shipped_confirmation_due_at_idx" ON "deals"  ("confirmation_due_at") WHERE "status" = 'shipped'`,
    );
    await queryRunner.query(
      `CREATE INDEX "deals_lot_id_idx" ON "deals"  ("lot_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "deals_seller_company_id_status_idx" ON "deals"  ("seller_company_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "deals_buyer_company_id_status_idx" ON "deals"  ("buyer_company_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "deal_status_changes" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "deal_id" uuid NOT NULL, "from_status" text, "to_status" text NOT NULL, "actor_type" text NOT NULL, "actor_ref" text, "reason" text, "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "deal_status_changes_reason_required" CHECK ("to_status" NOT IN ('disputed', 'refunded') OR ("reason" IS NOT NULL AND btrim("reason") <> '')), CONSTRAINT "deal_status_changes_actor_ref_matches_type" CHECK (("actor_type" = 'system') = ("actor_ref" IS NULL)), CONSTRAINT "deal_status_changes_actor_type_check" CHECK ("actor_type" IN ('buyer', 'seller', 'operator', 'system')), CONSTRAINT "deal_status_changes_to_status_check" CHECK ("to_status" IN ('awaiting_payment', 'paid', 'shipped', 'disputed', 'completed', 'cancelled', 'expired', 'refunded')), CONSTRAINT "deal_status_changes_from_status_check" CHECK ("from_status" IS NULL OR "from_status" IN ('awaiting_payment', 'paid', 'shipped', 'disputed', 'completed', 'cancelled', 'expired', 'refunded')), CONSTRAINT "deal_status_changes_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "deal_status_changes_deal_id_id_idx" ON "deal_status_changes"  ("deal_id", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "deal_status_changes_creation_key" ON "deal_status_changes"  ("deal_id") WHERE "from_status" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "invoices" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "deal_id" uuid NOT NULL, "number" text NOT NULL DEFAULT next_invoice_number(), "amount_minor" bigint NOT NULL, "status" text NOT NULL, "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL, "due_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "paid_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "invoices_number_key" UNIQUE ("number"), CONSTRAINT "invoices_deal_id_key" UNIQUE ("deal_id"), CONSTRAINT "invoices_paid_at_matches_status" CHECK (("status" = 'paid') = ("paid_at" IS NOT NULL)), CONSTRAINT "invoices_dates_ordered" CHECK ("issued_at" <= "due_at" AND "due_at" <= "expires_at"), CONSTRAINT "invoices_status_check" CHECK ("status" IN ('issued', 'paid', 'cancelled', 'expired')), CONSTRAINT "invoices_amount_positive" CHECK ("amount_minor" > 0), CONSTRAINT "invoices_number_format" CHECK ("number" ~ '^INV-[0-9]{4}-[0-9]{6,}$'), CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "invoices_issued_expires_at_idx" ON "invoices"  ("expires_at") WHERE "status" = 'issued'`,
    );
    await queryRunner.query(
      `ALTER TABLE "deals" ADD CONSTRAINT "deals_buyer_company_id_fkey" FOREIGN KEY ("buyer_company_id") REFERENCES "accounts"("company_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "deals" ADD CONSTRAINT "deals_seller_company_id_fkey" FOREIGN KEY ("seller_company_id") REFERENCES "accounts"("company_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "deals" ADD CONSTRAINT "deals_lot_seller_fkey" FOREIGN KEY ("lot_id", "seller_company_id") REFERENCES "lots"("id","seller_company_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "deal_status_changes" ADD CONSTRAINT "deal_status_changes_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // Hand-written: status history is append-only.
    await queryRunner.query(
      `CREATE TRIGGER deal_status_changes_append_only BEFORE UPDATE OR DELETE ON deal_status_changes FOR EACH ROW EXECUTE FUNCTION reject_change()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER deal_status_changes_append_only ON deal_status_changes`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "invoices_deal_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deal_status_changes" DROP CONSTRAINT "deal_status_changes_deal_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deals" DROP CONSTRAINT "deals_lot_seller_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deals" DROP CONSTRAINT "deals_seller_company_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "deals" DROP CONSTRAINT "deals_buyer_company_id_fkey"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."invoices_issued_expires_at_idx"`,
    );
    await queryRunner.query(`DROP TABLE "invoices"`);
    await queryRunner.query(
      `DROP INDEX "public"."deal_status_changes_creation_key"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."deal_status_changes_deal_id_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "deal_status_changes"`);
    await queryRunner.query(
      `DROP INDEX "public"."deals_buyer_company_id_status_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."deals_seller_company_id_status_idx"`,
    );
    await queryRunner.query(`DROP INDEX "public"."deals_lot_id_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."deals_shipped_confirmation_due_at_idx"`,
    );
    await queryRunner.query(`DROP TABLE "deals"`);
    await queryRunner.query(`DROP FUNCTION next_invoice_number()`);
    await queryRunner.query(`DROP SEQUENCE invoice_number_seq`);
  }
}
