import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

// A legal entity on the marketplace: a seller, a buyer, or both. The email is
// the company's contact address (billing, notifications), not a login.
@Entity({ name: 'companies' })
@Unique('companies_registration_number_key', ['registrationNumber'])
// Created by hand in the migration: unique on lower(email), so the address is
// unique regardless of letter case. TypeORM cannot express the expression.
@Index('companies_email_lower_key', { synchronize: false })
@Check('companies_name_length', 'char_length("name") BETWEEN 1 AND 300')
@Check(
  'companies_email_format',
  `char_length("email") <= 254 AND "email" ~ '^[^@\\s]+@[^@\\s]+$'`,
)
export class Company {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'companies_pkey',
  })
  id!: string;

  @Column({ type: 'text', name: 'name' })
  name!: string;

  @Column({ type: 'text', name: 'registration_number' })
  registrationNumber!: string;

  @Column({ type: 'text', name: 'email' })
  email!: string;

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
  /* v8 ignore stop */

  /* v8 ignore start -- TS decorator metadata branch for a Date property, not app logic */
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
  /* v8 ignore stop */
}
