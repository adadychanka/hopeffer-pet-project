import {
  Check,
  Column,
  Entity,
  ForeignKey,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { sqlList } from '../database/sql-list.js';
import { Lot } from './lot.entity.js';

export const LOT_PHOTO_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type LotPhotoContentType = (typeof LOT_PHOTO_CONTENT_TYPES)[number];

// Metadata of one image of a lot. The file itself lives in object storage
// under storage_key.
@Entity({ name: 'lot_photos' })
@Unique('lot_photos_storage_key_key', ['storageKey'])
// Checked at commit, so photos can be reordered in one transaction.
@Unique('lot_photos_lot_id_position_key', ['lotId', 'position'], {
  deferrable: 'INITIALLY DEFERRED',
})
@Check(
  'lot_photos_original_filename_length',
  'char_length("original_filename") BETWEEN 1 AND 255',
)
@Check(
  'lot_photos_content_type_check',
  `"content_type" IN (${sqlList(LOT_PHOTO_CONTENT_TYPES)})`,
)
@Check('lot_photos_size_bytes_positive', '"size_bytes" > 0')
@Check('lot_photos_width_px_positive', '"width_px" > 0')
@Check('lot_photos_height_px_positive', '"height_px" > 0')
@Check('lot_photos_position_not_negative', '"position" >= 0')
export class LotPhoto {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'lot_photos_pkey',
  })
  id!: string;

  @Column({ type: 'uuid', name: 'lot_id' })
  @ForeignKey(() => Lot, 'id', {
    name: 'lot_photos_lot_id_fkey',
    onDelete: 'CASCADE',
  })
  lotId!: string;

  @Column({ type: 'text', name: 'storage_key' })
  storageKey!: string;

  @Column({ type: 'text', name: 'original_filename' })
  originalFilename!: string;

  @Column({ type: 'text', name: 'content_type' })
  contentType!: LotPhotoContentType;

  @Column({ type: 'integer', name: 'size_bytes' })
  sizeBytes!: number;

  @Column({ type: 'integer', name: 'width_px' })
  widthPx!: number;

  @Column({ type: 'integer', name: 'height_px' })
  heightPx!: number;

  @Column({ type: 'integer', name: 'position' })
  position!: number;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @Column({ type: 'timestamptz', name: 'uploaded_at', default: () => 'now()' })
  uploadedAt!: Date;
  /* v8 ignore stop */
}
