// js/utils.js
import { PRICE_PER_M3 } from './config.js';

export function isDone(data) {
    return data.statut === true || data.statut === 'true';
}

export function hasAnomaly(data) {
    return !!(data.note && data.note.trim());
}

export function computeConso(data) {
    return (Number(data.new_index) || 0) - (Number(data.last_index) || 0);
}

export function computeApaid(conso, pricePerM3 = PRICE_PER_M3) {
    return Math.round(conso * pricePerM3);
}
