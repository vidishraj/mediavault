import { describe, it, expect, vi } from 'vitest';
import {
  GENERIC_ERROR_TITLE,
  KNOWN_ERROR_CODES,
  describeError,
  messageForApiError,
} from './messages';

describe('messageForApiError copy table', () => {
  it('maps every known code to a distinct, non-generic title', () => {
    const titles = KNOWN_ERROR_CODES.map((code) => messageForApiError({ code }));

    // No code collapses to the generic fallback...
    for (const title of titles) {
      expect(title).not.toBeNull();
      expect(title).not.toBe(GENERIC_ERROR_TITLE);
    }
    // ...and every code yields a DISTINCT title. This single assertion catches
    // the whole silent-collapse class: a collapse makes N codes yield 1 string,
    // so the distinct count drops below the code count.
    expect(new Set(titles).size).toBe(KNOWN_ERROR_CODES.length);
  });

  it('keeps an aborted request silent (null)', () => {
    expect(messageForApiError({ code: 'aborted' })).toBeNull();
  });

  it('falls back to the generic message for an unrecognised code', () => {
    expect(messageForApiError({ code: 'not_a_real_code' })).toBe(GENERIC_ERROR_TITLE);
  });
});

describe('describeError narrows structurally', () => {
  it('maps a typed ApiError by its code', () => {
    expect(describeError({ code: 'legal_hold' })).toBe(messageForApiError({ code: 'legal_hold' }));
  });

  it('stays silent on an aborted request', () => {
    expect(describeError({ code: 'aborted' })).toBeNull();
  });

  it('does not silently collapse a plain Error: generic string plus a dev warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(describeError(new Error('boom'))).toBe(GENERIC_ERROR_TITLE);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
