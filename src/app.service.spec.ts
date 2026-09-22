import { describe, expect, it } from 'vitest';
import { AppService } from './app.service.js';

describe('AppService', () => {
  it('getHello returns a JSON hello world payload', () => {
    expect(new AppService().getHello()).toEqual({ message: 'Hello World!' });
  });
});
