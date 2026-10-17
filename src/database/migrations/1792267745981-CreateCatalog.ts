import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalog1792267745981 implements MigrationInterface {
  name = 'CreateCatalog1792267745981';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "lots" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "seller_company_id" uuid NOT NULL, "title" text NOT NULL, "unit_price_minor" bigint NOT NULL, "stock_available" integer NOT NULL, "status" text NOT NULL DEFAULT 'hidden', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "lots_id_seller_company_id_key" UNIQUE ("id", "seller_company_id"), CONSTRAINT "lots_status_check" CHECK ("status" IN ('hidden', 'published')), CONSTRAINT "lots_stock_not_negative" CHECK ("stock_available" >= 0), CONSTRAINT "lots_unit_price_positive" CHECK ("unit_price_minor" > 0), CONSTRAINT "lots_title_length" CHECK (char_length("title") BETWEEN 1 AND 200), CONSTRAINT "lots_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "lots_published_created_at_idx" ON "lots"  ("created_at") WHERE "status" = 'published'`,
    );
    await queryRunner.query(
      `CREATE INDEX "lots_seller_company_id_idx" ON "lots"  ("seller_company_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "lot_photos" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "lot_id" uuid NOT NULL, "storage_key" text NOT NULL, "original_filename" text NOT NULL, "content_type" text NOT NULL, "size_bytes" integer NOT NULL, "width_px" integer NOT NULL, "height_px" integer NOT NULL, "position" integer NOT NULL, "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "lot_photos_lot_id_position_key" UNIQUE ("lot_id", "position") DEFERRABLE INITIALLY DEFERRED, CONSTRAINT "lot_photos_storage_key_key" UNIQUE ("storage_key"), CONSTRAINT "lot_photos_position_not_negative" CHECK ("position" >= 0), CONSTRAINT "lot_photos_height_px_positive" CHECK ("height_px" > 0), CONSTRAINT "lot_photos_width_px_positive" CHECK ("width_px" > 0), CONSTRAINT "lot_photos_size_bytes_positive" CHECK ("size_bytes" > 0), CONSTRAINT "lot_photos_content_type_check" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp')), CONSTRAINT "lot_photos_original_filename_length" CHECK (char_length("original_filename") BETWEEN 1 AND 255), CONSTRAINT "lot_photos_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "lot_price_changes" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "lot_id" uuid NOT NULL, "old_price_minor" bigint, "new_price_minor" bigint NOT NULL, "actor_type" text NOT NULL, "actor_ref" text NOT NULL, "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "lot_price_changes_actor_type_check" CHECK ("actor_type" IN ('seller', 'operator')), CONSTRAINT "lot_price_changes_price_changed" CHECK ("old_price_minor" IS DISTINCT FROM "new_price_minor"), CONSTRAINT "lot_price_changes_new_price_positive" CHECK ("new_price_minor" > 0), CONSTRAINT "lot_price_changes_old_price_positive" CHECK ("old_price_minor" IS NULL OR "old_price_minor" > 0), CONSTRAINT "lot_price_changes_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "lot_price_changes_lot_id_id_idx" ON "lot_price_changes"  ("lot_id", "id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "lot_price_changes_creation_key" ON "lot_price_changes"  ("lot_id") WHERE "old_price_minor" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "lots" ADD CONSTRAINT "lots_seller_company_id_fkey" FOREIGN KEY ("seller_company_id") REFERENCES "accounts"("company_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lot_photos" ADD CONSTRAINT "lot_photos_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "lot_price_changes" ADD CONSTRAINT "lot_price_changes_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Hand-written below: the price history is append-only. A direct delete
    // is rejected; the cascade from deleting the lot itself runs inside the
    // foreign key's own trigger (pg_trigger_depth() > 1) and is allowed.
    await queryRunner.query(`
            CREATE FUNCTION reject_price_change_edit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
                    RETURN OLD;
                END IF;
                RAISE EXCEPTION '% rejects %', TG_NAME, TG_OP
                    USING ERRCODE = 'check_violation', CONSTRAINT = TG_NAME;
            END
            $$`);
    await queryRunner.query(
      `CREATE TRIGGER lot_price_changes_append_only BEFORE UPDATE OR DELETE ON lot_price_changes FOR EACH ROW EXECUTE FUNCTION reject_price_change_edit()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER lot_price_changes_append_only ON lot_price_changes`,
    );
    await queryRunner.query(`DROP FUNCTION reject_price_change_edit()`);
    await queryRunner.query(
      `ALTER TABLE "lot_price_changes" DROP CONSTRAINT "lot_price_changes_lot_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lot_photos" DROP CONSTRAINT "lot_photos_lot_id_fkey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lots" DROP CONSTRAINT "lots_seller_company_id_fkey"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."lot_price_changes_creation_key"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."lot_price_changes_lot_id_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "lot_price_changes"`);
    await queryRunner.query(`DROP TABLE "lot_photos"`);
    await queryRunner.query(`DROP INDEX "public"."lots_seller_company_id_idx"`);
    await queryRunner.query(
      `DROP INDEX "public"."lots_published_created_at_idx"`,
    );
    await queryRunner.query(`DROP TABLE "lots"`);
  }
}
