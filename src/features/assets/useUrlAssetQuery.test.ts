import { describe, expect, it } from 'vitest';
import type { AssetListQuery } from './useAssetList';
import { parseQueryFromSearch, serializeQueryToSearch } from './useUrlAssetQuery';

describe('URL query state', () => {
  it('restores a full view from a shared link', () => {
    const q = parseQueryFromSearch('?q=studio&status=approved,draft&kind=image&tag=hero&sort=name:asc');
    expect(q).toEqual({
      q: 'studio',
      status: ['approved', 'draft'],
      kind: ['image'],
      tag: ['hero'],
      sort: 'name:asc',
    });
  });

  it('drops unknown enum values rather than passing them to the API', () => {
    const q = parseQueryFromSearch('?status=approved,banana&kind=hologram&sort=nonsense');
    expect(q.status).toEqual(['approved']);
    expect(q.kind).toBeUndefined();
    expect(q.sort).toBe('updatedAt:desc'); // unknown sort falls back to the default
  });

  it('omits the default sort and empty fields from the URL', () => {
    expect(serializeQueryToSearch({ sort: 'updatedAt:desc' })).toBe('');
    expect(serializeQueryToSearch({ q: 'x', sort: 'updatedAt:desc' })).toBe('?q=x');
    expect(serializeQueryToSearch({ status: ['draft'], sort: 'name:asc' })).toBe(
      '?status=draft&sort=name%3Aasc',
    );
  });

  it('round-trips a normalised query', () => {
    const original: AssetListQuery = {
      q: 'annual report',
      status: ['in_review'],
      kind: ['document'],
      tag: ['q4', 'finance'],
      sort: 'sizeBytes:desc',
    };
    expect(parseQueryFromSearch(serializeQueryToSearch(original))).toEqual(original);
  });

  it('never carries a cursor (pagination is not shareable state)', () => {
    expect(serializeQueryToSearch({ q: 'x', cursor: 'abc' } as never)).not.toContain('cursor');
  });
});
