import { describe, it, expect } from '@jest/globals';

describe('Basic Test Suite', () => {
  it('should be able to run basic tests', () => {
    expect(true).toBe(true);
  });

  it('should be able to perform arithmetic', () => {
    expect(2 + 2).toBe(4);
  });

  it('should handle async operations', async () => {
    const result = await Promise.resolve('test');
    expect(result).toBe('test');
  });
}); 