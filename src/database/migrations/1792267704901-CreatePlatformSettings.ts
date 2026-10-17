import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformSettings1792267704901 implements MigrationInterface {
  name = 'CreatePlatformSettings1792267704901';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "platform_settings" ("id" smallint NOT NULL DEFAULT '1', "payment_window_days" integer NOT NULL DEFAULT '5', "grace_period_days" integer NOT NULL DEFAULT '1', "max_unpaid_deals" integer NOT NULL DEFAULT '3', "expiry_limit" integer NOT NULL DEFAULT '2', "expiry_lookback_days" integer NOT NULL DEFAULT '30', "confirmation_window_days" integer NOT NULL DEFAULT '14', "updated_by_ref" text, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "platform_settings_confirmation_window_days_check" CHECK ("confirmation_window_days" >= 1), CONSTRAINT "platform_settings_expiry_lookback_days_check" CHECK ("expiry_lookback_days" >= 1), CONSTRAINT "platform_settings_expiry_limit_check" CHECK ("expiry_limit" >= 1), CONSTRAINT "platform_settings_max_unpaid_deals_check" CHECK ("max_unpaid_deals" >= 1), CONSTRAINT "platform_settings_grace_period_days_check" CHECK ("grace_period_days" >= 0), CONSTRAINT "platform_settings_payment_window_days_check" CHECK ("payment_window_days" >= 1), CONSTRAINT "platform_settings_single_row" CHECK ("id" = 1), CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id"))`,
    );
    // The single settings row, with the column defaults.
    await queryRunner.query(`INSERT INTO platform_settings DEFAULT VALUES`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "platform_settings"`);
  }
}
