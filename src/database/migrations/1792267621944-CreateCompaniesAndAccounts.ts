import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCompaniesAndAccounts1792267621944 implements MigrationInterface {
  name = 'CreateCompaniesAndAccounts1792267621944';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "companies" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" text NOT NULL, "registration_number" text NOT NULL, "email" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "companies_registration_number_key" UNIQUE ("registration_number"), CONSTRAINT "companies_email_format" CHECK (char_length("email") <= 254 AND "email" ~ '^[^@\\s]+@[^@\\s]+$'), CONSTRAINT "companies_name_length" CHECK (char_length("name") BETWEEN 1 AND 300), CONSTRAINT "companies_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "type" text NOT NULL, "company_id" uuid, "balance_minor" bigint NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "accounts_company_id_key" UNIQUE ("company_id"), CONSTRAINT "accounts_bank_clearing_not_positive" CHECK ("type" <> 'bank_clearing' OR "balance_minor" <= 0), CONSTRAINT "accounts_balance_not_negative" CHECK ("type" = 'bank_clearing' OR "balance_minor" >= 0), CONSTRAINT "accounts_company_matches_type" CHECK (("type" = 'company_wallet') = ("company_id" IS NOT NULL)), CONSTRAINT "accounts_type_check" CHECK ("type" IN ('company_wallet', 'escrow', 'bank_clearing')), CONSTRAINT "accounts_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "accounts_platform_type_key" ON "accounts"  ("type") WHERE "type" <> 'company_wallet'`,
    );
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD CONSTRAINT "accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    // Hand-written below: objects TypeORM does not model.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "companies_email_lower_key" ON "companies" (lower("email"))`,
    );
    // Shared guard for append-only tables (deal_status_changes, ledger): the
    // trigger name is the rule name a test or a service sees.
    await queryRunner.query(`
            CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION '% rejects %', TG_NAME, TG_OP
                    USING ERRCODE = 'check_violation', CONSTRAINT = TG_NAME;
            END
            $$`);
    await queryRunner.query(`
            CREATE FUNCTION reject_account_change() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'accounts are never deleted'
                        USING ERRCODE = 'check_violation', CONSTRAINT = TG_NAME;
                END IF;
                IF NEW.type IS DISTINCT FROM OLD.type
                    OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
                    RAISE EXCEPTION 'the type and company of an account never change'
                        USING ERRCODE = 'check_violation', CONSTRAINT = TG_NAME;
                END IF;
                RETURN NEW;
            END
            $$`);
    await queryRunner.query(
      `CREATE TRIGGER accounts_identity_immutable BEFORE UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION reject_account_change()`,
    );
    // The two platform accounts. They have no company.
    await queryRunner.query(
      `INSERT INTO accounts (type) VALUES ('escrow'), ('bank_clearing')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER accounts_identity_immutable ON accounts`,
    );
    await queryRunner.query(`DROP FUNCTION reject_account_change()`);
    await queryRunner.query(`DROP FUNCTION reject_change()`);
    await queryRunner.query(`DROP INDEX "companies_email_lower_key"`);
    await queryRunner.query(
      `ALTER TABLE "accounts" DROP CONSTRAINT "accounts_company_id_fkey"`,
    );
    await queryRunner.query(`DROP INDEX "public"."accounts_platform_type_key"`);
    await queryRunner.query(`DROP TABLE "accounts"`);
    await queryRunner.query(`DROP TABLE "companies"`);
  }
}
