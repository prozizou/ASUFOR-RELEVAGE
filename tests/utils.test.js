import { describe, it, expect } from 'vitest';
import { isDone, hasAnomaly, computeConso, computeApaid, isIndexDoubled } from '../JS/utils.js';

describe('isDone', () => {
    it('returns true for boolean true', () => {
        expect(isDone({ statut: true })).toBe(true);
    });

    it('returns true for the legacy string "true"', () => {
        expect(isDone({ statut: 'true' })).toBe(true);
    });

    it('returns false when statut is false, missing, or any other value', () => {
        expect(isDone({ statut: false })).toBe(false);
        expect(isDone({})).toBe(false);
        expect(isDone({ statut: 'false' })).toBe(false);
    });
});

describe('hasAnomaly', () => {
    it('returns true when note is a non-empty string', () => {
        expect(hasAnomaly({ note: 'Anomalie signalée' })).toBe(true);
    });

    it('returns false when note is missing, empty, or blank', () => {
        expect(hasAnomaly({})).toBe(false);
        expect(hasAnomaly({ note: '' })).toBe(false);
        expect(hasAnomaly({ note: '   ' })).toBe(false);
        expect(hasAnomaly({ note: null })).toBe(false);
    });
});

describe('computeConso', () => {
    it('computes the difference between new_index and last_index', () => {
        expect(computeConso({ new_index: 120, last_index: 100 })).toBe(20);
    });

    it('treats missing values as 0', () => {
        expect(computeConso({ new_index: 50 })).toBe(50);
        expect(computeConso({ last_index: 50 })).toBe(-50);
        expect(computeConso({})).toBe(0);
    });

    it('coerces numeric strings', () => {
        expect(computeConso({ new_index: '120', last_index: '100' })).toBe(20);
    });
});

describe('computeApaid', () => {
    it('multiplies consumption by the default price per m3', () => {
        expect(computeApaid(10)).toBe(2500);
    });

    it('rounds to the nearest integer', () => {
        expect(computeApaid(10.004)).toBe(2501);
    });

    it('accepts a custom price per m3', () => {
        expect(computeApaid(10, 300)).toBe(3000);
    });
});

describe('isIndexDoubled', () => {
    it('returns true when the new index is at least double the last index', () => {
        expect(isIndexDoubled(200, 100)).toBe(true);
        expect(isIndexDoubled(201, 100)).toBe(true);
    });

    it('returns false when the new index is less than double the last index', () => {
        expect(isIndexDoubled(199, 100)).toBe(false);
        expect(isIndexDoubled(150, 100)).toBe(false);
    });

    it('returns false when the last index is 0 or missing (nothing to compare against)', () => {
        expect(isIndexDoubled(500, 0)).toBe(false);
        expect(isIndexDoubled(500, undefined)).toBe(false);
        expect(isIndexDoubled(500, null)).toBe(false);
    });

    it('coerces numeric strings', () => {
        expect(isIndexDoubled('200', '100')).toBe(true);
    });
});
