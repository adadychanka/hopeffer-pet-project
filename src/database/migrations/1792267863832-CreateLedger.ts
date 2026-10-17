import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLedger1792267863832 implements MigrationInterface {
  name = 'CreateLedger1792267863832';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "top_ups" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "company_id" uuid NOT NULL, "amount_minor" bigint NOT NULL, "bank_reference" text NOT NULL, "transfer_date" date NOT NULL, "invoice_id" uuid, "operator_ref" text NOT NULL, "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "top_ups_bank_reference_key" UNIQUE ("bank_reference"), CONSTRAINT "top_ups_bank_reference_normalized" CHECK ("bank_reference" = upper(btrim("bank_reference")) AND "bank_reference" <> ''), CONSTRAINT "top_ups_amount_positive" CHECK ("amount_minor" > 0), CONSTRAINT "top_ups_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "corrections" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "company_id" uuid NOT NULL, "amount_minor" bigint NOT NULL, "reason" text NOT NULL, "top_up_id" uuid, "operator_ref" text NOT NULL, "idempotency_key" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "corrections_idempotency_key_key" UNIQUE ("idempotency_key"), CONSTRAINT "corrections_reason_length" CHECK (char_length("reason") BETWEEN 1 AND 1000), CONSTRAINT "corrections_amount_not_zero" CHECK ("amount_minor" <> 0), CONSTRAINT "corrections_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "ledger_transfers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "type" text NOT NULL, "top_up_id" uuid, "invoice_id" uuid, "deal_id" uuid, "correction_id" uuid, "actor_type" text NOT NULL, "actor_ref" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ledger_transfers_correction_id_key" UNIQUE ("correction_id"), CONSTRAINT "ledger_transfers_top_up_id_key" UNIQUE ("top_up_id"), CONSTRAINT "ledger_transfers_actor_ref_matches_type" CHECK (("actor_type" = 'system') = ("actor_ref" IS NULL)), CONSTRAINT "ledger_transfers_actor_type_check" CHECK ("actor_type" IN ('buyer', 'seller', 'operator', 'system')), CONSTRAINT "ledger_transfers_correction_matches_type" CHECK (("type" = 'correction') = ("correction_id" IS NOT NULL)), CONSTRAINT "ledger_transfers_deal_matches_type" CHECK (("type" IN ('payout', 'refund')) = ("deal_id" IS NOT NULL)), CONSTRAINT "ledger_transfers_invoice_matches_type" CHECK (("type" = 'invoice_payment') = ("invoice_id" IS NOT NULL)), CONSTRAINT "ledger_transfers_top_up_matches_type" CHECK (("type" = 'top_up') = ("top_up_id" IS NOT NULL)), CONSTRAINT "ledger_transfers_one_source" CHECK (num_nonnulls("top_up_id", "invoice_id", "deal_id", "correction_id") = 1), CONSTRAINT "ledger_transfers_type_check" CHECK ("type" IN ('top_up', 'invoice_payment', 'payout', 'refund', 'correction')), CONSTRAINT "ledger_transfers_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ledger_transfers_deal_settlement_key" ON "ledger_transfers"  ("deal_id") WHERE "type" IN ('payout', 'refund')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ledger_transfers_invoice_payment_key" ON "ledger_transfers"  ("invoice_id") WHERE "type" = 'invoice_payment'`,
    );
    await queryRunner.query(
      `CREATE TABLE "ledger_entries" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "transfer_id" uuid NOT NULL, "account_id" uuid NOT NULL, "amount_minor" bigint NOT NULL, "balance_after_minor" bigint NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "ledger_entries_amount_not_zero" CHECK ("amount_minor" <> 0), CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ledger_entries_account_id_id_idx" ON "ledger_entries"  ("account_id", "id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ledger_entries_transfer_id_idx" ON "ledger_entries"  ("transfer_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "accounts"("company_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "top_ups" ADD CONSTRAINT "top_ups_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "corrections" ADD CONSTRAINT "corrections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "accounts"("company_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "corrections" ADD CONSTRAINT "corrections_top_up_id_fkey" FOREIGN KEY ("top_up_id") REFERENCES "top_ups"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_transfers" ADD CONSTRAINT "ledger_transfers_top_up_id_fkey" FOREIGN KEY ("top_up_id") REFERENCES "top_ups"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_transfers" ADD CONSTRAINT "ledger_transfers_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_transfers" ADD CONSTRAINT "ledger_transfers_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_transfers" ADD CONSTRAINT "ledger_transfers_correction_id_fkey" FOREIGN KEY ("correction_id") REFERENCES "corrections"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "ledger_transfers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // Hand-written below. Zero-sum rule: at commit, a transfer has at least
    // two entries and they sum to 0. The trigger on transfers catches a
    // transfer with no entries; the trigger on entries catches an entry
    // added later to an older transfer. Both raise one rule name, so the
    // reported rule never depends on which trigger runs first.
    await queryRunner.query(`
            CREATE FUNCTION check_transfer_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
            DECLARE
                checked_transfer_id uuid;
                entry_count bigint;
                entry_sum numeric;
            BEGIN
                IF TG_TABLE_NAME = 'ledger_entries' THEN
                    checked_transfer_id := NEW.transfer_id;
                ELSE
                    checked_transfer_id := NEW.id;
                END IF;
                SELECT count(*), coalesce(sum(amount_minor), 0)
                    INTO entry_count, entry_sum
                    FROM ledger_entries WHERE transfer_id = checked_transfer_id;
                IF entry_count < 2 OR entry_sum <> 0 THEN
                    RAISE EXCEPTION 'ledger transfer % has % entries summing to %',
                        checked_transfer_id, entry_count, entry_sum
                        USING ERRCODE = 'check_violation',
                              CONSTRAINT = 'ledger_transfers_balanced';
                END IF;
                RETURN NULL;
            END
            $$`);
    await queryRunner.query(
      `CREATE CONSTRAINT TRIGGER ledger_transfers_balanced AFTER INSERT ON ledger_transfers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transfer_balanced()`,
    );
    await queryRunner.query(
      `CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_transfer_balanced()`,
    );
    // The ledger is append-only. TRUNCATE skips row triggers, so it gets its own.
    await queryRunner.query(
      `CREATE TRIGGER ledger_transfers_append_only BEFORE UPDATE OR DELETE ON ledger_transfers FOR EACH ROW EXECUTE FUNCTION reject_change()`,
    );
    await queryRunner.query(
      `CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION reject_change()`,
    );
    await queryRunner.query(
      `CREATE TRIGGER ledger_transfers_no_truncate BEFORE TRUNCATE ON ledger_transfers FOR EACH STATEMENT EXECUTE FUNCTION reject_change()`,
    );
    await queryRunner.query(
      `CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries FOR EACH STATEMENT EXECUTE FUNCTION reject_change()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER ledger_entries_no_truncate ON ledger_entries`,
    );
    await queryRunner.query(
      `DROP TRIGGER ledger_transfers_no_truncate ON ledger_transfers`,
    );
    await queryRunner.query(
      `DROP TRIGGER ledger_entries_append_only ON ledger_entries`,
    );
    await queryRunner.query(
      `DROP TRIGGER ledger_transfers_append_only ON ledger_transfers`,
    );
    await queryRunner.query(
      `DROP TRIGGER ledger_entries_balanced ON ledger_entries`,
    );
    await queryRunner.query(
      `DROP TRIGGER ledger_transfers_balanced ON ledger_transfers`,
    );
    await queryRunner.query(`DROP FUNCTION check_transfer_balanced()`);
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_account_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_transfer_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_transfers" DROP CONSTRAINT "ledger_transfers_correction_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_transfers" DROP CONSTRAINT "ledger_transfers_deal_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_transfers" DROP CONSTRAINT "ledger_transfers_invoice_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ledger_transfers" DROP CONSTRAINT "ledger_transfers_top_up_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "corrections" DROP CONSTRAINT "corrections_top_up_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "corrections" DROP CONSTRAINT "corrections_company_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "top_ups" DROP CONSTRAINT "top_ups_invoice_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "top_ups" DROP CONSTRAINT "top_ups_company_id_fkey"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ledger_entries_transfer_id_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ledger_entries_account_id_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "ledger_entries"`);
    await queryRunner.query(
      `DROP INDEX "public"."ledger_transfers_invoice_payment_key"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."ledger_transfers_deal_settlement_key"`,
    );
    await queryRunner.query(`DROP TABLE "ledger_transfers"`);
    await queryRunner.query(`DROP TABLE "corrections"`);
    await queryRunner.query(`DROP TABLE "top_ups"`);
  }
}
