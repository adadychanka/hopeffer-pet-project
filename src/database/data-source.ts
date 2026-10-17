// DataSource for the TypeORM CLI (migrations). It loads the compiled output in
// dist/, because the CLI needs emitted decorator metadata that tsx/esbuild
// cannot produce.
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateMigrationEnv } from '../config/env.js';
import { buildTypeOrmOptions } from './typeorm-options.js';

const { DATABASE_URL } = validateMigrationEnv(process.env);

export default new DataSource({
  ...buildTypeOrmOptions(DATABASE_URL),
  entities: [`${import.meta.dirname}/../**/*.entity.js`],
  migrations: [`${import.meta.dirname}/migrations/*.js`],
});
