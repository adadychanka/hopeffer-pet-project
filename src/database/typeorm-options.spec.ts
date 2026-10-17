import { describe, expect, it } from 'vitest';
import { buildTypeOrmOptions } from './typeorm-options.js';

describe('buildTypeOrmOptions', () => {
  it('connects to the given URL with gen_random_uuid() keys and no extension install', () => {
    expect(buildTypeOrmOptions('postgres://db:5432/app')).toEqual({
      type: 'postgres',
      url: 'postgres://db:5432/app',
      uuidExtension: 'pgcrypto',
      installExtensions: false,
    });
  });
});
